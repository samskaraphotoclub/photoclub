/* The Conscious Frame – the members-only gallery.
   Members sign in with their invite code; the photos then load from the club's inbox.
   Filters for categories and series, and under each photo in the viewer, members' comments
   (with a Report button) and hearts. Needs config.js, club.js and viewer.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = Club.esc, data = null;
  // gallery.html?by=NAME: one photographer's page; gallery.html?theme=2026-10: the entries for a monthly theme
  var params = new URLSearchParams(location.search), byName = params.get("by") || "", themeMonth = /^\d{4}-\d{2}$/.test(params.get("theme") || "") ? params.get("theme") : "";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function monthName(m) { return MONTHS[+m.slice(5, 7) - 1] + " " + m.slice(0, 4); }
  function themeTitle(d, month) { var t = (d.themes || []).filter(function (x) { return x.month === month; })[0]; return t ? t.title : ""; }
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
      // a link with a photographer's earlier name (they've changed it since, perhaps only its capitals): their page under the name they have now
      if (byName && !d.photos.some(function (p) { return p.by === byName; })) {
        var key = function (n) { return String(n || "").toLowerCase().replace(/[\s.,'’_-]+/g, ""); }, k = key(byName), was = d.was || {};
        var same = d.photos.filter(function (p) { return key(p.by) === k; })[0], earlier = Object.keys(was).filter(function (w) { return key(w) === k; })[0];
        var now = same ? same.by : earlier ? was[earlier] : "";
        if (now) { byName = now; try { history.replaceState(null, "", "gallery.html?by=" + encodeURIComponent(byName) + location.hash); } catch (e) {} }
      }
      var list = byName ?d.photos.filter(function (p) { return p.by === byName; }) : themeMonth ? d.photos.filter(function (p) { return p.theme === themeMonth; }) : d.photos;
      heading(d, list);
      seriesChips(d, list);
      $("grid").innerHTML = list.map(tile).join("");
      $("g-status").hidden = list.length > 0;
      $("g-status").textContent = byName ? "No photos from " + byName + " in the gallery yet." : themeMonth ? "No entries for this theme yet." : "No photos yet. Share the first one on the Share a photo page.";
      $("g-name").textContent = d.name;
      $("g-who").hidden = false; $("g-photos").hidden = false;
      var fresh = list.filter(function (p) { return Club.thisMonth(d, p); }).length;
      $("l-month").hidden = !fresh;
      if ((location.hash === "#this-month" || location.hash === "#this-week") && fresh) $("c-month").checked = true;
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

  // the page's heading: the gallery, a photographer's page, or a theme's entries
  function heading(d, list) {
    if (byName) {
      var person = (d.people || {})[byName], mine = byName === d.name;
      $("g-title").innerHTML = Club.avatar(d, byName, "big") + "<span>" + esc(byName) + "</span>"; $("g-title").classList.add("named"); $("g-title").setAttribute("lang", Club.ml(byName) ? "ml" : "en");
      document.title = byName + " – The Conscious Frame";
      $("g-intro").textContent = person && person.bio ? person.bio : mine ? "Add a line about yourself on the Share a photo page; members see it here." : "";
      $("g-intro").setAttribute("lang", person && Club.ml(person.bio) ? "ml" : "en");
      $("g-intro").hidden = !$("g-intro").textContent;
      $("g-meta").innerHTML = list.length + (list.length === 1 ? " photo" : " photos") + ' · <a href="photographers.html">All photographers</a>' + (mine ? ' · <a href="submit.html#about-you">Edit your picture and line</a>' : "");
      $("g-meta").hidden = false;
    } else if (themeMonth) {
      var title = themeTitle(d, themeMonth);
      $("g-title").textContent = title ? "Entries: " + title : "Theme entries";
      document.title = $("g-title").textContent + " – The Conscious Frame";
      $("g-intro").textContent = "Photos members shared for the monthly theme of " + monthName(themeMonth) + ", newest first.";
      $("g-meta").innerHTML = list.length + (list.length === 1 ? " entry" : " entries") + ' · <a href="archive.html">Theme archive</a> · <a href="gallery.html">The whole gallery</a>';
      $("g-meta").hidden = false;
    }
  }

  function tile(p) {
    var cats = Club.cats(p).map(Club.catClass).join(" "), ids = Club.seriesOf(p);
    var series = ids.map(function (id) { return Club.seriesName(data.series, id); }).filter(Boolean), theme = p.theme ? themeTitle(data, p.theme) : "";
    var lines = (theme ? '<p class="in-series">Entry for the monthly theme <a href="gallery.html?theme=' + esc(p.theme) + '"><b' + Club.ml(theme) + ">" + esc(theme) + "</b></a></p>" : "") +
      (p.fb === "share" ? '<p class="fb-note">Just sharing: no critique needed. Say what you enjoy about it.</p>' : '<p class="fb-note">Feedback welcome: start with what works, then your suggestion.</p>');
    return Viewer.tile(p, Club.photoUrl(data, p, "thumb"), Club.photoUrl(data, p, "full"), {
      cls: cats + (Club.thisMonth(data, p) ? " this-month" : "") + ids.map(function (id) { return " s-" + id; }).join("") + (p.theme ? " e-" + p.theme : "") + (p.fb === "share" ? "" : " fb-on"),
      series: series, lines: lines, byHref: "gallery.html?by=" + encodeURIComponent(p.by), votes: (data.votes && data.votes[p.id]) || 0,
      extra: p.pub ? '<p class="note">Also in the club\'s public <a href="exhibition.html#p-' + esc(p.id) + '">exhibition</a>, where anyone can see it.</p>' : ""
    });
  }

  // Filter chips for the current monthly theme's entries and each series with photos, right after "All",
  // and "Feedback welcome" before "This month" (filtering is plain CSS, like the categories)
  function seriesChips(d, list) {
    document.querySelectorAll(".chips .extra-chip").forEach(function (el) { el.remove(); });
    var style = $("series-filters") || document.head.appendChild(Object.assign(document.createElement("style"), { id: "series-filters" }));
    var rules = [], html = "";
    var chip = function (id, label, cls) { rules.push(".gallery:has(#" + id + ":checked) .tile:not(." + cls + ") { display: none; }");
      return '<input type="radio" name="cat" class="extra-chip" id="' + id + '"><label class="extra-chip" for="' + id + '"' + ml(label) + ">" + esc(label) + "</label>"; };
    if (d.entry && !themeMonth && list.some(function (p) { return p.theme === d.entry.month; })) html += chip("c-e", "Theme: " + d.entry.title, "e-" + d.entry.month);
    (d.series || []).forEach(function (s) { if (list.some(function (p) { return Club.seriesOf(p).indexOf(s.id) >= 0; })) html += chip("c-s-" + s.id, s.name, "s-" + s.id); });
    $("c-all").nextElementSibling.insertAdjacentHTML("afterend", html);
    if (list.some(function (p) { return p.fb !== "share"; }) && list.some(function (p) { return p.fb === "share"; })) $("c-month").insertAdjacentHTML("beforebegin", chip("c-fb", "Feedback welcome", "fb-on"));
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
    var id = v.id.slice(2);
    return Club.call("/photo/" + id).then(function (d) { draw(box, id, d); })
      .catch(function (e) { if (e.status === 401) { Club.signOut(); showGate(e.message); return; } box.innerHTML = '<p class="muted">' + esc(e.message) + "</p>"; });
  }

  // the heart beside the title: give any photo a heart (not your own); it can be taken back on the day it was given
  function dayName(day) { return day ? new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) : "an earlier day"; }
  function voteControls(v, id, d) {
    var slot = v.querySelector(".vote-slot"), note = v.querySelector(".vote-note");
    if (!slot) return;
    data.votes = data.votes || {};
    if (typeof d.votes === "number") { data.votes[id] = d.votes; Viewer.setVotes(id, d.votes); }
    if (!d.member) { slot.innerHTML = ""; note.textContent = ""; note.hidden = true; return; }
    note.hidden = false; note.className = "vote-note";
    if (d.own) { slot.innerHTML = ""; note.textContent = "Your photo, so you can't give it a heart."; return; }
    slot.innerHTML = '<button class="vote-heart" type="button"></button>';
    var btn = slot.querySelector("button");
    btn.innerHTML = Viewer.HEART;
    function show(msg) {
      var final = d.voted && d.canUndo === false;      // given on an earlier day: it stays
      btn.setAttribute("aria-pressed", !!d.voted);
      if (final) btn.setAttribute("aria-disabled", "true"); else btn.removeAttribute("aria-disabled");
      btn.setAttribute("aria-label", !d.voted ? "Give this photo a heart" : final ? "You gave this photo a heart" : "Take your heart back");
      note.className = "vote-note";
      note.textContent = msg || (!d.voted ? "Tap the heart if you like this photo." : final ? "You gave this photo a heart on " + dayName(d.day) + "."
        : "You gave this photo a heart today. Tap it again to take it back, until midnight.");
    }
    show();
    btn.addEventListener("click", function () {
      if (d.voted && d.canUndo === false) { show("You gave this photo a heart on " + dayName(d.day) + ". A heart can only be taken back on the day you give it."); return; }
      btn.disabled = true;
      Club.call("/vote", { method: "POST", json: { photo: id } }).then(function (r) {
        d.voted = r.voted; d.day = r.day; d.canUndo = r.canUndo;
        btn.classList.remove("pop"); void btn.offsetWidth; if (r.voted) btn.classList.add("pop");
        if (typeof r.votes === "number") { data.votes[id] = r.votes; Viewer.setVotes(id, r.votes); }
        show(r.voted ? "Thanks for the heart. Changed your mind? Tap again to take it back, until midnight." : "Heart taken back.");
      }).catch(function (e) { note.className = "vote-note error"; note.textContent = e.message; })
        .then(function () { btn.disabled = false; });
    });
  }
  // while a photo is open, its count keeps up with other members' hearts
  var polling = null;
  function watch(v, id) {
    clearInterval(polling);
    polling = setInterval(function () {
      if (!v.classList.contains("open")) { clearInterval(polling); return; }
      if (document.hidden) return;
      Club.call("/photo/" + id).then(function (d) { if (typeof d.votes === "number") { data.votes[id] = d.votes; Viewer.setVotes(id, d.votes); } }).catch(function () {});
    }, 30000);
  }

  // On your own photo: correct the description and camera settings. The photo keeps its hearts and comments.
  function ownEdit(v, id, d) {
    var old = v.querySelector(".own-edit");
    if (old) old.remove();
    var p = data && data.byId[id], box = v.querySelector(".info .details");
    if (!d.own || !p || !box) return;
    var wrap = document.createElement("div");
    wrap.className = "own-edit";
    box.insertAdjacentElement("afterend", wrap);
    function closed(msg) {
      wrap.innerHTML = '<button class="btn btn-light btn-small" type="button">Edit details</button><p class="status" aria-live="polite"></p>';
      if (msg) setStatus(wrap.querySelector(".status"), msg);
      wrap.querySelector("button").addEventListener("click", open);
    }
    function field(k, label, ph) { return '<div><label class="f" for="ed-' + k + "-" + id + '">' + label + '</label><input type="text" id="ed-' + k + "-" + id + '" maxlength="30" placeholder="' + ph + '" value="' + esc(p[k] || "") + '"></div>'; }
    function open() {
      wrap.innerHTML = '<form class="edit-form" novalidate><label class="f" for="ed-desc-' + id + '">Description</label>' +
        '<textarea id="ed-desc-' + id + '" maxlength="400"' + ml(p.desc) + ">" + esc(p.desc || "") + "</textarea>" +
        '<div class="two">' + field("lens", "Lens", "35 mm") + field("ap", "Aperture", "f/8") + field("sh", "Shutter", "1/250 s") + field("iso", "ISO", "100") + "</div>" +
        '<p class="note">Its hearts and comments stay. To change the photo itself or its title, ask a club admin.</p>' +
        '<div class="row-btns"><button class="btn btn-dark btn-small" type="submit">Save</button><button class="btn btn-light btn-small" type="button" data-a="cancel">Cancel</button></div>' +
        '<p class="status" aria-live="polite"></p></form>';
      var form = wrap.querySelector("form"), st = form.querySelector(".status");
      form.querySelector('[data-a="cancel"]').addEventListener("click", function () { closed(); });
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var body = { desc: form.querySelector("#ed-desc-" + id).value };
        ["lens", "ap", "sh", "iso"].forEach(function (k) { body[k] = form.querySelector("#ed-" + k + "-" + id).value; });
        form.querySelector('[type="submit"]').disabled = true; setStatus(st, "Saving…");
        Club.call("/photo/" + id + "/details", { method: "POST", json: body }).then(function (r) {
          ["desc", "lens", "ap", "sh", "iso"].forEach(function (k) { if (r.photo[k]) p[k] = r.photo[k]; else delete p[k]; });
          Viewer.setDetails(id, p);
          closed("Saved. The photo keeps its hearts and comments.");
        }).catch(function (e) {
          setStatus(st, e.status === 404 && /Not found/.test(e.message) ? "Editing details works once the club's inbox has been updated." : e.message, true);
          form.querySelector('[type="submit"]').disabled = false;
        });
      });
      form.querySelector("textarea").focus();
    }
    closed();
  }

  function draw(box, id, d) {
    var member = !!d.member, html = "";
    voteControls(box.closest(".viewer"), id, d);
    ownEdit(box.closest(".viewer"), id, d);
    watch(box.closest(".viewer"), id);
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
        '<textarea id="cf-' + id + '" maxlength="1000" placeholder="' + (data && data.byId[id] && data.byId[id].fb === "share" ? "Just sharing: say what you enjoy about it. English or Malayalam." : "Start with what you like about the photo, then your suggestion. English or Malayalam.") + '"></textarea>' +
        '<div class="emoji-pick" id="ep-' + id + '" role="group" aria-label="Smileys" hidden>' + SMILEYS.map(function (s) {
          return '<button type="button" data-e="' + s[0] + '" aria-label="' + s[1] + '" title="' + s[1] + '">' + s[0] + "</button>";
        }).join("") + "</div>" +
        '<div class="comment-actions"><button class="emoji-toggle" type="button" aria-expanded="false" aria-controls="ep-' + id + '" aria-label="Add a smiley" title="Add a smiley">😊</button>' +
        '<button class="btn btn-dark btn-small" type="submit">Post comment</button></div><p class="status" aria-live="polite"></p></form>';
    }
    box.innerHTML = html;


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
          return Club.call("/photo/" + id).then(function (d2) { draw(box, id, d2); setStatus(box.querySelector(".comment-form .status"), "Posted."); });
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
        act.querySelector(".no").addEventListener("click", function () { draw(box, id, d); });
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
        del.querySelector(".no").addEventListener("click", function () { draw(box, id, d); });
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
