'use strict';
// Decodes a HEIC/HEIF photo (the format iPhones/Android cameras use, which the
// built-in browser engine cannot show) with a WebAssembly build of libheif.
// Runs off the UI thread; replies with raw RGBA pixels.
importScripts('vendor/libheif-bundle.js');

let libPromise = null;
function lib() {
  if (!libPromise) {
    const f = typeof libheif === 'function' ? libheif : (self.libheif || self.libheif_wasm);
    libPromise = Promise.resolve(typeof f === 'function' ? f() : f);
  }
  return libPromise;
}

self.onmessage = async (e) => {
  const { id, buf } = e.data;
  try {
    const L = await lib();
    const decoder = new L.HeifDecoder();
    const images = decoder.decode(new Uint8Array(buf));
    if (!images || !images.length) throw new Error('no image found in the file');
    const img = images[0];
    const w = img.get_width(), h = img.get_height();
    const out = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    await new Promise((res, rej) => img.display(out, r => r ? res() : rej(new Error('the HEIC data could not be decoded'))));
    self.postMessage({ id, w, h, rgba: out.data.buffer }, [out.data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
