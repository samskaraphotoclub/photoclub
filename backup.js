/* The Conscious Frame – admin only: the Backup button.
   Collects the gallery's photos and the club's records from the inbox and saves them as one .zip file.
   The zip is "stored" (not compressed): photos are already compressed, and this keeps the code small. */
var Backup = (function () {
  "use strict";
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // files: [{ name: "photos/x.webp", data: Uint8Array }] -> a .zip Blob
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0, now = new Date();
    var time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, name, f.data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + size;
    });
    var csize = central.reduce(function (s, b) { return s + b.byteLength; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [e.buffer]), { type: "application/zip" });
  }
  function text(name, s) { return { name: name, data: new TextEncoder().encode(s) }; }
  function csv(photos) {
    var q = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return "\ufeff" + ["name,title,photographer,category,added,description"].concat(photos.map(function (p) {
      return [p.id, p.title, p.by, p.cat, p.added, p.desc].map(q).join(",");
    })).join("\r\n") + "\r\n";
  }

  /* inbox(path) -> Promise of JSON (the admin page's inbox call); photoUrl(d, p, size) -> address of a photo.
     onStatus(message) shows progress. Resolves with { blob, name, photos }. */
  function make(inbox, photoUrl, onStatus) {
    var files = [], records = {}, d;
    var parts = [["member:", "members"], ["c:", "comments"], ["owner:", "who sent which photo"], ["own:", "members' sent photos"], ["v:", "votes"], ["moved:", "earlier invite codes"]];
    onStatus("Getting the gallery…");
    return inbox("/gallery").then(function (g) {
      d = g;
      var i = 0;
      function nextPart() {
        if (i >= parts.length) return Promise.resolve();
        var prefix = parts[i][0], label = parts[i][1]; i++;
        records[prefix] = [];
        onStatus("Getting " + label + "…");
        function page(cursor) {
          return inbox("/admin/export?prefix=" + encodeURIComponent(prefix) + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "")).then(function (r) {
            records[prefix] = records[prefix].concat(r.entries);
            return r.cursor ? page(r.cursor) : null;
          });
        }
        return page(null).then(nextPart);
      }
      return nextPart();
    }).then(function () {
      var n = 0;
      function nextPhoto() {
        if (n >= d.photos.length) return Promise.resolve();
        var p = d.photos[n++];
        onStatus("Getting photo " + n + " of " + d.photos.length + "…");
        return Promise.all(["full", "thumb"].map(function (size) {
          return fetch(photoUrl(d, p, size)).then(function (r) {
            if (!r.ok) throw new Error("Couldn't get the photo “" + p.title + "”. Try again.");
            return r.arrayBuffer();
          }, function () { throw new Error("Couldn't reach the inbox. Check your connection and try again."); });
        })).then(function (b) {
          files.push({ name: "photos/" + p.id + "." + p.ext, data: new Uint8Array(b[0]) });
          files.push({ name: "photos/" + p.id + "-sm." + p.ext, data: new Uint8Array(b[1]) });
        }).then(nextPhoto);
      }
      return nextPhoto();
    }).then(function () {
      onStatus("Making the file…");
      var t = new Date(), pad = function (n) { return (n < 10 ? "0" : "") + n; };
      var day = t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());   // this phone's date
      var data = { made: new Date().toISOString(), members: records["member:"], comments: records["c:"], owners: records["owner:"],
                   sent: records["own:"], votes: records["v:"], earlierCodes: records["moved:"] };
      var readme = "The Conscious Frame – backup made on " + day + "\r\n\r\n" +
        "Keep this file private: it contains members' invite codes.\r\n\r\n" +
        "photos/                   Every photo in the gallery: NAME.webp or NAME.jpg (large) and NAME-sm (thumbnail)\r\n" +
        "photos.csv                The list of photos, to open in a spreadsheet\r\n" +
        "gallery.json              The gallery as the inbox keeps it (titles, photographers, camera settings, dates)\r\n" +
        "photos-of-the-week.json   The current Photos of the week\r\n" +
        "data.json                 Members and their invite codes, comments, votes, and who sent which photo\r\n\r\n" +
        d.photos.length + " photos, " + records["member:"].length + " members.\r\n";
      var all = [text("README.txt", readme), text("photos.csv", csv(d.photos)), text("gallery.json", JSON.stringify(d.photos, null, 2)),
                 text("photos-of-the-week.json", JSON.stringify(d.potw, null, 2)), text("data.json", JSON.stringify(data, null, 2))].concat(files);
      return { blob: zip(all), name: "conscious-frame-backup-" + day + ".zip", photos: d.photos.length, members: records["member:"].length };
    });
  }
  function save(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  }
  /* ---------- restoring ---------- */
  // A .zip -> { "name": Uint8Array }. Handles the club's own backups (stored) and re-packed ones (deflated).
  function unzip(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), eocd = -1, dec = new TextDecoder();
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return Promise.reject(new Error("That file isn't a .zip backup."));
    var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), jobs = [];
    for (var n = 0; n < count; n++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) return Promise.reject(new Error("The backup file is damaged."));
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true),
          xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      var start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      jobs.push(inflate(name, method, u8.subarray(start, start + csize)));
      p += 46 + nlen + xlen + clen;
    }
    return Promise.all(jobs).then(function (list) { var out = {}; list.forEach(function (f) { if (f) out[f.name] = f.data; }); return out; });
  }
  function inflate(name, method, data) {
    if (/\/$/.test(name) || /(^|\/)(__MACOSX|\.)/.test(name)) return Promise.resolve(null);   // folders and Mac extras
    if (method === 0) return Promise.resolve({ name: name, data: data });
    if (method === 8 && window.DecompressionStream)
      return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer().then(function (b) { return { name: name, data: new Uint8Array(b) }; });
    return Promise.reject(new Error("This phone can't open a backup that has been re-packed. Use the original file, or a computer."));
  }
  // What's in a backup: { made, gallery, potw, data, photoFile(name) }
  function read(files) {
    var root = Object.keys(files).filter(function (k) { return /(^|\/)gallery\.json$/.test(k); }).sort(function (a, b) { return a.length - b.length; })[0];
    if (root == null) throw new Error("That .zip isn't a club backup: it has no gallery.json.");
    var pre = root.slice(0, root.length - "gallery.json".length), dec = new TextDecoder();
    var json = function (name) { var f = files[pre + name]; return f ? JSON.parse(dec.decode(f)) : null; };
    var data = json("data.json") || {};
    return { made: data.made || "", gallery: json("gallery.json") || [], potw: json("photos-of-the-week.json"), data: data,
             photoFile: function (name) { return files[pre + "photos/" + name]; } };
  }
  /* Restores the chosen photos and members, then adds back comments, votes and the other records for
     everything that's in the club afterwards. inbox(path, opts) is the admin page's inbox call.
     photoIds/memberCodes: what to restore. have: { photos: {id: true}, members: {code: true} } now in the club. */
  function restore(inbox, b, photoIds, memberCodes, have, onStatus) {
    var data = b.data, done = { photos: 0, members: 0, records: 0 };
    var photos = {}, members = {};
    Object.keys(have.photos).forEach(function (id) { photos[id] = true; });
    Object.keys(have.members).forEach(function (c) { members[c] = true; });
    function records(entries, label) {
      var i = 0;
      function next() {
        if (i >= entries.length) return Promise.resolve();
        onStatus("Restoring " + label + "…");
        var batch = entries.slice(i, i + 100); i += 100;
        return inbox("/admin/restore/records", { method: "POST", json: { entries: batch } }).then(function (r) { done.records += r.added + r.merged; }).then(next);
      }
      return next();
    }
    var wantMembers = (data.members || []).filter(function (e) { return memberCodes.indexOf(e.key.slice(7)) >= 0; });
    return records(wantMembers, "members").then(function () {
      wantMembers.forEach(function (e) { members[e.key.slice(7)] = true; });
      done.members = wantMembers.length;
      var list = b.gallery.filter(function (p) { return photoIds.indexOf(p.id) >= 0; }), n = 0;
      function nextPhoto() {
        if (n >= list.length) return Promise.resolve();
        var p = list[n++];
        onStatus("Restoring photo " + n + " of " + list.length + ": “" + p.title + "”…");
        var full = b.photoFile(p.id + "." + p.ext), thumb = b.photoFile(p.id + "-sm." + p.ext);
        if (!full || !thumb) return Promise.reject(new Error("The backup is missing the files for “" + p.title + "”."));
        var type = p.ext === "webp" ? "image/webp" : "image/jpeg", f = new FormData();
        ["id", "title", "by", "cat", "desc", "lens", "ap", "sh", "iso", "added", "sub", "at", "w", "h", "tw", "th"].forEach(function (k) { f.append(k, p[k] == null ? "" : p[k]); });
        f.append("full", new Blob([full], { type: type }), "photo." + p.ext);
        f.append("thumb", new Blob([thumb], { type: type }), "thumb." + p.ext);
        return inbox("/admin/restore/photo", { form: f }).then(function (r) { if (!r.already) done.photos++; photos[p.id] = true; }).then(nextPhoto);
      }
      return nextPhoto();
    }).then(function () {
      var code = function (e) { return e.key.slice(e.key.lastIndexOf(":") + 1); };
      var rest = []
        .concat((data.comments || []).filter(function (e) { return photos[e.key.slice(2)]; }))
        .concat((data.owners || []).filter(function (e) { return photos[e.key.slice(6)]; }))
        .concat((data.sent || []).filter(function (e) { return members[e.key.slice(4)]; }))
        .concat((data.votes || []).filter(function (e) { return members[code(e)]; }))
        .concat(data.earlierCodes || []);
      if (b.potw) rest.push({ key: "potw", value: b.potw });
      return records(rest, "comments and votes");
    }).then(function () { return done; });
  }

  return { make: make, save: save, zip: zip, csv: csv, unzip: unzip, read: read, restore: restore };
})();
