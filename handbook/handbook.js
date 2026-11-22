/* The Conscious Frame – the Photography Handbook pages, for members only.
   The pages, pictures and search text on the site are locked. A signed-in member's page asks the club's inbox
   for this edition's key (the inbox checks the invite code), keeps it for the browser tab, and opens the page
   and its pictures here in the browser. Then: the contents list, search, exercise ticks, each chapter's quiz,
   members' attempts at each exercise (from the gallery) and the walk cards' print button. Ticks are kept in
   this browser only (localStorage), like the light/dark choice; quiz answers aren't kept at all. Needs config.js and club.js. */
(function () {
  "use strict";
  var EDITION = "BG4DdQL8xfTLHTzblqN9kp9cUEU15R5X5lmj09I5ZI-bZzJcvtEcigNlpDFAmPzESLsNaucxTDKYAu6dyNAdR54";        // this edition's public key, written by make_wiki.py
  var $ = function (id) { return document.getElementById(id); };
  var main = $("main"), data = $("hb-data");

  function bytes(s) {
    var t = String(s).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    var bin = atob(t + "===".slice((t.length + 3) % 4)), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // the edition's key: from this tab's memory, or from the inbox (members only)
  var SAVED = "conscious-frame-handbook-key:" + EDITION, keyP = null;
  function key() {
    if (keyP) return keyP;
    var saved = null;
    try { saved = sessionStorage.getItem(SAVED); } catch (e) {}
    var raw = saved ? Promise.resolve(saved) : Club.call("/handbook-key?e=" + EDITION).then(function (d) {
      try { sessionStorage.setItem(SAVED, d.key); } catch (e) {}
      return d.key;
    });
    keyP = raw.then(function (k) { return crypto.subtle.importKey("raw", bytes(k), { name: "AES-GCM" }, false, ["decrypt"]); });
    keyP.catch(function () { keyP = null; });
    return keyP;
  }
  function forget() { keyP = null; try { sessionStorage.removeItem(SAVED); } catch (e) {} }
  // a locked item: 12 bytes of IV, then the text or picture
  function open(locked) {
    return key().then(function (k) { return crypto.subtle.decrypt({ name: "AES-GCM", iv: locked.subarray(0, 12) }, k, locked.subarray(12)); });
  }

  /* ---------- signing in ---------- */
  function say(msg, isError) {
    var st = $("hb-status");
    if (!st) return;
    st.hidden = false; st.classList.toggle("error", !!isError); st.textContent = msg;
    $("hb-gate").hidden = true;
  }
  function showGate(msg) {
    $("hb-status").hidden = true;
    $("hb-gate").hidden = false;
    var st = $("hb-gate-status");
    st.classList.toggle("error", !!msg); st.textContent = msg || "";
  }
  var gate = $("hb-gate");
  if (gate) gate.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var st = $("hb-gate-status");
    st.classList.remove("error"); st.textContent = "Checking…";
    Club.signIn($("hb-code").value).then(function () { $("hb-code").value = ""; start(); })
      .catch(function (e) { st.classList.add("error"); st.textContent = e.message; });
  });

  function start() {
    if (!data) return;
    if (!window.Club || !Club.ready()) return say("The handbook opens soon.");
    if (!(window.crypto && crypto.subtle && window.TextDecoder)) return say("This browser can’t open the handbook. Try it in an up-to-date browser.", true);
    if (!Club.code()) return showGate();
    say("Opening the handbook…");
    open(bytes(data.textContent)).then(function (buf) {
      main.innerHTML = new TextDecoder().decode(buf);
      data.parentNode.removeChild(data); data = null;
      pictures();
      ready();
      if (location.hash) {
        var t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (t) t.scrollIntoView();
      }
    }).catch(function (e) {
      if (e.status === 401) { forget(); Club.signOut(); return showGate(e.message); }
      if (e.status === 404) return say("The handbook opens soon.");
      if (e.status) return say(e.message, true);
      if (e.name === "OperationError") { forget(); return say("Couldn’t open the handbook. Reload the page to try again.", true); }
      say(e.message || "Couldn’t open the handbook. Reload the page to try again.", true);
    });
  }

  /* ---------- pictures: opened as they come near the screen ---------- */
  function picture(img) {
    var src = img.getAttribute("data-hb");
    if (!src) return;
    img.removeAttribute("data-hb");
    fetch(src).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(function (b) { return open(new Uint8Array(b)); })
      .then(function (buf) { img.src = URL.createObjectURL(new Blob([buf], { type: "image/webp" })); })
      .catch(function () { img.setAttribute("data-hb", src); img.classList.add("hb-missing"); });
  }
  function pictures() {
    var list = main.querySelectorAll("img[data-hb]");
    if (!("IntersectionObserver" in window)) { list.forEach(picture); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); picture(e.target); } });
    }, { rootMargin: "900px 0px" });
    list.forEach(function (img) { io.observe(img); });
  }

  /* ---------- the handbook itself ---------- */
  function ready() {
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

    quizzes();
    attempts();
    document.querySelectorAll(".hb-print").forEach(function (b) { b.addEventListener("click", function () { window.print(); }); });

    // search: the handbook's text is opened the first time someone types
    var form = document.querySelector(".hb-search");
    if (!form) return;
    var input = form.querySelector("input"), out = form.querySelector(".hb-results"), loading = false, timer;
    function load(then) {
      if (window.HB_SEARCH) return then();
      if (loading) return;
      loading = true;
      fetch("search.bin").then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(function (b) { return open(new Uint8Array(b)); })
        .then(function (buf) { window.HB_SEARCH = JSON.parse(new TextDecoder().decode(buf)); loading = false; then(); })
        .catch(function () { loading = false; out.hidden = false; out.innerHTML = "<p>Search couldn’t load. Check your connection and try again.</p>"; });
    }
    function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    function fold(s) { return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "'"); }
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
  }

  /* ---------- each chapter's quiz: tap an answer to see whether it's right ---------- */
  function quizzes() {
    document.querySelectorAll(".hb-quiz").forEach(function (quiz) {
      var qs = quiz.querySelectorAll(".hb-q"), score = quiz.querySelector(".hb-qscore"), right = 0, answered = 0;
      qs.forEach(function (q) {
        var answer = +q.getAttribute("data-answer"), opts = q.querySelectorAll(".hb-qopt"), why = q.querySelector(".hb-qwhy");
        opts.forEach(function (b, i) {
          b.addEventListener("click", function () {
            if (q.classList.contains("is-answered")) return;
            q.classList.add("is-answered");
            var ok = i === answer;
            b.classList.add(ok ? "is-right" : "is-wrong");
            opts[answer].classList.add("is-right");
            opts.forEach(function (x) { x.setAttribute("aria-disabled", "true"); });
            b.setAttribute("aria-pressed", "true");
            if (why) { why.hidden = false; why.insertAdjacentHTML("afterbegin", "<b>" + (ok ? "Right." : "Not quite.") + "</b> "); }
            answered++; if (ok) right++;
            if (score && answered === qs.length) {
              score.hidden = false;
              score.textContent = "You got " + right + " of " + qs.length + "." + (right === qs.length ? " Well done." : " Read the chapter again and have another go any time.");
              if (right < qs.length) score.insertAdjacentHTML("beforeend", ' <button class="linkish hb-qagain" type="button">Try again</button>');
            }
          });
        });
      });
      quiz.addEventListener("click", function (e) {
        if (!e.target.closest(".hb-qagain")) return;
        qs.forEach(function (q) {
          q.classList.remove("is-answered");
          q.querySelectorAll(".hb-qopt").forEach(function (x) { x.classList.remove("is-right", "is-wrong"); x.removeAttribute("aria-disabled"); x.removeAttribute("aria-pressed"); });
          var why = q.querySelector(".hb-qwhy"); if (why) { why.hidden = true; var b = why.querySelector("b"); if (b) b.remove(); }
        });
        right = 0; answered = 0; score.hidden = true; score.textContent = "";
        qs[0].scrollIntoView({ block: "center" });
      });
    });
  }

  /* ---------- members' attempts at each exercise: gallery photos tagged with its label ---------- */
  function attempts() {
    var rows = document.querySelectorAll('.hb-ex[id^="ex-"]');
    if (!rows.length || !window.Club) return;
    function esc(s) { return Club.esc(s); }
    Club.gallery().then(function (g) {
      rows.forEach(function (row) {
        var label = row.id.slice(3), box = row.querySelector("div");
        if (!box || box.querySelector(".hb-attempts")) return;
        var list = g.photos.filter(function (p) { return p.hx === label; });
        box.insertAdjacentHTML("beforeend", '<div class="hb-attempts">' +
          (list.length ? '<p class="hb-attempts-h">' + (list.length === 1 ? "1 member’s attempt" : list.length + " members’ attempts") + "</p>" +
            '<ul class="hb-athumbs">' + list.slice(0, 6).map(function (p) {
              return '<li><a href="../gallery.html#p-' + esc(p.id) + '" title="' + esc(p.title + " by " + p.by) + '"><img src="' + esc(Club.photoUrl(g, p, "thumb")) + '" alt="' + esc(p.title) + '" loading="lazy"></a></li>';
            }).join("") + "</ul>" : "") +
          '<p class="hb-attempts-go"><a href="../submit.html?hx=' + encodeURIComponent(label) + '">Share your attempt</a>' +
          (list.length > 6 ? ' · <a href="../gallery.html#exercises">See them all in Exercises</a>' : "") + "</p></div>");
      });
    }).catch(function () { /* the gallery couldn't load: the exercises still work */ });
  }

  start();
})();
