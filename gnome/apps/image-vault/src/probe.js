'use strict';
// Looks at the first/last bytes of a file that the browser could not display and
// works out WHY (empty download, web page saved as .jpg, HEIC, truncated JPEG…).
const fs = require('fs');

function jpegInfo(b, tail) {
  let i = 2, sof = null;
  while (i + 4 < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const t = b[i + 1];
    if (t === 0xFF) { i++; continue; }
    if (t === 0xD8 || (t >= 0xD0 && t <= 0xD7) || t === 0x01) { i += 2; continue; }
    if (t >= 0xC0 && t <= 0xCF && t !== 0xC4 && t !== 0xC8 && t !== 0xCC) {
      sof = { type: t, precision: b[i + 4], h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), comps: b[i + 9] };
      break;
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  const hasEoi = tail.includes(Buffer.from([0xFF, 0xD9]));
  return { sof, hasEoi };
}

function describe(head, tail, size) {
  if (size === 0) return { kind: 'empty', size, note: 'The file is empty (0 bytes) — the download or copy failed.' };
  const s = head.toString('latin1', 0, 16);
  const hs = head.toString('latin1', 0, Math.min(head.length, 512)).trimStart().toLowerCase();

  if (head[0] === 0xFF && head[1] === 0xD8) {
    const { sof, hasEoi } = jpegInfo(head, tail);
    if (!sof) return { kind: 'jpeg', size, note: 'A JPEG whose header is damaged (no image data found).' };
    if (sof.type === 0xC9 || sof.type === 0xCA || sof.type === 0xCB || sof.type >= 0xCD)
      return { kind: 'jpeg', size, note: 'An arithmetic-coded JPEG — an unusual variant the built-in viewer does not support.' };
    if (sof.precision !== 8) return { kind: 'jpeg', size, note: `A ${sof.precision}-bit JPEG — not supported by the built-in viewer.` };
    if (!hasEoi) return { kind: 'jpeg', size, note: 'The JPEG is incomplete (it ends early) — the download was probably cut off.' };
    return { kind: 'jpeg', size, note: `A ${sof.w}×${sof.h} JPEG (${sof.comps} channels) that looks complete but the decoder rejected it — corrupt data inside.` };
  }
  if (head[0] === 0x89 && s.slice(1, 4) === 'PNG') return { kind: 'png', size, note: 'A PNG that could not be decoded — damaged or cut off.' };
  if (s.startsWith('GIF')) return { kind: 'gif', size, note: 'A GIF that could not be decoded — damaged or cut off.' };
  if (s.startsWith('RIFF') && head.toString('latin1', 8, 12) === 'WEBP') return { kind: 'webp', size, note: 'A WebP that could not be decoded — damaged or cut off.' };
  if (head.toString('latin1', 4, 8) === 'ftyp') {
    const brand = head.toString('latin1', 8, 12);
    if (/^(avif|avis)$/.test(brand)) return { kind: 'avif', size, note: 'An AVIF image that could not be decoded — damaged or an unsupported variant.' };
    return { kind: 'heic', size, note: `A ${/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand) ? 'HEIC/HEIF' : 'MP4/MOV-type'} file (${brand.trim()}) — not supported by the built-in viewer.` };
  }
  if (head[0] === 0xFF && head[1] === 0x0A || s.startsWith('\0\0\0\x0CJXL ')) return { kind: 'jxl', size, note: 'A JPEG XL image — not supported by the built-in viewer.' };
  if (s.startsWith('\0\0\0\x0CjP  ')) return { kind: 'jp2', size, note: 'A JPEG 2000 image — not supported by the built-in viewer.' };
  if (s.startsWith('II*\0') || s.startsWith('MM\0*')) return { kind: 'tiff', size, note: 'A TIFF image — not supported by the built-in viewer.' };
  if (s.startsWith('%PDF')) return { kind: 'pdf', size, note: 'This is a PDF document saved with an image name.' };
  if (s.startsWith('PK')) return { kind: 'zip', size, note: 'This is a ZIP archive saved with an image name.' };
  if (hs.startsWith('<!doctype') || hs.startsWith('<html') || hs.includes('<html') || hs.startsWith('<?xml') && !hs.includes('<svg'))
    return { kind: 'html', size, note: 'Not an image — it is a web page / error message saved with an image name (the download failed).' };
  const printable = head.slice(0, 256).every(c => c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127));
  if (printable) return { kind: 'text', size, note: 'Not an image — it is a plain text file saved with an image name.' };
  return { kind: 'unknown', size, note: 'Unknown / damaged data (first bytes: ' + [...head.slice(0, 8)].map(c => c.toString(16).padStart(2, '0')).join(' ') + ').' };
}

async function probeFile(p) {
  let fh;
  try {
    fh = await fs.promises.open(p, 'r');
    const st = await fh.stat();
    const head = Buffer.alloc(Math.min(65536, st.size));
    if (head.length) await fh.read(head, 0, head.length, 0);
    const tail = Buffer.alloc(Math.min(64, st.size));
    if (tail.length) await fh.read(tail, 0, tail.length, st.size - tail.length);
    return describe(head, tail, st.size);
  } catch (err) {
    return { kind: 'unreadable', size: 0, note: err.code === 'ENOENT' ? 'The file no longer exists at this path.' : 'The file could not be read (' + (err.code || err.message) + ').' };
  } finally { if (fh) await fh.close().catch(() => {}); }
}

module.exports = { probeFile, describe };
