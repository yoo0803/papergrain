import { PopupBook } from './book.js';
import { PALETTES, buildCharacterCard, makeCanvas } from './stylize.js';
import { makeSpreadTextures } from './decor.js';
import { BgPipeline } from './pipeline.js';
import { makeCover, makeSpine, makeBackCover, boardColor, splitWrap, wrapRatio, COVER_TEMPLATES, COVER_THEMES, COVER_FONTS, loadCoverFont } from './covers.js';
import { BINDINGS } from './book.js';
import { loadImageSafely, loadBundled, ImageError } from './safeimage.js';
import { t, pick, getLang, setLang, onLang, applyI18n } from './i18n.js';
import { initTheme, onTheme, resolved } from './theme.js';
import { SAMPLE_BOOK } from './samples.js';
import { Tutorial, tutorialDone } from './tutorial.js';
import { recordVideo, recordGif, canRecordVideo, QUALITY, RATIOS, frameSize } from './export.js';
import { CONFIG } from './config.js';

// 챕터 제목 글꼴
const CT_FONTS = {
  classic: { ko: "'Iropke Batang'", en: "'EB Garamond'", italic: true },
  maru: { ko: "'Maru Buri'", en: "'Maru Buri'" },
  ...Object.fromEntries(Object.entries(COVER_FONTS).map(([k, f]) => [k, { ko: f.ko, en: f.en }])),
};
const ctFamily = (key) => { const f = CT_FONTS[key] || CT_FONTS.classic; return `${f.en}, ${f.ko}, serif`; };

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MOTIONS = ['sway', 'bounce', 'float', 'spin', 'still'];
const AMBIENCES = ['dust', 'fireflies', 'petals', 'snow', 'none'];
const SUB = 'A POP-UP STORYBOOK';

// ── 상태
let seedN = 1;
let ctState = null; // 녹화 합성용 챕터 제목 상태 { i, t0: 책 시간 }
const MAX_CHARS = 4;
const CHAR_SPOTS = [0.3, -0.35, 0.65, -0.65];
const newChar = (img, i = 0, o = {}) => ({ img, placement: { x: CHAR_SPOTS[i % 4], d: 0.8, h: 0.42 }, removeBg: false, tol: 30, ...o });
/** 챕터: 캐릭터는 chars 배열 (예전 단일 char 형식도 받음) */
function newChapter(o = {}) {
  const { char, placement, removeBg, tol, chars, ...rest } = o;
  const list = chars ? chars.map((c, i) => newChar(c.img, i, c))
    : char ? [newChar(char, 0, { ...(placement && { placement }), removeBg: !!removeBg, tol: tol ?? 30 })] : [];
  return { bg: null, title: '', credit: null, motion: 'sway', ambience: 'dust', objPlace: {}, seed: 1000 + seedN * 37, id: seedN++, cache: {}, ...rest, chars: list, charSel: 0 };
}
const defaultCover = () => ({ template: 'dither', theme: 'sunset', font: 'diphylleia', titleScale: 1, image: null, binding: 'round', wrap: false, back: { on: false, blurb: '', author: '', date: '' } });
const books = {
  samples: { title: SAMPLE_BOOK.title, cover: defaultCover(), style: { ...SAMPLE_BOOK.style }, chapters: [], index: 0 },
  studio: { title: '', cover: defaultCover(), style: { palette: 'none', tint: 0.55, wash: 0.85, ink: 0.55, abstraction: 1, layers: 4, objects: 3 }, chapters: [newChapter()], index: 0 },
};
let mode = 'samples';
const cur = () => books[mode];
const ch = () => cur().chapters[cur().index];
const titleText = (bk = cur()) => pick(bk.title) || t('studio.untitled');

const book = new PopupBook($('stage'));

// ── 챕터 → 3D 에셋
const pipeline = new BgPipeline();
const bgKey = (st) => [st.palette, st.tint, st.wash, st.ink, st.abstraction, st.objects ?? 3, st.layers].join('|');
function isReady(bk, i) { const c = bk.chapters[i]; return !c || !c.bg || (c.cache.bgKey === bgKey(bk.style) && !!c.cache.bg); }
function prepare(bk, i) {
  const c = bk.chapters[i];
  if (!c || !c.bg) return Promise.resolve();
  const key = bgKey(bk.style), k = c.cache;
  if (k.bgKey === key && k.bg) return Promise.resolve();
  if (k.pending?.key === key && k.pending.src === c.bg) return k.pending.p;
  const src = c.bg;
  const p = pipeline.run({ id: c.id, bg: src, style: bk.style, seed: c.seed }).then((r) => {
    if (c.bg !== src || bgKey(bk.style) !== key) return; // 그사이 바뀜 → 버림
    k.bg = r; k.bgKey = key; k.pending = null;
  }, (e) => { k.pending = null; throw e; });
  k.pending = { key, src, p };
  return p;
}
/** 로딩 표시 */
async function ensure(bk, i) { if (!isReady(bk, i)) await withBusy('busy.cut', () => prepare(bk, i)); }

function assetsFor(bk, i) {
  const c = bk.chapters[i], k = c.cache, st = bk.style;
  let layers = [], bottom = null, objects = [];
  const r = c.bg && k.bgKey === bgKey(st) ? k.bg : null;
  if (r) {
    layers = r.layers; bottom = r.bottom;
    const { W, H } = r;
    objects = r.objects.map(({ o, card }, n) => ({
      card, h: (o.y1 - o.y0 + 1) / W / (1 - 2 * card.padFrac),
      place: c.objPlace[n] || { x: Math.max(-1, Math.min(1, ((o.cx / W) - 0.5) * 2 / 0.92)), d: 0.57 + 0.12 * Math.max(0, Math.min(1, (o.bottom / H - 0.3) / 0.7)) }, // 맨 앞 겹 바로 앞, 캐릭터보다는 뒤
    }));
  }
  const tone = bk.cover.theme;
  const pageKey = [st.palette, i, tone, r ? k.bgKey : c.bg ? 'wait' : getLang()].join('|');
  if (k.pageKey !== pageKey) { [k.pageL, k.pageR] = makeSpreadTextures(st.palette, bottom, c.seed, i, c.bg ? null : t('page.dropHint'), tone); k.pageKey = pageKey; }
  const chars = c.chars.map((cc, n) => {
    const key = [st.palette, cc.removeBg, cc.tol].join('|');
    if (cc.key !== key) { cc.card = buildCharacterCard(cc.img, { palette: st.palette, removeBg: cc.removeBg, tolerance: cc.tol, seed: c.seed + n }); cc.key = key; }
    return { card: cc.card, placement: cc.placement };
  });
  return { layers, objects, chars, pageL: k.pageL, pageR: k.pageR, motion: c.motion, ambience: c.ambience };
}

book.nav = {
  get index() { return cur().index; },
  set index(v) { cur().index = v; },
  count: () => cur().chapters.length,
  get: (i) => assetsFor(cur(), i),
  ready: (i) => isReady(cur(), i),
};

book.on('wait', (i) => { const bk = cur(); withBusy('busy.cut', () => prepare(bk, i)).catch(() => toast(t('toast.error'))); });

// ── 공용 UI
async function withBusy(key, fn) {
  $('busyText').textContent = t(key); $('busy').hidden = false;
  await nextFrame();
  try { return await fn(); } finally { $('busy').hidden = true; }
}
function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.id); toast.id = setTimeout(() => el.classList.remove('show'), 2600);
}
let running = false;
/** 다른 작업이 끝나길 기다렸다가 실행 */
async function runQueued(fn) { while (running) await wait(120); return run(fn); }
async function run(fn) {
  if (running) return; running = true;
  try { await fn(); } catch (e) { console.error(e); toast(e instanceof ImageError ? t(e.message) : t('toast.error')); }
  finally { running = false; }
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function thumb(src, w, h, cover = false) {
  const c = makeCanvas(w, h), x = c.getContext('2d');
  x.fillStyle = '#f4ece6'; x.fillRect(0, 0, w, h);
  if (src) { const s = (cover ? Math.max : Math.min)(w / src.width, h / src.height); x.drawImage(src, (w - src.width * s) / 2, (h - src.height * s) / 2, src.width * s, src.height * s); }
  return c;
}
const fileName = (bk) => (titleText(bk).replace(/[\\/:*?"<>|]+/g, '').trim() || 'papergrain').slice(0, 40);

// ── 표지
function wrapParts(cv) {
  if (!(cv.template === 'custom' && cv.wrap && cv.image)) return null;
  const w = cv._wrap;
  if (w && w.img === cv.image && w.binding === cv.binding) return w.parts;
  cv._wrap = { img: cv.image, binding: cv.binding, parts: splitWrap(cv.image, cv.binding) };
  return cv._wrap.parts;
}
const frontImage = (cv) => wrapParts(cv)?.front || cv.image;
async function coverCanvas(bk = cur()) {
  await loadCoverFont(bk.cover.font, titleText(bk) + (bk.cover.back?.author || ''));
  return makeCover({ ...bk.cover, image: frontImage(bk.cover), title: titleText(bk), sub: SUB });
}
/** 표지 + 책등·뒷표지·판지 색을 함께 적용 (글꼴은 coverCanvas에서 로드) */
/** 표지 색 테마 → 강조색·배경·책장 톤 */
function applyTone(th) {
  const changed = document.documentElement.dataset.tone !== th;
  document.documentElement.dataset.tone = th;
  book.setTone(th);
  if (changed && book.state === 'open' && !book.busy) run(refresh); // 책장 무늬 색 갱신
}
async function applyCover(bk = cur()) {
  const c = await coverCanvas(bk);
  if (bk !== cur()) return;
  const th = bk.cover.theme;
  applyTone(th);
  const cv = bk.cover, parts = wrapParts(cv);
  book.setBindingStyle(cv.binding || 'round');
  book.setCover(c);
  book.setBinding({
    color: boardColor(th),
    spine: makeSpine({ theme: th, font: cv.font, title: titleText(bk), sub: SUB, image: parts?.spine, binding: cv.binding }),
    back: makeBackCover({ theme: th, image: parts?.back, back: cv.back, font: cv.font }),
  });
}
let coverTimer;
function refreshCover(delay = 120) {
  clearTimeout(coverTimer);
  coverTimer = setTimeout(() => applyCover(), delay);
}
$('coverTitle').addEventListener('input', () => { cur().title = $('coverTitle').value; $('bookTitle').value = $('coverTitle').value; refreshCover(); });
$('coverTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.currentTarget.blur(); tutorial.signal('title'); } });
$('openBtn').addEventListener('click', () => run(async () => { const bk = cur(); await book.showBack(false); await ensure(bk, bk.index); if (cur() === bk) await book.open(); }));

async function showClosedBook() {
  book.showClosed(); book.setClosedView();
  prepare(cur(), cur().index).catch(() => {}); // 펼치기 전에 미리 준비
  await applyCover();
  $('coverTitle').value = pick(cur().title);
  $('coverEditor').hidden = false; setDock(false);
}

// ── 챕터 제목 오버레이
function showChapterTitle(i) {
  const c = cur().chapters[i];
  ctState = { i, t0: book.time }; // 녹화 합성용
  const fk = cur().ctFont || 'classic', el0 = $('chapterTitle');
  el0.style.setProperty('--ct-font', ctFamily(fk));
  el0.toggleAttribute('data-plain', !CT_FONTS[fk]?.italic);
  $('ctNum').textContent = `${t('chapter')} ${String(i + 1).padStart(2, '0')}`;
  $('ctTitle').textContent = pick(c.title) || t('studio.newChapter');
  $('ctCredit').textContent = c.credit ? pick(c.credit) : '';
  const el = $('chapterTitle'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(showChapterTitle.id); showChapterTitle.id = setTimeout(() => el.classList.remove('show'), 4500);
}

// ── 모션 박스
function buildSeg(boxId, items, prefix, onPick) {
  items.forEach((key) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'radio'); b.dataset.key = key; b.dataset.i18n = prefix + key; b.textContent = t(prefix + key);
    b.addEventListener('click', () => onPick(key));
    $(boxId).append(b);
  });
}
buildSeg('motionSeg', MOTIONS, 'motion.', (m) => { ch().motion = m; book.setMotion(m); syncDock(); tutorial.signal('motion'); });
buildSeg('ambSeg', AMBIENCES, 'amb.', (a) => { ch().ambience = a; book.setAmbience(a); syncDock(); tutorial.signal('motion'); });
function syncDock() {
  const c = ch();
  $('motionSeg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.key === c.motion)));
  $('ambSeg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.key === c.ambience)));
}
function setDock(on) { $('dock').hidden = !on; document.body.classList.toggle('dock-on', on); if (on) syncDock(); }

// ── 책 이벤트
book.on('open', () => { $('coverEditor').hidden = true; setDock(true); tutorial.signal('open'); });
book.on('close', () => { $('coverEditor').hidden = false; setDock(false); ctState = null; $('chapterTitle').classList.remove('show'); }); // 덮으면 챕터 제목도 사라짐
book.on('chapter', (i) => { showChapterTitle(i); syncDock(); syncPanel(); prefetch(i); });
book.on('flip', () => tutorial.signal('flip'));
book.on('charMoved', (i, pl) => { const c = ch(); if (!c.chars[i]) return; c.chars[i].placement = pl; if (c.charSel !== i) { c.charSel = i; syncChars(); } tutorial.signal('char'); });
book.on('objMoved', (i, pl) => { ch().objPlace[i] = pl; });
book.on('edge', (dir) => { if (dir > 0) toast(t('toast.last')); });

const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
function prefetch(i) {
  const bk = cur();
  const warm = (j) => { if (j < 0 || j >= bk.chapters.length || cur() !== bk) return; idle(() => { if (cur() === bk && isReady(bk, j)) book.warm(assetsFor(bk, j)); }); };
  prepare(bk, i).then(() => prepare(bk, i + 1)).then(() => { warm(i + 1); return prepare(bk, i - 1); }).then(() => warm(i - 1)).catch(() => {});
}

// 표지 편집기
(function follow() {
  const ed = $('coverEditor');
  if (!ed.hidden) {
    const a = book.anchor('coverBottom'), r = $('stage').getBoundingClientRect(), w = ed.offsetWidth / 2, h = ed.offsetHeight;
    if (a) {
      ed.style.left = `${Math.max(w + 8, Math.min(r.width - w - 8, a.x))}px`;
      ed.style.top = `${Math.max(90, Math.min(r.height - h - 24, a.y))}px`;
    }
  }
  requestAnimationFrame(follow);
})();

// ── 모드
async function setMode(next) {
  while (book.busy) await wait(100); // 애니메이션 중 누르면 끝난 뒤 전환
  mode = next;
  ['samples', 'studio'].forEach((m) => document.body.classList.toggle('mode-' + m, m === mode));
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  ctState = null; $('chapterTitle').classList.remove('show'); // 다른 모드의 챕터 제목이 남지 않게
  await showClosedBook();
  setPanel(mode === 'studio' && !window.matchMedia('(max-width: 820px)').matches);
  syncPanel();
}
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { tutorial.stop(); setMode(b.dataset.mode); }));
$('ctaStudio').addEventListener('click', () => { tutorial.stop(); setMode('studio'); });

// ── 튜토리얼
const tutorial = new Tutorial({ book, onFinish: () => { $('endModal').hidden = false; $('endMake').focus(); } });
$('endMore').addEventListener('click', () => { $('endModal').hidden = true; });
$('endMake').addEventListener('click', () => { $('endModal').hidden = true; setMode('studio'); });
$('tutorialBtn').addEventListener('click', async () => { if (book.busy) return; await setMode('samples'); tutorial.start(); });

// ── 제작 패널
function setPanel(open) { document.body.classList.toggle('panel-open', open); if (open) renderCoverOptions(); }
$('panelClose').addEventListener('click', () => setPanel(false));
$('panelFab').addEventListener('click', () => setPanel(true));

async function refresh() {
  if (book.state === 'open' && !book.busy) { const bk = cur(), i = bk.index; await ensure(bk, i); if (book.state === 'open' && cur() === bk && bk.index === i) book.update(assetsFor(bk, i)); }
  syncPanel();
}

// 표지 선택지 (썸네일은 디바운스 렌더)
let thumbTimer;
function renderCoverOptions() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(async () => {
    if (mode !== 'studio') return;
    const job = ++renderCoverOptions.job; // 겹친 호출은 최신 것만 그림 (중복 썸네일 방지)
    const bk = cur(), box = $('coverList');
    await loadCoverFont(bk.cover.font, titleText(bk));
    if (job !== renderCoverOptions.job) return;
    box.replaceChildren();
    for (const tpl of COVER_TEMPLATES) {
      if (job !== renderCoverOptions.job) return;
      const b = document.createElement('button');
      b.className = 'cover-opt'; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', t('cover.' + tpl)); b.title = t('cover.' + tpl);
      b.setAttribute('aria-checked', String(bk.cover.template === tpl));
      if (tpl === 'custom' && !bk.cover.image) { b.classList.add('add'); b.textContent = '＋'; }
      else b.append(thumb(makeCover({ ...bk.cover, image: frontImage(bk.cover), template: tpl, title: titleText(bk), sub: SUB }), 120, 156, true));
      b.addEventListener('click', () => {
        if (tpl === 'custom' && (!bk.cover.image || bk.cover.template === 'custom')) { $('coverFile').click(); return; }
        bk.cover.template = tpl; afterCoverChange();
      });
      box.append(b);
      await nextFrame();
    }
  }, 160);
}
renderCoverOptions.job = 0;
function afterCoverChange() { refreshCover(0); syncCoverControls(); renderCoverOptions(); }
function syncCoverControls() {
  const cv = cur().cover;
  document.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.key === cv.theme)));
  document.querySelectorAll('#fontList button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.key === cv.font)));
  document.querySelectorAll('#ctFontList button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.key === (cur().ctFont || 'classic'))));
  document.querySelectorAll('.cover-opt').forEach((b, i) => b.setAttribute('aria-checked', String(COVER_TEMPLATES[i] === cv.template)));
  $('titleScale').value = cv.titleScale;
  const bd = cv.binding || 'round', bc = cv.back || {};
  $('bindSeg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.key === bd)));
  $('wrapRow').hidden = !(cv.template === 'custom' && cv.image);
  $('wrapOn').checked = !!cv.wrap;
  const r = wrapRatio(bd);
  $('wrapHint').textContent = `${t('cover.wrapHint')} ${r.toFixed(2)} : 1 (${Math.round(1800 * r / 10) * 10}×1800px)`;
  $('backOn').checked = !!bc.on; $('backFields').hidden = !bc.on;
  if (document.activeElement !== $('backBlurb')) $('backBlurb').value = bc.blurb || '';
  if (document.activeElement !== $('backAuthor')) $('backAuthor').value = bc.author || '';
  if (document.activeElement !== $('backDate')) $('backDate').value = bc.date || '';
}
// 제본 형태
Object.keys(BINDINGS).forEach((k) => {
  const b = document.createElement('button');
  b.setAttribute('role', 'radio'); b.dataset.key = k; b.dataset.i18n = 'bind.' + k; b.textContent = t('bind.' + k);
  b.addEventListener('click', () => { cur().cover.binding = k; afterCoverChange(); });
  $('bindSeg').append(b);
});
$('wrapOn').addEventListener('change', () => { cur().cover.wrap = $('wrapOn').checked; afterCoverChange(); });
// 뒷표지 글: 입력하면 책을 뒤집어 바로 보여줌
const backCv = () => (cur().cover.back ||= { on: false, blurb: '', author: '', date: '' });
$('backOn').addEventListener('change', () => { backCv().on = $('backOn').checked; $('backFields').hidden = !backCv().on; refreshCover(0); if (backCv().on) book.showBack(true); });
[['backBlurb', 'blurb'], ['backAuthor', 'author'], ['backDate', 'date']].forEach(([id, key]) => {
  $(id).addEventListener('input', () => { backCv()[key] = $(id).value; refreshCover(); });
  $(id).addEventListener('focus', () => book.showBack(true));
});
$('flipBtn').addEventListener('click', () => book.showBack(!book.backShown));
(function buildCoverControls() {
  Object.entries(COVER_THEMES).forEach(([key, ramp]) => {
    const b = document.createElement('button');
    b.className = 'swatch'; b.setAttribute('role', 'radio'); b.dataset.key = key; b.dataset.i18nLabel = 'ctheme.' + key;
    b.style.background = `linear-gradient(90deg, ${ramp.slice(1, 7).join(',')})`;
    b.addEventListener('click', () => { cur().cover.theme = key; afterCoverChange(); });
    $('themeList').append(b);
  });
  Object.entries(COVER_FONTS).forEach(([key, f]) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'radio'); b.dataset.key = key; b.dataset.i18nLabel = 'cfont.' + key;
    const ko = document.createElement('span'); ko.textContent = '가'; ko.style.fontFamily = f.ko;
    const en = document.createElement('span'); en.textContent = 'Aa'; en.style.fontFamily = f.en;
    b.append(ko, en);
    b.addEventListener('click', () => { cur().cover.font = key; afterCoverChange(); });
    $('fontList').append(b);
  });
  // 챕터 제목 글꼴
  Object.entries(CT_FONTS).forEach(([key, f]) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'radio'); b.dataset.key = key; b.dataset.i18nLabel = (key in COVER_FONTS ? 'cfont.' : 'ctfont.') + key;
    const ko = document.createElement('span'); ko.textContent = '가'; ko.style.fontFamily = f.ko;
    const en = document.createElement('span'); en.textContent = 'Aa'; en.style.fontFamily = f.en;
    b.append(ko, en);
    b.addEventListener('click', async () => {
      const bk = cur(); bk.ctFont = key; syncCoverControls();
      const text = bk.chapters.map((c) => pick(c.title)).join('') || 'Chapter';
      await Promise.all([document.fonts.load(`40px ${f.ko}`, text), document.fonts.load(`40px ${f.en}`, text)]).catch(() => {});
      if (book.state === 'open') showChapterTitle(bk.index); // 바로 미리보기
    });
    $('ctFontList').append(b);
  });
})();
$('titleScale').addEventListener('input', () => { cur().cover.titleScale = parseFloat($('titleScale').value); refreshCover(60); });
$('titleScale').addEventListener('change', renderCoverOptions);
$('coverFile').addEventListener('change', () => {
  const f = $('coverFile').files[0]; $('coverFile').value = '';
  if (!f) return;
  run(async () => {
    const img = await withBusy('busy.check', () => loadImageSafely(f));
    const cv = cur().cover;
    cv.image = img; cv.template = 'custom';
    cv.wrap = img.width / img.height > 1.35; // 가로로 긴 그림이면 펼친 표지로 (선택 가능)
    afterCoverChange();
  });
});

function syncPanel() {
  if (mode !== 'studio') return;
  const bk = cur(), c = ch(), st = bk.style;
  $('bookTitle').value = bk.title;
  $('chTitle').value = c.title || '';
  $('bgThumb').replaceChildren(thumb(c.bg, 160, 120));
  syncChars();
  $('delChapter').disabled = bk.chapters.length <= 1;
  $('tint').value = st.tint; $('wash').value = st.wash; $('ink').value = st.ink; $('abst').value = st.abstraction; $('layers').value = st.layers; $('objects').value = st.objects ?? 3;
  document.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.key === st.palette)));
  syncCoverControls();
  const list = $('chapterList'); list.replaceChildren();
  bk.chapters.forEach((cc, i) => {
    const b = document.createElement('button');
    b.className = 'chapter'; b.setAttribute('role', 'listitem'); b.setAttribute('aria-current', String(i === bk.index));
    b.append(thumb(cc.cache.bg ? cc.cache.bg.thumb : cc.bg, 160, 100, true));
    const s = document.createElement('span'); s.textContent = `${i + 1}. ${cc.title || t('studio.newChapter')}`; b.append(s);
    b.addEventListener('click', () => runQueued(() => jumpTo(i)));
    list.append(b);
  });
}

async function jumpTo(i) {
  const bk = cur();
  if (i === bk.index && book.state === 'open') return;
  if (book.state === 'closed') { bk.index = i; syncPanel(); await ensure(bk, i); if (cur() === bk) await book.open(); return; }
  const d = i - bk.index;
  await ensure(bk, i);
  if (Math.abs(d) === 1) { await book.flip(d); return; }
  bk.index = i;
  book.update(assetsFor(bk, i));
  showChapterTitle(i); syncDock(); syncPanel();
}

$('bookTitle').addEventListener('input', () => { cur().title = $('bookTitle').value; $('coverTitle').value = cur().title; refreshCover(); });
$('bookTitle').addEventListener('change', renderCoverOptions);
let chTimer;
$('chTitle').addEventListener('input', () => { ch().title = $('chTitle').value.trim(); clearTimeout(chTimer); chTimer = setTimeout(syncPanel, 400); });
// 캐릭터 목록: 선택한 캐릭터에 크기·배경 제거 적용
const selChar = () => ch().chars[ch().charSel];
function syncChars() {
  if (mode !== 'studio') return;
  const c = ch(), list = $('charList'); list.replaceChildren();
  c.charSel = Math.min(c.charSel, Math.max(0, c.chars.length - 1));
  c.chars.forEach((cc, i) => {
    const b = document.createElement('button');
    b.className = 'char-pick'; b.setAttribute('aria-pressed', String(i === c.charSel));
    b.setAttribute('aria-label', `${t('studio.char')} ${i + 1}`);
    b.append(thumb(cc.img, 96, 96));
    b.addEventListener('click', () => { c.charSel = i; syncChars(); });
    list.append(b);
  });
  const sc = selChar(), has = !!sc;
  $('charList').hidden = !has; $('charCtrl').hidden = !has;
  $('charDrop').classList.toggle('full', c.chars.length >= MAX_CHARS);
  if (has) { $('chSize').value = sc.placement.h; $('removeBg').checked = sc.removeBg; $('tol').value = sc.tol; $('tolRow').hidden = !sc.removeBg; }
}
$('chSize').addEventListener('input', () => { const sc = selChar(); if (!sc) return; sc.placement = { ...sc.placement, h: parseFloat($('chSize').value) }; book.setPlacement(ch().charSel, sc.placement); });
$('removeBg').addEventListener('change', () => { const sc = selChar(); if (!sc) return; sc.removeBg = $('removeBg').checked; run(refresh); });
$('tol').addEventListener('change', () => { const sc = selChar(); if (!sc) return; sc.tol = parseFloat($('tol').value); if (sc.removeBg) run(refresh); });
$('charRemove').addEventListener('click', () => { const c = ch(); if (!selChar()) return; c.chars.splice(c.charSel, 1); c.charSel = Math.max(0, c.charSel - 1); run(refresh); });
[['tint', 'tint'], ['wash', 'wash'], ['ink', 'ink'], ['abst', 'abstraction'], ['layers', 'layers'], ['objects', 'objects']].forEach(([id, key]) => {
  $(id).addEventListener('change', () => { cur().style[key] = parseFloat($(id).value); if (key === 'objects') cur().chapters.forEach((c) => (c.objPlace = {})); run(refresh); });
});
(function buildPalettes() {
  Object.entries(PALETTES).forEach(([key, p]) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.setAttribute('role', 'radio'); b.dataset.key = key;
    const sw = document.createElement('i'); sw.style.background = `linear-gradient(90deg, ${(p.stops || ['#c9c2b4', '#d9a37a', '#e6c58a', '#f4efe4']).join(',')})`;
    const label = document.createElement('span'); label.dataset.i18n = p.name; label.textContent = t(p.name);
    b.append(sw, label);
    b.addEventListener('click', () => { cur().style.palette = key; run(refresh); });
    $('palettes').append(b);
  });
})();
$('addChapter').addEventListener('click', () => runQueued(async () => {
  const bk = cur();
  if (bk.chapters.length >= 12) { toast(t('toast.max')); return; }
  bk.chapters.push(newChapter());
  await jumpTo(bk.chapters.length - 1);
}));
$('delChapter').addEventListener('click', () => runQueued(async () => {
  const bk = cur(); if (bk.chapters.length <= 1) return;
  bk.chapters.splice(bk.index, 1);
  bk.index = Math.max(0, bk.index - 1);
  bk.chapters.forEach((c) => (c.cache.pageKey = null));
  await refresh();
}));

// 파일 입력
async function acceptFile(file, kind) {
  while (running) await wait(120); // 처리 중에 넣은 파일도 버리지 않고 순서대로
  await run(async () => {
    const img = await withBusy('busy.check', () => loadImageSafely(file));
    const c = ch();
    if (kind === 'bg') c.bg = img, c.cache = {};
    else {
      if (c.chars.length >= MAX_CHARS) { toast(t('toast.charMax')); return; }
      c.chars.push(newChar(img, c.chars.length)); c.charSel = c.chars.length - 1;
    }
    if (book.state === 'closed') { syncPanel(); const bk = cur(); await ensure(bk, bk.index); if (cur() === bk) await book.open(); }
    else await refresh();
    toast(t(kind === 'bg' ? 'toast.bg' : 'toast.char'));
  });
}
function bindDrop(zoneId, inputId, kind) {
  const zone = $(zoneId), input = $(inputId);
  input.addEventListener('change', () => { if (input.files[0]) acceptFile(input.files[0], kind); input.value = ''; });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) acceptFile(f, kind); });
}
bindDrop('bgDrop', 'bgFile', 'bg');
bindDrop('charDrop', 'charFile', 'char');
$('stage').addEventListener('dragover', (e) => e.preventDefault());
$('stage').addEventListener('drop', async (e) => {
  e.preventDefault(); const f = e.dataTransfer.files[0];
  if (!f) return;
  if (mode !== 'studio') await setMode('studio');
  acceptFile(f, 'bg');
});

// ── 완성 화면
$('finishBtn').addEventListener('click', async () => {
  const c = await coverCanvas();
  $('finishCover').replaceChildren(thumb(c, 400, 520, true));
  $('saveVideo').hidden = !canRecordVideo();
  $('finishModal').hidden = false;
});
$('finishClose').addEventListener('click', () => { $('finishModal').hidden = true; });

// 내보내기 옵션: 길이 배율 · 화질 · 비율
const LENGTHS = [0.5, 0.7, 1, 1.2, 1.5];
const exportOpt = { length: 1, quality: 'mid', ratio: '16:9' };
LENGTHS.forEach((v) => {
  const b = document.createElement('button');
  b.setAttribute('role', 'radio'); b.dataset.key = String(v); b.textContent = `×${v.toFixed(1)}`;
  b.addEventListener('click', () => { exportOpt.length = v; syncExportOpts(); });
  $('lenSeg').append(b);
});
buildSeg('qualSeg', Object.keys(QUALITY), 'q.', (k) => { exportOpt.quality = k; syncExportOpts(); });
Object.keys(RATIOS).forEach((r) => {
  const b = document.createElement('button');
  b.setAttribute('role', 'radio'); b.dataset.key = r; b.textContent = r;
  b.addEventListener('click', () => { exportOpt.ratio = r; syncExportOpts(); });
  $('ratioSeg').append(b);
});
function syncExportOpts() {
  for (const [id, v] of [['lenSeg', String(exportOpt.length)], ['qualSeg', exportOpt.quality], ['ratioSeg', exportOpt.ratio]]) {
    $(id).querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.key === v)));
  }
  // 선택한 화질의 실제 크기 표시 (영상 · GIF)
  const q = QUALITY[exportOpt.quality], v = frameSize(q.short, exportOpt.ratio), g = frameSize(q.gifShort, exportOpt.ratio);
  $('sizeNote').textContent = `${t('finish.video')} ${v.W}×${v.H} · ${q.fps}fps   GIF ${g.W}×${g.H}`;
}
syncExportOpts();
onLang(syncExportOpts);

// 녹화 프레임에 챕터 제목 합성 (화면의 챕터 제목 오버레이와 같은 모양·타이밍)
const CT_DUR = 4.4;
// CSS 색(#hex·rgb) → 투명도 붙인 rgba (그러데이션이 검은색으로 번지지 않게)
const colorCtx = document.createElement('canvas').getContext('2d');
function rgba(color, alpha) {
  colorCtx.fillStyle = '#000'; colorCtx.fillStyle = color;
  const v = colorCtx.fillStyle; // '#rrggbb' 또는 'rgba(...)'
  if (v.startsWith('#')) return `rgba(${parseInt(v.slice(1, 3), 16)},${parseInt(v.slice(3, 5), 16)},${parseInt(v.slice(5, 7), 16)},${alpha})`;
  const m = v.match(/[\d.]+/g) || [0, 0, 0]; return `rgba(${m[0]},${m[1]},${m[2]},${alpha})`;
}
function drawChapterTitle(ctx, W, H, time) {
  if (!ctState) return;
  const k = (time - ctState.t0) / CT_DUR;
  if (k < 0 || k > 1) return;
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const a = k < 0.14 ? ease(k / 0.14) : k > 0.78 ? 1 - ease((k - 0.78) / 0.22) : 1;
  const dy = k < 0.14 ? (1 - ease(k / 0.14)) * 10 : k > 0.78 ? -ease((k - 0.78) / 0.22) * 8 : 0;
  const c = cur().chapters[ctState.i]; if (!c) return;
  const css = getComputedStyle(document.documentElement), ink = css.getPropertyValue('--ink').trim() || '#2a1d2b', bg = css.getPropertyValue('--bg').trim() || '#fff';
  const u = Math.min(W / 1200, H / 800) * (W < H ? 1.25 : 1); // 화면 기준 크기 → 출력 크기 (세로 영상은 조금 크게)
  const cx = W / 2, top = (W < H ? H * 0.1 : 74 * u) + dy * u;
  const en = getLang() === 'en';
  const title = pick(c.title) || t('studio.newChapter'), credit = c.credit ? pick(c.credit) : '';
  const num = `${t('chapter')} ${String(ctState.i + 1).padStart(2, '0')}`.toUpperCase();
  ctx.save();
  ctx.globalAlpha = a;
  // 뒤 번짐 (가독성)
  const halo = ctx.createRadialGradient(cx, top + 46 * u, 0, cx, top + 46 * u, 440 * u);
  halo.addColorStop(0, rgba(bg, 0.78)); halo.addColorStop(0.3, rgba(bg, 0.78)); halo.addColorStop(0.72, rgba(bg, 0)); halo.addColorStop(1, rgba(bg, 0));
  ctx.fillStyle = halo;
  ctx.save(); ctx.translate(cx, top + 46 * u); ctx.scale(1, 0.32); ctx.translate(-cx, -(top + 46 * u)); ctx.fillRect(cx - 440 * u, top + 46 * u - 440 * u, 880 * u, 880 * u); ctx.restore();
  ctx.globalAlpha = a; ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = bg; ctx.shadowBlur = 14 * u;
  // 눈썹: CHAPTER 01 + 양옆 선
  ctx.font = `600 ${11 * u}px SUIT, system-ui, sans-serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${0.42 * 11 * u}px`;
  ctx.globalAlpha = a * 0.7; ctx.fillText(num, cx, top + 6 * u);
  const nw = ctx.measureText(num).width;
  ctx.globalAlpha = a * 0.42; ctx.fillRect(cx - nw / 2 - 60 * u, top + 6 * u, 46 * u, Math.max(1, u)); ctx.fillRect(cx + nw / 2 + 14 * u, top + 6 * u, 46 * u, Math.max(1, u));
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  // 제목 (넘치면 줄이기)
  let fs = 48 * u;
  const fk = cur().ctFont || 'classic';
  const font = (n) => `${en && CT_FONTS[fk]?.italic ? 'italic ' : ''}500 ${n}px ${ctFamily(fk)}`;
  ctx.font = font(fs); while (ctx.measureText(title).width > W * 0.86 && fs > 18 * u) { fs *= 0.94; ctx.font = font(fs); }
  ctx.globalAlpha = a * 0.88; ctx.shadowBlur = 24 * u; ctx.fillText(title, cx, top + 12 * u + 6 * u + fs * 0.62);
  // 출처
  if (credit) {
    let cs = 12.5 * u; ctx.font = `300 ${cs}px 'Maru Buri', serif`;
    while (ctx.measureText(credit).width > W * 0.9 && cs > 8 * u) { cs *= 0.94; ctx.font = `300 ${cs}px 'Maru Buri', serif`; }
    ctx.globalAlpha = a * 0.75; ctx.shadowBlur = 8 * u; ctx.fillText(credit, cx, top + 18 * u + fs * 1.24 + 12 * u);
  }
  ctx.restore();
}

/** 녹화용 재생 (책 시간 기준): 펼침 → 끝 장까지. 길이 배율은 export.js가 시간 간격으로 적용 */
async function playThrough() {
  const w = (ms) => book.wait(ms / 1000);
  if (cur().cover.back?.on) { await w(1400); await book.showBack(false); }
  await w(500); await book.open(); await w(1500);
  for (let i = 1; i < cur().chapters.length; i++) { await book.flip(1); await w(1400); }
  if (cur().cover.back?.on) { await book.close(); await w(300); await book.showBack(true); await w(1600); }
  await w(400);
}
async function recordWith(kind, fn) {
  const bk = cur();
  $('finishModal').hidden = true; setPanel(false);
  $('busyText').textContent = t('busy.prep'); $('busy').hidden = false;
  try {
    for (let i = 0; i < bk.chapters.length; i++) await prepare(bk, i); // 끊김 없도록 전부 준비
    bk.index = 0; ctState = null;
    await showClosedBook(); $('coverEditor').hidden = true; setDock(false);
    if (bk.cover.back?.on) book.setBackShown(true);
    // 진행률: 재생 길이(책 시간)로 전체 프레임 수 추정
    const q = QUALITY[exportOpt.quality], fps = kind === 'gif' ? 1000 / q.gifDelay : q.fps;
    const total = ((bk.cover.back?.on ? 2.5 + 4.6 : 0) + 0.5 + 1.8 + 1.5 + (bk.chapters.length - 1) * (1.6 + 1.4) + 0.4) * fps * exportOpt.length;
    const label = t(kind === 'gif' ? 'busy.gifRec' : 'busy.rec');
    $('busyText').textContent = label;
    return await fn({
      quality: exportOpt.quality, ratio: exportOpt.ratio, length: exportOpt.length, overlay: drawChapterTitle,
      onProgress: (i) => { if (i % 6 === 0) $('busyText').textContent = `${label} ${Math.min(99, Math.round((i / total) * 100))}%`; },
      onEncode: (p) => { $('busyText').textContent = `${t('busy.gif')} ${Math.round(p * 100)}%`; },
    });
  } finally { $('busy').hidden = true; setDock(true); }
}
$('saveVideo').addEventListener('click', () => runQueued(async () => {
  const { blob, ext } = await recordWith('video', (o) => recordVideo(book, playThrough, o));
  download(blob, `${fileName(cur())}.${ext}`);
}));
$('saveGif').addEventListener('click', () => runQueued(async () => {
  const blob = await recordWith('gif', (o) => recordGif(book, playThrough, o));
  download(blob, `${fileName(cur())}.gif`);
}));

// ── 메인 링크 (X 공유, GitHub)
function syncSiteLinks() {
  const site = location.origin + location.pathname;
  $('shareX').href = `https://x.com/intent/post?text=${encodeURIComponent(t('share.text'))}&url=${encodeURIComponent(site)}`;
  if (CONFIG.GITHUB_URL && /^https:\/\/github\.com\//.test(CONFIG.GITHUB_URL)) { $('githubLink').href = CONFIG.GITHUB_URL; $('githubLink').hidden = false; }
}

// ── 크레딧
const CREDITS = [
  ['code', { ko: '종이결 — MIT © 2026 Y.C.\nthree.js r170 — MIT © three.js authors\ngifenc — MIT © Matt DesLauriers\nmp4-muxer — MIT © Vanilagy', en: 'Papergrain — MIT © 2026 Y.C.\nthree.js r170 — MIT © three.js authors\ngifenc — MIT © Matt DesLauriers\nmp4-muxer — MIT © Vanilagy' }],
  ['fonts', { ko: 'EB Garamond · 이롭게 바탕체 · 마루 부리 · SUIT · Diphylleia · Gasoek One · Grandiflora One · Song Myung · Kaushan Script · Shrikhand · Great Vibes — SIL OFL 1.1\nYellowtail · Satisfy — Apache 2.0', en: 'EB Garamond · Iropke Batang · Maru Buri · SUIT · Diphylleia · Gasoek One · Grandiflora One · Song Myung · Kaushan Script · Shrikhand · Great Vibes — SIL OFL 1.1\nYellowtail · Satisfy — Apache 2.0' }],
  ['artwork', { ko: '일월오봉도 (조선) · 까치호랑이 민화 (조선) · 정선 〈인왕제색도〉 1751 · 김홍도 〈무동〉 〈씨름〉 18세기 · 십장생도 병풍 (조선) · 빈센트 반 고흐 〈별이 빛나는 밤〉 1889 · 클로드 모네 〈수련〉 1919 · 베아트릭스 포터 〈피터 래빗 이야기〉 1902 — 저작권이 만료된 퍼블릭 도메인 작품만 사용, Wikimedia Commons · Project Gutenberg', en: 'Irworobongdo (Joseon) · Magpie and Tiger folk painting (Joseon) · Jeong Seon, Inwangjesaekdo, 1751 · Kim Hong-do, Mudong and Ssireum, 18th c. · Ten Longevity Symbols screen (Joseon) · Vincent van Gogh, The Starry Night, 1889 · Claude Monet, Water Lilies, 1919 · Beatrix Potter, The Tale of Peter Rabbit, 1902 — public domain works only (copyright expired), via Wikimedia Commons and Project Gutenberg' }],
  ['design', { ko: '파비콘·표지 이미지: Claude Code\n장식·종이 질감: 코드로 생성', en: 'Favicon and cover images: Claude Code\nOrnaments and paper textures: generated in code' }],
];
$('creditsBtn').addEventListener('click', () => {
  const dl = $('creditsList'); dl.replaceChildren();
  CREDITS.forEach(([k, v]) => {
    const d = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k; dd.textContent = pick(v); dd.style.whiteSpace = 'pre-line';
    d.append(dt, dd); dl.append(d);
  });
  $('creditsModal').hidden = false; $('creditsClose').focus();
});
$('creditsClose').addEventListener('click', () => { $('creditsModal').hidden = true; });
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m && m.id !== 'endModal') m.hidden = true; }));

// ── 키보드
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'ArrowRight') run(async () => { const bk = cur(), i = book.state === 'closed' ? bk.index : bk.index + 1; if (i < bk.chapters.length) await ensure(bk, i); if (cur() !== bk) return; return book.state === 'closed' ? book.open() : book.flip(1); });
  if (e.key === 'ArrowLeft') run(async () => { const bk = cur(); if (bk.index > 0) await ensure(bk, bk.index - 1); if (cur() !== bk) return; return book.flip(-1); });
  if (e.key === 'Escape') { setPanel(false); document.querySelectorAll('.modal').forEach((m) => { if (m.id !== 'endModal') m.hidden = true; }); }
});

// ── 언어·테마
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
const syncLangButtons = () => document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
onLang(() => {
  syncLangButtons(); syncSiteLinks(); tutorial.refresh();
  if (book.state === 'closed') { refreshCover(0); if (typeof cur().title !== 'string') $('coverTitle').value = pick(cur().title); }
  if (book.state === 'open' && !ch().bg) run(refresh);
  syncPanel(); renderCoverOptions();
});
onTheme((th) => book.setTheme(th));

// ── 시작
async function boot() {
  initTheme(); applyI18n(); syncLangButtons(); syncSiteLinks();
  book.setTheme(resolved());
  $('busyText').textContent = '…'; $('busy').hidden = false;
  await Promise.race([Promise.all(["500 40px 'EB Garamond'", "500 40px 'Iropke Batang'", "40px 'SUIT'"].map((f) => document.fonts.load(f, '가A'))), wait(2500)]);
  books.samples.chapters = await Promise.all(SAMPLE_BOOK.chapters.map(async (c) => newChapter({ ...c, bg: await loadBundled(c.bg), char: await loadBundled(c.char) })));
  $('busy').hidden = true;
  await setMode('samples');
  if (!tutorialDone()) tutorial.start();
}
boot().catch((e) => { console.error(e); toast(t('toast.error')); });
