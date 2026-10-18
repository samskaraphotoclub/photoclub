/* The Conscious Frame – photo tiles and the photo viewer, shared by the gallery and the exhibition.
   Tiles keep each photo's own shape (rows of photos the same height, nothing cropped).
   The viewer opens from the address (#p-NAME): previous/next, swipe, arrow keys, Esc. Needs club.js. */
var Viewer = (function () {
  "use strict";
  var esc = Club.esc, ml = Club.ml;

  /* A tile with its viewer. thumb, full: the image addresses.
     o.cls: extra classes; o.series: the names of its series; o.extra: HTML under the details; o.byHref: link for the photographer's name;
     o.votes: its number of hearts (shown on the photo), which also makes room for the heart button beside the title. */
  var HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.6 4.3 13a4.9 4.9 0 0 1 0-7 4.9 4.9 0 0 1 7 0l.7.7.7-.7a4.9 4.9 0 0 1 7 0 4.9 4.9 0 0 1 0 7Z"/></svg>';
  function badge(n, cls) { return '<span class="' + cls + '"' + (n ? "" : " hidden") + ' aria-label="' + n + (n === 1 ? " heart" : " hearts") + '">' + HEART + "<b>" + (n | 0) + "</b></span>"; }
  function tile(p, thumb, full, o) {
    o = o || {};
    var id = esc(p.id), title = esc(p.title), ar = (p.tw > 0 && p.th > 0 ? p.tw / p.th : 1.5).toFixed(3);
    var series = Array.isArray(o.series) ? o.series : o.series ? [o.series] : [], voting = o.votes !== undefined;
    var by = o.byHref ? '<a class="by-link" href="' + esc(o.byHref) + '"' + ml(p.by) + ">" + esc(p.by) + "</a>" : "<span" + ml(p.by) + ">" + esc(p.by) + "</span>";
    var rows = [["Lens", p.lens], ["Aperture", p.ap], ["Shutter", p.sh], ["ISO", p.iso]].filter(function (r) { return r[1]; })
      .map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
    return '<figure class="tile' + (o.cls ? " " + o.cls : "") + '" id="t-' + id + '" style="--ar:' + ar + '">' +
      '<a href="#p-' + id + '"><img src="' + esc(thumb) + '" alt="' + title + '" width="' + (p.tw | 0) + '" height="' + (p.th | 0) + '" loading="lazy">' + (voting ? badge(o.votes, "tile-votes") : "") + "</a>" +
      "<figcaption><b" + ml(p.title) + ">" + title + "</b>" + by + "</figcaption>" +
      '<div class="viewer" id="p-' + id + '" role="dialog" aria-label="' + title + '">' +
        '<a class="shade" href="#t-' + id + '" aria-label="Close" tabindex="-1"></a>' +
        '<div class="box">' +
          '<a class="close" href="#t-' + id + '" aria-label="Close">×</a>' +
          '<div class="pic"><img src="' + esc(full) + '" alt="' + title + '" width="' + (p.w | 0) + '" height="' + (p.h | 0) + '" loading="lazy">' + (voting ? badge(o.votes, "vote-badge") : "") + "</div>" +
          '<div class="info">' + (voting ? '<div class="title-row"><h2' + ml(p.title) + ">" + title + '</h2><div class="vote-slot"></div></div><p class="vote-note" aria-live="polite"></p>' : "<h2" + ml(p.title) + ">" + title + "</h2>") +
            '<p class="by">' + by + ", " + esc(Club.cats(p).join(", ")) + "</p>" +
            (series.length ? '<p class="in-series">Part of the series ' + series.map(function (n) { return "<b" + ml(n) + ">" + esc(n) + "</b>"; }).join(" and ") + "</p>" : "") + (o.lines || "") +
            (p.desc ? '<p class="desc"' + ml(p.desc) + ">" + esc(p.desc) + "</p>" : "") + (rows ? "<dl>" + rows + "</dl>" : "") + (o.extra || "") + "</div>" +
        "</div>" +
      "</div></figure>";
  }

  // The open photo, from the address. The page adds "open" itself, because the browser doesn't
  // apply :target to photos that arrive after the page has loaded.
  function current() {
    var id = "";
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
    var v = id && document.getElementById(id);
    return v && v.classList.contains("viewer") ? v : null;
  }
  var opts = {};
  function sync() {
    var v = current();
    document.querySelectorAll(".viewer.open").forEach(function (o) { if (o !== v) o.classList.remove("open"); });
    if (v) { v.classList.add("open"); if (opts.onOpen) opts.onOpen(v); }
    else if (/^#p-/.test(location.hash) && opts.onMissing) opts.onMissing();
  }
  function addSteps(root) {
    (root || document).querySelectorAll(".viewer .pic").forEach(function (pic) {
      if (pic.querySelector(".step")) return;
      pic.insertAdjacentHTML("beforeend", '<button class="step prev" type="button" aria-label="Previous photo">‹</button><button class="step next" type="button" aria-label="Next photo">›</button>');
    });
  }
  function go(step) {
    var cur = current(); if (!cur) return;
    var tiles = [].filter.call(document.querySelectorAll(".tile"), function (t) { return t.offsetParent || t.contains(cur); });
    var i = tiles.indexOf(cur.closest(".tile"));
    location.replace("#" + tiles[(i + step + tiles.length) % tiles.length].querySelector(".viewer").id);
  }
  function close() { var cur = current(); if (cur) location.replace(cur.querySelector(".close").getAttribute("href")); }

  var started = false;
  function init(o) {
    opts = o || {};
    if (started) return;
    started = true;
    window.addEventListener("hashchange", sync);
    document.addEventListener("click", function (e) {
      var b = e.target.closest(".step, .viewer .close, .viewer .shade");
      if (!b) return;
      e.preventDefault();
      b.classList.contains("step") ? go(b.classList.contains("prev") ? -1 : 1) : close();
    });
    document.addEventListener("keydown", function (e) {
      if (!current() || e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    });
    var x0 = null, y0 = 0;
    document.addEventListener("touchstart", function (e) { if (e.target.closest(".viewer .pic")) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } }, { passive: true });
    document.addEventListener("touchend", function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    });
  }

  // updates a photo's number of hearts on the photo and its thumbnail
  function setVotes(id, n) {
    document.querySelectorAll("#t-" + id + " .tile-votes, #p-" + id + " .vote-badge").forEach(function (b) {
      b.hidden = !n; b.querySelector("b").textContent = n; b.setAttribute("aria-label", n + (n === 1 ? " heart" : " hearts"));
    });
  }
  return { tile: tile, init: init, sync: sync, addSteps: addSteps, current: current, setVotes: setVotes, HEART: HEART };
})();
