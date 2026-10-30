// 이미지 입력 검증
// - 매직 바이트 기반 형식 판별 (PNG/JPEG/WEBP/GIF), SVG 거부
// - 디코딩 전 헤더 크기 검사 (압축 폭탄 차단)
// - 캔버스 재인코딩으로 EXIF 제거

export const LIMITS = { maxBytes: 25 * 1024 * 1024, maxSide: 12000, maxPixels: 40e6, workSide: 2048 };

/** message = i18n 키 */
export class ImageError extends Error {}

function sniff(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  return null;
}

function dims(type, b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (type === 'png') return [dv.getUint32(16), dv.getUint32(20)];
    if (type === 'gif') return [dv.getUint16(6, true), dv.getUint16(8, true)];
    if (type === 'webp') {
      const fmt = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fmt === 'VP8 ') return [dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff];
      if (fmt === 'VP8L') { const v = dv.getUint32(21, true); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
      if (fmt === 'VP8X') return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
    }
    if (type === 'jpeg') {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [dv.getUint16(i + 7), dv.getUint16(i + 5)];
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        i += 2 + dv.getUint16(i + 2);
      }
    }
  } catch (_) { /* 헤더 손상 */ }
  return null;
}

/** 검증 후 작업 크기(최대 2048px)로 축소한 비트맵/캔버스 반환 */
export async function loadImageSafely(file) {
  if (!(file instanceof Blob)) throw new ImageError('err.read');
  if (file.size > LIMITS.maxBytes) throw new ImageError('err.big');
  if (file.size < 24) throw new ImageError('err.type');
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer());
  const type = sniff(head);
  if (!type) throw new ImageError('err.type');
  const d = dims(type, head);
  if (!d || !d[0] || !d[1]) throw new ImageError('err.dims');
  if (d[0] > LIMITS.maxSide || d[1] > LIMITS.maxSide || d[0] * d[1] > LIMITS.maxPixels) throw new ImageError('err.res');
  const blob = new Blob([await file.arrayBuffer()], { type: 'image/' + type });
  let bmp;
  try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch (_) { throw new ImageError('err.decode'); }
  const sc = Math.min(1, LIMITS.workSide / Math.max(bmp.width, bmp.height));
  if (sc >= 1) return bmp;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

/** 앱 내장 샘플 로드 (동일 출처 고정 경로) */
export async function loadBundled(path) {
  const res = await fetch(path, { credentials: 'omit' });
  if (!res.ok) throw new ImageError('err.read');
  return createImageBitmap(await res.blob());
}
