// 내보내기: 영상(MP4, WebCodecs) · GIF(gifenc)
// 화면 녹화가 아니라 책을 정해진 해상도·시간 간격으로 한 프레임씩 렌더 → 끊김·프레임 누락 없음
// - 영상: WebCodecs VideoEncoder + mp4-muxer (H.264 → VP9 → AV1 순으로 지원 확인)
//         미지원 브라우저는 MediaRecorder 실시간 녹화로 대체
// - GIF: 2배 크기로 렌더 후 축소(부드러운 가장자리), 공통 팔레트 + 순서 디더 + 변하지 않은 픽셀 투명 처리
// - 매 프레임 위에 오버레이(챕터 제목) 합성
import { GIFEncoder, quantize, applyPalette } from '../vendor/gifenc.esm.js';
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';

/** 화질 단계: 짧은 변 픽셀 · 영상 fps · GIF 짧은 변 · GIF 프레임 간격(ms, 10ms 단위) · 디더 세기 */
export const QUALITY = {
  low: { short: 720, fps: 30, gifShort: 360, gifDelay: 100, dither: 0 },
  mid: { short: 1080, fps: 30, gifShort: 480, gifDelay: 60, dither: 5 },
  high: { short: 1440, fps: 60, gifShort: 600, gifDelay: 50, dither: 6 },
  max: { short: 2160, fps: 60, gifShort: 720, gifDelay: 40, dither: 7 },
};
export const RATIOS = { '16:9': 16 / 9, '1:1': 1, '9:16': 9 / 16 };

/** 짧은 변 + 비율 → 짝수 W×H */
export function frameSize(short, ratio) {
  const r = RATIOS[ratio] || 16 / 9, even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return r >= 1 ? { W: even(short * r), H: even(short) } : { W: even(short), H: even(short / r) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * 프레임 단위 렌더 루프
 * play(): 책 시간 기준 재생 시퀀스 (book.wait / open / flip 사용)
 * onFrame(canvas, i): 합성된 프레임 처리 (await 가능)
 */
async function capture(book, play, { W, H, fps, length = 1, ss = 1, stillCam = false, overlay, onFrame, realtime = false }) {
  const comp = document.createElement('canvas'); comp.width = W; comp.height = H;
  const ctx = comp.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  book.beginCapture(Math.round(W * ss), Math.round(H * ss), { stillCam });
  const dt = 1 / fps / length; // 길이 배율: 책 시간을 천천히/빠르게
  let done = false, err = null, i = 0;
  const run = play().then(() => { done = true; }, (e) => { done = true; err = e; });
  const t0 = performance.now();
  try {
    while (!done) {
      book.step(dt);
      ctx.drawImage(book.canvas, 0, 0, W, H);
      overlay?.(ctx, W, H, book.time);
      await onFrame(comp, i++);
      if (realtime) { const wait = t0 + (i * 1000) / fps - performance.now(); await new Promise((r) => setTimeout(r, Math.max(0, wait))); }
      else await tick(); // 재생 시퀀스의 Promise가 진행되도록
    }
    await run;
    if (err) throw err;
  } finally { book.endCapture(); }
  return i;
}

// ── 영상
const CODECS = [
  ['avc1.640034', 'avc'], ['avc1.640033', 'avc'], ['avc1.640028', 'avc'], ['avc1.4d0028', 'avc'],
  ['vp09.00.51.08', 'vp9'], ['vp09.00.41.08', 'vp9'], ['av01.0.12M.08', 'av1'], ['av01.0.08M.08', 'av1'],
];
const bitrateFor = (W, H, fps) => Math.min(80e6, Math.round(W * H * fps * 0.2)); // 1080p30 ≈ 12Mbps, 4K60 ≈ 80Mbps(상한)

async function pickCodec(W, H, fps, bitrate) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const [codec, mux] of CODECS) {
    try {
      const cfg = { codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality', ...(mux === 'avc' && { avc: { format: 'avc' } }) };
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return { cfg: r.config || cfg, mux };
    } catch (_) { /* 다음 후보 */ }
  }
  return null;
}

export const canRecordVideo = () => typeof VideoEncoder !== 'undefined' || (typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream);

/** @returns {Promise<{blob, ext}>} */
export async function recordVideo(book, play, { quality = 'mid', ratio = '16:9', length = 1, overlay, onProgress } = {}) {
  const q = QUALITY[quality] || QUALITY.mid;
  const { W, H } = frameSize(q.short, ratio), fps = q.fps, bitrate = bitrateFor(W, H, fps);
  const picked = await pickCodec(W, H, fps, bitrate);
  if (!picked) return recordRealtime(book, play, { W, H, fps: 30, bitrate, length, overlay });

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: picked.mux, width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
  let encErr = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  enc.configure(picked.cfg);
  const us = 1e6 / fps;
  await capture(book, play, {
    W, H, fps, length, overlay,
    onFrame: async (canvas, i) => {
      if (encErr) throw encErr;
      const f = new VideoFrame(canvas, { timestamp: Math.round(i * us), duration: Math.round(us) });
      enc.encode(f, { keyFrame: i % (fps * 2) === 0 }); f.close();
      while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2)); // 인코더가 밀리면 잠깐 대기
      onProgress?.(i);
    },
  });
  await enc.flush(); enc.close();
  if (encErr) throw encErr;
  muxer.finalize();
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4' };
}

/** 대체 경로: 합성 캔버스를 실시간으로 MediaRecorder 녹화 */
async function recordRealtime(book, play, { W, H, fps, bitrate, length, overlay }) {
  const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  let rec, stream, chunks = [], stopped;
  await capture(book, play, {
    W, H, fps, length, overlay, realtime: true,
    onFrame: (canvas, i) => {
      if (i === 0) {
        stream = canvas.captureStream(fps);
        rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: bitrate } : undefined);
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        stopped = new Promise((r) => (rec.onstop = r));
        rec.start(250);
      }
    },
  });
  rec.stop(); await stopped; stream.getTracks().forEach((t) => t.stop());
  const type = rec.mimeType || mime || 'video/webm';
  return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
}

// ── GIF
// 4×4 Bayer 행렬 → -0.5~0.5 (순서 디더: 그러데이션 계단 줄임, 프레임 간 깜빡임 없음)
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

export async function recordGif(book, play, { quality = 'mid', ratio = '16:9', length = 1, overlay, onProgress, onEncode } = {}) {
  const q = QUALITY[quality] || QUALITY.mid;
  const { W, H } = frameSize(q.gifShort, ratio), fps = 1000 / q.gifDelay;
  const shots = [];
  // 1) 프레임 캡처: 2배로 렌더 후 축소 → 가장자리 부드럽게, 임시로 고품질 WebP 저장
  await capture(book, play, {
    W, H, fps, length, overlay, ss: 2, stillCam: true,
    onFrame: (canvas, i) => { shots.push(new Promise((r) => canvas.toBlob(r, 'image/png'))); onProgress?.(i); }, // 무손실 저장 (손실 압축 잡음이 프레임마다 달라 깜빡임의 원인)
  });
  const blobs = await Promise.all(shots);

  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const frame = async (blob) => {
    const bmp = await createImageBitmap(blob);
    ctx.drawImage(bmp, 0, 0, W, H); bmp.close();
    return ctx.getImageData(0, 0, W, H).data;
  };
  // 2) 공통 팔레트: 고르게 뽑은 프레임에서 픽셀 표본
  const picks = Math.min(12, blobs.length), stride = 3, per = Math.ceil(W * H / stride);
  const sample = new Uint8Array(picks * per * 4);
  for (let k = 0, o = 0; k < picks; k++) {
    const d = await frame(blobs[Math.floor((k + 0.5) * blobs.length / picks)]);
    for (let i = 0; i < d.length; i += 4 * stride, o += 4) { sample[o] = d[i]; sample[o + 1] = d[i + 1]; sample[o + 2] = d[i + 2]; sample[o + 3] = 255; }
  }
  const palette = quantize(sample, 255, { format: 'rgb565' });
  const colors = palette.slice(), T = palette.length; palette.push([0, 0, 0]); // 마지막 칸 = 투명 (이전 프레임과 같은 픽셀), 색 매핑에는 안 씀

  // 3) 인코딩
  const gif = GIFEncoder(), amp = q.dither;
  // 시간 안정화: 마지막으로 갱신했을 때의 원본 색(ref)과 거의 같은 픽셀(그러데이션의 미세한 흔들림)은
  // 이전 색을 그대로 유지(투명) → 배경이 번쩍이지 않음. 차이가 쌓여 커지면 그때 갱신
  const STILL = 12; // RGB 차이 합 기준
  // 단, 이렇게 붙잡아 둔 픽셀이 실제 색과 계속 다른 색 칸으로 남아 있으면(책·그림자가 지나간 자리)
  // SETTLE 프레임 연속으로 어긋날 때 한 번 고쳐 그림 → 지나간 흔적이 남지 않음.
  // 흔들림처럼 프레임마다 왔다 갔다 하는 픽셀은 연속으로 어긋나지 않으니 그대로 유지
  const SETTLE = 4;
  const stale = new Uint8Array(W * H);
  let prevIdx = null, ref = null;
  for (let f = 0; f < blobs.length; f++) {
    const data = await frame(blobs[f]);
    const keep = new Uint8Array(W * H);
    if (ref) for (let p = 0, i = 0; p < keep.length; p++, i += 4) {
      if (Math.abs(data[i] - ref[i]) + Math.abs(data[i + 1] - ref[i + 1]) + Math.abs(data[i + 2] - ref[i + 2]) <= STILL) keep[p] = 1;
    }
    const src = Uint8ClampedArray.from(data);
    if (amp) for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
      const dd = BAYER[((y & 3) << 2) | (x & 3)] * amp;
      data[i] += dd; data[i + 1] += dd; data[i + 2] += dd; // Uint8ClampedArray: 자동 0~255
    }
    const idx = applyPalette(data, colors, 'rgb565');
    const out = idx.slice();
    if (!ref) ref = src;
    else for (let p = 0, i = 0; p < idx.length; p++, i += 4) {
      const cur = idx[p], shown = prevIdx[p];
      if (cur === shown) { stale[p] = 0; out[p] = T; continue; } // 투명 = 이전 그대로
      if (keep[p] && ++stale[p] < SETTLE) { out[p] = T; idx[p] = shown; continue; } // 미세한 흔들림: 잠시 붙잡아 둠
      stale[p] = 0; // 새 색으로 갱신
      ref[i] = src[i]; ref[i + 1] = src[i + 1]; ref[i + 2] = src[i + 2];
    }
    prevIdx = idx;
    gif.writeFrame(out, W, H, { palette: f === 0 ? palette : undefined, delay: q.gifDelay, transparent: f > 0, transparentIndex: T, dispose: 1 });
    onEncode?.((f + 1) / blobs.length);
    if (f % 4 === 3) await tick();
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}
