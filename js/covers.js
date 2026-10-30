// 표지: 템플릿 × 색 테마 × 제목 글꼴 × 제목 크기
// 기본 표지 그림(디더 노을 · 디더 바다 · 판화)은 이미지 파일 없이 모두 이 파일의 코드로 그린다.
// 색은 직접 쓰지 않고 색 테마의 8단계 색(ramp)만 골라 쓰기 때문에, 테마를 바꾸면 같은 그림이 그 색으로 다시 칠해진다.
import { makeCanvas, paperTile, rng, fbm } from './stylize.js';

export const COVER_W = 1024, COVER_H = 1332;
export const COVER_TEMPLATES = ['dither', 'dithersea', 'print', 'custom'];

// 색 테마: 어두움(0) → 밝음(7) 8단계
// 템플릿은 "몇 번째 칸"으로만 색을 고른다 (예: R[0] 가장 어두운 그림자, R[7] 하늘·글씨처럼 가장 밝은 곳).
// 칸끼리 밝기 차이가 고르게 벌어지도록 골라 두어서, 디더 그림에서 단계가 계단처럼 자연스럽게 이어진다.
export const COVER_THEMES = {
  sunset: ['#1c1128', '#3b2350', '#6e2f62', '#a8385c', '#e2562f', '#f08a4b', '#f7b267', '#ffe9c8'],
  snow:   ['#121a2c', '#22335a', '#3d5a8e', '#6f8fc4', '#a6bfe6', '#cddcf2', '#e9f0fb', '#ffffff'],
  grass:  ['#0d1d15', '#1a3826', '#2a5833', '#4a7c39', '#7da447', '#b2c95c', '#e1e39a', '#fbf7dc'],
  sea:    ['#06182a', '#0b2f4b', '#105070', '#16768c', '#2ea3a6', '#6bc8bf', '#b3e5d8', '#f0fbf6'],
  dream:  ['#1b1433', '#34255e', '#5a3b8c', '#8a5fb8', '#bf8ad6', '#e6b0da', '#f6d6ec', '#fff4fb'],
};

// 제목 글꼴 (모두 Google Fonts, SIL OFL)
export const COVER_FONTS = {
  diphylleia: { ko: "'Diphylleia'", en: "'Kaushan Script'", ks: 1.05, es: 1.0 },
  retro:      { ko: "'Gasoek One'", en: "'Shrikhand'", ks: 0.92, es: 0.95, retro: true },
  yellowtail: { ko: "'Diphylleia'", en: "'Yellowtail'", ks: 1.05, es: 1.15 },
  grandiflora:{ ko: "'Grandiflora One'", en: "'Great Vibes'", ks: 1.05, es: 1.3 },
  songmyung:  { ko: "'Song Myung'", en: "'Satisfy'", ks: 1.05, es: 1.15 },
};

const HANGUL = /[ㄱ-ㆎ가-힣]/;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgba = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };

export function titleFont(fontKey, text, size) {
  const f = COVER_FONTS[fontKey] || COVER_FONTS.diphylleia;
  return HANGUL.test(text) ? `${size * f.ks}px ${f.ko}, serif` : `${size * f.es}px ${f.en}, cursive`;
}

// ── 공통
function grain(ctx, W, H, a = 0.4) {
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = a;
  ctx.fillStyle = ctx.createPattern(paperTile(), 'repeat'); ctx.fillRect(0, 0, W, H); ctx.restore();
}

/** 잉크 폭 (스와시 포함) */
function inkWidth(ctx, s) { const m = ctx.measureText(s); return (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width); }

function wrapLines(ctx, text, maxW) {
  const out = []; let line = '';
  for (const word of String(text).split(/(\s+)/)) {
    if (inkWidth(ctx, line + word) > maxW && line.trim()) { out.push(line.trim()); line = word.trimStart(); } else line += word;
    while (inkWidth(ctx, line) > maxW && line.length > 1) { let k = line.length; while (k > 1 && inkWidth(ctx, line.slice(0, k)) > maxW) k--; out.push(line.slice(0, k)); line = line.slice(k); }
  }
  if (line.trim()) out.push(line.trim());
  return out.length ? out : [''];
}

/** 안전 영역 box 안에 맞춰 제목 그리기 (넘치면 줄이기) */
function title(ctx, o, text, box, base, color, align, fx) {
  let s = base * o.titleScale, lines, lh, total;
  for (;;) {
    ctx.font = titleFont(o.font, text, s);
    lines = wrapLines(ctx, text, box.w);
    lh = s * 1.18; total = lines.length * lh;
    const widest = Math.max(...lines.map((l) => inkWidth(ctx, l)));
    if ((lines.length <= 3 && total <= box.h && widest <= box.w) || s < 28) break;
    s *= 0.94;
  }
  ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const y0 = box.y + (box.h - total) / 2 + lh / 2;
  const draw = (dx, dy) => lines.forEach((l, i) => {
    const m = ctx.measureText(l), w = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width);
    const x = align === 'left' ? box.x + (m.actualBoundingBoxLeft || 0) : box.x + (box.w - w) / 2 + (m.actualBoundingBoxLeft || 0);
    ctx.fillText(l, x + dx, y0 + i * lh + dy);
  });
  if (fx?.retro) { ctx.fillStyle = fx.retro[1]; draw(7, 7); ctx.fillStyle = fx.retro[0]; draw(3.5, 3.5); }
  else if (fx?.shadow) { ctx.shadowColor = fx.shadow; ctx.shadowBlur = 20; ctx.shadowOffsetY = 3; }
  ctx.fillStyle = color; draw(0, 0);
  ctx.restore();
}

function caption(ctx, text, x, y, color, align = 'center') {
  ctx.save(); ctx.font = `600 22px 'SUIT', system-ui, sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
  ctx.fillText(text, x, y); ctx.restore();
}

// ── 디더 (도트 그림)
// 8×8 Bayer 행렬: 0~63을 픽셀 위치마다 고르게 흩어 놓은 표를 0~1로 바꾼 것.
// 밝기를 색 칸 번호로 바꿀 때 이 값을 더한 뒤 내림하면, 두 색 사이의 중간 밝기가
// 두 색 점의 비율(체크무늬·격자 무늬)로 표현된다 → 레트로 게임 같은 도트 그러데이션.
const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21].map((v) => (v + 0.5) / 64);

/**
 * 디더 풍경: 노을(산 실루엣) / 바다(물결 위 해 반사) 두 가지
 * 1) 표지를 4px 단위의 작은 격자로 보고, 칸마다 밝기(0~1)를 계산한다
 * 2) 밝기를 Bayer 디더로 색 테마의 8단계 색에 대응시켜 작은 캔버스에 찍는다
 * 3) 작은 캔버스를 부드럽게 하지 않고(nearest) 크게 늘려 도트가 또렷하게 보이게 한다
 * 4) 별 입자 · 비네트 · 빗줄기 · 종이 질감 · 테두리를 얹고 제목을 쓴다
 * 난수는 고정 시드(rng)라서 같은 템플릿은 언제 만들어도 똑같은 그림이 나온다.
 */
function ditherScene(ctx, W, H, o, sea) {
  const R = o.ramp, ramp = R.map(hex);
  // px: 도트 한 칸 크기, w·h: 격자 칸 수, hz: 수평선 높이, cx·r: 해의 중심과 반지름 (모두 격자 단위)
  const px = 4, w = W / px, h = H / px, rnd = rng(sea ? 61 : 57);
  const hz = h * (sea ? 0.56 : 0.62), cx = w * (sea ? 0.5 : 0.36), r = w * 0.26;
  const val = new Float32Array(w * h); // 칸마다의 밝기
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v;
    if (y < hz) {
      // 하늘: 위가 어둡고 수평선으로 갈수록 밝아지는 노을 + 구름처럼 일렁이는 노이즈(fbm)
      v = 0.18 + 0.78 * Math.pow(y / hz, 1.4) + (fbm(x / 26, y / 12, 7, 3) - 0.5) * 0.18;
      const d = Math.hypot(x - cx, y - hz);
      if (d < r * 2.2) v += (1 - d / (r * 2.2)) * 0.25; // 해 주변이 은은하게 밝아지는 빛무리
      if (d < r) { // 해: 가장 밝은 색으로 채우되, 아래쪽 절반에는 아래로 갈수록 두꺼워지는 가로 틈(슬릿)을 낸다 → 80년대 노을 무늬
        const k = (y - (hz - r * 0.55)) / (r * 0.55);
        if (!(k > 0 && ((y - (hz - r * 0.55)) % 7) < 1 + k * 3.2)) v = 0.98;
      }
    } else if (sea) {
      // 바다: 수평선 아래는 어둡게, 가로로 길게 늘인 노이즈로 잔물결을 만든다
      const dy = (y - hz) / (h - hz);
      v = 0.3 - dy * 0.22 + (fbm(x / 40, y / 3, 9, 2) - 0.5) * 0.1;
      // 해 그림자(반사): 해 바로 아래 세로 띠. 가까울수록 밝고, 아래로 갈수록 넓어지며 흐려진다.
      // 두 줄 걸러 한 줄만 그려(y % 4 < 2) 물결에 끊긴 빛처럼 보이게 한다
      const spread = r * (0.9 + dy * 1.4), dx = Math.abs(x - cx);
      if (dx < spread && y % 4 < 2) v = Math.max(v, 0.82 - dy * 0.5 - (dx / spread) * 0.3 + (fbm(x / 8, y, 3, 2) - 0.5) * 0.3);
    } else v = 0.12; // 노을: 수평선 아래는 일단 어두운 땅 (아래에서 산을 덮어 그림)
    val[y * w + x] = Math.max(0, Math.min(1, v));
  }
  // 노을 전용 산 실루엣 4겹: [능선 기준 높이, 굴곡 크기, 밝기]
  // 뒤쪽 산일수록 밝고(공기 원근), 앞쪽으로 올수록 어두워진다. 능선은 산마다 다른 시드의 노이즈
  if (!sea) [[hz - 6, 18, 0.34], [hz + 14, 16, 0.24], [h * 0.8, 14, 0.14], [h * 0.9, 10, 0.06]].forEach(([base, amp, v], i) => {
    for (let x = 0; x < w; x++) {
      const top = base - amp * fbm(x / 30, i * 5, 13 + i, 4);
      for (let y = Math.max(0, Math.floor(top)); y < h; y++) val[y * w + x] = Math.min(val[y * w + x], v);
    }
  });
  // 밝기 → 색 칸 번호: 밝기 × 7 + Bayer 값을 내림 → 0~7 칸의 색을 찍는다
  const small = makeCanvas(w, h), sctx = small.getContext('2d'), id = sctx.createImageData(w, h), d = id.data, n = ramp.length - 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = Math.max(0, Math.min(n, Math.floor(val[y * w + x] * n + BAYER[(y % 8) * 8 + (x % 8)]))), c = ramp[j], p = (y * w + x) * 4;
    d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
  }
  sctx.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = false; ctx.drawImage(small, 0, 0, W, H); ctx.imageSmoothingEnabled = true; // 확대해도 도트가 뭉개지지 않게
  // 별 입자: 대부분은 도트 격자에 맞춘 작은 점, 8%는 십자 모양으로 반짝이는 별
  // 노을은 하늘(위 60%)에만, 바다는 물 위 반짝임까지 전체에 뿌린다
  for (let k = 0; k < 340; k++) {
    const x = rnd() * W, y = rnd() * (sea ? H : H * 0.6), s = rnd() < 0.85 ? px : px * 2;
    ctx.fillStyle = rnd() < 0.7 ? R[7] : R[6]; ctx.globalAlpha = 0.35 + rnd() * 0.6;
    if (rnd() < 0.08) { ctx.fillRect(x - s * 2, y, s * 5, s); ctx.fillRect(x, y - s * 2, s, s * 5); } else ctx.fillRect(Math.round(x / px) * px, Math.round(y / px) * px, s, s);
  }
  ctx.globalAlpha = 1;
  // 비네트: 가장자리를 가장 어두운 색 쪽으로 눌러 시선을 가운데로 모은다
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
  vg.addColorStop(0, rgba(R[7], 0)); vg.addColorStop(1, rgba(R[0], 0.5));
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  // 옅은 세로 긁힘 14줄: 오래된 인쇄물 · 필름 같은 느낌
  ctx.save(); ctx.strokeStyle = rgba(R[7], 0.18); ctx.lineWidth = 1;
  for (let k = 0; k < 14; k++) { const x = rnd() * W; ctx.beginPath(); ctx.moveTo(x, rnd() * H * 0.3); ctx.lineTo(x + (rnd() - 0.5) * 20, H * (0.5 + rnd() * 0.5)); ctx.stroke(); }
  ctx.restore();
  // 종이 질감을 soft-light로 덮어 화면 그림이 아니라 종이에 인쇄된 것처럼 보이게 한다
  ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.5; ctx.fillStyle = ctx.createPattern(paperTile(), 'repeat'); ctx.fillRect(0, 0, W, H); ctx.restore();
  ctx.save(); ctx.strokeStyle = R[7]; ctx.lineWidth = 3; ctx.strokeRect(40, 40, W - 80, H - 80); ctx.restore(); // 안쪽 테두리
  // 제목은 하늘 위쪽 30% 영역에. 레트로 글꼴이면 두 겹 그림자로 입체 글씨, 아니면 은은한 그림자로 배경에서 띄운다
  const f = COVER_FONTS[o.font] || COVER_FONTS.diphylleia;
  title(ctx, o, o.title, { x: 100, y: 80, w: W - 200, h: H * 0.3 }, 104, R[7], 'center', f.retro ? { retro: [R[4], R[1]] } : { shadow: rgba(R[0], 0.6) });
  caption(ctx, o.sub, W / 2, H - 92, R[7]);
}

// ── 템플릿
const T = {
  dither(ctx, W, H, o) { ditherScene(ctx, W, H, o, false); },
  dithersea(ctx, W, H, o) { ditherScene(ctx, W, H, o, true); },

  /**
   * 판화: 수평선에 잠긴 줄무늬 해 + 띠 + 리소 질감
   * 리소그래프 · 실크스크린 포스터처럼 몇 가지 단색 면을 겹쳐 찍은 느낌을 낸다.
   * 디더 템플릿과 달리 픽셀 계산 없이 도형만으로 그려서 가볍다.
   */
  print(ctx, W, H, o) {
    // hz: 수평선 높이, cx·r: 해의 중심(오른쪽으로 치우침)과 반지름
    const R = o.ramp, rnd = rng(41), hz = H * 0.6, cx = W * 0.62, r = 270;
    ctx.fillStyle = R[7]; ctx.fillRect(0, 0, W, H); // 바탕: 가장 밝은 색 (종이색)
    // 해: 위는 밝고 아래로 갈수록 진해지는 그러데이션. 수평선 위만 보이도록 잘라(clip) 반쯤 잠긴 해를 만든다
    const sg = ctx.createLinearGradient(0, hz - r, 0, hz);
    sg.addColorStop(0, R[6]); sg.addColorStop(0.55, R[5]); sg.addColorStop(1, R[4]);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, hz); ctx.clip();
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, hz, r, 0, Math.PI * 2); ctx.fill();
    // 해를 가로지르는 바탕색 줄 7개: 아래로 갈수록 두꺼워져 해가 수평선 아래로 녹아드는 것처럼 보인다
    ctx.fillStyle = R[7];
    for (let k = 0; k < 7; k++) { const y = hz - r * 0.62 + k * (r * 0.62 / 7) + k * 2; ctx.fillRect(0, y, W, 3 + k * 2.6); }
    ctx.restore();
    // 수평선 아래 띠 5개: 밝은 색 → 어두운 색. 바다나 겹겹이 이어지는 땅처럼 읽힌다
    [R[5], R[4], R[3], R[2], R[1]].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, hz + i * H * 0.08, W, H * 0.08 + 1); });
    // 물에 비친 해: 아래로 갈수록 짧아지는 반투명 가로 막대 9개, 좌우로 조금씩 어긋나게 해서 손으로 찍은 느낌
    ctx.fillStyle = rgba(R[6], 0.7);
    for (let k = 0; k < 9; k++) { const w = r * 1.4 * (1 - k / 11) * (0.6 + rnd() * 0.4); ctx.fillRect(cx - w / 2 + (rnd() - 0.5) * 30, hz + 18 + k * 34, w, 4); }
    // 리소 잉크 점: 어두운 색의 아주 작은 점 9000개를 흩뿌려 인쇄 잉크가 튄 듯한 거친 질감
    ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = R[1];
    for (let k = 0; k < 9000; k++) ctx.fillRect(rnd() * W, rnd() * H, 1.6, 1.6);
    ctx.restore();
    grain(ctx, W, H, 0.4); // 종이 결
    // 제목은 왼쪽 위에 왼쪽 정렬, 어두운 색으로 (밝은 바탕 위라서 그림자 없이도 잘 읽힘)
    const f = COVER_FONTS[o.font] || COVER_FONTS.diphylleia;
    title(ctx, o, o.title, { x: 90, y: 90, w: W - 180, h: H * 0.32 }, 112, R[1], 'left', f.retro ? { retro: [R[4], R[6]] } : null);
    caption(ctx, o.sub, 92, H - 70, R[7], 'left');
  },

  /** 사용자 이미지 */
  custom(ctx, W, H, o) {
    const R = o.ramp, img = o.image;
    ctx.fillStyle = R[1]; ctx.fillRect(0, 0, W, H);
    if (img) { const s = Math.max(W / img.width, H / img.height); ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s); }
    const g = ctx.createLinearGradient(0, H * 0.45, 0, H); g.addColorStop(0, rgba(R[0], 0)); g.addColorStop(1, rgba(R[0], 0.88));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.strokeStyle = rgba(R[7], 0.85); ctx.lineWidth = 2; ctx.strokeRect(46, 46, W - 92, H - 92); ctx.restore();
    const f = COVER_FONTS[o.font] || COVER_FONTS.diphylleia;
    title(ctx, o, o.title, { x: 100, y: H * 0.64, w: W - 200, h: H * 0.22 }, 96, R[7], 'center', f.retro ? { retro: [R[4], R[1]] } : { shadow: rgba(R[0], 0.7) });
    caption(ctx, o.sub, W / 2, H - 100, rgba(R[7], 0.9));
  },
};

/** @param {{template?:string, theme?:string, font?:string, titleScale?:number, title:string, sub?:string, image?:CanvasImageSource}} o */
export function makeCover(o) {
  const c = makeCanvas(COVER_W, COVER_H), ctx = c.getContext('2d');
  const opt = {
    title: o.title || ' ', sub: o.sub || 'A POP-UP STORYBOOK', image: o.image,
    font: COVER_FONTS[o.font] ? o.font : 'diphylleia',
    ramp: COVER_THEMES[o.theme] || COVER_THEMES.sunset,
    titleScale: Math.max(0.6, Math.min(1.5, o.titleScale || 1)),
  };
  (T[o.template] || T.dither)(ctx, COVER_W, COVER_H, opt);
  return c;
}

/** 표지 글꼴 로드 (한글 서브셋은 실제 글자 기준) */
export function loadCoverFont(fontKey, text) {
  const f = COVER_FONTS[fontKey] || COVER_FONTS.diphylleia;
  return Promise.all([document.fonts.load(`40px ${f.ko}`, text || '가'), document.fonts.load(`40px ${f.en}`, text || 'A')]);
}

// ── 책등 · 뒷표지 (표지 색 테마를 따라감)
/** 책 판지 색 (책등·뒷표지·안쪽 테두리) */
export const boardColor = (theme) => (COVER_THEMES[theme] || COVER_THEMES.sunset)[2];

/**
 * 책등 텍스처: 가로 = 책 세로 길이 방향, 세로 = 책 두께 방향
 * 금박 띠 + 제목 + 작은 해 문양
 */
function spineTitle(ctx, W, H, font, text, color, x, w) { // 한 줄, 넘치면 줄이기
  let size = H * 0.46;
  for (;;) { ctx.font = titleFont(font, text, size); if (inkWidth(ctx, text) <= w || size < 40) break; size *= 0.94; }
  ctx.save(); ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
  ctx.fillText(text, x, H / 2 + size * 0.04); ctx.restore();
}

/**
 * 노출 제본 책등: 종이 접장 묶음 + 접장을 엮은 실 (표지 색 테마의 실 색)
 * 가로 = 책 세로 방향, 세로 = 두께 방향
 */
function exposedSpine(ctx, c, W, H, R) {
  ctx.fillStyle = '#efe8da'; ctx.fillRect(0, 0, W, H);
  const n = 9, bh = H / n, rnd = rng(77);
  for (let k = 0; k < n; k++) { // 접장: 가운데가 밝고 가장자리가 어두운 띠
    const y = k * bh, g = ctx.createLinearGradient(0, y, 0, y + bh);
    g.addColorStop(0, 'rgba(120,100,80,0.38)'); g.addColorStop(0.18, 'rgba(255,252,244,0.25)'); g.addColorStop(0.55, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(110,90,70,0.42)');
    ctx.fillStyle = g; ctx.fillRect(0, y, W, bh);
    ctx.fillStyle = 'rgba(90,70,50,0.35)'; ctx.fillRect(0, y + bh - 1.5, W, 1.5);
  }
  // 엮은 실: 일정 간격의 바늘땀 + 접장 사이를 잇는 사슬
  const thread = R[4], dark = R[2], stations = 6;
  for (let s = 0; s < stations; s++) {
    const x = W * (0.08 + 0.84 * (s / (stations - 1)));
    for (let k = 0; k < n; k++) {
      const y = k * bh + bh * 0.5, len = 46 + rnd() * 6;
      ctx.fillStyle = dark; ctx.fillRect(x - len / 2, y - 3.5, len, 7);
      ctx.fillStyle = thread; ctx.fillRect(x - len / 2 + 1, y - 2.5, len - 2, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x - len / 2 + 2, y - 2.5, len - 4, 1.5);
      if (k < n - 1) { ctx.fillStyle = thread; ctx.fillRect(x - 2, y, 4, bh); } // 다음 접장으로
    }
  }
  // 가장자리 풀 자국
  ctx.fillStyle = 'rgba(200,180,140,0.25)'; ctx.fillRect(0, 0, 14, H); ctx.fillRect(W - 14, 0, 14, H);
  grain(ctx, W, H, 0.3);
  return c;
}

export function makeSpine({ theme, font, title: text, sub, image, binding }) {
  const R = COVER_THEMES[theme] || COVER_THEMES.sunset;
  const W = 1792, H = 256, c = makeCanvas(W, H), ctx = c.getContext('2d');
  if (binding === 'exposed') return exposedSpine(ctx, c, W, H, R);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, R[1]); g.addColorStop(0.5, R[2]); g.addColorStop(1, R[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (image) { // 펼친 표지 그림의 가운데 띠: 그림 위→아래 = 책등 위→아래, 그림 왼쪽(뒷표지 쪽) = 아래
    ctx.save(); ctx.translate(0, H); ctx.rotate(-Math.PI / 2); ctx.drawImage(image, 0, 0, H, W); ctx.restore();
    const sh = ctx.createLinearGradient(0, 0, 0, H);
    sh.addColorStop(0, 'rgba(0,0,0,0.22)'); sh.addColorStop(0.5, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = sh; ctx.fillRect(0, 0, W, H);
    if (text) spineTitle(ctx, W, H, font, text, '#ffffff', 150, W - 300);
    grain(ctx, W, H, 0.2);
    return c;
  }
  // 둥근 책등 음영
  const s = ctx.createLinearGradient(0, 0, 0, H);
  s.addColorStop(0, 'rgba(0,0,0,0.28)'); s.addColorStop(0.35, 'rgba(255,255,255,0.06)'); s.addColorStop(0.65, 'rgba(255,255,255,0.06)'); s.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = s; ctx.fillRect(0, 0, W, H);
  // 금박 띠 (양 끝)
  ctx.fillStyle = R[6];
  for (const x of [70, W - 70 - 10]) { ctx.fillRect(x, 0, 10, H); ctx.fillRect(x + 22, 0, 4, H); }
  // 작은 해 문양 (파비콘 모티프)
  const sx = W - 190, sy = H / 2, r = 34;
  ctx.save(); ctx.beginPath(); ctx.arc(sx, sy, r, Math.PI, 0); ctx.closePath(); ctx.clip();
  ctx.fillStyle = R[6]; ctx.fillRect(sx - r, sy - r, r * 2, r);
  ctx.fillStyle = R[2]; for (let k = 1; k < 4; k++) ctx.fillRect(sx - r, sy - k * 9, r * 2, 3);
  ctx.restore();
  ctx.fillStyle = R[6]; ctx.fillRect(sx - r - 6, sy + 6, r * 2 + 12, 4); ctx.fillRect(sx - r + 6, sy + 16, r * 2 - 12, 4);
  spineTitle(ctx, W, H, font, text, R[7], 150, W - 150 - 300);
  if (sub) caption(ctx, sub.split(' ').slice(-1)[0], W - 250, H / 2, rgba(R[6], 0.8), 'right');
  grain(ctx, W, H, 0.25);
  return c;
}

/**
 * 뒷표지: 판지 색 바탕 + 줄무늬 해 (또는 펼친 표지 그림의 왼쪽)
 * back.on이면 소개글·지은이·만든 날 (모두 선택)
 */
export function makeBackCover({ theme, image, back = {}, font }) {
  const R = COVER_THEMES[theme] || COVER_THEMES.sunset;
  const W = 768, H = Math.round(768 * 1.36 / 1.04), c = makeCanvas(W, H), ctx = c.getContext('2d');
  const blurb = back.on ? String(back.blurb || '').trim() : '', author = back.on ? String(back.author || '').trim() : '', date = back.on ? String(back.date || '').trim() : '';
  const hasText = !!(blurb || author || date);
  if (image) {
    const sc = Math.max(W / image.width, H / image.height);
    ctx.drawImage(image, (W - image.width * sc) / 2, (H - image.height * sc) / 2, image.width * sc, image.height * sc);
    if (hasText) { // 글씨가 읽히도록 은은한 어둠
      const v = ctx.createLinearGradient(0, 0, 0, H);
      v.addColorStop(0, 'rgba(10,6,16,0.55)'); v.addColorStop(0.5, 'rgba(10,6,16,0.35)'); v.addColorStop(1, 'rgba(10,6,16,0.6)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    }
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, R[1]); g.addColorStop(1, R[2]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = rgba(R[6], 0.55); ctx.lineWidth = 3; ctx.strokeRect(34, 34, W - 68, H - 68);
    // 줄무늬 해 (글이 있으면 위로 작게)
    const cx = W / 2, cy = hasText ? H * 0.17 : H * 0.5, r = hasText ? 44 : 70;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0); ctx.closePath(); ctx.clip();
    ctx.fillStyle = R[5]; ctx.fillRect(cx - r, cy - r, r * 2, r);
    ctx.fillStyle = R[1]; for (let k = 1; k < 5; k++) ctx.fillRect(cx - r, cy - k * (r / 5.4), r * 2, Math.max(2, r / 17));
    ctx.restore();
    const sc = r / 70;
    [[0, 6], [16, 5], [30, 4]].forEach(([dy, hh], i) => { ctx.fillStyle = R[4 - i] || R[4]; ctx.fillRect(cx - (r + 20 * sc) + i * 14 * sc, cy + (8 + dy) * sc, (r + 20 * sc - i * 14 * sc) * 2, hh * sc); });
  }
  const ink = R[7], soft = rgba(R[6], 0.85);
  if (blurb) { // 소개글: 가운데 정렬, 넘치면 글자 줄이기
    const box = { x: 96, y: H * 0.27, w: W - 192, h: H * 0.42 };
    let size = 30, lines, lh;
    for (;;) {
      ctx.font = `400 ${size}px 'Maru Buri', 'EB Garamond', serif`;
      lines = String(blurb).split(/\n/).flatMap((para) => wrapLines(ctx, para, box.w));
      lh = size * 1.62;
      if (lines.length * lh <= box.h || size < 15) break;
      size *= 0.92;
    }
    lines = lines.slice(0, Math.floor(box.h / lh));
    ctx.save(); ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (image) { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8; }
    const y0 = box.y + (box.h - lines.length * lh) / 2 + lh / 2;
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh));
    ctx.restore();
  }
  if (author) { // 지은이: 표지 글꼴
    ctx.save(); let size = 46; ctx.font = titleFont(font, author, size);
    while (inkWidth(ctx, author) > W - 160 && size > 18) { size *= 0.92; ctx.font = titleFont(font, author, size); }
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (image) { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10; }
    ctx.fillText(author, W / 2, H * 0.76); ctx.restore();
  }
  if (date) caption(ctx, date, W / 2, H * 0.76 + (author ? 52 : 0), soft);
  caption(ctx, 'PAPERGRAIN', W / 2, H - 90, rgba(R[6], 0.75));
  grain(ctx, W, H, image ? 0.18 : 0.3);
  return c;
}

/** 책등 폭(표지 폭 대비) — 펼친 표지 그림 나누기용 */
const SPINE_FRAC = { round: 0.19, square: 0.18, paper: 0.16, spiral: 0, exposed: 0 };
const BOARD_W = 1.04;
/** 펼친 표지 그림 → [뒷표지, 책등, 앞표지] (왼쪽부터) */
export function splitWrap(image, binding = 'round') {
  const s = SPINE_FRAC[binding] ?? 0.19, total = BOARD_W * 2 + s, W = image.width, H = image.height;
  const bw = W * BOARD_W / total, sw = W * s / total;
  const cut = (x, w) => { const cv = makeCanvas(Math.max(1, w), H); cv.getContext('2d').drawImage(image, x, 0, w, H, 0, 0, cv.width, H); return cv; };
  return { back: cut(0, Math.round(bw)), spine: sw >= 1 ? cut(Math.round(bw), Math.round(sw)) : null, front: cut(Math.round(bw + sw), Math.round(W - bw - sw)) };
}
/** 펼친 표지 권장 비율 (가로/세로) */
export const wrapRatio = (binding = 'round') => (BOARD_W * 2 + (SPINE_FRAC[binding] ?? 0.19)) / 1.36;
