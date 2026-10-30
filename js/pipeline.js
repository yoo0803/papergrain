// 배경 처리 파이프라인 (스타일화 → 물체 분할 → 겹 자르기 → 물체 카드)

import { stylizeBackground, computeCuts, buildLayers, sampleBottomColors, buildCharacterCard, makeCanvas } from './stylize.js';
import { findObjects } from './segment.js';

/** 단계별 계산 (store: 챕터 id → 캐시) */
export function compute(store, { id, bg, style: st, seed }) {
  let k = store.get(id);
  if (!k || bg) { k = { bg: bg || k?.bg }; store.set(id, k); }
  const styKey = [st.palette, st.tint, st.wash, st.ink, st.abstraction].join('|');
  if (k.styKey !== styKey) { k.sty = stylizeBackground(k.bg, { ...st, seed }); k.styKey = styKey; k.objKey = null; }
  const nObj = st.objects ?? 3, objKey = styKey + '|' + nObj;
  if (k.objKey !== objKey) {
    k.seg = findObjects(k.sty, nObj, k.bg); k.objKey = objKey; k.cutKey = null;
    k.objCards = k.seg.objects.map((o) => ({ o: { x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1, cx: o.cx, bottom: o.bottom }, card: buildCharacterCard(o.canvas, { palette: st.palette, removeBg: false, seed }) }));
  }
  const cutKey = objKey + '|' + st.layers;
  if (k.cutKey !== cutKey) {
    const base = { ...k.sty, canvas: k.seg.filled };
    k.layers = buildLayers(base, computeCuts(k.sty.L, k.sty.W, k.sty.H, st.layers, seed), st.palette, seed);
    k.bottom = sampleBottomColors(base); k.cutKey = cutKey;
  }
  return { layers: k.layers, bottom: k.bottom, objects: k.objCards, W: k.sty.W, H: k.sty.H, thumb: k.sty.canvas };
}

/** 워커 결과 → 텍스처용 ImageBitmap (WebGL은 ImageBitmap의 flipY를 무시하므로 미리 뒤집음) */
export function toBitmap(src, flip = true) {
  const c = makeCanvas(src.width, src.height), x = c.getContext('2d');
  if (flip) { x.translate(0, src.height); x.scale(1, -1); }
  x.drawImage(src, 0, 0);
  return c.transferToImageBitmap();
}
export function thumbBitmap(src, w = 320) {
  const s = Math.min(1, w / src.width), c = makeCanvas(src.width * s, src.height * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.transferToImageBitmap();
}

/** 화면 스레드용 실행기: 워커 우선, 실패 시 직접 계산 */
export class BgPipeline {
  constructor() {
    this.jobs = new Map(); this.n = 0; this.sent = new Map(); this.local = null;
    try {
      if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || !OffscreenCanvas.prototype.transferToImageBitmap) throw 0;
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        const j = this.jobs.get(data.jid); if (!j) return;
        this.jobs.delete(data.jid);
        data.error ? j.reject(new Error(data.error)) : j.resolve(data.res);
      };
      this.worker.onerror = (e) => { e.preventDefault?.(); this._fallback(); };
    } catch (_) { this._fallback(); }
  }
  _fallback() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.local = new Map(); this.sent.clear();
    for (const [, j] of this.jobs) j.retry();
    this.jobs.clear();
  }
  /** @returns Promise<{layers, bottom, objects, W, H, thumb}> */
  run({ id, bg, style, seed }) {
    if (!this.worker) {
      return new Promise((res, rej) => setTimeout(() => {
        try { res(compute(this.local, { id, bg: this.sent.get(id) === bg ? null : (this.sent.set(id, bg), bg), style, seed })); } catch (e) { rej(e); }
      }, 0));
    }
    return new Promise(async (resolve, reject) => {
      const jid = ++this.n;
      const retry = () => this.run({ id, bg, style, seed }).then(resolve, reject);
      this.jobs.set(jid, { resolve, reject, retry });
      let send = null, transfer = [];
      if (this.sent.get(id) !== bg) { send = await createImageBitmap(bg); transfer = [send]; this.sent.set(id, bg); }
      if (!this.worker) return retry();
      this.worker.postMessage({ jid, id, bg: send, style: { ...style }, seed }, transfer);
    });
  }
}
