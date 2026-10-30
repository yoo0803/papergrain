// 이미지 처리 (AI 미사용, 순수 픽셀 연산)
// 배경: 쿠와하라 → 그라디언트 맵 → 수채 번짐·안료 고임 → 잉크선 → 종이결 → 빛 번짐
// 겹 분리: 윤곽 추종 최소비용 경로(seam)
// 캐릭터: 원본 픽셀 유지 + 종이 칼선 테두리

// name = i18n 키
export const PALETTES = {
  none:   { name: 'pal.none',   stops: null, haze: '#dfe3ee', ink: '#1c2340', paper: '#fbf8f1', accent: ['#e9925f', '#d9a35b', '#c76a8a'] },
  blend:  { name: 'pal.blend',  stops: ['#1f2a48', '#3d8584', '#d9716b', '#f7e8c9'], haze: '#c9dfdb', ink: '#1d2b36', paper: '#fbf8f1', accent: ['#6fb3ab', '#d9716b', '#9a5a8e'] },
  sunset: { name: 'pal.sunset', stops: ['#2f1d45', '#c4456e', '#f08a4b', '#fff1e2'], haze: '#f8d9c8', ink: '#2a1730', paper: '#fffaf5', accent: ['#f08a4b', '#c4456e', '#f4c06b'] },
  dawn:   { name: 'pal.dawn',   stops: ['#2e3550', '#c95f63', '#f0a58f', '#f6eed6'], haze: '#f3e3d0', ink: '#2c3a3a', paper: '#fbf6ec', accent: ['#79b9b1', '#e0827a', '#f2c46d'] },
  moon:   { name: 'pal.moon',   stops: ['#14203d', '#2c5a8a', '#8c79a0', '#ebbb7c'], haze: '#6487b5', ink: '#111c33', paper: '#f4f1ea', accent: ['#4f7fb5', '#e6b06e', '#8c79a0'] },
  forest: { name: 'pal.forest', stops: ['#0f2b2a', '#2b6d66', '#ad456e', '#ecdca8'], haze: '#9cc6b8', ink: '#0d2222', paper: '#f7f2e4', accent: ['#3f8f7f', '#c0507c', '#e3c25a'] },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
export function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
/** 캔버스 생성: 화면 스레드는 <canvas>, 워커는 OffscreenCanvas */
export function makeCanvas(w, h) {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  if (typeof document === 'undefined') return new OffscreenCanvas(W, H);
  const c = document.createElement('canvas'); c.width = W; c.height = H; return c;
}

// ── 노이즈
function hash(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}
export function fbm(x, y, s, oct = 4) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += a * vnoise(x * f, y * f, s + i * 17); f *= 2.03; a *= 0.5; }
  return v / (1 - Math.pow(0.5, oct));
}
export function rng(seed) { let t = seed >>> 0; return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }

// ── 적분 영상(SAT)
function sat(arr, W, H, square) {
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      const v = arr[y * W + x];
      row += square ? v * v : v;
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row;
    }
  }
  return S;
}
function rect(S, W, x0, y0, x1, y1) {
  const w = W + 1;
  return S[(y1 + 1) * w + x1 + 1] - S[y0 * w + x1 + 1] - S[(y1 + 1) * w + x0] + S[y0 * w + x0];
}
function boxBlur(arr, W, H, r) {
  const S = sat(arr, W, H, false), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      out[y * W + x] = rect(S, W, x0, y0, x1, y1) / ((x1 - x0 + 1) * (y1 - y0 + 1));
    }
  }
  return out;
}

function kuwahara(R, G, B, L, W, H, r) {
  const SR = sat(R, W, H), SG = sat(G, W, H), SB = sat(B, W, H), SL = sat(L, W, H), SQ = sat(L, W, H, true);
  const oR = new Float32Array(W * H), oG = new Float32Array(W * H), oB = new Float32Array(W * H);
  const qs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = Infinity, bi = 0, bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
      for (let q = 0; q < 4; q++) {
        const dx = qs[q][0], dy = qs[q][1];
        const x0 = dx < 0 ? Math.max(0, x - r) : x, x1 = dx < 0 ? x : Math.min(W - 1, x + r);
        const y0 = dy < 0 ? Math.max(0, y - r) : y, y1 = dy < 0 ? y : Math.min(H - 1, y + r);
        const n = (x1 - x0 + 1) * (y1 - y0 + 1);
        const m = rect(SL, W, x0, y0, x1, y1) / n;
        const v = rect(SQ, W, x0, y0, x1, y1) / n - m * m;
        if (v < best) { best = v; bi = n; bx0 = x0; by0 = y0; bx1 = x1; by1 = y1; }
      }
      const i = y * W + x;
      oR[i] = rect(SR, W, bx0, by0, bx1, by1) / bi;
      oG[i] = rect(SG, W, bx0, by0, bx1, by1) / bi;
      oB[i] = rect(SB, W, bx0, by0, bx1, by1) / bi;
    }
  }
  return [oR, oG, oB];
}

/** 알파 유지 종이결 곱하기 */
export function grain(canvas, alpha) {
  const ctx = canvas.getContext('2d');
  const mask = makeCanvas(canvas.width, canvas.height);
  mask.getContext('2d').drawImage(canvas, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = alpha;
  ctx.fillStyle = ctx.createPattern(paperTile(), 'repeat'); ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-in'; ctx.globalAlpha = 1;
  ctx.drawImage(mask, 0, 0);
  ctx.restore();
  return canvas;
}

// ── 종이결 타일
let paperTileCache = null;
export function paperTile() {
  if (paperTileCache) return paperTileCache;
  const S = 256, c = makeCanvas(S, S), ctx = c.getContext('2d');
  const id = ctx.createImageData(S, S), d = id.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = 0.55 * fbm(x / 32, y / 32, 3, 3) + 0.45 * hash(x, y, 9);
    const fiber = Math.pow(Math.abs(Math.sin((x * 0.9 + y * 0.35 + fbm(x / 9, y / 9, 5, 2) * 30) * 0.21)), 40) * 0.6;
    const v = 255 - (n * 26 + fiber * 22);
    const i = (y * S + x) * 4;
    d[i] = v; d[i + 1] = v - 2; d[i + 2] = v - 7; d[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  paperTileCache = c;
  return c;
}
function paperValue(x, y) {
  const n = 0.55 * fbm(x / 32, y / 32, 3, 3) + 0.45 * hash(x & 255, y & 255, 9);
  return 1 - n * 0.09;
}

// ── 배경 스타일화
/**
 * @param {CanvasImageSource & {width:number,height:number}} src
 * @param {{palette:string, tint:number, wash:number, ink:number, abstraction:number, seed:number}} o
 */
export function stylizeBackground(src, o) {
  const pal = PALETTES[o.palette] || PALETTES.blend;
  const sc = Math.min(1, 1280 / src.width, 960 / src.height);
  const W = Math.round(src.width * sc), H = Math.round(src.height * sc), N = W * H;
  const c = makeCanvas(W, H), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, W, H);
  const id = ctx.getImageData(0, 0, W, H), d = id.data;
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), L = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    R[i] = d[i * 4] / 255; G[i] = d[i * 4 + 1] / 255; B[i] = d[i * 4 + 2] / 255;
    L[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
  }

  // 붓터치 단순화
  const rad = Math.max(2, Math.round((W / 230) * o.abstraction));
  let [r2, g2, b2] = kuwahara(R, G, B, L, W, H, rad);
  if (o.abstraction > 1.2) { // 2차 패스: 평면 색면
    const L2 = new Float32Array(N); for (let i = 0; i < N; i++) L2[i] = 0.299 * r2[i] + 0.587 * g2[i] + 0.114 * b2[i];
    [r2, g2, b2] = kuwahara(r2, g2, b2, L2, W, H, Math.max(2, rad >> 1));
  }

  // 팔레트 그라디언트 맵
  const stops = pal.stops ? pal.stops.map(hexToRgb) : null;
  const tint = pal.stops ? o.tint : 0;
  const Ls = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let r = r2[i], g = g2[i], b = b2[i];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    if (stops && tint > 0) {
      const t = clamp(l * 1.05 - 0.02, 0, 1) * 3, k = Math.min(2, Math.floor(t)), f = t - k;
      const s0 = stops[k], s1 = stops[k + 1];
      const gr = lerp(s0[0], s1[0], f), gg = lerp(s0[1], s1[1], f), gb = lerp(s0[2], s1[2], f);
      r = lerp(r, gr, tint); g = lerp(g, gg, tint); b = lerp(b, gb, tint);
    }
    const m = (r + g + b) / 3;
    r = m + (r - m) * 1.12; g = m + (g - m) * 1.12; b = m + (b - m) * 1.12;
    r2[i] = r; g2[i] = g; b2[i] = b;
    Ls[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // 수채: 얼룩·안료 고임·잉크·빛 번짐·종이결
  const blurL = boxBlur(Ls, W, H, Math.max(3, rad * 2));
  const bloomR = boxBlur(r2, W, H, Math.round(W / 45)), bloomG = boxBlur(g2, W, H, Math.round(W / 45)), bloomB = boxBlur(b2, W, H, Math.round(W / 45));
  const ink = hexToRgb(pal.ink);
  const seed = o.seed | 0;
  const out = ctx.createImageData(W, H), od = out.data;
  const lineT = 0.16 - 0.07 * o.ink;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let r = r2[i], g = g2[i], b = b2[i];
      const wash = o.wash;
      const n1 = fbm((x / W) * 4, (y / H) * 4 * (H / W) * 1.6, seed, 4);
      const n2 = fbm((x / W) * 14, (y / H) * 14 * (H / W), seed + 3, 3);
      const m = 1 + (n1 - 0.5) * 0.28 * wash + (n2 - 0.5) * 0.08 * wash;
      r *= m; g *= m; b *= m;
      const diff = blurL[i] - Ls[i];
      if (diff > 0) { const k = 1 - Math.min(0.38, diff * 2.2 * wash); r *= k; g *= k; b *= k; }
      else { const k = -diff * 0.35 * wash; r += k; g += k; b += k; }
      if (o.ink > 0 && x > 0 && y > 0 && x < W - 1 && y < H - 1) {
        const a = Ls[i - W - 1], bb = Ls[i - W], cc = Ls[i - W + 1], dd = Ls[i - 1], ff = Ls[i + 1], gg = Ls[i + W - 1], hh = Ls[i + W], ii = Ls[i + W + 1];
        const gx = -a - 2 * dd - gg + cc + 2 * ff + ii, gy = -a - 2 * bb - cc + gg + 2 * hh + ii;
        const mag = Math.sqrt(gx * gx + gy * gy);
        if (mag > lineT) {
          const broken = 0.45 + 0.55 * fbm(x / 7, y / 7, seed + 11, 2); // 끊긴 선
          const al = clamp((mag - lineT) / 0.12, 0, 1) * o.ink * broken;
          r = lerp(r, ink[0], al); g = lerp(g, ink[1], al); b = lerp(b, ink[2], al);
        }
      }
      const gl = 0.16 * wash;
      r = 1 - (1 - r) * (1 - bloomR[i] * gl); g = 1 - (1 - g) * (1 - bloomG[i] * gl); b = 1 - (1 - b) * (1 - bloomB[i] * gl);
      const p = paperValue(x, y) - (hash(x, y, seed + 5) - 0.5) * 0.05 * wash;
      od[i * 4] = clamp(r * p, 0, 1) * 255;
      od[i * 4 + 1] = clamp(g * p, 0, 1) * 255;
      od[i * 4 + 2] = clamp(b * p * 0.99, 0, 1) * 255;
      od[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);

  // 먼지·물감 튐
  const rnd = rng(seed + 99);
  ctx.save();
  for (let k = 0; k < N * 0.00018 * (0.4 + o.wash); k++) {
    const x = rnd() * W, y = rnd() * H * 0.75, s = 0.6 + rnd() * 1.8;
    ctx.globalAlpha = 0.35 + rnd() * 0.5; ctx.fillStyle = '#fffaf0';
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
  }
  for (let k = 0; k < 18 * o.wash; k++) {
    const x = rnd() * W, y = rnd() * H, s = 1 + rnd() * 3;
    ctx.globalAlpha = 0.15 + rnd() * 0.2; ctx.fillStyle = pal.accent[k % pal.accent.length];
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  return { canvas: c, W, H, L: Ls };
}

// ── 겹 자르기 (seam)
export function computeCuts(L, W, H, count, seed) {
  const cuts = [];
  if (count < 2) return cuts;
  const step = 4, cols = Math.ceil(W / step);
  // 세로 밝기 변화 = 능선·지평선
  const E = (x, y) => {
    const i = y * W + Math.min(W - 1, x);
    const up = L[Math.max(0, y - 2) * W + Math.min(W - 1, x)], dn = L[Math.min(H - 1, y + 2) * W + Math.min(W - 1, x)];
    const lf = L[Math.max(0, i - 2)], rt = L[Math.min(W * H - 1, i + 2)];
    return Math.abs(dn - up) + 0.35 * Math.abs(rt - lf);
  };
  let prev = null;
  for (let k = 1; k < count; k++) {
    const frac = count === 2 ? 0.52 : 0.28 + 0.44 * ((k - 1) / (count - 2));
    const base = Math.round(H * frac), band = Math.round(H * 0.11);
    const y0 = Math.max(2, base - band), y1 = Math.min(H - 3, base + band), rows = y1 - y0 + 1;
    const cost = new Float32Array(cols * rows), from = new Int16Array(cols * rows);
    const maxJump = 3;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const y = y0 + r;
        const centerPull = Math.abs(y - base) / band * 0.04;
        let e = -E(c * step, y) + centerPull;
        if (prev) { const minY = prev[Math.min(W - 1, c * step)] + H * 0.07; if (y < minY) e += 5; }
        if (c === 0) { cost[r] = e; continue; }
        let best = Infinity, bj = r;
        for (let j = Math.max(0, r - maxJump); j <= Math.min(rows - 1, r + maxJump); j++) {
          const v = cost[(c - 1) * rows + j] + Math.abs(j - r) * 0.004;
          if (v < best) { best = v; bj = j; }
        }
        cost[c * rows + r] = best + e; from[c * rows + r] = bj;
      }
    }
    let br = 0, bv = Infinity;
    for (let r = 0; r < rows; r++) if (cost[(cols - 1) * rows + r] < bv) { bv = cost[(cols - 1) * rows + r]; br = r; }
    const path = new Float32Array(cols);
    for (let c = cols - 1; c >= 0; c--) { path[c] = y0 + br; br = from[c * rows + br]; }
    // 업샘플 → 평활 → 가위질 흔들림
    const line = new Float32Array(W);
    for (let x = 0; x < W; x++) { const t = x / step, c0 = Math.min(cols - 1, Math.floor(t)), c1 = Math.min(cols - 1, c0 + 1); line[x] = lerp(path[c0], path[c1], t - c0); }
    const sm = new Float32Array(W), win = Math.round(W / 60);
    for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let j = -win; j <= win; j++) { const xx = x + j; if (xx >= 0 && xx < W) { s += line[xx]; n++; } } sm[x] = s / n; }
    for (let x = 0; x < W; x++) {
      sm[x] += (fbm(x / (W / 9), k * 3.1, seed + 40 + k, 3) - 0.5) * H * 0.035 + (vnoise(x / 6, k, seed) - 0.5) * 1.6;
      if (prev) sm[x] = Math.max(sm[x], prev[x] + H * 0.05);
      sm[x] = clamp(sm[x], H * 0.12, H * 0.92);
    }
    cuts.push(sm); prev = sm;
  }
  return cuts;
}

// ── 겹 텍스처
export function buildLayers(sty, cuts, palKey, seed) {
  const pal = PALETTES[palKey] || PALETTES.blend;
  const { canvas: img, W, H } = sty;
  const count = cuts.length + 1;
  const rim = Math.max(2, Math.round(W / 300));
  const layers = [];
  for (let i = 0; i < count; i++) {
    let top;
    if (i === 0) { top = new Float32Array(W); for (let x = 0; x < W; x++) top[x] = rim + 2 + (fbm(x / 40, 0, seed + 7, 2) - 0.5) * 4; }
    else top = cuts[i - 1];
    let minTop = H; for (let x = 0; x < W; x++) minTop = Math.min(minTop, top[x]);
    const y0 = Math.max(0, Math.floor(minTop - rim - 2)), h = H - y0;
    const shape = makeCanvas(W, h), sctx = shape.getContext('2d');
    sctx.beginPath(); sctx.moveTo(0, h);
    for (let x = 0; x < W; x += 2) sctx.lineTo(x, top[x] - y0);
    sctx.lineTo(W, top[W - 1] - y0); sctx.lineTo(W, h); sctx.closePath();
    sctx.save(); sctx.clip(); sctx.drawImage(img, 0, -y0); sctx.restore();
    // 원근 안개
    const fog = count > 1 ? ((count - 1 - i) / (count - 1)) * 0.16 : 0;
    sctx.globalCompositeOperation = 'source-atop';
    if (fog > 0) { sctx.globalAlpha = fog; sctx.fillStyle = pal.haze; sctx.fillRect(0, 0, W, h); sctx.globalAlpha = 1; }
    // 앞 겹 그늘
    if (i < count - 1) {
      let nextMin = H; const nt = cuts[i]; for (let x = 0; x < W; x++) nextMin = Math.min(nextMin, nt[x]);
      const gy = Math.max(0, nextMin - y0 - h * 0.08);
      const gr = sctx.createLinearGradient(0, gy, 0, h);
      gr.addColorStop(0, 'rgba(10,14,30,0)'); gr.addColorStop(1, 'rgba(10,14,30,0.35)');
      sctx.fillStyle = gr; sctx.fillRect(0, 0, W, h);
    }
    // 단면 안쪽 그림자
    sctx.globalCompositeOperation = 'source-atop';
    sctx.strokeStyle = 'rgba(20,20,35,0.22)'; sctx.lineWidth = rim * 2.2;
    sctx.beginPath(); for (let x = 0; x < W; x += 2) sctx[x ? 'lineTo' : 'moveTo'](x, top[x] - y0 + rim * 1.6); sctx.stroke();
    sctx.globalCompositeOperation = 'source-over';

    // 종이 단면 + 그림
    const fin = makeCanvas(W, h), fctx = fin.getContext('2d');
    const t = makeCanvas(W, h), tctx = t.getContext('2d');
    tctx.drawImage(shape, 0, -rim); tctx.drawImage(shape, 0, -rim * 0.5);
    tctx.globalCompositeOperation = 'source-in'; tctx.fillStyle = pal.paper; tctx.fillRect(0, 0, W, h);
    fctx.drawImage(t, 0, 0); fctx.drawImage(shape, 0, 0);

    // 뒷면
    const back = makeCanvas(W, h), bctx = back.getContext('2d');
    bctx.drawImage(fin, 0, 0); bctx.globalCompositeOperation = 'source-in';
    bctx.fillStyle = pal.paper; bctx.fillRect(0, 0, W, h);
    grain(back, 0.5);

    layers.push({ canvas: fin, back, W, H: h, aspect: h / W });
  }
  return layers;
}

// ── 바닥 번짐 색 추출
export function sampleBottomColors(sty, n = 10) {
  const ctx = sty.canvas.getContext('2d', { willReadFrequently: true });
  const cols = [];
  for (let k = 0; k < n; k++) {
    const x = Math.round(((k + 0.5) / n) * sty.W), y = sty.H - 6;
    const p = ctx.getImageData(Math.max(0, x - 3), y - 3, 6, 6).data;
    let r = 0, g = 0, b = 0; for (let i = 0; i < p.length; i += 4) { r += p[i]; g += p[i + 1]; b += p[i + 2]; }
    const c = p.length / 4; cols.push([r / c, g / c, b / c]);
  }
  return cols;
}

// ── 캐릭터 카드
export function buildCharacterCard(src, opts) {
  const pal = PALETTES[opts.palette] || PALETTES.blend;
  const sc = Math.min(1, 1024 / Math.max(src.width, src.height));
  const W = Math.round(src.width * sc), H = Math.round(src.height * sc);
  const base = makeCanvas(W, H), bctx = base.getContext('2d', { willReadFrequently: true });
  bctx.drawImage(src, 0, 0, W, H);

  const id = bctx.getImageData(0, 0, W, H), d = id.data;
  let transparent = 0, edgeCount = 0;
  for (let x = 0; x < W; x += 3) { edgeCount += 2; if (d[(x) * 4 + 3] < 200) transparent++; if (d[((H - 1) * W + x) * 4 + 3] < 200) transparent++; }
  for (let y = 0; y < H; y += 3) { edgeCount += 2; if (d[(y * W) * 4 + 3] < 200) transparent++; if (d[(y * W + W - 1) * 4 + 3] < 200) transparent++; }
  let hasAlpha = transparent / edgeCount > 0.3;

  // 선택: 테두리 연결 단색 영역만 투명화
  if (!hasAlpha && opts.removeBg) {
    const tol = opts.tolerance * opts.tolerance * 3;
    const corners = [0, W - 1, (H - 1) * W, H * W - 1];
    let sr = 0, sg = 0, sb = 0; corners.forEach(i => { sr += d[i * 4]; sg += d[i * 4 + 1]; sb += d[i * 4 + 2]; });
    sr /= 4; sg /= 4; sb /= 4;
    const seen = new Uint8Array(W * H), stack = [];
    const push = (i) => { if (!seen[i]) { seen[i] = 1; stack.push(i); } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (stack.length) {
      const i = stack.pop();
      const dr = d[i * 4] - sr, dg = d[i * 4 + 1] - sg, db = d[i * 4 + 2] - sb;
      if (dr * dr + dg * dg + db * db > tol) continue;
      d[i * 4 + 3] = 0;
      const x = i % W, y = (i / W) | 0;
      if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
    }
    bctx.putImageData(id, 0, 0);
    hasAlpha = true;
  }

  const pad = Math.round(Math.max(W, H) * 0.045);
  const cw = W + pad * 2, ch = H + pad * 2;
  const card = makeCanvas(cw, ch), cctx = card.getContext('2d');
  const silhouette = (color) => {
    const t = makeCanvas(W, H), tctx = t.getContext('2d');
    tctx.drawImage(base, 0, 0); tctx.globalCompositeOperation = 'source-in'; tctx.fillStyle = color; tctx.fillRect(0, 0, W, H);
    return t;
  };
  if (hasAlpha) {
    // 외곽 팽창 스티커 테두리
    const sInk = silhouette(pal.ink), sPaper = silhouette(pal.paper);
    const r = pad * 0.8;
    for (let a = 0; a < 32; a++) { const t = (a / 32) * Math.PI * 2; cctx.drawImage(sInk, pad + Math.cos(t) * (r + 2), pad + Math.sin(t) * (r + 2)); }
    for (let a = 0; a < 32; a++) { const t = (a / 32) * Math.PI * 2; cctx.drawImage(sPaper, pad + Math.cos(t) * r, pad + Math.sin(t) * r); }
    cctx.drawImage(sPaper, pad, pad);
  } else {
    // 찢은 종이 액자
    const rnd = rng(opts.seed + 3), inset = pad * 0.2;
    cctx.beginPath();
    const pts = [];
    const edge = (x0, y0, x1, y1, n) => { for (let k = 0; k < n; k++) { const t = k / n; pts.push([lerp(x0, x1, t) + (rnd() - 0.5) * pad * 0.35, lerp(y0, y1, t) + (rnd() - 0.5) * pad * 0.35]); } };
    edge(inset, inset, cw - inset, inset, 40); edge(cw - inset, inset, cw - inset, ch - inset, 40);
    edge(cw - inset, ch - inset, inset, ch - inset, 40); edge(inset, ch - inset, inset, inset, 40);
    pts.forEach((p, k) => cctx[k ? 'lineTo' : 'moveTo'](p[0], p[1])); cctx.closePath();
    cctx.fillStyle = pal.paper; cctx.fill();
    cctx.lineWidth = Math.max(1.5, pad * 0.08); cctx.strokeStyle = pal.ink; cctx.stroke();
  }
  grain(card, 0.35);
  // 원본 픽셀 그대로
  cctx.drawImage(base, pad, pad);

  const back = makeCanvas(cw, ch), bk = back.getContext('2d');
  bk.drawImage(card, 0, 0); bk.globalCompositeOperation = 'source-in'; bk.fillStyle = pal.paper; bk.fillRect(0, 0, cw, ch);
  grain(back, 0.5);
  return { canvas: card, back, aspect: ch / cw, padFrac: pad / ch };
}
