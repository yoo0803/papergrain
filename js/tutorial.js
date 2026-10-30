// 첫 방문 튜토리얼: 코치 카드 + 제스처 힌트
import { t } from './i18n.js';

const STEPS = [
  { key: 's1', signal: 'title', focus: 'coverEditor', next: true },
  { key: 's2', signal: 'open', focus: 'coverEditor', hand: { from: 'coverEdge', dx: -260, dy: 10 } },
  { key: 's3', signal: 'char', hand: { from: 'char', dx: 90, dy: 18 } },
  { key: 's4', signal: 'motion', focus: 'dock' },
  { key: 's5', signal: 'flip', hand: { from: 'pageR', dx: -300, dy: 0 } },
];
const DONE_KEY = 'pg.tutorialDone';

export const tutorialDone = () => { try { return localStorage.getItem(DONE_KEY) === '1'; } catch (_) { return false; } };
const markDone = () => { try { localStorage.setItem(DONE_KEY, '1'); } catch (_) { /* 무시 */ } };

export class Tutorial {
  constructor({ book, onFinish }) {
    this.book = book; this.onFinish = onFinish;
    this.i = -1;
    this.el = document.getElementById('coach');
    this.hand = document.getElementById('hand');
    document.getElementById('coachSkip').addEventListener('click', () => this.stop());
    document.getElementById('coachNext').addEventListener('click', () => this.signal(STEPS[this.i]?.signal));
    this._loop = this._loop.bind(this);
  }
  get active() { return this.i >= 0; }
  /** 언어 변경 시 다시 그리기 */
  refresh() { if (this.active) this.render(); }

  start() { this.i = 0; document.body.classList.add('coach-on'); this.render(); requestAnimationFrame(this._loop); }

  render() {
    const s = STEPS[this.i];
    document.querySelectorAll('.pulse').forEach((e) => e.classList.remove('pulse'));
    if (!s) return;
    this.el.hidden = false;
    this.el.classList.remove('enter'); void this.el.offsetWidth; this.el.classList.add('enter');
    document.getElementById('coachStep').textContent = String(this.i + 1);
    document.querySelectorAll('#coachBars i').forEach((b, k) => b.classList.toggle('on', k <= this.i));
    document.getElementById('coachTitle').textContent = t(`tut.${s.key}`);
    document.getElementById('coachNext').hidden = !s.next;
    if (s.focus) document.getElementById(s.focus)?.classList.add('pulse');
    this.t0 = performance.now();
  }

  /** 동작 완료 신호: 현재 이후 단계와 일치하면 그 다음 단계로 */
  signal(name) {
    if (!this.active || !name) return;
    const k = STEPS.findIndex((s, idx) => idx >= this.i && s.signal === name);
    if (k < 0) return;
    this.i = k + 1;
    if (this.i >= STEPS.length) this.finish(); else this.render();
  }

  finish() { this._hide(); markDone(); this.onFinish?.(); }
  stop() { this._hide(); markDone(); }
  _hide() {
    this.i = -1; this.el.hidden = true; this.hand.hidden = true;
    document.body.classList.remove('coach-on');
    document.querySelectorAll('.pulse').forEach((e) => e.classList.remove('pulse'));
  }

  // 제스처 힌트: 시작점 → 끝점 반복
  _loop(now) {
    if (!this.active) return;
    const s = STEPS[this.i], h = s?.hand;
    const a = h && !this.book.busy ? this.book.anchor(h.from) : null;
    if (!a) this.hand.hidden = true;
    else {
      this.hand.hidden = false;
      const p = ((now - this.t0) % 2200) / 2200;
      const move = p < 0.18 ? 0 : p > 0.78 ? 1 : (p - 0.18) / 0.6;
      const e = move < 0.5 ? 2 * move * move : 1 - Math.pow(-2 * move + 2, 2) / 2;
      const op = p < 0.12 ? p / 0.12 : p > 0.82 ? Math.max(0, 1 - (p - 0.82) / 0.14) : 1;
      const sc = p < 0.18 ? 1.15 - 0.15 * (p / 0.18) : 1;
      this.hand.style.transform = `translate(${a.x + h.dx * e}px, ${a.y + h.dy * e}px) scale(${sc})`;
      this.hand.style.opacity = op;
    }
    requestAnimationFrame(this._loop);
  }
}
