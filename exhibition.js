/* The Conscious Frame – the public exhibition: photos members have agreed anyone may see,
   chosen by the club's admins. No sign-in. Needs config.js, club.js and viewer.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = Club.esc, ml = Club.ml, data = null;

  Viewer.init({
    onMissing: function () { if (data) { $("x-status").hidden = false; $("x-status").textContent = "That photo isn't in the exhibition any more."; } }
  });

  if (!Club.ready()) { $("x-status").textContent = "The exhibition opens soon."; return; }
  Club.exhibition().then(function (d) {
    data = d;
    if (!d.photos.length) { $("x-status").textContent = "The exhibition opens soon. Its first photos are being chosen."; return; }
    var series = (d.series || []).filter(function (s) { return d.photos.some(function (p) { return p.series === s.id; }); });
    // filters for the series, only when there's something to filter
    if (series.length) {
      var rules = [];
      $("x-chips").innerHTML = '<input type="radio" name="x" id="x-all" checked><label for="x-all">All</label>' + series.map(function (s) {
        rules.push(".gallery:has(#x-s-" + s.id + ":checked) .tile:not(.s-" + s.id + ") { display: none; }");
        return '<input type="radio" name="x" id="x-s-' + esc(s.id) + '"><label for="x-s-' + esc(s.id) + '"' + ml(s.name) + ">" + esc(s.name) + "</label>";
      }).join("");
      document.head.appendChild(document.createElement("style")).textContent = rules.join("\n");
      $("x-chips").hidden = false;
    }
    $("grid").innerHTML = d.photos.map(function (p) {
      var s = p.series ? Club.seriesName(d.series, p.series) : "";
      return Viewer.tile(p, Club.publicUrl(p, "thumb"), Club.publicUrl(p, "full"), {
        cls: s ? "s-" + p.series : "", series: s,
        extra: '<p class="note">© <span' + ml(p.by) + ">" + esc(p.by) + "</span>. Shown with the photographer's permission. Please don't use this photo without asking them.</p>"
      });
    }).join("");
    $("x-status").hidden = true;
    var m = location.hash.match(/^#series-([a-z0-9-]+)$/), chip = m && $("x-s-" + m[1]);
    if (chip) chip.checked = true;
    Club.layout();
    document.addEventListener("change", function (e) { if (e.target.name === "x") Club.layout(); });
    Viewer.addSteps();
    Viewer.sync();
  }).catch(function (e) { $("x-status").textContent = e.status === 404 ? "The exhibition opens soon." : e.message; });   // 404: the inbox hasn't been updated yet
})();
