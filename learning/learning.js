/* The Conscious Frame – the Learning page: this month's Masters challenge, the members' attempts and the past challenges.
   The page is locked like the Masters pages and ../masters/masters.js opens it; then this fills in what the inbox knows.
   Attempts are gallery photos the member ticked as an attempt (mc: the challenge's month). Needs config.js and club.js. */
(function () {
  "use strict";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var $ = function (id) { return document.getElementById(id); }, esc = Club.esc, ml = Club.ml;
  function monthName(m) { return MONTHS[+m.slice(5, 7) - 1] + " " + m.slice(0, 4); }

  function thumbs(g, list) {
    return list.map(function (p) {
      return '<li><a href="../gallery.html#p-' + esc(p.id) + '"><img src="' + esc(Club.photoUrl(g, p, "thumb")) + '" alt="' + esc(p.title) + '" width="' + (p.tw | 0) + '" height="' + (p.th | 0) + '" loading="lazy">' +
        "<span><b" + ml(p.title) + ">" + esc(p.title) + "</b> <small" + ml(p.by) + ">" + esc(p.by) + "</small></span></a></li>";
    }).join("");
  }
  var frames = true;   // whether 36 frames is online, read from the page in start()
  function heading(data, c) {
    var m = data[c.slug], ex = m && m.ex[c.ex - 1];
    return m ? esc(m.name) + ": " + esc(ex ? ex[0] : "exercise " + c.ex) : "Exercise " + c.ex;
  }

  function fill(data, d, g) {
    var photos = (g && g.photos) || [];
    var of = function (month) { return photos.filter(function (p) { return p.mc === month; }); };
    var c = d.current, box = $("lr-current");
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
      box.innerHTML = "<p>This month’s challenge hasn’t been picked yet. While you wait, choose any exercise from the " +
        '<a href="../masters/index.html">Masters of photography</a> pages and share what you make.</p>';
    }
    var past = d.past || [];
    $("lr-past").innerHTML = past.length ? past.map(function (p) {
      var list = of(p.month);
      return '<section class="lr-past" id="mc-' + esc(p.month) + '"><h3><span class="hb-kicker">' + esc(monthName(p.month)) + "</span>" + heading(data, p) + "</h3>" +
        '<p class="muted">' + (list.length ? (list.length === 1 ? "1 attempt" : list.length + " attempts") : "No attempts") +
        (data[p.slug] && data[p.slug].on !== false ? ' · <a href="../masters/' + esc(p.slug) + '.html#try">The exercise</a>' : "") + "</p>" +
        (list.length ? '<ul class="lr-thumbs small">' + thumbs(g, list) + "</ul>" : "") + "</section>";
    }).join("") : '<p class="muted">The challenges of earlier months will be collected here, with everyone’s attempts.</p>';
    if (/^#mc-\d{4}-\d{2}$/.test(location.hash)) { var t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
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
    Promise.all([Club.call("/challenges"), Club.gallery().catch(function () { return null; })]).then(function (r) { fill(data, r[0], r[1]); }).catch(function (e) {
      if (e.status === 404) { $("lr-current").innerHTML = '<p class="muted">The Masters challenge starts soon.</p>'; $("lr-past").innerHTML = ""; return; }
      $("lr-current").innerHTML = '<p class="status error">' + esc(e.message) + "</p>";
      $("lr-past").innerHTML = "";
    });
  }
  document.addEventListener("ms-opened", start);
  start();
})();
