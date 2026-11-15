/* The Conscious Frame – the Photography Handbook pages: the contents list, search and exercise ticks.
   Search loads the handbook's text (search-data.js) the first time someone types. Ticks are kept in this
   browser only (localStorage), like the light/dark choice. */
(function () {
  "use strict";

  // contents: always open on wide screens, a tap-to-open list on phones and tablets
  var toc = document.querySelector(".hb-toc");
  if (toc && window.matchMedia) {
    var wide = matchMedia("(min-width: 1010px)");
    var set = function () { toc.open = wide.matches; };
    set();
    if (wide.addEventListener) wide.addEventListener("change", set);
  }

  // exercise ticks
  var KEY = "conscious-frame-handbook-done", done = {};
  try { done = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { done = {}; }
  document.querySelectorAll(".hb-done input").forEach(function (box) {
    var row = box.closest(".hb-ex"), id = box.getAttribute("data-ex");
    box.checked = !!done[id];
    if (row) row.classList.toggle("is-done", box.checked);
    box.addEventListener("change", function () {
      if (box.checked) done[id] = 1; else delete done[id];
      if (row) row.classList.toggle("is-done", box.checked);
      try { localStorage.setItem(KEY, JSON.stringify(done)); } catch (e) {}
    });
  });

  // search
  var form = document.querySelector(".hb-search");
  if (!form) return;
  var input = form.querySelector("input"), out = form.querySelector(".hb-results"), loading = false, timer;
  function load(then) {
    if (window.HB_SEARCH) return then();
    if (loading) return;
    loading = true;
    var s = document.createElement("script");
    s.src = "search-data.js";
    s.onload = function () { loading = false; then(); };
    s.onerror = function () { loading = false; out.hidden = false; out.innerHTML = "<p>Search couldn’t load. Check your connection and try again.</p>"; };
    document.head.appendChild(s);
  }
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fold(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'"); }
  function snippet(text, word) {
    var f = fold(text), i = f.indexOf(word), start = Math.max(0, i - 60);
    var part = text.slice(start, start + 170);
    var cut = (start > 0 ? "…" : "") + part + (start + 170 < text.length ? "…" : "");
    var re = new RegExp("(" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "i");
    return esc(cut).replace(re, "<mark>$1</mark>");
  }
  function run() {
    var q = fold(input.value.trim());
    if (q.length < 2) { out.hidden = true; out.innerHTML = ""; return; }
    var words = q.split(/\s+/).filter(Boolean);
    var hits = [];
    window.HB_SEARCH.forEach(function (e) {
      var t = fold(e.t), x = fold(e.x), score = 0;
      for (var i = 0; i < words.length; i++) {
        var w = words[i], inT = t.indexOf(w) >= 0, inX = x.indexOf(w) >= 0;
        if (!inT && !inX) return;
        score += (inT ? 20 : 0) + (inX ? Math.min(10, x.split(w).length - 1) : 0);
      }
      if (t === q) score += 50;
      hits.push({ e: e, s: score });
    });
    hits.sort(function (a, b) { return b.s - a.s; });
    if (!hits.length) { out.hidden = false; out.innerHTML = "<p>Nothing found for “" + esc(input.value.trim()) + "”.</p>"; return; }
    out.innerHTML = "<ol>" + hits.slice(0, 12).map(function (h) {
      var e = h.e, w = words.find(function (w) { return fold(e.x).indexOf(w) >= 0; }) || words[0];
      return '<li><a href="' + esc(e.u) + '"><small>' + esc(e.c) + "</small><b>" + esc(e.t) + "</b><span>" + snippet(e.x, w) + "</span></a></li>";
    }).join("") + "</ol>";
    out.hidden = false;
  }
  input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { load(run); }, 120); });
  input.addEventListener("focus", function () { load(function () {}); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { input.value = ""; out.hidden = true; }
    if (e.key === "ArrowDown") { var a = out.querySelector("a"); if (a) { e.preventDefault(); a.focus(); } }
  });
  out.addEventListener("keydown", function (e) {
    var links = Array.prototype.slice.call(out.querySelectorAll("a")), i = links.indexOf(document.activeElement);
    if (e.key === "ArrowDown" && i < links.length - 1) { e.preventDefault(); links[i + 1].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); (i > 0 ? links[i - 1] : input).focus(); }
    if (e.key === "Escape") { input.focus(); out.hidden = true; }
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    load(function () { run(); var a = out.querySelector("a"); if (a) location.href = a.getAttribute("href"); });
  });
  document.addEventListener("click", function (e) { if (!form.contains(e.target)) out.hidden = true; });
  // following a result to another part of the same page: close the list
  out.addEventListener("click", function () { out.hidden = true; });
})();
