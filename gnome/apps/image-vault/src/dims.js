'use strict';
// Reads an image's pixel size from its file header (first 128 KB) instead of
// decoding the whole picture. JPEG EXIF rotation is applied so the result
// matches what the browser displays.
const fs = require('fs');

function jpegDims(b) {
  let i = 2, orient = 1, w = 0, h = 0;
  while (i + 4 < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    let t = b[i + 1];
    if (t === 0xFF) { i++; continue; }
    if (t === 0xD8 || (t >= 0xD0 && t <= 0xD7) || t === 0x01) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (t === 0xE1 && b.toString('latin1', i + 4, i + 8) === 'Exif') {        // APP1 → EXIF orientation
      const t0 = i + 10, le = b.toString('latin1', t0, t0 + 2) === 'II';
      const u16 = o => le ? b.readUInt16LE(o) : b.readUInt16BE(o);
      const u32 = o => le ? b.readUInt32LE(o) : b.readUInt32BE(o);
      try {
        const ifd = t0 + u32(t0 + 4), n = u16(ifd);
        for (let k = 0; k < n; k++) {
          const e = ifd + 2 + k * 12;
          if (u16(e) === 0x0112) { orient = u16(e + 8); break; }
        }
      } catch {}
    }
    if (t >= 0xC0 && t <= 0xCF && t !== 0xC4 && t !== 0xC8 && t !== 0xCC) {    // SOFn
      h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7);
      break;
    }
    i += 2 + len;
  }
  if (!w || !h) return null;
  return orient >= 5 && orient <= 8 ? [h, w] : [w, h];
}

function webpDims(b) {
  const f = b.toString('latin1', 12, 16);
  if (f === 'VP8 ') return [b.readUInt16LE(26) & 0x3FFF, b.readUInt16LE(28) & 0x3FFF];
  if (f === 'VP8L') return [1 + (((b[22] & 0x3F) << 8) | b[21]), 1 + (((b[24] & 0xF) << 10) | (b[23] << 2) | ((b[22] & 0xC0) >> 6))];
  if (f === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  return null;
}

function parseDims(b) {
  if (b.length < 32) return null;
  if (b[0] === 0xFF && b[1] === 0xD8) return jpegDims(b);
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.toString('latin1', 0, 3) === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)];
  if (b[0] === 0x42 && b[1] === 0x4D) return [Math.abs(b.readInt32LE(18)), Math.abs(b.readInt32LE(22))];
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return webpDims(b);
  if (b.toString('latin1', 4, 8) === 'ftyp') {                                    // AVIF / HEIF
    const k = b.indexOf('ispe');
    if (k > 0 && k + 16 <= b.length) {
      let w = b.readUInt32BE(k + 8), h = b.readUInt32BE(k + 12);
      const r = b.indexOf('irot');                                   // rotation property: odd = 90°/270°
      if (r > 0 && r + 5 <= b.length && (b[r + 4] & 1)) [w, h] = [h, w];
      return [w, h];
    }
  }
  return null;
}

// First 16 KB is enough for almost every file (that is all we read from slow
// disks); only if the size isn't there yet do we read more.
async function imageDims(file) {
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    for (const len of [16384, 262144]) {
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, 0);
      const d = parseDims(buf.subarray(0, bytesRead));
      if (d && d[0] > 0 && d[1] > 0) return d;
      if (bytesRead < len) break;                        // whole file read already
    }
    return null;
  } catch { return null; }
  finally { if (fh) await fh.close().catch(() => {}); }
}

// ── video sizes without loading the video ───────────────────────
// MP4/MOV: walk the top-level boxes (16 bytes each, seeking past `mdat`), read
// only the `moov` box and take the video track's `tkhd` (rotation aware).
async function mp4Dims(fh, size) {
  let pos = 0;
  const hdr = Buffer.alloc(16);
  for (let guard = 0; guard < 64 && pos + 8 <= size; guard++) {
    await fh.read(hdr, 0, 16, pos);
    let box = hdr.readUInt32BE(0);
    const type = hdr.toString('latin1', 4, 8);
    if (box === 1) box = Number(hdr.readBigUInt64BE(8));
    else if (box === 0) box = size - pos;
    if (type === 'moov') {
      const len = Math.min(box, 16 * 1024 * 1024);
      const m = Buffer.alloc(len);
      const { bytesRead } = await fh.read(m, 0, len, pos);
      let k = 0;
      while ((k = m.indexOf('tkhd', k)) > 0 && k + 4 + 96 < bytesRead) {
        const base = k + 4, v = m[base];
        const wOff = v === 1 ? 88 : 76, mOff = v === 1 ? 52 : 40;
        const w = m.readUInt32BE(base + wOff) / 65536, h = m.readUInt32BE(base + wOff + 4) / 65536;
        if (w > 0 && h > 0) {
          const a = m.readInt32BE(base + mOff), b = m.readInt32BE(base + mOff + 4);
          const rotated = a === 0 && b !== 0;                // 90° / 270°
          return rotated ? [Math.round(h), Math.round(w)] : [Math.round(w), Math.round(h)];
        }
        k += 4;
      }
      return null;
    }
    if (box < 8) break;
    pos += box;
  }
  return null;
}

// WebM/MKV: PixelWidth (0xB0) is followed by PixelHeight (0xBA) in the track header.
function webmDims(b) {
  for (let i = 0; i + 12 < b.length; i++) {
    if (b[i] !== 0xB0) continue;
    const sw = b[i + 1] - 0x80;
    if (sw < 1 || sw > 4) continue;
    const j = i + 2 + sw;
    if (b[j] !== 0xBA) continue;
    const sh = b[j + 1] - 0x80;
    if (sh < 1 || sh > 4) continue;
    const w = b.readUIntBE(i + 2, sw), h = b.readUIntBE(j + 2, sh);
    if (w > 0 && h > 0 && w < 20000 && h < 20000) return [w, h];
  }
  return null;
}

async function videoDims(file) {
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    const st = await fh.stat();
    const head = Buffer.alloc(65536);
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    if (head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3)    // EBML
      return webmDims(head.subarray(0, bytesRead));
    return await mp4Dims(fh, st.size);
  } catch { return null; }
  finally { if (fh) await fh.close().catch(() => {}); }
}

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;
const mediaDims = file => VIDEO_EXT.test(file) ? videoDims(file) : imageDims(file);

module.exports = { imageDims, videoDims, mediaDims, parseDims };
