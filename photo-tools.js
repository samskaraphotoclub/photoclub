/* The Conscious Frame – shared by the Share a photo and admin pages.
   Reads camera settings from the photo and resizes it on the phone before upload. */
var PhotoTools = (function () {
  "use strict";
  var FULL = 1600, THUMB = 700;   // longest edge in pixels

  /* camera settings (EXIF) from JPEG files */
  function readExif(file) {
    return file.slice(0, 256 * 1024).arrayBuffer().then(function (buf) {
      var v = new DataView(buf), off = 2;
      if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return {};
      while (off + 10 < v.byteLength) {
        var marker = v.getUint16(off), len = v.getUint16(off + 2);
        if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
        if ((marker & 0xFF00) !== 0xFF00) break;
        off += 2 + len;
      }
      return {};
    }).catch(function () { return {}; });
  }
  function parseTiff(v, t) {
    var le = v.getUint16(t) === 0x4949, out = {};
    function u16(o) { return v.getUint16(t + o, le); }
    function u32(o) { return v.getUint32(t + o, le); }
    function rational(e) { var p = u32(e + 8); return u32(p) / u32(p + 4); }
    function entries(ifd, fn) { var n = u16(ifd); for (var i = 0; i < n; i++) { var e = ifd + 2 + i * 12; fn(u16(e), e); } }
    try {
      var exifIfd = 0;
      entries(u32(4), function (tag, e) { if (tag === 0x8769) exifIfd = u32(e + 8); });
      if (!exifIfd) return out;
      entries(exifIfd, function (tag, e) {
        if (tag === 0x829A) out.exposure = rational(e);
        if (tag === 0x829D) out.fnumber = rational(e);
        if (tag === 0x8827) out.iso = u16(e + 8);
        if (tag === 0x920A) out.focal = rational(e);
        if (tag === 0xA405) out.focal35 = u16(e + 8);
      });
    } catch (e) { /* unusual EXIF layout: skip */ }
    return out;
  }
  function settingsFromExif(x) {
    var f = x.focal35 || (x.focal ? Math.round(x.focal) : 0), s = {};
    if (f) s.lens = f + " mm";
    if (x.fnumber) s.ap = "f/" + (+x.fnumber.toFixed(1));
    if (x.exposure) s.sh = x.exposure >= 1 ? (+x.exposure.toFixed(1)) + " s" : "1/" + Math.round(1 / x.exposure) + " s";
    if (x.iso) s.iso = String(x.iso);
    return s;
  }

  /* resizing */
  function decodeImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error("This file couldn't be opened as a photo. Try a JPEG or PNG.")); };
      img.src = URL.createObjectURL(file);
    });
  }
  function encode(src, edge) {
    var w = src.width, h = src.height, k = Math.min(1, edge / Math.max(w, h));
    var c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    var ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, c.width, c.height);
    function blob(type, q) { return new Promise(function (res) { c.toBlob(res, type, q); }); }
    // WebP where the browser can make it; iPhones and iPads fall back to JPEG
    return blob("image/webp", 0.8).then(function (b) {
      return b && b.type === "image/webp" ? b : blob("image/jpeg", 0.82);
    }).then(function (b) {
      if (!b) throw new Error("This phone couldn't resize the photo. Try a smaller photo.");
      return { blob: b, w: c.width, h: c.height, ext: b.type === "image/webp" ? "webp" : "jpg" };
    });
  }
  function prepare(file) {
    return decodeImage(file).then(function (img) {
      return encode(img, FULL).then(function (full) {
        return encode(img, THUMB).then(function (thumb) { return { full: full, thumb: thumb }; });
      });
    });
  }

  function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ago(ms) {
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + " h ago";
    var d = Math.round(h / 24);
    return d === 1 ? "yesterday" : d + " days ago";
  }

  return { readExif: readExif, settingsFromExif: settingsFromExif, prepare: prepare, decodeImage: decodeImage, encode: encode, kb: kb, esc: esc, ago: ago };
})();
