/* The Conscious Frame – the home page's photos.
   Everyone: a few photos from the public exhibition, picked at random on each visit. Visitors also get one of
   them as the large photo. Members instead see last month's top three as a fan of prints, Photos of the month,
   the long-term series and the newest photos, loaded from the club's inbox. Everyone sees the next
   events and the newest downloads. Needs config.js and club.js (and events.js, downloads.js). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var esc = Club.esc, ml = Club.ml;
  if (!Club.ready()) return;

  function ar(p) { return (p.tw > 0 && p.th > 0 ? p.tw / p.th : 1.5).toFixed(3); }
  function img(src, p, size, alt, extra) {
    var w = size === "full" ? p.w : p.tw, h = size === "full" ? p.h : p.th;
    return '<img src="' + esc(src) + '" alt="' + esc(alt) + '" width="' + (w | 0) + '" height="' + (h | 0) + '"' + (extra || ' loading="lazy"') + ">";
  }
  function byLine(p) { return "<b" + ml(p.title) + ">" + esc(p.title) + "</b> by <span" + ml(p.by) + ">" + esc(p.by) + "</span>"; }

  var member = !!Club.code();

  // the next three events (visitors see the public ones)
  Club.call("/events").then(function (r) {
    var next = r.upcoming.slice(0, 3);
    if (!next.length || !window.ClubEvents) return;
    $("coming").innerHTML = next.map(function (e) {
      var p = ClubEvents.parts(e.date);
      return '<li><a href="events.html#e-' + esc(e.id) + '"><span class="when"><b>' + p.day + "</b><span>" + p.mon + '</span></span><span class="what"><b' + ml(e.title) + ">" + esc(e.title) + "</b><span>" +
        esc(e.kind + " · " + ClubEvents.when(e)) + (e.going && e.going.length ? " · " + e.going.length + " coming" : "") + "</span></span></a></li>";
    }).join("");
    $("coming-section").hidden = false;
  }).catch(function () { /* no events yet, or the inbox hasn't been updated */ });

  // the three newest downloads (visitors get the ones for everyone)
  if (window.ClubDownloads) ClubDownloads.load().then(function (d) {
    if (!d.files || !d.files.length) return;
    $("downloads").innerHTML = d.files.slice(0, 3).map(function (f) { return ClubDownloads.card(f, d); }).join("");
    $("downloads-section").hidden = false;
  }).catch(function () { /* no downloads yet, or the inbox hasn't been updated */ });
  var shown = Club.exhibition().catch(function () { return { photos: [], series: [] }; });
  var gallery = member ? Club.gallery().catch(function () { return null; }) : Promise.resolve(null);

  Promise.all([shown, gallery]).then(function (r) {
    var ex = r[0], d = r[1];
    var pool = Club.shuffle(ex.photos.slice());
    if (d) members(d);
    else if (pool.length) visitorPhoto(pool.shift());
    // a few more from the exhibition, for everyone
    var strip = pool.slice(0, 6);
    if (strip.length) {
      $("exhibit").innerHTML = strip.map(function (p) {
        return '<a href="exhibition.html#p-' + esc(p.id) + '" style="--ar:' + ar(p) + '" aria-label="' + esc(p.title + " by " + p.by) + '">' + img(Club.publicUrl(p, "thumb"), p, "thumb", "") + "</a>";
      }).join("");
      $("exhibit-section").hidden = false;
    }
    Club.layout();
  });

  // Visitors: one photo from the exhibition as the large photo, gently tilted. The invitation to sign in moves below.
  function visitorPhoto(p) {
    $("hero-photo").style.setProperty("--ar", ar(p));
    $("hero-photo").innerHTML = '<a href="exhibition.html#p-' + esc(p.id) + '">' + img(Club.publicUrl(p, "full"), p, "full", p.title, ' fetchpriority="high"') + "</a>" +
      "<figcaption>" + byLine(p) + ', from the club\'s <a href="exhibition.html">exhibition</a></figcaption>';
    $("hero-photo").hidden = false;
    $("join-slot").appendChild($("hero-card"));
    $("join-slot").hidden = false;
  }

  function members(d) {
    // the monthly theme: how many entries so far, and Share a photo opens with the entry box ticked
    if (d.entry) {
      var n = d.photos.filter(function (p) { return p.theme === d.entry.month; }).length;
      $("entries-line").innerHTML = (n ? '<a href="gallery.html?theme=' + esc(d.entry.month) + '">' + n + (n === 1 ? " entry" : " entries") + " so far</a> · " : "No entries yet. ") +
        '<a href="submit.html?entry=1">' + (n ? "Add yours" : "Be the first") + "</a>";
      $("entries-line").hidden = false;
      $("share-btn").href = "submit.html?entry=1";
    }
    function link(p, inner, label) {
      return '<a href="gallery.html#p-' + esc(p.id) + '"' + (label ? ' aria-label="' + esc(label) + '"' : "") + ">" + inner + "</a>";
    }
    var potw = ((d.potw && d.potw.items) || []).map(function (x) { var p = d.byId[x.id]; return p ? { p: p, votes: x.votes } : null; }).filter(Boolean);

    // The fan: last month's favourites, by the hearts given that month (still in the gallery), else Photos of the month, else the newest.
    var top = ((d.top && d.top.items) || []).filter(function (x) { return d.byId[x.id]; }).slice(0, 3).map(function (x) { return d.byId[x.id]; });
    var fan = top.length ? top : potw.length ? potw.map(function (x) { return x.p; }) : d.photos.slice(0, 3);
    var why = top.length ? (fan.length > 1 ? "Most hearts last month. In front: " : "Most hearts last month: ")
            : potw.length ? "Photos of the month. In front: " : fan.length > 1 ? "Newest in the gallery. In front: " : "Newest in the gallery: ";
    if (fan.length) {
      $("hero-fan").innerHTML = '<div class="stage">' + fan.map(function (p, i) {
        return '<a class="p' + (i + 1) + '" href="gallery.html#p-' + esc(p.id) + '" style="--ar:' + ar(p) + '" aria-label="' + esc((i + 1) + ". " + p.title + " by " + p.by) + '">' +
          img(Club.photoUrl(d, p, i ? "thumb" : "full"), p, i ? "thumb" : "full", "", i ? "" : ' fetchpriority="high"') + "</a>";
      }).join("") + "</div><figcaption>" + why + byLine(fan[0]) + "</figcaption>";
      $("hero-fan").hidden = false; $("hero-card").hidden = true;
    } else {
      $("hero-card").querySelector("h2").textContent = "No photos yet";
      $("hero-card").querySelector("p").textContent = "The gallery fills up as members share their photos. Be the first.";
      $("hero-card").querySelector(".actions").innerHTML = '<a class="btn btn-dark" href="submit.html">Share a photo</a>';
    }

    // Photos of the month, unless the fan already shows the same photos
    var inFan = fan.map(function (p) { return p.id; });
    if (potw.length && !potw.every(function (x) { return inFan.indexOf(x.p.id) >= 0; })) {
      $("potw").innerHTML = potw.map(function (x) {
        return '<figure class="print" style="--ar:' + ar(x.p) + '">' + link(x.p, img(Club.photoUrl(d, x.p, "thumb"), x.p, "thumb", x.p.title)) + "<h3" + ml(x.p.title) + ">" + esc(x.p.title) + "</h3><figcaption" + ml(x.p.by) + ">" + esc(x.p.by) +
          (x.votes ? ", " + x.votes + (x.votes === 1 ? " heart" : " hearts") : "") + "</figcaption></figure>";
      }).join("");
      $("potw-section").hidden = false;
    }

    // the long-term series, like Life in Germany
    $("series-list").innerHTML = (d.series || []).map(function (s) {
      var photos = d.photos.filter(function (p) { return Club.seriesOf(p).indexOf(s.id) >= 0; });
      if (!photos.length && !s.open) return "";
      return '<section class="wrap section"><div class="head"><h2' + ml(s.name) + ">" + esc(s.name) + "</h2>" +
        (photos.length ? '<a href="gallery.html#series-' + esc(s.id) + '">See all ' + photos.length + (photos.length === 1 ? " photo" : " photos") + "</a>" : "") + "</div>" +
        (s.desc ? '<p class="series-desc"' + ml(s.desc) + ">" + esc(s.desc) + "</p>" : "") +
        (photos.length ? '<div class="just strip">' + photos.slice(0, 8).map(function (p) {
          return '<a href="gallery.html#p-' + esc(p.id) + '" style="--ar:' + ar(p) + '" aria-label="' + esc(p.title + " by " + p.by) + '">' + img(Club.photoUrl(d, p, "thumb"), p, "thumb", "") + "</a>";
        }).join("") + "</div>" : "") +
        (s.open ? '<div class="actions home-actions"><a class="btn btn-light" href="submit.html?series=' + esc(s.id) + '">' + (photos.length ? "Add your photo to the series" : "Be the first: share a photo for it") + "</a></div>" : "") +
        "</section>";
    }).join("");

    if (d.photos.length) {
      $("newest").innerHTML = d.photos.slice(0, 8).map(function (p) {
        return '<a href="gallery.html#p-' + esc(p.id) + '" style="--ar:' + ar(p) + '" aria-label="' + esc(p.title + " by " + p.by) + '">' + img(Club.photoUrl(d, p, "thumb"), p, "thumb", "") + "</a>";
      }).join("");
      $("newest-section").hidden = false;
    }

  }
})();
