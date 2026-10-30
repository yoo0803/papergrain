// 물체 분할 (AI 미사용)
// 1) 축소 영상에서 그래프 기반 분할 (Felzenszwalb–Huttenlocher)
// 2) 인접 영역 색 유사도 병합
// 3) 물체 점수: 크기·대비·밀집도·하늘 배제
// 4) 원본 해상도 마스크 복원 → 구멍 메우기 → 최대 연결 성분
// 5) 빈자리 메우기: push-pull 보간

import { makeCanvas } from './stylize.js';

const SMALL = 320;

class DSU {
  constructor(n) { this.p = new Int32Array(n); this.s = new Int32Array(n).fill(1); this.th = new Float32Array(n); for (let i = 0; i < n; i++) this.p[i] = i; }
  find(a) { while (this.p[a] !== a) { this.p[a] = this.p[this.p[a]]; a = this.p[a]; } return a; }
  union(a, b, w) { if (this.s[a] < this.s[b]) [a, b] = [b, a]; this.p[b] = a; this.s[a] += this.s[b]; this.th[a] = w; return a; }
}

/** 축소 RGB (가벼운 블러 포함) */
function smallRGB(src, W, H) {
  const w = Math.min(SMALL, W), h = Math.round(H * (w / W));
  // 입력 종류(Image·ImageBitmap·Canvas)와 상관없이 같은 결과: 먼저 축소 → 그다음 블러
  const t = makeCanvas(w, h), tx = t.getContext('2d'); tx.imageSmoothingQuality = 'high'; tx.drawImage(src, 0, 0, w, h);
  const c = makeCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.filter = 'blur(0.8px)'; x.drawImage(t, 0, 0);
  const d = x.getImageData(0, 0, w, h).data, rgb = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; }
  return { rgb, w, h };
}

function segmentGraph(rgb, w, h, k, minSize) {
  const n = w * h, E = [];
  const diff = (a, b) => { const dr = rgb[a * 3] - rgb[b * 3], dg = rgb[a * 3 + 1] - rgb[b * 3 + 1], db = rgb[a * 3 + 2] - rgb[b * 3 + 2]; return Math.sqrt(dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.9); };
  const ea = [], eb = [], ew = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x < w - 1) { ea.push(i); eb.push(i + 1); ew.push(diff(i, i + 1)); }
    if (y < h - 1) { ea.push(i); eb.push(i + w); ew.push(diff(i, i + w)); }
    if (x < w - 1 && y < h - 1) { ea.push(i); eb.push(i + w + 1); ew.push(diff(i, i + w + 1)); }
    if (x > 0 && y < h - 1) { ea.push(i); eb.push(i + w - 1); ew.push(diff(i, i + w - 1)); }
  }
  const m = ew.length, order = new Uint32Array(m); for (let i = 0; i < m; i++) order[i] = i;
  const wts = Float32Array.from(ew); order.sort((a, b) => wts[a] - wts[b]);
  const dsu = new DSU(n); for (let i = 0; i < n; i++) dsu.th[i] = k;
  for (let q = 0; q < m; q++) {
    const e = order[q]; let a = dsu.find(ea[e]), b = dsu.find(eb[e]);
    if (a === b) continue;
    if (wts[e] <= Math.min(dsu.th[a], dsu.th[b])) { const r = dsu.union(a, b, wts[e]); dsu.th[r] = wts[e] + k / dsu.s[r]; }
  }
  for (let q = 0; q < m; q++) { // 작은 조각 흡수
    const e = order[q], a = dsu.find(ea[e]), b = dsu.find(eb[e]);
    if (a !== b && (dsu.s[a] < minSize || dsu.s[b] < minSize)) dsu.union(a, b, wts[e]);
  }
  const label = new Int32Array(n); for (let i = 0; i < n; i++) label[i] = dsu.find(i);
  return { label, E: { ea, eb, wts } };
}

/** 영역 통계 + 색 유사 인접 영역 병합 */
function regions(rgb, w, h, label, E, mergeT) {
  const stat = new Map();
  const get = (l) => { let s = stat.get(l); if (!s) { s = { l, n: 0, r: 0, g: 0, b: 0, sx: 0, sy: 0, x0: w, y0: h, x1: 0, y1: 0, top: 0, side: 0, bottom: 0 }; stat.set(l, s); } return s; };
  const mx = Math.max(2, Math.round(w * 0.03)), my = Math.max(2, Math.round(h * 0.03)); // 종이 여백 고려한 가장자리 폭
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, s = get(label[i]);
    s.n++; s.r += rgb[i * 3]; s.g += rgb[i * 3 + 1]; s.b += rgb[i * 3 + 2]; s.sx += x; s.sy += y;
    if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x; if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
    if (y < my) s.top++; if (x < mx || x >= w - mx) s.side++; if (y >= h - my) s.bottom++;
  }
  // 색 유사 병합
  const dsu = new Map(); const f = (a) => { while (dsu.has(a) && dsu.get(a) !== a) a = dsu.get(a); return a; };
  for (const l of stat.keys()) dsu.set(l, l);
  const mean = (s) => [s.r / s.n, s.g / s.n, s.b / s.n];
  for (let pass = 0; pass < 2; pass++) {
    for (let e = 0; e < E.ea.length; e++) {
      const a = f(label[E.ea[e]]), b = f(label[E.eb[e]]); if (a === b) continue;
      const A = stat.get(a), B = stat.get(b), ma = mean(A), mb = mean(B);
      if (Math.hypot(ma[0] - mb[0], ma[1] - mb[1], ma[2] - mb[2]) < mergeT) {
        const [big, small] = A.n >= B.n ? [A, B] : [B, A];
        for (const k of ['n', 'r', 'g', 'b', 'sx', 'sy', 'top', 'side', 'bottom']) big[k] += small[k];
        big.x0 = Math.min(big.x0, small.x0); big.y0 = Math.min(big.y0, small.y0); big.x1 = Math.max(big.x1, small.x1); big.y1 = Math.max(big.y1, small.y1);
        dsu.set(small.l, big.l); stat.delete(small.l);
      }
    }
  }
  for (let i = 0; i < label.length; i++) label[i] = f(label[i]);
  // 경계 대비 + 주변 평균색과의 차이
  const cs = new Map();
  for (let e = 0; e < E.ea.length; e++) {
    const pa = E.ea[e], pb = E.eb[e], a = label[pa], b = label[pb]; if (a === b) continue;
    for (const [l, q] of [[a, pb], [b, pa]]) { const c = cs.get(l) || [0, 0, 0, 0, 0]; c[0] += E.wts[e]; c[1]++; c[2] += rgb[q * 3]; c[3] += rgb[q * 3 + 1]; c[4] += rgb[q * 3 + 2]; cs.set(l, c); }
  }
  let gr = 0, gg = 0, gb = 0; const N = w * h;
  for (let i = 0; i < N; i++) { gr += rgb[i * 3]; gg += rgb[i * 3 + 1]; gb += rgb[i * 3 + 2]; }
  gr /= N; gg /= N; gb /= N;
  for (const s of stat.values()) {
    s.global = Math.hypot(s.r / s.n - gr, s.g / s.n - gg, s.b / s.n - gb); // 그림 전체 평균과의 차이
    const c = cs.get(s.l); s.contrast = c ? c[0] / c[1] : 0; s.perim = c ? c[1] : 0;
    s.distinct = Math.max(c ? Math.hypot(s.r / s.n - c[2] / c[1], s.g / s.n - c[3] / c[1], s.b / s.n - c[4] / c[1]) : 0, s.global * 0.8);
  }
  return stat;
}

/** 물체 후보 선택 */
function pick(stat, w, h, max) {
  const A = w * h, out = [];
  for (const s of stat.values()) {
    const bw = s.x1 - s.x0 + 1, bh = s.y1 - s.y0 + 1, area = s.n / A;
    if (area < 0.006 || area > (bh > bw * 1.5 ? 0.22 : 0.14)) continue; // 너무 작거나 큼 (세로로 긴 물체는 더 허용)
    if (bh < h * 0.06 || bw < w * 0.03 || bh > h * 0.8) continue;
    if (s.top > 0) continue;                                 // 하늘(위 가장자리 닿음)
    if (bw > w * 0.45 || s.side > bh * 0.5) continue;         // 띠 모양 배경
    if (s.bottom > bw * 0.6 && bh < h * 0.25) continue;      // 바닥 띠
    const fill = s.n / (bw * bh);
    if (fill < 0.33 || s.distinct < 18) continue;
    const round = (s.n * 4 * Math.PI) / Math.max(1, s.perim * s.perim) * 30; // 대략적 밀집도
    const cx = s.sx / s.n / w, centre = 1 - Math.abs(cx - 0.5);
    s.score = Math.sqrt(s.distinct * s.contrast) * Math.sqrt(area) * (0.6 + fill) * (0.7 + centre * 0.6) * (0.8 + Math.min(1, round) * 0.4) * (0.7 + Math.min(1.6, bh / bw) * 0.35); // 세로로 선 물체(나무·탑) 선호
    out.push(s);
  }
  out.sort((a, b) => b.score - a.score);
  // 서로 너무 겹치는 박스 제거
  const chosen = [];
  for (const s of out) {
    if (chosen.length >= max) break;
    const ov = chosen.some((c) => { const ix = Math.max(0, Math.min(c.x1, s.x1) - Math.max(c.x0, s.x0)), iy = Math.max(0, Math.min(c.y1, s.y1) - Math.max(c.y0, s.y0)); return ix * iy > 0.5 * (s.x1 - s.x0 + 1) * (s.y1 - s.y0 + 1); });
    if (!ov) chosen.push(s);
  }
  return chosen;
}

/** 원본 해상도 마스크 (부드럽게 확대 → 이진화 → 구멍 메우기 → 최대 성분) */
function fullMask(label, l, w, h, W, H) {
  const sm = makeCanvas(w, h), sx = sm.getContext('2d'), id = sx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = label[i] === l ? 255 : 0; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  sx.putImageData(id, 0, 0);
  const big = makeCanvas(W, H), bx = big.getContext('2d', { willReadFrequently: true });
  bx.imageSmoothingQuality = 'high'; bx.filter = `blur(${Math.max(1, W / w * 0.9)}px)`; bx.drawImage(sm, 0, 0, W, H);
  const d = bx.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = d[i * 4] > 127 ? 1 : 0;
  // 구멍 메우기: 테두리에서 바깥 영역 채우기
  const out = new Uint8Array(W * H), st = [];
  const push = (i) => { if (!m[i] && !out[i]) { out[i] = 1; st.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (st.length) { const i = st.pop(), x = i % W; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (i >= W) push(i - W); if (i < W * (H - 1)) push(i + W); }
  for (let i = 0; i < W * H; i++) m[i] = out[i] ? 0 : 1;
  // 최대 연결 성분
  const comp = new Int32Array(W * H).fill(-1); let best = -1, bestN = 0, id2 = 0;
  for (let s = 0; s < W * H; s++) {
    if (!m[s] || comp[s] >= 0) continue;
    let n = 0; st.push(s); comp[s] = id2;
    while (st.length) { const i = st.pop(), x = i % W; n++; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < W * H && m[j] && comp[j] < 0) { comp[j] = id2; st.push(j); } }
    if (n > bestN) { bestN = n; best = id2; }
    id2++;
  }
  let x0 = W, y0 = H, x1 = 0, y1 = 0, sx2 = 0, cnt = 0;
  for (let i = 0; i < W * H; i++) {
    m[i] = comp[i] === best ? 1 : 0;
    if (m[i]) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; sx2 += x; cnt++; }
  }
  return { mask: m, x0, y0, x1, y1, cx: cnt ? sx2 / cnt : W / 2, n: cnt };
}

/** 물체 잘라낸 캔버스 (알파 = 마스크, 1px 페더) */
function cutout(img, o, W) {
  const pad = 2, w = o.x1 - o.x0 + 1 + pad * 2, h = o.y1 - o.y0 + 1 + pad * 2;
  const c = makeCanvas(w, h), x = c.getContext('2d');
  x.drawImage(img, -(o.x0 - pad), -(o.y0 - pad));
  const id = x.getImageData(0, 0, w, h), d = id.data;
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
    const sx = xx + o.x0 - pad, sy = y + o.y0 - pad;
    const inside = sx >= 0 && sy >= 0 && sx < W && o.mask[sy * W + sx];
    d[(y * w + xx) * 4 + 3] = inside ? 255 : 0;
  }
  x.putImageData(id, 0, 0);
  const f = makeCanvas(w, h), fx = f.getContext('2d'); fx.filter = 'blur(0.6px)'; fx.drawImage(c, 0, 0);
  return f;
}

/** 빈자리 메우기: push-pull 보간 */
export function inpaint(canvas, mask) {
  const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d', { willReadFrequently: true });
  const id = ctx.getImageData(0, 0, W, H), d = id.data;
  // 레벨 0
  let lw = W, lh = H, cur = { c: new Float32Array(W * H * 3), a: new Float32Array(W * H) };
  for (let i = 0; i < W * H; i++) { const a = mask[i] ? 0 : 1; cur.a[i] = a; cur.c[i * 3] = d[i * 4] * a; cur.c[i * 3 + 1] = d[i * 4 + 1] * a; cur.c[i * 3 + 2] = d[i * 4 + 2] * a; }
  const levels = [{ ...cur, w: lw, h: lh }];
  while (lw > 1 || lh > 1) { // pull
    const nw = Math.max(1, lw >> 1), nh = Math.max(1, lh >> 1), nc = new Float32Array(nw * nh * 3), na = new Float32Array(nw * nh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const i = y * lw + x, j = Math.min(nh - 1, y >> 1) * nw + Math.min(nw - 1, x >> 1);
      na[j] += cur.a[i]; nc[j * 3] += cur.c[i * 3]; nc[j * 3 + 1] += cur.c[i * 3 + 1]; nc[j * 3 + 2] += cur.c[i * 3 + 2];
    }
    for (let j = 0; j < nw * nh; j++) if (na[j] > 1) { const s = 1 / na[j]; nc[j * 3] *= s; nc[j * 3 + 1] *= s; nc[j * 3 + 2] *= s; na[j] = 1; }
    cur = { c: nc, a: na }; lw = nw; lh = nh; levels.push({ ...cur, w: lw, h: lh });
  }
  for (let k = levels.length - 2; k >= 0; k--) { // push
    const L = levels[k], U = levels[k + 1];
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x, a = Math.min(1, L.a[i]);
      if (a >= 1) continue;
      // 상위 레벨 쌍선형 샘플 (계단 무늬 방지)
      const fx = Math.min(U.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), fy = Math.min(U.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(U.w - 1, x0 + 1), y1 = Math.min(U.h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      const j00 = y0 * U.w + x0, j10 = y0 * U.w + x1, j01 = y1 * U.w + x0, j11 = y1 * U.w + x1;
      const norm = L.a[i] > 0 ? 1 / L.a[i] : 0;
      for (let ch = 0; ch < 3; ch++) {
        const u = (U.c[j00 * 3 + ch] * (1 - tx) + U.c[j10 * 3 + ch] * tx) * (1 - ty) + (U.c[j01 * 3 + ch] * (1 - tx) + U.c[j11 * 3 + ch] * tx) * ty;
        L.c[i * 3 + ch] = (L.a[i] > 0 ? L.c[i * 3 + ch] * norm * a : 0) + u * (1 - a);
      }
      L.a[i] = 1;
    }
  }
  // 붓결 유지: 행마다 구멍 양옆 무늬를 거울 복사, 평균 밝기는 push-pull 값에 맞춤
  const L0 = levels[0], src = new Uint8ClampedArray(d);
  const bc = makeCanvas(W, H), bx = bc.getContext('2d', { willReadFrequently: true });
  bx.filter = 'blur(5px)'; bx.drawImage(canvas, 0, 0); const blur = bx.getImageData(0, 0, W, H).data;
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!mask[y * W + x]) { x++; continue; }
      let b = x; while (b < W && mask[y * W + b]) b++;
      const a = x, len = b - a;
      for (let k = a; k < b; k++) {
        const i = y * W + k, left = k - a < len / 2;
        let sxp = left ? a - 1 - (k - a) : b + (b - 1 - k);
        if (sxp < 0 || sxp >= W || mask[y * W + sxp]) sxp = left ? b + (b - 1 - k) : a - 1 - (k - a);
        const ok = sxp >= 0 && sxp < W && !mask[y * W + sxp];
        const edge = Math.min(k - a, b - 1 - k) / Math.max(1, len / 2); // 0 가장자리 → 1 가운데
        // 색은 매끈한 보간값, 붓결(고주파)만 옆에서 빌려 옴 → 해·달 같은 형태가 복제되지 않음
        const tex = ok ? 0.9 - 0.3 * edge : 0;
        for (let ch = 0; ch < 3; ch++) {
          const q = (y * W + sxp) * 4 + ch, detail = ok ? src[q] - blur[q] : 0;
          d[i * 4 + ch] = L0.c[i * 3 + ch] + detail * tex;
        }
      }
      x = b;
    }
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

/**
 * 스타일화된 배경에서 물체 찾기
 * @returns {{objects: {canvas, x0, y0, x1, y1, cx, bottom}[], filled: HTMLCanvasElement}}
 */
export function findObjects(sty, max, source) {
  const { canvas: img, W, H } = sty;
  const filled = makeCanvas(W, H); filled.getContext('2d').drawImage(img, 0, 0);
  if (!max) return { objects: [], filled };
  const { rgb, w, h } = smallRGB(source || img, W, H); // 원본 기준 분할 → 스타일 무늬·시드에 덜 흔들림
  // 두 가지 세밀도로 분할 → 후보를 모아 점수순 선택
  const pool = new Map();
  for (const k of [320, 620]) {
    const { label, E } = segmentGraph(rgb, w, h, k, Math.round(w * h * 0.002));
    for (const st of regions(rgb, w, h, label, E, 22).values()) { st.label = label; pool.set(pool.size, st); }
  }
  const chosen = pick(pool, w, h, max);
  const objects = [], union = new Uint8Array(W * H);
  for (const s of chosen) {
    const o = fullMask(s.label, s.l, w, h, W, H);
    if (o.n < W * H * 0.003) continue;
    // 약간 팽창한 영역을 메울 대상으로
    const r = 3;
    for (let y = Math.max(0, o.y0 - r); y <= Math.min(H - 1, o.y1 + r); y++) for (let x = Math.max(0, o.x0 - r); x <= Math.min(W - 1, o.x1 + r); x++) {
      if (union[y * W + x]) continue;
      outer: for (let dy = -r; dy <= r; dy += r) for (let dx = -r; dx <= r; dx += r) { const yy = y + dy, xx = x + dx; if (yy >= 0 && xx >= 0 && yy < H && xx < W && o.mask[yy * W + xx]) { union[y * W + x] = 1; break outer; } }
    }
    objects.push({ canvas: cutout(img, o, W), x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1, cx: o.cx, bottom: o.y1 });
  }
  if (objects.length) inpaint(filled, union);
  return { objects, filled };
}
