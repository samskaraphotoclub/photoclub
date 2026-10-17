/* The Conscious Frame – the members-only gallery.
   Members sign in with their invite code; the photos then load from the club's inbox.
   Also: the photo viewer (previous/next, swipe, arrow keys, Esc) and, under each photo,
   members' comments and votes for this week's photos. Needs config.js and club.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = Club.esc, data = null;
  var SMILEYS = [["😊", "smiling face"], ["😀", "grinning face"], ["😍", "heart eyes"], ["🤩", "star-struck"], ["🥰", "smiling face with hearts"], ["😮", "wow"],
    ["🤔", "thinking face"], ["😂", "laughing"], ["😉", "winking face"], ["🙂", "slight smile"], ["👍", "thumbs up"], ["👏", "clapping"],
    ["🙌", "raised hands"], ["❤️", "red heart"], ["🔥", "fire"], ["✨", "sparkles"], ["🌟", "glowing star"], ["💯", "hundred points"],
    ["📷", "camera"], ["🌅", "sunrise"], ["🌊", "wave"], ["🌲", "tree"], ["🍂", "autumn leaves"], ["🌙", "moon"]];

  function setStatus(el, msg, isError) { if (el) { el.classList.add("status"); el.classList.toggle("error", !!isError); el.textContent = msg; } }
  function ago(ms) {
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + " h ago";
    var d = Math.round(h / 24);
    return d === 1 ? "yesterday" : d + " days ago";
  }

  /* ---------- signing in ---------- */
  function showGate(msg) {
    $("g-status").hidden = true; $("g-photos").hidden = true; $("g-who").hidden = true; $("gate").hidden = false;
    setStatus($("gate-status"), msg || "", !!msg);
  }
  $("gate").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var st = $("gate-status");
    setStatus(st, "Checking…");
    Club.signIn($("gate-code").value).then(function () { $("gate-code").value = ""; start(); })
      .catch(function (e) { setStatus(st, e.message, true); });
  });
  $("sign-out").addEventListener("click", function () { Club.signOut(); data = null; $("grid").innerHTML = ""; showGate(); });

  /* ---------- the photos ---------- */
  function start() {
    if (!Club.ready()) { $("g-status").textContent = "The gallery isn't switched on yet. Ask a club admin to finish setting it up."; return; }
    if (!Club.code()) { showGate(); return; }
    $("gate").hidden = true; $("g-status").hidden = false; $("g-status").textContent = "Loading the photos…";
    Club.gallery().then(function (d) {
      data = d;
      $("grid").innerHTML = d.photos.map(tile).join("");
      $("g-status").hidden = d.photos.length > 0;
      $("g-status").textContent = "No photos yet. Share the first one on the Share a photo page.";
      $("g-name").textContent = d.name;
      $("g-who").hidden = false; $("g-photos").hidden = false;
      var fresh = d.photos.filter(function (p) { return Club.thisWeek(d, p); }).length;
      $("l-week").hidden = !fresh;
      if (location.hash === "#this-week" && fresh) $("c-week").checked = true;
      addSteps();
      sync();
    }).catch(function (e) {
      if (e.status === 401) showGate(e.message);
      else { $("g-status").hidden = false; $("g-status").textContent = e.message; }
    });
  }

  function tile(p) {
    var id = esc(p.id), title = esc(p.title), cat = String(p.cat || "").toLowerCase().replace(/[^a-z]/g, "");
    var rows = [["Lens", p.lens], ["Aperture", p.ap], ["Shutter", p.sh], ["ISO", p.iso]].filter(function (r) { return r[1]; })
      .map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
    return '<figure class="tile ' + cat + (Club.thisWeek(data, p) ? " this-week" : "") + '" id="t-' + id + '">' +
      '<a href="#p-' + id + '"><img src="' + esc(Club.photoUrl(data, p, "thumb")) + '" alt="' + title + '" width="' + (p.tw | 0) + '" height="' + (p.th | 0) + '" loading="lazy"></a>' +
      "<figcaption><b>" + title + "</b>" + esc(p.by) + "</figcaption>" +
      '<div class="viewer" id="p-' + id + '" role="dialog" aria-label="' + title + '">' +
        '<a class="shade" href="#t-' + id + '" aria-label="Close" tabindex="-1"></a>' +
        '<div class="box">' +
          '<a class="close" href="#t-' + id + '" aria-label="Close">×</a>' +
          '<div class="pic"><img src="' + esc(Club.photoUrl(data, p, "full")) + '" alt="' + title + '" width="' + (p.w | 0) + '" height="' + (p.h | 0) + '" loading="lazy"></div>' +
          '<div class="info"><h2>' + title + '</h2><p class="by">' + esc(p.by) + ", " + esc(p.cat) + "</p>" +
            (p.desc ? '<p class="desc">' + esc(p.desc) + "</p>" : "") + (rows ? "<dl>" + rows + "</dl>" : "") + "</div>" +
        "</div>" +
      "</div></figure>";
  }

  /* ---------- the viewer: open from the address, previous/next, swipe, keys ---------- */
  // The open photo, from the address. The page adds "open" itself, because the browser doesn't
  // apply :target to photos that arrive after the page has loaded.
  function current() {
    var id = "";
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
    var v = id && document.getElementById(id);
    return v && v.classList.contains("viewer") ? v : null;
  }
  function sync() {
    var v = current();
    document.querySelectorAll(".viewer.open").forEach(function (o) { if (o !== v) o.classList.remove("open"); });
    if (v) { v.classList.add("open"); panel(v); }
    else if (data && /^#p-/.test(location.hash)) { $("g-status").hidden = false; $("g-status").textContent = "That photo isn't in the gallery any more."; }
  }
  window.addEventListener("hashchange", sync);
  function addSteps() {
    document.querySelectorAll(".viewer .pic").forEach(function (pic) {
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

  /* ---------- votes and comments under the photo ---------- */
  function panel(v) {
    var info = v.querySelector(".info"), box = info.querySelector(".talk");
    if (!box) {
      box = document.createElement("section");
      box.className = "talk";
      box.setAttribute("aria-label", "Votes and comments");
      info.appendChild(box);
      box.innerHTML = '<p class="muted">Loading comments…</p>';
    }
    load(v, box);
  }
  function load(v, box) {
    var id = v.id.slice(2), tile = v.closest(".tile");
    var thisWeek = !!(tile && tile.classList.contains("this-week"));
    return Club.call("/photo/" + id).then(function (d) { draw(box, id, d, thisWeek); })
      .catch(function (e) { if (e.status === 401) { Club.signOut(); showGate(e.message); return; } box.innerHTML = '<p class="muted">' + esc(e.message) + "</p>"; });
  }

  function draw(box, id, d, thisWeek) {
    var member = !!d.member, html = "";
    if (thisWeek && member) {
      if (d.own) html += '<p class="vote-row muted">This is your photo, so you can\'t vote for it.</p>';
      else html += '<div class="vote-row"><button class="btn btn-small vote" type="button" aria-pressed="' + !!d.voted + '">' + (d.voted ? "Your vote" : "Vote") +
        '</button><span class="muted">' + d.votesLeft + " of " + d.perWeek + ' votes left this week</span></div><p class="status vote-status" aria-live="polite"></p>';
    }
    html += "<h3>Comments" + (d.comments.length ? " (" + d.comments.length + ")" : "") + "</h3>";
    html += d.comments.length
      ? '<ol class="comments">' + d.comments.map(function (c) {
          return '<li data-cid="' + esc(c.cid) + '"><p class="who-said"><b>' + esc(c.name) + "</b> <time>" + ago(c.at) + '</time></p><p class="said">' + esc(c.text) + "</p>" +
            (c.mine ? '<div class="del-box"><button class="linkish del" type="button">Delete</button></div>' : "") + "</li>";
        }).join("") + "</ol>"
      : '<p class="muted">No comments yet.' + (member ? " Start with what you like about the photo." : "") + "</p>";
    if (member) {
      html += '<form class="comment-form" novalidate><label class="f" for="cf-' + id + '">Your comment <small>(as ' + esc(d.member) + ")</small></label>" +
        '<textarea id="cf-' + id + '" maxlength="500" placeholder="Start with what you like about the photo, then your suggestion"></textarea>' +
        '<div class="emoji-pick" id="ep-' + id + '" role="group" aria-label="Smileys" hidden>' + SMILEYS.map(function (s) {
          return '<button type="button" data-e="' + s[0] + '" aria-label="' + s[1] + '" title="' + s[1] + '">' + s[0] + "</button>";
        }).join("") + "</div>" +
        '<div class="comment-actions"><button class="emoji-toggle" type="button" aria-expanded="false" aria-controls="ep-' + id + '" aria-label="Add a smiley" title="Add a smiley">😊</button>' +
        '<button class="btn btn-dark btn-small" type="submit">Post comment</button></div><p class="status" aria-live="polite"></p></form>';
    }
    box.innerHTML = html;

    var voteBtn = box.querySelector(".vote");
    if (voteBtn) voteBtn.addEventListener("click", function () {
      voteBtn.disabled = true;
      Club.call("/vote", { method: "POST", json: { photo: id } }).then(function (r) {
        voteBtn.setAttribute("aria-pressed", r.voted);
        voteBtn.textContent = r.voted ? "Your vote" : "Vote";
        voteBtn.nextElementSibling.textContent = r.votesLeft + " of " + r.perWeek + " votes left this week";
        setStatus(box.querySelector(".vote-status"), r.voted ? "Thanks for voting. Results are announced on Monday." : "Vote taken back.");
      }).catch(function (e) { setStatus(box.querySelector(".vote-status"), e.message, true); })
        .then(function () { voteBtn.disabled = false; });
    });

    var form = box.querySelector(".comment-form");
    if (form) {
      // smiley picker: inserts at the cursor
      var pick = form.querySelector(".emoji-pick"), toggle = form.querySelector(".emoji-toggle"), area = form.querySelector("textarea");
      toggle.addEventListener("click", function () {
        var opening = pick.hidden;
        pick.hidden = !opening;
        toggle.setAttribute("aria-expanded", opening);
      });
      pick.addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-e]");
        if (!b) return;
        var e = b.getAttribute("data-e"), s = area.selectionStart, end = area.selectionEnd, val = area.value;
        if (val.length - (end - s) + e.length > 500) return;
        area.value = val.slice(0, s) + e + val.slice(end);
        area.focus();
        area.setSelectionRange(s + e.length, s + e.length);
      });
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var st = form.querySelector(".status"), btn = form.querySelector("button[type=submit]");
        if (!area.value.trim()) { setStatus(st, "Write a comment first.", true); area.focus(); return; }
        btn.disabled = true; setStatus(st, "Posting…");
        Club.call("/comment", { method: "POST", json: { photo: id, text: area.value } }).then(function () {
          return Club.call("/photo/" + id).then(function (d2) { draw(box, id, d2, thisWeek); setStatus(box.querySelector(".comment-form .status"), "Posted."); });
        }).catch(function (e) { btn.disabled = false; setStatus(st, e.message, true); });
      });
    }

    box.querySelectorAll(".del").forEach(function (b) {
      b.addEventListener("click", function () {
        var li = b.closest("li"), del = b.parentNode;
        del.innerHTML = '<span class="muted">Delete this comment?</span> <button class="linkish yes" type="button">Yes, delete</button> <button class="linkish no" type="button">Cancel</button>';
        del.querySelector(".no").addEventListener("click", function () { draw(box, id, d, thisWeek); });
        del.querySelector(".yes").addEventListener("click", function () {
          Club.call("/comment/delete", { method: "POST", json: { photo: id, cid: li.getAttribute("data-cid") } })
            .then(function () { return load(box.closest(".viewer"), box); })
            .catch(function (e) { del.innerHTML = '<span class="status error">' + esc(e.message) + "</span>"; });
        });
      });
    });
  }

  start();
})();
