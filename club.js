/* The Conscious Frame – shared by the gallery, exhibition, theme archive and home page.
   Signing in with an invite code, and loading the members-only gallery from the club's inbox
   (config.js holds its address). Photos are never part of the website itself: the inbox only
   hands them to signed-in members, through links that stop working within a day. The exhibition's
   photos are the exception: anyone can see those, because their photographers agreed. */
var Club = (function () {
  "use strict";
  var KEY = "conscious-frame-member";          // the same sign-in as the Share a photo page
  var INBOX = String(window.CLUB_INBOX || "").replace(/\/+$/, "");

  function ready() { return /^https?:\/\//.test(INBOX); }
  function code() { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function setCode(c) { try { if (c) localStorage.setItem(KEY, c); else localStorage.removeItem(KEY); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function call(path, opts) {
    opts = opts || {};
    var headers = {}, c = opts.anon ? "" : opts.code || code();
    if (c) headers.Authorization = "Bearer " + c;
    if (opts.json) headers["Content-Type"] = "application/json";
    return fetch(INBOX + path, { method: opts.method || "GET", headers: headers, body: opts.json ? JSON.stringify(opts.json) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) { var e = new Error(d.error || "Something went wrong (" + r.status + "). Try again."); e.status = r.status; throw e; }
          return d;
        });
      }, function () { throw new Error("Couldn't reach the club. Check your internet connection and try again."); });
  }

  // The whole gallery: photos (newest first), Photos of the month, this month's dates and the photo link key.
  var loading = null;
  function gallery() {
    if (!loading) {
      loading = call("/gallery").then(function (d) {
        d.byId = {};
        d.photos.forEach(function (p) { d.byId[p.id] = p; });
        return d;
      });
      loading.catch(function (e) { loading = null; if (e.status === 401) setCode(""); });
    }
    return loading;
  }
  function photoUrl(d, p, size) {
    return INBOX + "/img/" + encodeURIComponent(p.id) + "/" + size + "?v=" + encodeURIComponent(p.v || "") + "&t=" + encodeURIComponent(d.token);
  }
  // The public exhibition: { photos, series }. Each photo carries its own link key (p.t).
  var showing = null;
  function exhibition() {
    if (!showing) {
      showing = call("/exhibition", { anon: true });
      showing.catch(function () { showing = null; });
    }
    return showing;
  }
  function publicUrl(p, size) {
    return INBOX + "/img/" + encodeURIComponent(p.id) + "/" + size + "?v=" + encodeURIComponent(p.v || "") + "&t=" + encodeURIComponent(p.t);
  }
  // A download's address. Members-only files need the members' key (d.token from /files); o.thumb: its preview; o.dl: save it instead of opening it.
  function fileUrl(f, token, o) {
    o = o || {};
    var q = ["v=" + encodeURIComponent(String(f.added || ""))];
    if (!f.pub && token) q.push("t=" + encodeURIComponent(token));
    if (o.dl) q.push("dl=1");
    return INBOX + "/file/" + encodeURIComponent(f.id) + (o.thumb ? "/thumb" : "") + "?" + q.join("&");
  }
  // lang="ml" on Malayalam text: phones then use a Malayalam font, line spacing and line breaking
  function ml(s) { return /[\u0D00-\u0D7F]/.test(s || "") ? ' lang="ml"' : ""; }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  /* Rows of photos, each photo at its own shape (nothing cropped), each row as close as possible to the
     row height in the CSS (--row). Picks where rows break, so a tall photo never ends up alone and huge.
     Works on every .just box; call it again after adding photos or filtering. The CSS alone is the fallback. */
  var watched = typeof WeakSet === "function" ? new WeakSet() : null, ro = window.ResizeObserver ? new ResizeObserver(function (es) { es.forEach(function (e) { justify(e.target); }); }) : null;
  function justify(box) {
    var W = box.clientWidth;
    if (!W) return;
    if (ro && watched && !watched.has(box)) { watched.add(box); ro.observe(box); }
    var cs = getComputedStyle(box), target = parseFloat(cs.getPropertyValue("--row")) || 200, pad = parseFloat(cs.getPropertyValue("--pad")) || 0, gap = parseFloat(cs.columnGap) || 0;
    var items = [].filter.call(box.children, function (el) { return getComputedStyle(el).display !== "none"; });
    function height(row, sum) { return (W - gap * (row.length - 1) - pad * row.length - 1) / sum; }   // 1px to spare against rounding
    function place(row, h) { row.forEach(function (x) { x.el.style.flex = "0 0 auto"; x.el.style.width = Math.floor((x.ar * h + pad) * 100) / 100 + "px"; }); }
    var row = [], sum = 0;
    items.forEach(function (el) {
      var ar = parseFloat(el.style.getPropertyValue("--ar")) || 1.5;
      row.push({ el: el, ar: ar }); sum += ar;
      if (sum * target + pad * row.length + gap * (row.length - 1) < W) return;
      var withIt = height(row, sum), without = row.length > 1 ? height(row.slice(0, -1), sum - ar) : Infinity;
      if (Math.abs(Math.log(without / target)) < Math.abs(Math.log(withIt / target))) {   // closer to the row height without the last photo
        place(row.slice(0, -1), without); row = [row[row.length - 1]]; sum = ar;
        if (sum * target + pad < W) return;
      }
      place(row, height(row, sum)); row = []; sum = 0;
    });
    place(row, Math.min(target, row.length ? height(row, sum) : target));   // the last row keeps the row height
  }
  function layout(root) { (root || document).querySelectorAll(".just").forEach(justify); }

  // A photo's categories and series: one or several (older photos have a single one)
  function cats(p) { return p.cats && p.cats.length ? p.cats : p.cat ? [p.cat] : []; }
  function seriesOf(p) { return Array.isArray(p.series) ? p.series : p.series ? [p.series] : []; }
  function catClass(c) { return String(c).toLowerCase().replace(/[^a-z]/g, ""); }
  // The series a photo belongs to, by id, from a list of series
  function seriesName(list, id) {
    var s = (list || []).filter(function (x) { return x.id === id; })[0];
    return s ? s.name : "";
  }
  // added this month, so members can vote for it (votes are monthly)
  function thisMonth(d, p) { return !!p.added && p.added >= (d.monthStart || d.weekStart) && p.added <= d.today; }

  function signIn(typed) {
    var c = String(typed || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (!c) return Promise.reject(new Error("Enter your invite code."));
    return call("/me", { code: c }).then(function (me) { setCode(c); loading = null; return me; });
  }
  function signOut() { setCode(""); loading = null; }

  return { ready: ready, code: code, esc: esc, call: call, gallery: gallery, photoUrl: photoUrl, thisMonth: thisMonth, thisWeek: thisMonth, signIn: signIn, signOut: signOut,
           exhibition: exhibition, publicUrl: publicUrl, ml: ml, shuffle: shuffle, seriesName: seriesName, layout: layout,
           cats: cats, seriesOf: seriesOf, catClass: catClass, fileUrl: fileUrl };
})();
