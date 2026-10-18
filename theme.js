/* The Conscious Frame – light and dark viewing. The site starts the way the phone or computer is set;
   the moon/sun button in the header switches it, and this browser remembers the choice.
   (A line in each page's <head> applies the choice before the page appears, so it doesn't flash.) */
(function () {
  "use strict";
  var KEY = "conscious-frame-mode", root = document.documentElement;
  var device = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  function chosen() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function apply(mode) {
    root.setAttribute("data-theme", mode);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", mode === "dark" ? "#141212" : "#ffffff");
    document.querySelectorAll(".mode").forEach(function (b) {
      b.setAttribute("aria-pressed", String(mode === "dark"));
      b.title = mode === "dark" ? "Switch to light mode" : "Switch to dark mode";
    });
  }
  apply(chosen() || (device && device.matches ? "dark" : "light"));
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".mode");
    if (!b) return;
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch (err) {}
    apply(next);
  });
  // when the phone switches between light and dark (say, at sunset), follow it, unless a choice was made here
  if (device && device.addEventListener) device.addEventListener("change", function (e) { if (!chosen()) apply(e.matches ? "dark" : "light"); });
})();
