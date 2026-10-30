// 테마: 기기 설정 / 라이트 / 다크

const KEY = 'pg.theme';
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();
let mode = (() => { try { return localStorage.getItem(KEY) || 'system'; } catch (_) { return 'system'; } })();

export const getMode = () => mode;
export const resolved = () => (mode === 'system' ? (mq.matches ? 'dark' : 'light') : mode);

function apply() {
  document.documentElement.dataset.theme = resolved();
  document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === mode)));
  listeners.forEach((fn) => fn(resolved()));
}

export function setMode(next) {
  mode = next;
  try { localStorage.setItem(KEY, mode); } catch (_) { /* 무시 */ }
  apply();
}
export const onTheme = (fn) => listeners.add(fn);

export function initTheme() {
  mq.addEventListener('change', () => { if (mode === 'system') apply(); });
  document.querySelectorAll('[data-theme-set]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.themeSet)));
  apply();
}
