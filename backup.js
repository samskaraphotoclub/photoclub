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
    return ["name,title,photographer,category,added,description"].concat(photos.map(function (p) {
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
  return { make: make, save: save, zip: zip, csv: csv };
})();
