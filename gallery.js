/* The Conscious Frame – the members-only gallery.
   Members sign in with their invite code; the photos then load from the club's inbox.
   Filters for categories and series, and under each photo in the viewer, members' comments
   (with a Report button) and votes for this week's photos. Needs config.js, club.js and viewer.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = Club.esc, data = null;
  var SMILEYS = [["😊", "smiling face"], ["😀", "grinning face"], ["😍", "heart eyes"], ["🤩", "star-struck"], ["🥰", "smiling face with hearts"], ["😮", "wow"],
    ["🤔", "thinking face"], ["😂", "laughing"], ["😉", "winking face"], ["🙂", "slight smile"], ["👍", "thumbs up"], ["👏", "clapping"],
    ["🙌", "raised hands"], ["❤️", "red heart"], ["🔥", "fire"], ["✨", "sparkles"], ["🌟", "glowing star"], ["💯", "hundred points"],
    ["📷", "camera"], ["🌅", "sunrise"], ["🌊", "wave"], ["🌲", "tree"], ["🍂", "autumn leaves"], ["🌙", "moon"]];

  var ml = Club.ml;
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
      seriesChips(d);
      $("grid").innerHTML = d.photos.map(tile).join("");
      $("g-status").hidden = d.photos.length > 0;
      $("g-status").textContent = "No photos yet. Share the first one on the Share a photo page.";
      $("g-name").textContent = d.name;
      $("g-who").hidden = false; $("g-photos").hidden = false;
      var fresh = d.photos.filter(function (p) { return Club.thisWeek(d, p); }).length;
      $("l-week").hidden = !fresh;
      if (location.hash === "#this-week" && fresh) $("c-week").checked = true;
      var s = location.hash.match(/^#series-([a-z0-9-]+)$/), chip = s && $("c-s-" + s[1]);
      if (chip) { chip.checked = true; chip.scrollIntoView({ block: "nearest", inline: "center" }); }
      Club.layout();
      Viewer.addSteps();
      Viewer.sync();
    }).catch(function (e) {
      if (e.status === 401) showGate(e.message);
      else { $("g-status").hidden = false; $("g-status").textContent = e.message; }
    });
  }

  function tile(p) {
    var cat = String(p.cat || "").toLowerCase().replace(/[^a-z]/g, "");
    var series = p.series ? Club.seriesName(data.series, p.series) : "";
    return Viewer.tile(p, Club.photoUrl(data, p, "thumb"), Club.photoUrl(data, p, "full"), {
      cls: cat + (Club.thisWeek(data, p) ? " this-week" : "") + (series ? " s-" + p.series : ""),
      series: series,
      extra: p.pub ? '<p class="note">Also in the club\'s public <a href="exhibition.html#p-' + esc(p.id) + '">exhibition</a>, where anyone can see it.</p>' : ""
    });
  }

  // A filter chip for each series that has photos, right after "All" (filtering is plain CSS, like the categories)
  function seriesChips(d) {
    document.querySelectorAll(".chips .series-chip").forEach(function (el) { el.remove(); });
    var style = $("series-filters") || document.head.appendChild(Object.assign(document.createElement("style"), { id: "series-filters" }));
    var rules = [], html = "";
    (d.series || []).forEach(function (s) {
      if (!d.photos.some(function (p) { return p.series === s.id; })) return;
      html += '<input type="radio" name="cat" class="series-chip" id="c-s-' + esc(s.id) + '"><label class="series-chip" for="c-s-' + esc(s.id) + '"' + ml(s.name) + ">" + esc(s.name) + "</label>";
      rules.push(".gallery:has(#c-s-" + s.id + ":checked) .tile:not(.s-" + s.id + ") { display: none; }");
    });
    $("c-all").nextElementSibling.insertAdjacentHTML("afterend", html);
    style.textContent = rules.join("\n");
  }

  document.addEventListener("change", function (e) { if (e.target.name === "cat") Club.layout(); });   // filters change which photos are in the rows

  /* ---------- the viewer ---------- */
  Viewer.init({
    onOpen: function (v) { panel(v); },
    onMissing: function () { if (data) { $("g-status").hidden = false; $("g-status").textContent = "That photo isn't in the gallery any more."; } }
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
          return '<li data-cid="' + esc(c.cid) + '"><p class="who-said"><b' + ml(c.name) + '>' + esc(c.name) + "</b> <time>" + ago(c.at) + '</time></p><p class="said"' + ml(c.text) + '>' + esc(c.text) + "</p>" +
            (c.mine ? '<div class="del-box"><button class="linkish del" type="button">Delete</button></div>'
              : member ? '<div class="del-box">' + (c.reported ? '<span class="muted">You reported this comment</span>' : '<button class="linkish report" type="button">Report</button>') + "</div>" : "") + "</li>";
        }).join("") + "</ol>"
      : '<p class="muted">No comments yet.' + (member ? " Start with what you like about the photo." : "") + "</p>";
    if (member) {
      html += '<form class="comment-form" novalidate><label class="f" for="cf-' + id + '">Your comment <small>(as ' + esc(d.member) + ")</small></label>" +
        '<textarea id="cf-' + id + '" maxlength="1000" placeholder="Start with what you like about the photo, then your suggestion. English or Malayalam."></textarea>' +
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
        if (val.length - (end - s) + e.length > 1000) return;
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

    box.querySelectorAll(".report").forEach(function (b) {
      b.addEventListener("click", function () {
        var li = b.closest("li"), act = b.parentNode, fid = "rw-" + li.getAttribute("data-cid");
        act.innerHTML = '<div class="report-box"><label class="f" for="' + fid + '">Report this comment to the club\'s admins? <small>They see your name; the person who wrote it doesn\'t.</small></label>' +
          '<input type="text" id="' + fid + '" maxlength="300" placeholder="What\'s wrong with it? (optional)">' +
          '<div class="row-btns"><button class="btn btn-dark btn-small yes" type="button">Report</button><button class="btn btn-light btn-small no" type="button">Cancel</button></div><p class="status" aria-live="polite"></p></div>';
        var why = act.querySelector("input"), st = act.querySelector(".status");
        why.focus();
        act.querySelector(".no").addEventListener("click", function () { draw(box, id, d, thisWeek); });
        act.querySelector(".yes").addEventListener("click", function () {
          act.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
          setStatus(st, "Sending…");
          Club.call("/report", { method: "POST", json: { photo: id, cid: li.getAttribute("data-cid"), why: why.value } }).then(function () {
            act.innerHTML = '<p class="status" style="margin:4px 0 0">Thank you. The club\'s admins will have a look.</p>';
          }).catch(function (e) { act.querySelectorAll("button").forEach(function (x) { x.disabled = false; }); setStatus(st, e.message, true); });
        });
      });
    });

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
