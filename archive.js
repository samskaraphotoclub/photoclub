/* The Conscious Frame – the theme archive, for members: every month's theme and the photos
   members voted for most that month. Needs config.js and club.js. */
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

  // 2026-10 -> "October 2026"
  function monthName(m) {
    var x = String(m).match(/^(\d{4})-(\d{2})$/);
    return x ? MONTHS[+x[2] - 1] + " " + x[1] : m;
  }

  function start() {
    if (!Club.ready()) { $("a-status").textContent = "The archive isn't switched on yet. Ask a club admin to finish setting it up."; return; }
    if (!Club.code()) { showGate(); return; }
    $("gate").hidden = true; $("a-status").hidden = false; setStatus($("a-status"), "Loading the archive…");
    Promise.all([Club.gallery(), Club.call("/archive")]).then(function (r) {
      if (!r[1].months) { setStatus($("a-status"), "The theme archive opens soon."); return; }   // the inbox hasn't been updated yet
      var d = r[0], months = r[1].months, now = r[1].month;
      $("a-name").textContent = d.name; $("a-who").hidden = false;
      var html = months.map(function (w) {
        var picks = (w.top || []).filter(function (x) { return d.byId[x.id]; });
        var later = w.month > now, current = w.month === now;
        if (!w.theme && !picks.length) return "";
        var head = '<p class="kicker">' + (current ? "This month · " : later ? "Next month · " : "") + monthName(w.month) + "</p>";
        var theme = w.theme ? '<h2 class="past-theme"' + ml(w.theme.title) + ">" + esc(w.theme.title) + "</h2>" + (w.theme.lede ? '<p class="lede"' + ml(w.theme.lede) + ">" + esc(w.theme.lede) + "</p>" : "")
                            : '<h2 class="past-theme muted">No theme recorded</h2>';
        var body = picks.length ? '<div class="just winners">' + picks.map(function (x, i) {
            var p = d.byId[x.id];
            return '<figure class="print" style="--ar:' + (p.tw / p.th || 1.5).toFixed(3) + '"><a href="gallery.html#p-' + esc(p.id) + '"><img src="' + esc(Club.photoUrl(d, p, "thumb")) + '" alt="' + esc(p.title) +
              '" width="' + (p.tw | 0) + '" height="' + (p.th | 0) + '" loading="lazy"></a><figcaption><b' + ml(p.title) + ">" + (i + 1) + ". " + esc(p.title) + "</b> <span" + ml(p.by) + ">" + esc(p.by) + "</span>" +
              (x.votes ? ", " + x.votes + (x.votes === 1 ? " vote" : " votes") : "") + "</figcaption></figure>";
          }).join("") + "</div>"
          : current ? '<p class="muted">The month\'s most-voted photos appear here once it\'s over. <a href="gallery.html#this-week">Vote for this week\'s photos</a></p>'
          : later ? "" : '<p class="muted">No votes that month.</p>';
        return '<article class="week">' + head + theme + body + "</article>";
      }).join("");
      $("weeks").innerHTML = html;
      $("weeks").hidden = !html;
      Club.layout();
      if (html) $("a-status").hidden = true;
      else setStatus($("a-status"), "The archive starts with the next theme of the month. Each month's theme and its most-voted photos will be kept here.");
    }).catch(function (e) {
      if (e.status === 401) showGate(e.message);
      else { $("a-status").hidden = false; setStatus($("a-status"), e.status === 404 ? "The theme archive opens soon." : e.message, e.status !== 404); }
    });
  }
  start();
})();
