/* The Conscious Frame – the photographers, for members: everyone who has shared photos, with their
   line about themselves and their latest photos. Each name opens their page (gallery.html?by=NAME).
   Needs config.js and club.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = Club.esc, ml = Club.ml;

  function setStatus(el, msg, isError) { el.classList.add("status"); el.classList.toggle("error", !!isError); el.textContent = msg; }
  function showGate(msg) {
    $("a-status").hidden = true; $("people").hidden = true; $("a-who").hidden = true; $("gate").hidden = false;
    setStatus($("gate-status"), msg || "", !!msg);
  }
  $("gate").addEventListener("submit", function (ev) {
    ev.preventDefault();
    setStatus($("gate-status"), "Checking…");
    Club.signIn($("gate-code").value).then(function () { $("gate-code").value = ""; start(); })
      .catch(function (e) { setStatus($("gate-status"), e.message, true); });
  });
  $("sign-out").addEventListener("click", function () { Club.signOut(); $("people").innerHTML = ""; showGate(); });

  function start() {
    if (!Club.ready()) { $("a-status").textContent = "This page isn't switched on yet. Ask a club admin to finish setting it up."; return; }
    if (!Club.code()) { showGate(); return; }
    $("gate").hidden = true; $("a-status").hidden = false; setStatus($("a-status"), "Loading…");
    Club.gallery().then(function (d) {
      $("a-name").textContent = d.name; $("a-who").hidden = false;
      var byName = {}, order = [];
      d.photos.forEach(function (p) { if (!byName[p.by]) { byName[p.by] = []; order.push(p.by); } byName[p.by].push(p); });   // newest photo first
      $("people").innerHTML = order.map(function (name) {
        var photos = byName[name], bio = ((d.people || {})[name] || {}).bio || "", href = "gallery.html?by=" + encodeURIComponent(name);
        return '<article class="person"><div class="head"><h2' + ml(name) + '><a href="' + esc(href) + '">' + esc(name) + "</a></h2>" +
          '<a href="' + esc(href) + '">' + (photos.length === 1 ? "1 photo" : "All " + photos.length + " photos") + "</a></div>" +
          (bio ? '<p class="person-bio"' + ml(bio) + ">" + esc(bio) + "</p>" : name === d.name ? '<p class="person-bio muted">You haven\'t written a line about yourself yet. <a href="submit.html#about-you">Add one</a></p>' : "") +
          '<div class="just strip">' + photos.slice(0, 6).map(function (p) {
            return '<a href="' + esc(href) + "#p-" + esc(p.id) + '" style="--ar:' + (p.tw / p.th || 1.5).toFixed(3) + '" aria-label="' + esc(p.title) + '"><img src="' + esc(Club.photoUrl(d, p, "thumb")) +
              '" alt="" width="' + (p.tw | 0) + '" height="' + (p.th | 0) + '" loading="lazy"></a>';
          }).join("") + "</div></article>";
      }).join("");
      $("people").hidden = !order.length;
      if (order.length) $("a-status").hidden = true; else setStatus($("a-status"), "Nobody has shared a photo yet.");
      Club.layout();
    }).catch(function (e) {
      if (e.status === 401) showGate(e.message);
      else { $("a-status").hidden = false; setStatus($("a-status"), e.message, true); }
    });
  }
  start();
})();
