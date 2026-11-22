/* The Conscious Frame – the Learning page: this month's Masters challenge and handbook exercise, Why it works, the
   handbook course, photos asking for feedback, members' attempts and the past challenges.
   The page is locked like the Masters pages and ../masters/masters.js opens it; then this fills in what the inbox knows
   and adds the sections that came after the page was locked (22 Nov 2026). Attempts are gallery photos the member ticked
   as an attempt (mc: the challenge's month) or tagged with a handbook exercise (hx). Needs config.js, club.js and
   ../handbook/exercises.js (the handbook's parts, chapters and exercise titles). */
(function () {
  "use strict";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var $ = function (id) { return document.getElementById(id); }, esc = Club.esc, ml = Club.ml;
  var course = window.HB_COURSE || null;
  function monthName(m) { return MONTHS[+m.slice(5, 7) - 1] + " " + m.slice(0, 4); }
  function exercise(label) { return label && course ? course.ex.filter(function (x) { return x[0] === label; })[0] || null : null; }
  function exLink(e) { return "../handbook/" + esc(e[2]) + ".html#ex-" + esc(e[0]); }

  function thumbs(g, list) {
    return list.map(function (p) {
      return '<li><a href="../gallery.html#p-' + esc(p.id) + '"><img src="' + esc(Club.photoUrl(g, p, "thumb")) + '" alt="' + esc(p.title) + '" width="' + (p.tw | 0) + '" height="' + (p.th | 0) + '" loading="lazy">' +
        "<span><b" + ml(p.title) + ">" + esc(p.title) + "</b> <small" + ml(p.by) + ">" + esc(p.by) + "</small></span></a></li>";
    }).join("");
  }
  var frames = true;   // whether 36 frames is online, read from the page in start()
  function heading(data, c) {
    if (!c.slug) { var e = exercise(c.hx); return "Handbook exercise " + esc(e ? e[0] + ": " + e[1] : c.hx); }
    var m = data[c.slug], ex = m && m.ex[c.ex - 1];
    return m ? esc(m.name) + ": " + esc(ex ? ex[0] : "exercise " + c.ex) : "Exercise " + c.ex;
  }

  /* ---------- sections added after the page was locked ---------- */
  function section(id, title, after) {
    var h = document.createElement("h2");
    h.id = id; h.textContent = title;
    var box = document.createElement("div");
    box.id = id + "-box";
    after.parentNode.insertBefore(box, after.nextSibling);
    after.parentNode.insertBefore(h, box);
    return box;
  }
  function addSections() {
    var past = $("past");
    if (!past || $("course")) return;
    var before = past.previousElementSibling;           // the Masters challenge's attempts
    var ex = section("exercise", "The handbook exercise of the month", before); ex.previousElementSibling.hidden = true;
    var why = section("why-it-works", "Why it works", ex); why.previousElementSibling.hidden = true;
    var crs = section("course", "The handbook course", why);
    var ask = section("asking", "Asking for feedback", crs); ask.previousElementSibling.hidden = true;
    var lede = document.querySelector(".hb-lede");
    if (lede) lede.textContent = "Learn from the great photographers and from the club’s handbook, one step at a time.";
    var nav = document.querySelector(".ms-onpage");
    if (nav) nav.innerHTML = '<a href="#challenge">This month’s challenge</a><a href="#why-it-works" hidden>Why it works</a><a href="#course">The handbook course</a>' +
      '<a href="#asking" hidden>Asking for feedback</a><a href="#past">Past challenges</a><a href="#more-to-learn">More to learn from</a>';
    var more = document.querySelector(".lr-more");
    if (more && !more.querySelector('a[href$="walk-cards.html"]'))
      more.insertAdjacentHTML("beforeend", '<li><a class="hb-chcard" href="../handbook/walk-cards.html"><span class="hb-chtitle">Walk cards</span><span class="hb-chlede">One technique per card, to print or keep on your phone for a club photo walk.</span></a></li>');
    course ? drawCourse() : (crs.innerHTML = '<p class="muted">The course will show here.</p>');
  }
  function show(id, on) {
    var h = $(id); if (h) h.hidden = !on;
    var a = document.querySelector('.ms-onpage a[href="#' + id + '"]'); if (a) a.hidden = !on;
  }

  // the course: the handbook's six parts, one a month, with this browser's exercise ticks
  function drawCourse() {
    var done = {};
    try { done = JSON.parse(localStorage.getItem("conscious-frame-handbook-done") || "{}") || {}; } catch (e) {}
    var next = -1;
    var cards = course.parts.map(function (part, i) {
      var list = course.ex.filter(function (x) { return part.ch.indexOf(x[2]) >= 0; }), n = list.filter(function (x) { return done[x[0]]; }).length;
      if (next < 0 && n < list.length) next = i;
      return { part: part, n: n, total: list.length };
    });
    $("course-box").innerHTML = '<p>The handbook is in six parts, in the order a course builds: how the camera makes an exposure, then lenses, light and composition, ' +
      'then putting it all into practice, and what happens after the shot. Take one part a month. Read its chapters, try the quiz at the end of each one, ' +
      'and tick the exercises off in the handbook as you do them. Your ticks stay on this phone or computer, and they show here.</p>' +
      '<ol class="lr-course">' + cards.map(function (c, i) {
        var pct = c.total ? Math.round(100 * c.n / c.total) : 0;
        return '<li class="lr-part' + (i === next ? " is-next" : "") + (c.n === c.total ? " is-done" : "") + '"><p class="hb-kicker">Part ' + (i + 1) + (i === next ? " · Start here" : c.n === c.total ? " · Done" : "") + "</p>" +
          "<h3>" + esc(c.part.t) + "</h3><ul>" + c.part.ch.map(function (slug) {
            var ch = course.ch[slug];
            return '<li><a href="../handbook/' + esc(slug) + '.html">' + esc(ch[0] + ". " + ch[1]) + "</a></li>";
          }).join("") + "</ul>" +
          '<p class="lr-progress"><span class="lr-bar" role="img" aria-label="' + c.n + " of " + c.total + ' exercises done"><span style="width:' + pct + '%"></span></span> ' + c.n + " of " + c.total + " exercises done</p></li>";
      }).join("") + "</ol>";
  }

  function drawExercise(d, g) {
    var c = d.current, e = c && exercise(c.hx), box = $("exercise-box");
    show("exercise", !!e);
    if (!e) { box.innerHTML = ""; return; }
    var photos = ((g && g.photos) || []).filter(function (p) { return p.hx === e[0]; }), ch = course.ch[e[2]];
    box.innerHTML = '<div class="lr-card"><p class="hb-kicker">' + esc(monthName(c.month)) + "</p><h3>" + esc(e[0] + ": " + e[1]) + "</h3>" +
      "<p>From chapter " + ch[0] + ", <i>" + esc(ch[1]) + "</i>. Read the exercise in the handbook, try it on your next walk and share your best frame.</p>" +
      (c.note && !c.slug ? '<p class="lr-note">' + esc(c.note) + "</p>" : "") +
      '<p class="lr-links"><a href="' + exLink(e) + '">The exercise in the handbook</a> · <a href="../gallery.html#exercises">Every attempt in Exercises</a></p>' +
      '<p><a class="btn btn-dark" href="../submit.html?hx=' + esc(e[0]) + '">Send your attempt</a></p></div>' +
      '<h3>' + (photos.length ? (photos.length === 1 ? "1 attempt so far" : photos.length + " attempts so far") : "No attempts yet. Yours could be the first.") + "</h3>" +
      '<ul class="lr-thumbs">' + thumbs(g, photos) + "</ul>";
  }

  function drawWhy(g) {
    var picks = ((g && g.picks) || []).filter(function (x) { return g.byId[x.id]; });
    show("why-it-works", picks.length > 0);
    if (!picks.length) { $("why-it-works-box").innerHTML = ""; return; }
    var x = picks[0], p = g.byId[x.id], ch = x.ch && course && course.ch[x.ch];
    $("why-it-works-box").innerHTML = '<p>Each month an admin picks one member’s photo from the gallery and says why it works, with a chapter to read.</p>' +
      '<figure class="lr-why"><a href="../gallery.html#p-' + esc(p.id) + '"><img src="' + esc(Club.photoUrl(g, p, "full")) + '" alt="' + esc(p.title) + '" width="' + (p.w | 0) + '" height="' + (p.h | 0) + '" loading="lazy"></a>' +
      '<figcaption><p class="hb-kicker">' + esc(monthName(x.month)) + "</p><h3" + ml(p.title) + ">" + esc(p.title) + ' <small' + ml(p.by) + ">by " + esc(p.by) + "</small></h3>" +
      "<p" + ml(x.note) + ">" + esc(x.note) + "</p>" +
      (ch ? '<p class="lr-links"><a href="../handbook/' + esc(x.ch) + '.html">Read: ' + esc(ch[1]) + "</a></p>" : "") + "</figcaption></figure>" +
      (picks.length > 1 ? '<h3>Earlier months</h3><ul class="lr-thumbs small">' + picks.slice(1, 13).map(function (y) {
        var q = g.byId[y.id];
        return '<li><a href="../gallery.html#p-' + esc(q.id) + '"><img src="' + esc(Club.photoUrl(g, q, "thumb")) + '" alt="' + esc(q.title) + '" loading="lazy"><span><b>' + esc(monthName(y.month)) + "</b> <small" + ml(q.title) + ">" + esc(q.title) + "</small></span></a></li>";
      }).join("") + "</ul>" : "") +
      '<p class="lr-links"><a href="../gallery.html#why-it-works">All of them in the gallery</a></p>';
  }

  function drawAsking(g) {
    var list = ((g && g.photos) || []).filter(function (p) { return p.fb === "ask" && p.by !== g.name; }).slice(0, 8);
    show("asking", list.length > 0);
    $("asking-box").innerHTML = list.length ? "<p>These members would like feedback on their photos. Open one, say what works and what could be stronger, and ask a question if you like. " +
      'An admin checks it before it shows. The handbook’s chapter <a href="../handbook/talking-about-photographs.html">Talking about photographs</a> has tips.</p>' +
      '<ul class="lr-thumbs">' + thumbs(g, list) + '</ul><p class="lr-links"><a href="../gallery.html#asking-for-feedback">All of them in the gallery</a></p>' : "";
  }

  function fill(data, d, g) {
    var photos = (g && g.photos) || [];
    var of = function (month) { return photos.filter(function (p) { return p.mc === month; }); };
    var c = d.current && d.current.slug ? d.current : null, box = $("lr-current");
    if (c) {
      var m = data[c.slug], ex = m && m.ex[c.ex - 1], his = m && m.he === "she" ? "her" : "his";
      box.id = "mc-" + c.month;
      box.innerHTML = '<p class="hb-kicker">' + esc(monthName(c.month)) + "</p><h3>" + heading(data, c) + "</h3>" +
        (ex ? "<p>" + esc(ex[1]) + "</p>" : "") +
        (c.note ? '<p class="lr-note">' + esc(c.note) + "</p>" : "") +
        (m && m.on !== false ? '<p class="lr-links"><a href="../masters/' + esc(c.slug) + '.html">How ' + esc(m.name) + " worked</a>" +
          (frames && m.fr !== false ? '<a href="../frames/' + esc(c.slug) + '.html">' + (his === "her" ? "Her" : "His") + " 36 frames</a>" : "") + "</p>" : "") +
        '<p><a class="btn btn-dark" href="../submit.html?challenge=1">Send your attempt</a></p>';
      var mine = of(c.month);
      $("lr-attempts-h").textContent = mine.length ? (mine.length === 1 ? "1 attempt so far" : mine.length + " attempts so far") : "No attempts yet. Yours could be the first.";
      $("lr-attempts-h").hidden = false;
      $("lr-attempts").innerHTML = thumbs(g, mine);
    } else {
      box.innerHTML = "<p>This month’s Masters challenge hasn’t been picked yet. While you wait, choose any exercise from the " +
        '<a href="../masters/index.html">Masters of photography</a> pages and share what you make.</p>';
    }
    var past = d.past || [];
    $("lr-past").innerHTML = past.length ? past.map(function (p) {
      var list = p.slug ? of(p.month) : [], e = exercise(p.hx);
      var hxList = e ? photos.filter(function (x) { return x.hx === e[0]; }) : [];
      return '<section class="lr-past" id="mc-' + esc(p.month) + '"><h3><span class="hb-kicker">' + esc(monthName(p.month)) + "</span>" + heading(data, p) + "</h3>" +
        (p.slug ? '<p class="muted">' + (list.length ? (list.length === 1 ? "1 attempt" : list.length + " attempts") : "No attempts") +
          (data[p.slug] && data[p.slug].on !== false ? ' · <a href="../masters/' + esc(p.slug) + '.html#try">The exercise</a>' : "") + "</p>" +
          (list.length ? '<ul class="lr-thumbs small">' + thumbs(g, list) + "</ul>" : "") : "") +
        (e && p.slug ? '<p class="muted">Handbook exercise: <a href="' + exLink(e) + '">' + esc(e[0] + ", " + e[1]) + "</a> · " + (hxList.length === 1 ? "1 attempt" : hxList.length + " attempts") + "</p>" : "") +
        (e && !p.slug ? '<p class="muted">' + (hxList.length === 1 ? "1 attempt" : hxList.length + " attempts") + ' · <a href="' + exLink(e) + '">The exercise</a></p>' +
          (hxList.length ? '<ul class="lr-thumbs small">' + thumbs(g, hxList.slice(0, 12)) + "</ul>" : "") : "") + "</section>";
    }).join("") : '<p class="muted">The challenges of earlier months will be collected here, with everyone’s attempts.</p>';
    if (course) { drawExercise(d, g); drawWhy(g); drawAsking(g); }
    if (/^#(mc-\d{4}-\d{2}|why-it-works|exercise|course|asking)$/.test(location.hash)) { var t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
  }

  // masters.js opens the page and then sends ms-opened. With the key remembered from an earlier visit it can open
  // before this script runs, so start now if the page is already open.
  var started = false;
  function start() {
    if (started || !$("lr-current")) return;
    started = true;
    var data = {};
    frames = $("lr-data").getAttribute("data-frames") !== "0";   // 36 frames can be offline (data-frames="0")
    try { data = JSON.parse($("lr-data").textContent); } catch (e) {}
    addSections();
    Promise.all([Club.call("/challenges"), Club.gallery().catch(function () { return null; })]).then(function (r) { fill(data, r[0], r[1]); }).catch(function (e) {
      if (e.status === 404) { $("lr-current").innerHTML = '<p class="muted">The Masters challenge starts soon.</p>'; $("lr-past").innerHTML = ""; return; }
      $("lr-current").innerHTML = '<p class="status error">' + esc(e.message) + "</p>";
      $("lr-past").innerHTML = "";
    });
  }
  document.addEventListener("ms-opened", start);
  start();
})();
