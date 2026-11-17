/* The Conscious Frame – "Masters of photography" pages, for members only.
   Each page's text and drawings are locked on the site. A signed-in member's page asks the club's inbox for the
   page's key (the inbox checks the invite code, the same way as for the handbook), keeps it for the browser tab
   and opens the page here in the browser.
   Photos by the masters are never stored on this site. They are shown straight from a museum's website, and only
   after the member taps "Show", because loading them sends the member's IP address to that museum.
   Needs config.js and club.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var main = $("main"), data = $("hb-data");
  var EDITION = data ? data.getAttribute("data-edition") || "" : "";

  function bytes(s) {
    var t = String(s).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    var bin = atob(t + "===".slice((t.length + 3) % 4)), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // the page's key: from this tab's memory, or from the inbox (members only)
  var SAVED = "conscious-frame-handbook-key:" + EDITION, keyP = null;
  function key() {
    if (keyP) return keyP;
    var saved = null;
    try { saved = sessionStorage.getItem(SAVED); } catch (e) {}
    var raw = saved ? Promise.resolve(saved) : Club.call("/handbook-key?e=" + EDITION).then(function (d) {
      try { sessionStorage.setItem(SAVED, d.key); } catch (e) {}
      return d.key;
    });
    keyP = raw.then(function (k) { return crypto.subtle.importKey("raw", bytes(k), { name: "AES-GCM" }, false, ["decrypt"]); });
    keyP.catch(function () { keyP = null; });
    return keyP;
  }
  function forget() { keyP = null; try { sessionStorage.removeItem(SAVED); } catch (e) {} }
  // the locked page: 12 bytes of IV, then the text
  function open(locked) {
    return key().then(function (k) { return crypto.subtle.decrypt({ name: "AES-GCM", iv: locked.subarray(0, 12) }, k, locked.subarray(12)); });
  }

  /* ---------- signing in ---------- */
  function say(msg, isError) {
    var st = $("hb-status");
    if (!st) return;
    st.hidden = false; st.classList.toggle("error", !!isError); st.textContent = msg;
    $("hb-gate").hidden = true;
  }
  function showGate(msg) {
    $("hb-status").hidden = true;
    $("hb-gate").hidden = false;
    var st = $("hb-gate-status");
    st.classList.toggle("error", !!msg); st.textContent = msg || "";
  }
  var gate = $("hb-gate");
  if (gate) gate.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var st = $("hb-gate-status");
    st.classList.remove("error"); st.textContent = "Checking…";
    Club.signIn($("hb-code").value).then(function () { $("hb-code").value = ""; start(); })
      .catch(function (e) { st.classList.add("error"); st.textContent = e.message; });
  });

  function start() {
    if (!data) return;
    if (!window.Club || !Club.ready()) return say("This page opens soon.");
    if (!(window.crypto && crypto.subtle && window.TextDecoder)) return say("This browser can’t open the page. Try it in an up-to-date browser.", true);
    if (!Club.code()) return showGate();
    say("Opening the page…");
    open(bytes(data.textContent)).then(function (buf) {
      main.innerHTML = new TextDecoder().decode(buf);
      data.parentNode.removeChild(data); data = null;
      museumPhotos();
      document.dispatchEvent(new Event("ms-opened"));   // the Learning page fills itself in then
      if (location.hash) {
        var t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (t) t.scrollIntoView();
      }
    }).catch(function (e) {
      if (e.status === 401) { forget(); Club.signOut(); return showGate(e.message); }
      if (e.status === 404) return say("This page opens soon.");
      if (e.status === 503) return say("This page opens soon.");
      if (e.status) return say(e.message, true);
      if (e.name === "OperationError") { forget(); return say("Couldn’t open the page. Reload it to try again.", true); }
      say(e.message || "Couldn’t open the page. Reload it to try again.", true);
    });
  }

  /* ---------- photos from a museum's or agency's website, only when the member asks ---------- */
  function show(slot) {
    if (!slot || slot.getAttribute("data-shown")) return;
    slot.setAttribute("data-shown", "1");
    var img = new Image();
    img.alt = slot.getAttribute("data-alt") || "";
    img.decoding = "async";
    img.onload = function () {
      slot.innerHTML = "";
      slot.appendChild(img);
      slot.classList.add("is-shown");
    };
    // Other copies of the same photo on the same site (data-src2, then data-alts, space-separated), tried in turn
    var tries = [slot.getAttribute("data-src2")].concat((slot.getAttribute("data-alts") || "").split(" ")).filter(Boolean);
    img.onerror = function () {
      if (tries.length) { img.src = tries.shift(); return; }
      slot.removeAttribute("data-shown");
      var ask = slot.querySelector(".ms-ask");
      if (!ask) return;
      ask.innerHTML = "";
      var p = document.createElement("p");
      var site = slot.getAttribute("data-site");     // e.g. "magnumphotos.com"; the museum when not given
      p.textContent = site ? "The photo didn’t load." : "The museum’s photo didn’t load.";
      var a = document.createElement("a");
      a.href = slot.getAttribute("data-page") || "#";
      a.target = "_blank"; a.rel = "noopener";
      a.textContent = site ? "See it on " + site : "See it on the museum’s website";
      ask.appendChild(p); ask.appendChild(a);
    };
    var ask = slot.querySelector(".ms-ask p");
    if (ask) ask.textContent = "Loading the photo…";
    img.src = slot.getAttribute("data-src");
  }
  function museumPhotos() {
    main.addEventListener("click", function (ev) {
      var one = ev.target.closest(".ms-show");
      if (one) { show(one.closest(".ms-photo")); return; }
      var all = ev.target.closest(".ms-show-all");
      if (all) {
        main.querySelectorAll(".ms-photo").forEach(show);
        main.querySelectorAll(".ms-show-all").forEach(function (btn) { btn.disabled = true; btn.textContent = "Showing the photos"; });
      }
    });
  }

  start();
})();
