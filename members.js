/* The Conscious Frame – gallery page: members' votes and comments in the photo viewer.
   Anyone can read comments. Members sign in with their invite code to comment and to vote
   for this week's photos. Needs config.js (the inbox address); without it the gallery works as before. */
(function () {
  "use strict";
  var TIMEZONE = "Europe/Berlin";              // keep in step with TIMEZONE in the inbox settings
  var KEY = "conscious-frame-member";          // the same sign-in as the Share a photo page
  var INBOX = String(window.CLUB_INBOX || "").replace(/\/+$/, "");
  var SMILEYS = [["😊", "smiling face"], ["😀", "grinning face"], ["😍", "heart eyes"], ["🤩", "star-struck"], ["🥰", "smiling face with hearts"], ["😮", "wow"],
    ["🤔", "thinking face"], ["😂", "laughing"], ["😉", "winking face"], ["🙂", "slight smile"], ["👍", "thumbs up"], ["👏", "clapping"],
    ["🙌", "raised hands"], ["❤️", "red heart"], ["🔥", "fire"], ["✨", "sparkles"], ["🌟", "glowing star"], ["💯", "hundred points"],
    ["📷", "camera"], ["🌅", "sunrise"], ["🌊", "wave"], ["🌲", "tree"], ["🍂", "autumn leaves"], ["🌙", "moon"]];

  function code() { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function setCode(c) { try { if (c) localStorage.setItem(KEY, c); else localStorage.removeItem(KEY); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ago(ms) {
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + " h ago";
    var d = Math.round(h / 24);
    return d === 1 ? "yesterday" : d + " days ago";
  }
  function clubDate(d) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }

  /* ---------- this week's photos (Monday to Sunday) can be voted for ---------- */
  var today = clubDate(new Date());
  var t = new Date(today + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  var monday = t.toISOString().slice(0, 10), fresh = 0;
  document.querySelectorAll(".tile[data-added]").forEach(function (tile) {
    var a = tile.getAttribute("data-added");
    if (a >= monday && a <= today) { tile.classList.add("this-week"); fresh++; }
  });
  var chip = document.getElementById("l-week");
  if (chip && fresh) chip.hidden = false;
  if (location.hash === "#this-week" && fresh) {
    var radio = document.getElementById("c-week");
    if (radio) radio.checked = true;
  }

  if (!/^https?:\/\//.test(INBOX)) return;      // the inbox isn't set up yet

  /* ---------- the panel under each photo ---------- */
  function call(path, opts) {
    opts = opts || {};
    var headers = {}, c = opts.code || code();
    if (c) headers.Authorization = "Bearer " + c;
    if (opts.json) headers["Content-Type"] = "application/json";
    return fetch(INBOX + path, { method: opts.method || "GET", headers: headers, body: opts.json ? JSON.stringify(opts.json) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) { var e = new Error(d.error || "Something went wrong (" + r.status + "). Try again."); e.status = r.status; throw e; }
          return d;
        });
      }, function () { throw new Error("Comments couldn't be loaded. Check your internet connection."); });
  }
  function setStatus(el, msg, isError) { if (el) { el.className = "status" + (isError ? " error" : ""); el.textContent = msg; } }

  // the open photo, from the address (works even before the browser has applied :target on page load)
  function current() {
    var id = "";
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
    var v = id && document.getElementById(id);
    return v && v.classList.contains("viewer") ? v : null;
  }
  function render() {
    var v = current();
    if (!v) return;
    var info = v.querySelector(".info"), panel = info.querySelector(".talk");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "talk";
      panel.setAttribute("aria-label", "Votes and comments");
      info.appendChild(panel);
      panel.innerHTML = '<p class="muted">Loading comments…</p>';
    }
    load(v, panel);
  }
  function load(v, panel) {
    var id = v.id.slice(2), tile = v.closest(".tile");
    var thisWeek = !!(tile && tile.classList.contains("this-week"));
    return call("/photo/" + id).then(function (d) {
      if (d.signedOut) setCode("");             // the code was removed by an admin
      draw(panel, id, d, thisWeek);
    }).catch(function (e) { panel.innerHTML = '<p class="muted">' + esc(e.message) + "</p>"; });
  }

  function draw(panel, id, d, thisWeek) {
    var member = !!d.member, html = "";
    if (thisWeek) {
      if (!member) html += '<p class="vote-row muted">This photo was added this week. Members can vote for it.</p>';
      else if (d.own) html += '<p class="vote-row muted">This is your photo, so you can\'t vote for it.</p>';
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
    } else {
      html += '<form class="member-signin" novalidate><p>Members can comment' + (thisWeek ? " and vote" : "") + ". Sign in with your invite code.</p>" +
        '<div class="signin-row"><label class="visually-hidden" for="sc-' + id + '">Invite code</label>' +
        '<input type="text" id="sc-' + id + '" placeholder="Invite code" autocapitalize="characters" autocomplete="off" spellcheck="false">' +
        '<button class="btn btn-small" type="submit">Sign in</button></div><p class="status" aria-live="polite"></p></form>';
    }
    panel.innerHTML = html;

    var voteBtn = panel.querySelector(".vote");
    if (voteBtn) voteBtn.addEventListener("click", function () {
      voteBtn.disabled = true;
      call("/vote", { method: "POST", json: { photo: id } }).then(function (r) {
        voteBtn.setAttribute("aria-pressed", r.voted);
        voteBtn.textContent = r.voted ? "Your vote" : "Vote";
        voteBtn.nextElementSibling.textContent = r.votesLeft + " of " + r.perWeek + " votes left this week";
        setStatus(panel.querySelector(".vote-status"), r.voted ? "Thanks for voting. Results are announced on Monday." : "Vote taken back.");
      }).catch(function (e) { setStatus(panel.querySelector(".vote-status"), e.message, true); })
        .then(function () { voteBtn.disabled = false; });
    });

    var form = panel.querySelector(".comment-form");
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
        var e = b.getAttribute("data-e"), s = area.selectionStart, end = area.selectionEnd, v = area.value;
        if (v.length - (end - s) + e.length > 500) return;
        area.value = v.slice(0, s) + e + v.slice(end);
        area.focus();
        area.setSelectionRange(s + e.length, s + e.length);
      });
    }
    if (form) form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var box = form.querySelector("textarea"), st = form.querySelector(".status"), btn = form.querySelector("button");
      if (!box.value.trim()) { setStatus(st, "Write a comment first.", true); box.focus(); return; }
      btn.disabled = true; setStatus(st, "Posting…");
      call("/comment", { method: "POST", json: { photo: id, text: box.value } }).then(function () {
        return call("/photo/" + id).then(function (d2) { draw(panel, id, d2, thisWeek); setStatus(panel.querySelector(".comment-form .status"), "Posted."); });
      }).catch(function (e) { btn.disabled = false; setStatus(st, e.message, true); if (e.status === 401) { setCode(""); load(panel.closest(".viewer"), panel); } });
    });

    panel.querySelectorAll(".del").forEach(function (b) {
      b.addEventListener("click", function () {
        var li = b.closest("li"), box = b.parentNode;
        box.innerHTML = '<span class="muted">Delete this comment?</span> <button class="linkish yes" type="button">Yes, delete</button> <button class="linkish no" type="button">Cancel</button>';
        box.querySelector(".no").addEventListener("click", function () { draw(panel, id, d, thisWeek); });
        box.querySelector(".yes").addEventListener("click", function () {
          call("/comment/delete", { method: "POST", json: { photo: id, cid: li.getAttribute("data-cid") } })
            .then(function () { return load(panel.closest(".viewer"), panel); })
            .catch(function (e) { box.innerHTML = '<span class="status error">' + esc(e.message) + "</span>"; });
        });
      });
    });

    var signin = panel.querySelector(".member-signin");
    if (signin) signin.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var input = signin.querySelector("input"), st = signin.querySelector(".status");
      var c = input.value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
      if (!c) { setStatus(st, "Enter your invite code.", true); return; }
      setStatus(st, "Checking…");
      call("/me", { code: c }).then(function () { setCode(c); return load(panel.closest(".viewer"), panel); })
        .catch(function (e) { setStatus(st, e.message, true); });
    });
  }

  window.addEventListener("hashchange", render);
  render();
})();
