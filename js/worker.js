// 배경 처리: 화면 스레드를 막지 않도록 무거운 계산을 여기서 실행
import { compute, toBitmap, thumbBitmap } from './pipeline.js';

const store = new Map();
let queue = Promise.resolve();

self.onmessage = ({ data }) => {
  queue = queue.then(() => {
    try {
      const r = compute(store, data);
      const res = {
        layers: r.layers.map((l) => ({ canvas: toBitmap(l.canvas), back: toBitmap(l.back), aspect: l.aspect })),
        objects: r.objects.map(({ o, card }) => ({ o, card: { canvas: toBitmap(card.canvas), back: toBitmap(card.back), aspect: card.aspect, padFrac: card.padFrac } })),
        bottom: r.bottom, W: r.W, H: r.H, thumb: thumbBitmap(r.thumb),
      };
      const transfer = [res.thumb, ...res.layers.flatMap((l) => [l.canvas, l.back]), ...res.objects.flatMap((o) => [o.card.canvas, o.card.back])];
      self.postMessage({ jid: data.jid, res }, transfer);
    } catch (e) {
      self.postMessage({ jid: data.jid, error: String(e?.message || e) });
    }
  });
};
