// 장식 텍스처: 책장, 표지, 무대 배경
import { PALETTES, makeCanvas, paperTile, rng, fbm } from './stylize.js';

export const FONT_TITLE = "'EB Garamond', 'Iropke Batang', serif";
export const FONT_BODY = "'SUIT', system-ui, sans-serif";
// 표지 색 테마별 톤: 책장 테두리·덩굴(ink), 무대 배경 번짐(glow), 배경 바탕색
export const TONES = {
  sunset: { ink: '#d0532d', glowL: ['#ffc9a8', '#f7c2d3', '#ffe2b0'], glowD: ['#e2562f', '#c4456e', '#f4a259'], edgeL: '#f9e6dc', midL: '#fff7f2', coreD: '#2b1738', midD: '#150c1d', outD: '#09050d', table: [0xfdf6f2, 0x170e20] },
  snow:   { ink: '#4f6f9e', glowL: ['#cfe0fb', '#e2e9f7', '#dfe7ff'], glowD: ['#3d5a8e', '#6f8fc4', '#a6bfe6'], edgeL: '#e4ecf7', midL: '#f6f9fd', coreD: '#1a2540', midD: '#0e1524', outD: '#070a12', table: [0xf4f7fc, 0x0f1522] },
  grass:  { ink: '#4f7f3a', glowL: ['#dbecc4', '#f1ecc0', '#d5ead0'], glowD: ['#4a7c39', '#7da447', '#b2c95c'], edgeL: '#e9f0dc', midL: '#fafcf5', coreD: '#1a2a1c', midD: '#0d170f', outD: '#060b07', table: [0xf6f8ef, 0x0f170f] },
  sea:    { ink: '#16768c', glowL: ['#c7ecea', '#d5eef7', '#e3f4ec'], glowD: ['#16768c', '#2ea3a6', '#105070'], edgeL: '#dfeff0', midL: '#f5fbfb', coreD: '#0f2737', midD: '#08151f', outD: '#040a10', table: [0xf1f8f8, 0x0a141b] },
  dream:  { ink: '#8a5fb8', glowL: ['#e6d4f5', '#f6d6ec', '#dcd8fb'], glowD: ['#5a3b8c', '#8a5fb8', '#bf8ad6'], edgeL: '#eee4f6', midL: '#fbf8fd', coreD: '#271a3b', midD: '#140d20', outD: '#08050e', table: [0xf8f4fb, 0x150e1f] },
};
const tone = (k) => TONES[k] || TONES.sunset;
const lerp = (a, b, t) => a + (b - a) * t;

function leaf(ctx, x, y, len, ang, fill, ink, lw) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.45, -len * 0.32, len, 0);
  ctx.quadraticCurveTo(len * 0.45, len * 0.32, 0, 0);
  ctx.globalAlpha = 0.5; ctx.fillStyle = fill; ctx.fill();
  ctx.globalAlpha = 0.85; ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(len * 0.08, 0); ctx.lineTo(len * 0.85, 0); ctx.lineWidth = lw * 0.6; ctx.stroke();
  ctx.restore();
}

/** 베지어 덩굴 + 잎 */
function vine(ctx, pts, ink, accents, rnd, scale) {
  const [p0, p1, p2, p3] = pts;
  const bez = (t) => {
    const u = 1 - t;
    return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
  };
  ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = ink; ctx.lineWidth = 2 * scale; ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]); ctx.stroke(); ctx.restore();
  for (let k = 1; k < 9; k++) {
    const t = k / 9 + (rnd() - 0.5) * 0.04, a = bez(t), b = bez(Math.min(1, t + 0.01));
    const dir = Math.atan2(b[1] - a[1], b[0] - a[0]), side = k % 2 ? 1 : -1;
    leaf(ctx, a[0], a[1], (24 + rnd() * 20) * scale * (1 - t * 0.45), dir + side * (0.7 + rnd() * 0.4), accents[k % accents.length], ink, 1.2 * scale);
  }
  for (let k = 0; k < 3; k++) {
    const a = bez(0.25 + k * 0.3);
    ctx.save(); ctx.globalAlpha = 0.8; ctx.fillStyle = accents[(k + 1) % accents.length];
    ctx.beginPath(); ctx.arc(a[0] + (rnd() - 0.5) * 18 * scale, a[1] + (rnd() - 0.5) * 18 * scale, 4.2 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.lineWidth = scale; ctx.strokeStyle = ink; ctx.stroke(); ctx.restore();
  }
}

function blob(ctx, x, y, r, color, alpha, rnd) {
  for (let k = 0; k < 6; k++) {
    ctx.save(); ctx.globalAlpha = alpha * (0.25 + rnd() * 0.25); ctx.fillStyle = color; ctx.beginPath();
    const n = 22, rr = r * (0.7 + rnd() * 0.5), ox = (rnd() - 0.5) * r * 0.4, oy = (rnd() - 0.5) * r * 0.25;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2, w = rr * (0.8 + 0.4 * fbm(Math.cos(t) * 2 + k, Math.sin(t) * 2, 31 + k, 2));
      const px = x + ox + Math.cos(t) * w, py = y + oy + Math.sin(t) * w * 0.55;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.fill(); ctx.restore();
  }
}

/** 펼친 면 → [왼쪽, 오른쪽] 캔버스. hint: 빈 챕터 안내 문구 */
export function makeSpreadTextures(palKey, bottomColors, seed, pageNo, hint, toneKey) {
  const pal = PALETTES[palKey] || PALETTES.none, INK = tone(toneKey).ink;
  const PW = 1024, PH = 1332, W = PW * 2;
  const c = makeCanvas(W, PH), ctx = c.getContext('2d'), rnd = rng(seed + 501);
  ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, W, PH);

  if (bottomColors) bottomColors.forEach((col, k) => {
    const m = (v) => (v * 0.4 + 250 * 0.6) | 0; // 종이색 쪽으로 옅게
    blob(ctx, lerp(140, W - 140, (k + 0.5) / bottomColors.length), PH * 0.66 + (rnd() - 0.5) * 160, 230, `rgb(${m(col[0])},${m(col[1])},${m(col[2])})`, 0.2, rnd);
  });
  pal.accent.forEach((col) => blob(ctx, 200 + rnd() * (W - 400), PH * (0.82 + rnd() * 0.1), 140, col, 0.18, rnd));

  for (let side = 0; side < 2; side++) {
    const ox = side * PW, m = 54;
    ctx.save(); ctx.strokeStyle = INK; ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2.4; ctx.strokeRect(ox + m, m, PW - m * 2, PH - m * 2);
    ctx.lineWidth = 1; ctx.strokeRect(ox + m + 12, m + 12, PW - m * 2 - 24, PH - m * 2 - 24);
    ctx.setLineDash([2, 9]); ctx.lineWidth = 1.6; ctx.strokeRect(ox + m + 24, m + 24, PW - m * 2 - 48, PH - m * 2 - 48);
    ctx.restore();
    const outer = side === 0 ? ox + m : ox + PW - m, dx = side === 0 ? 1 : -1;
    vine(ctx, [[outer, PH - m], [outer + dx * 40, PH - 300], [outer + dx * 160, PH - 260], [outer + dx * 300, PH - m - 40]], INK, pal.accent, rnd, 1.15);
    vine(ctx, [[outer, m], [outer + dx * 60, 220], [outer + dx * 200, 140], [outer + dx * 320, m + 30]], INK, pal.accent, rnd, 0.95);
    ctx.save(); ctx.fillStyle = INK; ctx.globalAlpha = 0.75; ctx.font = `500 26px ${FONT_TITLE}`; ctx.textAlign = 'center';
    ctx.fillText(String(pageNo * 2 + side + 1), ox + PW / 2, PH - 20); ctx.restore();
  }

  if (hint) {
    ctx.save();
    ctx.strokeStyle = INK; ctx.globalAlpha = 0.6; ctx.lineWidth = 4; ctx.setLineDash([18, 14]);
    const bx = 260, by = 200, bw = W - 520, bh = PH * 0.5;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.setLineDash([]); ctx.globalAlpha = 0.9; ctx.fillStyle = INK; ctx.textAlign = 'center';
    ctx.font = `600 54px ${FONT_BODY}`; ctx.fillText('＋', W / 2, by + bh / 2 - 30);
    ctx.font = `500 44px ${FONT_BODY}`; ctx.fillText(hint, W / 2, by + bh / 2 + 50);
    ctx.restore();
  }

  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.45;
  ctx.fillStyle = ctx.createPattern(paperTile(), 'repeat'); ctx.fillRect(0, 0, W, PH); ctx.restore();
  // 제본선 그늘·가장자리 바램
  const g = ctx.createLinearGradient(PW - 120, 0, PW + 120, 0);
  g.addColorStop(0, 'rgba(30,30,50,0)'); g.addColorStop(0.5, 'rgba(30,30,50,0.26)'); g.addColorStop(1, 'rgba(30,30,50,0)');
  ctx.fillStyle = g; ctx.fillRect(PW - 120, 0, 240, PH);
  const v = ctx.createRadialGradient(W / 2, PH / 2, PH * 0.4, W / 2, PH / 2, W * 0.62);
  v.addColorStop(0, 'rgba(70,60,40,0)'); v.addColorStop(1, 'rgba(70,60,40,0.16)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, PH);

  const L = makeCanvas(PW, PH), R = makeCanvas(PW, PH);
  L.getContext('2d').drawImage(c, 0, 0, PW, PH, 0, 0, PW, PH);
  R.getContext('2d').drawImage(c, PW, 0, PW, PH, 0, 0, PW, PH);
  return [L, R];
}

/** 무대 배경 (라이트/다크) */
export function makeBackdrop(theme, toneKey) {
  const T = tone(toneKey);
  const W = 1024, H = 640, c = makeCanvas(W, H), ctx = c.getContext('2d'), rnd = rng(9);
  const dark = theme === 'dark';
  const g = ctx.createRadialGradient(W * 0.5, H * 0.42, 20, W * 0.5, H * 0.5, W * 0.75);
  if (dark) { g.addColorStop(0, T.coreD); g.addColorStop(0.55, T.midD); g.addColorStop(1, T.outD); }
  else { g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, T.midL); g.addColorStop(1, T.edgeL); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 노을 빛 번짐
  const glows = dark ? T.glowD.map((c, k) => [c, [0.2, 0.16, 0.1][k]]) : T.glowL.map((c, k) => [c, [0.4, 0.3, 0.35][k]]);
  glows.forEach(([col, a], k) => {
    const x = W * (0.25 + 0.25 * k) + (rnd() - 0.5) * 80, y = H * (0.2 + rnd() * 0.25), r = 260 + rnd() * 120;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = a; ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  });
  ctx.globalAlpha = 1;
  if (dark) for (let k = 0; k < 120; k++) { ctx.globalAlpha = 0.1 + rnd() * 0.35; ctx.fillStyle = '#ffe9dc'; ctx.fillRect(rnd() * W, rnd() * H * 0.7, 1.2, 1.2); }
  ctx.globalAlpha = 1;
  return c;
}

export function makePageEdgeTexture() {
  const c = makeCanvas(64, 64), ctx = c.getContext('2d');
  for (let y = 0; y < 64; y++) { const v = 236 - (y % 3 === 0 ? 26 : 0) - Math.random() * 8; ctx.fillStyle = `rgb(${v},${v - 3},${v - 10})`; ctx.fillRect(0, y, 64, 1); }
  return c;
}
