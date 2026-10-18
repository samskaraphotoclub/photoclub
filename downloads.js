/* The Conscious Frame – the club's downloads: posters, cheat sheets, guides and forms the admins share.
   The home page shows the newest three; the Downloads page shows them all, by kind. Visitors get the
   ones for everyone; signed-in members get the members-only ones too. Needs config.js and club.js. */
var ClubDownloads = (function () {
  "use strict";
  var esc = Club.esc, ml = Club.ml;
  var KINDS = ["Poster", "Cheat sheet", "Guide", "Form", "Other"];
  var LABEL = { pdf: "PDF", png: "PNG image", jpg: "JPEG image", jpeg: "JPEG image", webp: "WebP image", docx: "Word", xlsx: "Excel", pptx: "PowerPoint",
                odt: "Text document", ods: "Spreadsheet", odp: "Presentation", zip: "ZIP" };
  function type(f) { return LABEL[f.ext] || String(f.ext || "").toUpperCase(); }
  function size(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace(/\.0$/, "") + " MB" : Math.max(1, Math.round((n || 0) / 1024)) + " KB"; }
  function load() { return Club.ready() ? Club.call("/files") : Promise.reject(new Error("Downloads open soon.")); }

  // one download: its preview (or the kind of file), what it is, and a Download button
  function card(f, d) {
    var open = Club.fileUrl(f, d.token), save = Club.fileUrl(f, d.token, { dl: true });
    var short = { pdf: "PDF", docx: "DOC", xlsx: "XLS", pptx: "PPT", odt: "ODT", ods: "ODS", odp: "ODP", zip: "ZIP" }[f.ext] || String(f.ext || "").toUpperCase();
    var pic = f.tw ? '<img src="' + esc(Club.fileUrl(f, d.token, { thumb: true })) + '" alt="" width="' + (f.tw | 0) + '" height="' + (f.th | 0) + '" loading="lazy">'
                   : '<span class="dl-type">' + esc(short) + "</span>";
    return '<article class="dl" id="f-' + esc(f.id) + '" data-kind="' + esc(f.kind) + '">' +
      '<a class="dl-pic" href="' + esc(open) + '" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">' + pic + "</a>" +
      '<div class="dl-text"><h3' + ml(f.title) + '><a href="' + esc(open) + '" target="_blank" rel="noopener">' + esc(f.title) + "</a></h3>" +
      '<p class="dl-meta">' + esc(f.kind + ", " + type(f) + ", " + size(f.size)) + (f.pub ? "" : ' <span class="tag">Members only</span>') + "</p>" +
      (f.desc ? '<p class="dl-desc"' + ml(f.desc) + ">" + esc(f.desc) + "</p>" : "") +
      '<a class="btn btn-light btn-small" href="' + esc(save) + '" aria-label="Download ' + esc(f.title) + '">Download</a></div></article>';
  }

  // the Downloads page: every file, with a filter for each kind that has files
  function page() {
    var $ = function (id) { return document.getElementById(id); };
    var st = $("dl-status");
    load().then(function (d) {
      var files = d.files || [];
      var more = d.forMembers ? d.forMembers + (d.forMembers === 1 ? " more download is" : " more downloads are") + ' for members. <a href="gallery.html">Sign in</a> to get ' + (d.forMembers === 1 ? "it." : "them.") : "";
      if (!files.length) { st.innerHTML = "Nothing to download yet. " + more; return; }
      var kinds = KINDS.filter(function (k) { return files.some(function (f) { return f.kind === k; }); });
      if (kinds.length > 1) {
        $("dl-chips").innerHTML = '<input type="radio" name="dl-kind" id="k-all" value="" checked><label for="k-all">All</label>' + kinds.map(function (k, i) {
          return '<input type="radio" name="dl-kind" id="k-' + i + '" value="' + esc(k) + '"><label for="k-' + i + '">' + esc(k === "Other" ? "Other" : k + "s") + "</label>";
        }).join("");
        $("dl-chips").hidden = false;
        $("dl-chips").addEventListener("change", function (e) {
          var k = e.target.value;
          [].forEach.call($("dl-list").children, function (el) { el.hidden = !!k && el.getAttribute("data-kind") !== k; });
        });
      }
      $("dl-list").innerHTML = files.map(function (f) { return card(f, d); }).join("");
      st.innerHTML = more;
      st.hidden = !more;
      var target = location.hash && document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }).catch(function (e) { st.textContent = e.status === 404 || /open soon/.test(e.message) ? "Downloads open soon." : e.message; });
  }

  return { load: load, card: card, page: page, size: size, type: type, KINDS: KINDS };
})();
