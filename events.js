/* The Conscious Frame – events: photo walks, workshops, exhibitions and meet-ups.
   Visitors see the events the club made public; members see all of them, who's coming, and tap
   "I'm coming". Anyone can add an event to their calendar or share it on WhatsApp.
   Times are the club's time (Europe/Berlin). Needs config.js and club.js. */
var ClubEvents = (function () {
  "use strict";
  var esc = Club.esc, ml = Club.ml, TZ = "Europe/Berlin";
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function parts(date) { var d = new Date(date + "T12:00:00Z"); return { day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()], mon: MONTHS[d.getUTCMonth()].slice(0, 3), weekday: DAYS[d.getUTCDay()], year: d.getUTCFullYear() }; }
  function when(e) {   // "Sun 18 October, 14:00–17:00"
    var p = parts(e.date);
    return p.weekday + " " + p.day + " " + p.month + (p.year !== new Date().getFullYear() ? " " + p.year : "") + (e.start ? ", " + e.start + (e.end ? "–" + e.end : "") : "");
  }
  function pageUrl(e) { return new URL("events.html", location.href).href.split("#")[0] + "#e-" + e.id; }

  /* ---------- calendars ---------- */
  function offset(ms) {   // how far Berlin time is ahead of UTC at a moment, in ms
    var v = {};
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(ms)).forEach(function (x) { v[x.type] = x.value; });
    return Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour % 24, +v.minute, +v.second) - ms;
  }
  function berlin(date, time) {   // a Berlin date and time -> the moment, in ms
    var d = date.split("-").map(Number), t = time.split(":").map(Number), local = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1]), ms = local;
    for (var i = 0; i < 2; i++) ms = local - offset(ms);
    return ms;
  }
  function span(e) {   // { start, end } in ms, or null for an all-day event
    if (!e.start) return null;
    var s = berlin(e.date, e.start), end = e.end ? berlin(e.date, e.end) : s + 2 * 3600e3;
    if (end <= s) end += 24 * 3600e3;   // ends after midnight
    return { start: s, end: end };
  }
  function stamp(ms) { return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
  function day(date, add) { var d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + (add || 0)); return d.toISOString().slice(0, 10).replace(/-/g, ""); }
  function icsText(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function fold(line) {   // calendar files want lines of at most 75 bytes
    var out = "", cur = "", enc = new TextEncoder();
    Array.from(line).forEach(function (ch) { if (enc.encode(cur + ch).length > 74) { out += cur + "\r\n "; cur = ""; } cur += ch; });
    return out + cur;
  }
  function ics(e) {
    var t = span(e), lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Conscious Frame//Events//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
      "UID:" + e.id + "@the-conscious-frame", "DTSTAMP:" + stamp(Date.now())];
    if (t) lines.push("DTSTART:" + stamp(t.start), "DTEND:" + stamp(t.end));
    else lines.push("DTSTART;VALUE=DATE:" + day(e.date), "DTEND;VALUE=DATE:" + day(e.date, 1));
    lines.push("SUMMARY:" + icsText(e.title));
    if (e.place) lines.push("LOCATION:" + icsText(e.place));
    lines.push("DESCRIPTION:" + icsText((e.desc ? e.desc + "\n\n" : "") + pageUrl(e)), "URL:" + pageUrl(e), "END:VEVENT", "END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }
  function downloadIcs(e) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics(e)], { type: "text/calendar;charset=utf-8" }));
    a.download = (e.title.replace(/[^\w\- ]+/g, "").trim() || "event") + ".ics";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  }
  function google(e) {
    var t = span(e), dates = t ? stamp(t.start) + "/" + stamp(t.end) : day(e.date) + "/" + day(e.date, 1);
    return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(e.title) + "&dates=" + dates + "&ctz=" + encodeURIComponent(TZ) +
      "&details=" + encodeURIComponent((e.desc ? e.desc + "\n\n" : "") + pageUrl(e)) + (e.place ? "&location=" + encodeURIComponent(e.place) : "");
  }
  function whatsapp(text) { return "https://wa.me/?text=" + encodeURIComponent(text); }
  function shareText(e) { return e.kind + ": " + e.title + "\n" + when(e) + (e.place ? "\n" + e.place : "") + "\n\nDetails" + (e.public ? "" : " (for members)") + ": " + pageUrl(e); }

  /* ---------- the page ---------- */
  function going(e) {
    var n = (e.going || []).length, left = e.max ? Math.max(0, e.max - n) : null;
    return (n ? n + " coming: " + e.going.map(esc).join(", ") : "Nobody has signed up yet.") + (left !== null ? " · " + (left ? left + (left === 1 ? " place" : " places") + " left" : "Full") : "");
  }
  function card(e, d, past) {
    var p = parts(e.date), member = d.member;
    return '<article class="event' + (past ? " past" : "") + '" id="e-' + esc(e.id) + '">' +
      '<div class="when" aria-hidden="true"><b>' + p.day + "</b><span>" + p.mon + "</span></div>" +
      '<div class="what"><p class="kicker">' + esc(e.kind) + (e.public ? "" : ' · <span class="chip">Members only</span>') + "</p>" +
      "<h2" + ml(e.title) + ">" + esc(e.title) + "</h2>" +
      '<p class="meta"><b>' + esc(when(e)) + "</b>" + (e.place ? "<br><span" + ml(e.place) + ">" + esc(e.place) + "</span>" : "") + "</p>" +
      (e.desc ? '<p class="desc"' + ml(e.desc) + ">" + esc(e.desc) + "</p>" : "") +
      (d.member || d.admin ? '<p class="going">' + going(e) + "</p>" : "") +
      (past ? "" : '<div class="row-btns">' +
        (member ? '<button class="btn btn-small rsvp' + (e.mine ? " btn-dark" : " btn-light") + '" type="button" aria-pressed="' + !!e.mine + '">' + (e.mine ? "You're coming" : "I'm coming") + "</button>" : "") +
        '<button class="btn btn-light btn-small ics" type="button">Add to calendar</button>' +
        '<a class="btn btn-light btn-small" href="' + esc(google(e)) + '" target="_blank" rel="noopener">Google Calendar</a>' +
        '<a class="btn btn-light btn-small" href="' + esc(whatsapp(shareText(e))) + '" target="_blank" rel="noopener">Share on WhatsApp</a></div>' +
        (member || d.admin ? "" : '<p class="note">Members can sign in to say they\'re coming. <a href="gallery.html">Sign in</a></p>')) +
      '<p class="status" aria-live="polite"></p></div></article>';
  }
  function wire(root, d, byId) {
    root.querySelectorAll(".event").forEach(function (el) {
      var e = byId[el.id.slice(2)];
      var ics = el.querySelector(".ics"); if (ics) ics.addEventListener("click", function () { downloadIcs(e); });
      var btn = el.querySelector(".rsvp"), st = el.querySelector(".status");
      if (btn) btn.addEventListener("click", function () {
        btn.disabled = true;
        Club.call("/events/" + encodeURIComponent(e.id) + "/rsvp", { method: "POST" }).then(function (r) {
          e.mine = r.mine; e.going = r.going;
          btn.textContent = r.mine ? "You're coming" : "I'm coming"; btn.setAttribute("aria-pressed", r.mine);
          btn.classList.toggle("btn-dark", r.mine); btn.classList.toggle("btn-light", !r.mine);
          el.querySelector(".going").innerHTML = going(e);
          st.className = "status"; st.textContent = r.mine ? "See you there. Add it to your calendar so you don't forget." : "Taken back.";
        }).catch(function (x) { st.className = "status error"; st.textContent = x.message; }).then(function () { btn.disabled = false; });
      });
    });
  }
  function page() {
    var $ = function (id) { return document.getElementById(id); };
    if (!Club.ready()) { $("ev-status").textContent = "Events open soon."; return; }
    Club.call("/events").then(function (d) {
      var byId = {};
      d.upcoming.concat(d.past).forEach(function (e) { byId[e.id] = e; });
      $("upcoming").innerHTML = d.upcoming.map(function (e) { return card(e, d, false); }).join("");
      $("ev-status").textContent = d.upcoming.length ? "" : "Nothing planned at the moment. New events appear here" + (d.member ? "." : ", and members see a few more after signing in.");
      $("ev-status").hidden = !!d.upcoming.length;
      $("past").innerHTML = d.past.map(function (e) { return card(e, d, true); }).join("");
      $("past-box").hidden = !d.past.length;
      wire(document, d, byId);
      var target = location.hash && document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }).catch(function (e) {
      if (e.status === 401) { Club.signOut(); return page(); }       // an old code: show the visitors' view
      $("ev-status").textContent = e.status === 404 ? "Events open soon." : e.message;
    });
  }
  return { page: page, when: when, parts: parts, ics: ics, google: google, whatsapp: whatsapp, shareText: shareText };
})();
if (document.getElementById("upcoming")) ClubEvents.page();
