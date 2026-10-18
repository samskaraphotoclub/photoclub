/* The Conscious Frame – the theme archive, for members: every week's theme and the photos
   members voted for most. Needs config.js and club.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = Club.esc, ml = Club.ml;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function setStatus(el, msg, isError) { el.classList.add("status"); el.classList.toggle("error", !!isError); el.textContent = msg; }
  function showGate(msg) {
    $("a-status").hidden = true; $("weeks").hidden = true; $("a-who").hidden = true; $("gate").hidden = false;
    setStatus($("gate-status"), msg || "", !!msg);
  }
  $("gate").addEventListener("submit", function (ev) {
    ev.preventDefault();
    setStatus($("gate-status"), "Checking…");
    Club.signIn($("gate-code").value).then(function () { $("gate-code").value = ""; start(); })
      .catch(function (e) { setStatus($("gate-status"), e.message, true); });
  });
  $("sign-out").addEventListener("click", function () { Club.signOut(); $("weeks").innerHTML = ""; showGate(); });

  // 2026-W42 -> "12–18 October 2026"
  function dates(week) {
    var m = String(week).match(/^(\d{4})-W(\d{2})$/);
    if (!m) return week;
    var jan4 = new Date(Date.UTC(+m[1], 0, 4)), mon = new Date(jan4);
    mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (+m[2] - 1) * 7);
    var sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
    var a = mon.getUTCDate(), b = sun.getUTCDate() + " " + MONTHS[sun.getUTCMonth()] + " " + sun.getUTCFullYear();
    if (mon.getUTCFullYear() !== sun.getUTCFullYear()) return a + " " + MONTHS[mon.getUTCMonth()] + " " + mon.getUTCFullYear() + " – " + b;
    return mon.getUTCMonth() === sun.getUTCMonth() ? a + "–" + b : a + " " + MONTHS[mon.getUTCMonth()] + " – " + b;
  }

  function start() {
    if (!Club.ready()) { $("a-status").textContent = "The archive isn't switched on yet. Ask a club admin to finish setting it up."; return; }
    if (!Club.code()) { showGate(); return; }
    $("gate").hidden = true; $("a-status").hidden = false; setStatus($("a-status"), "Loading the archive…");
    Promise.all([Club.gallery(), Club.call("/archive")]).then(function (r) {
      var d = r[0], weeks = r[1].weeks || [], now = r[1].week;
      $("a-name").textContent = d.name; $("a-who").hidden = false;
      var html = weeks.map(function (w) {
        var picks = ((w.potw && w.potw.length ? w.potw : w.top) || []).filter(function (x) { return d.byId[x.id]; });
        var later = w.week > now, current = w.week === now;
        if (!w.theme && !picks.length) return "";
        var head = '<p class="kicker">' + (current ? "This week" : later ? "Next week" : "Week " + parseInt(w.week.split("-W")[1], 10)) + " · " + dates(w.week) + "</p>";
        var theme = w.theme ? '<h2 class="past-theme"' + ml(w.theme.title) + ">" + esc(w.theme.title) + "</h2>" + (w.theme.lede ? '<p class="lede"' + ml(w.theme.lede) + ">" + esc(w.theme.lede) + "</p>" : "")
                            : '<h2 class="past-theme muted">No theme recorded</h2>';
        var body = picks.length ? '<div class="just winners">' + picks.map(function (x, i) {
            var p = d.byId[x.id];
            return '<figure class="print" style="--ar:' + (p.tw / p.th || 1.5).toFixed(3) + '"><a href="gallery.html#p-' + esc(p.id) + '"><img src="' + esc(Club.photoUrl(d, p, "thumb")) + '" alt="' + esc(p.title) +
              '" width="' + (p.tw | 0) + '" height="' + (p.th | 0) + '" loading="lazy"></a><figcaption><b' + ml(p.title) + ">" + (i + 1) + ". " + esc(p.title) + "</b> <span" + ml(p.by) + ">" + esc(p.by) + "</span>" +
              (x.votes ? ", " + x.votes + (x.votes === 1 ? " vote" : " votes") : "") + "</figcaption></figure>";
          }).join("") + "</div>"
          : current ? '<p class="muted">Voting is open until Sunday. <a href="gallery.html#this-week">Vote for this week\'s photos</a></p>'
          : later ? "" : '<p class="muted">No votes that week.</p>';
        return '<article class="week">' + head + theme + body + "</article>";
      }).join("");
      $("weeks").innerHTML = html;
      $("weeks").hidden = !html;
      Club.layout();
      if (html) $("a-status").hidden = true;
      else setStatus($("a-status"), "The archive starts with the next theme of the week. Each week's theme and its most-voted photos will be kept here.");
    }).catch(function (e) {
      if (e.status === 401) showGate(e.message);
      else { $("a-status").hidden = false; setStatus($("a-status"), e.status === 404 ? "The theme archive opens soon." : e.message, e.status !== 404); }
    });
  }
  start();
})();
