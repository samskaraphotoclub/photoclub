/* The Conscious Frame – home page photos, for signed-in members only.
   Visitors see the theme, contests and club text, plus an invitation to sign in.
   Members also see a large photo, Photos of the week, the newest photos and the contest photos,
   loaded from the club's inbox. Needs config.js and club.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = Club.esc;
  if (!Club.ready() || !Club.code()) return;      // visitors: the page stays as it is

  function link(p, inner, label) {
    return '<a href="gallery.html#p-' + esc(p.id) + '"' + (label ? ' aria-label="' + esc(label) + '"' : "") + ">" + inner + "</a>";
  }
  function img(d, p, size, alt, extra) {
    var w = size === "full" ? p.w : p.tw, h = size === "full" ? p.h : p.th;
    return '<img src="' + esc(Club.photoUrl(d, p, size)) + '" alt="' + esc(alt) + '" width="' + (w | 0) + '" height="' + (h | 0) + '"' + (extra || ' loading="lazy"') + ">";
  }

  Club.gallery().then(function (d) {
    var potw = ((d.potw && d.potw.items) || []).map(function (x) { var p = d.byId[x.id]; return p ? { p: p, votes: x.votes } : null; }).filter(Boolean);

    // the large photo: last week's favourite, or else the newest photo
    var lead = potw.length ? potw[0].p : d.photos[0];
    if (lead) {
      $("hero-photo").innerHTML = link(lead, img(d, lead, "full", lead.title, ' fetchpriority="high"')) +
        "<figcaption><b>" + esc(lead.title) + "</b> by " + esc(lead.by) + (potw.length ? ", top photo of the week" : ", newest in the gallery") + "</figcaption>";
      $("hero-photo").hidden = false; $("hero-card").hidden = true;
    } else {
      $("hero-card").querySelector("h2").textContent = "No photos yet";
      $("hero-card").querySelector("p").textContent = "The gallery fills up as members share their photos. Be the first.";
      $("hero-card").querySelector(".actions").innerHTML = '<a class="btn btn-dark" href="submit.html">Share a photo</a>';
    }

    if (potw.length) {
      $("potw").innerHTML = potw.map(function (x) {
        return '<figure class="print">' + link(x.p, img(d, x.p, "thumb", x.p.title)) + "<h3>" + esc(x.p.title) + "</h3><figcaption>" + esc(x.p.by) +
          (x.votes ? ", " + x.votes + (x.votes === 1 ? " vote" : " votes") : "") + "</figcaption></figure>";
      }).join("");
      $("potw-section").hidden = false;
    }

    if (d.photos.length) {
      $("newest").innerHTML = d.photos.slice(0, 8).map(function (p) { return link(p, img(d, p, "thumb", ""), p.title + " by " + p.by); }).join("");
      $("newest-section").hidden = false;
    }

    document.querySelectorAll(".contest[data-photo]").forEach(function (c) {
      var p = d.byId[c.getAttribute("data-photo")];
      if (p) c.insertAdjacentHTML("afterbegin", link(p, img(d, p, "thumb", "")));
    });
  }).catch(function () { /* signed out or offline: the visitor view stays */ });
})();
