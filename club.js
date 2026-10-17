/* The Conscious Frame – shared by the gallery and the home page.
   Signing in with an invite code, and loading the members-only gallery from the club's inbox
   (config.js holds its address). Photos are never part of the website itself: the inbox only
   hands them to signed-in members, through links that stop working within a day. */
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
    var headers = {}, c = opts.code || code();
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

  // The whole gallery: photos (newest first), Photos of the week, this week's dates and the photo link key.
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
  function thisWeek(d, p) { return !!p.added && p.added >= d.weekStart && p.added <= d.today; }

  function signIn(typed) {
    var c = String(typed || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (!c) return Promise.reject(new Error("Enter your invite code."));
    return call("/me", { code: c }).then(function (me) { setCode(c); loading = null; return me; });
  }
  function signOut() { setCode(""); loading = null; }

  return { ready: ready, code: code, esc: esc, call: call, gallery: gallery, photoUrl: photoUrl, thisWeek: thisWeek, signIn: signIn, signOut: signOut };
})();
