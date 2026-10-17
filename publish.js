/* The Conscious Frame – admin only.
   Publishes photos to the GitHub repository that hosts the site, as one commit per photo. */
var Publish = (function () {
  "use strict";
  var esc = PhotoTools.esc;
  var TIMEZONE = "Europe/Berlin";   // keep in step with TIMEZONE in the inbox settings and members.js
  function clubDate() {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }

  function explain(status, cfg) {
    if (status === 401) return "GitHub rejected the token. It may have expired: create a new one and save it in Settings.";
    if (status === 403) return "The token can't change this repository. Give it Contents: Read and write permission for " + cfg.repo + ".";
    if (status === 404) return "GitHub can't find " + cfg.owner + "/" + cfg.repo + " (or the branch). Check the names in Settings, and that the token includes this repository.";
    if (status === 409 || status === 422) return "The site changed while publishing. Try again.";
    return "GitHub returned an error (" + status + "). Try again in a minute.";
  }
  function api(cfg, path, opts) {
    opts = opts || {};
    var headers = { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch("https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo + path, {
      method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (r.ok) return r.json();
      var err = new Error(explain(r.status, cfg));
      err.status = r.status;
      throw err;
    }, function () { throw new Error("Couldn't reach GitHub. Check your internet connection and try again."); });
  }
  function decode(b64) {
    var bin = atob(b64.replace(/\s/g, "")), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function encodeText(s) { return btoa(unescape(encodeURIComponent(s))); }
  function readText(cfg, path, ref) {
    return api(cfg, "/contents/" + path + "?ref=" + ref).then(function (f) {
      return f.content ? decode(f.content) : api(cfg, "/git/blobs/" + f.sha).then(function (b) { return decode(b.content); });
    });
  }
  function toBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(",")[1]); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }
  function slugify(s) {
    return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "photo";
  }

  /* one photo in gallery.html: the tile and its viewer */
  function block(p) {
    var rows = [["Lens", p.lens], ["Aperture", p.ap], ["Shutter", p.sh], ["ISO", p.iso]].filter(function (r) { return r[1]; })
      .map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
    return "    <figure class=\"tile " + p.cat.toLowerCase() + "\" id=\"t-" + p.id + "\"" + (p.sub ? " data-sub=\"" + esc(p.sub) + "\"" : "") +
      " data-added=\"" + (p.added || clubDate()) + "\">\n" +
      "      <a href=\"#p-" + p.id + "\"><img src=\"photos/" + p.id + "-sm." + p.ext + "\" alt=\"" + esc(p.title) + "\" width=\"" + p.tw + "\" height=\"" + p.th + "\" loading=\"lazy\"></a>\n" +
      "      <figcaption><b>" + esc(p.title) + "</b>" + esc(p.by) + "</figcaption>\n" +
      "      <div class=\"viewer\" id=\"p-" + p.id + "\" role=\"dialog\" aria-label=\"" + esc(p.title) + "\">\n" +
      "        <a class=\"shade\" href=\"#t-" + p.id + "\" aria-label=\"Close\" tabindex=\"-1\"></a>\n" +
      "        <div class=\"box\">\n" +
      "          <a class=\"close\" href=\"#t-" + p.id + "\" aria-label=\"Close\">×</a>\n" +
      "          <div class=\"pic\"><img src=\"photos/" + p.id + "." + p.ext + "\" alt=\"" + esc(p.title) + "\" width=\"" + p.w + "\" height=\"" + p.h + "\" loading=\"lazy\"></div>\n" +
      "          <div class=\"info\">\n" +
      "            <h2>" + esc(p.title) + "</h2>\n" +
      "            <p class=\"by\">" + esc(p.by) + ", " + esc(p.cat) + "</p>\n" +
      (p.desc ? "            <p class=\"desc\">" + esc(p.desc) + "</p>\n" : "") +
      (rows ? "            <dl>" + rows + "</dl>\n" : "") +
      "          </div>\n        </div>\n      </div>\n    </figure>\n";
  }
  function addToGallery(html, p) {
    var marker = html.indexOf("<!-- NEW PHOTOS GO HERE");
    if (marker < 0) throw new Error("gallery.html is missing the line <!-- NEW PHOTOS GO HERE … -->. Put it back just inside <div class=\"grid\">.");
    var at = html.indexOf("\n", marker) + 1;
    return html.slice(0, at) + block(p) + html.slice(at);
  }
  function addToHome(html, p) {
    var a = html.indexOf("<!-- NEWEST:START -->"), b = html.indexOf("    <!-- NEWEST:END -->");
    if (a < 0 || b < 0) return null;   // home page edited by hand: leave it alone
    a = html.indexOf("\n", a) + 1;
    var items = html.slice(a, b).split("\n").filter(function (l) { return l.trim(); });
    items.unshift("    <a href=\"gallery.html#p-" + p.id + "\" aria-label=\"" + esc(p.title) + " by " + esc(p.by) + "\"><img src=\"photos/" + p.id + "-sm." + p.ext +
      "\" alt=\"\" width=\"" + p.tw + "\" height=\"" + p.th + "\" loading=\"lazy\"></a>");
    return html.slice(0, a) + items.slice(0, 8).join("\n") + "\n" + html.slice(b);
  }

  /* p: title, by, cat, desc, lens, ap, sh, iso, ext, w, h, tw, th, and sub (inbox id) for member photos.
     Resolves with the photo's gallery id. */
  function publish(cfg, p, fullBlob, thumbBlob, onStatus, retried) {
    var branch = cfg.branch || "main", head, baseTree, existing = null;
    onStatus = onStatus || function () {};
    onStatus("Uploading…");
    return api(cfg, "/git/ref/heads/" + branch).then(function (ref) {
      head = ref.object.sha;
      return api(cfg, "/git/commits/" + head);
    }).then(function (commit) {
      baseTree = commit.tree.sha;
      return Promise.all([readText(cfg, "gallery.html", head), readText(cfg, "index.html", head).catch(function () { return null; })]);
    }).then(function (pages) {
      if (p.sub) {   // already published from another phone a moment ago
        var m = pages[0].match(new RegExp('id="t-([a-z0-9-]+)" data-sub="' + p.sub.replace(/[^a-z0-9-]/gi, "") + '"'));
        if (m) { existing = m[1]; return null; }
      }
      var base = slugify(p.title), n = 2;
      p.id = base;
      while (pages[0].indexOf("id=\"p-" + p.id + "\"") >= 0) p.id = base + "-" + n++;
      var gallery = addToGallery(pages[0], p), home = pages[1] && addToHome(pages[1], p);
      return Promise.all([toBase64(fullBlob), toBase64(thumbBlob)]).then(function (b64) {
        var blobs = [
          api(cfg, "/git/blobs", { method: "POST", body: { content: b64[0], encoding: "base64" } }),
          api(cfg, "/git/blobs", { method: "POST", body: { content: b64[1], encoding: "base64" } }),
          api(cfg, "/git/blobs", { method: "POST", body: { content: gallery, encoding: "utf-8" } })
        ];
        if (home) blobs.push(api(cfg, "/git/blobs", { method: "POST", body: { content: home, encoding: "utf-8" } }));
        return Promise.all(blobs);
      });
    }).then(function (b) {
      if (!b) return null;
      var paths = ["photos/" + p.id + "." + p.ext, "photos/" + p.id + "-sm." + p.ext, "gallery.html", "index.html"];
      onStatus("Saving…");
      return api(cfg, "/git/trees", { method: "POST", body: { base_tree: baseTree,
        tree: b.map(function (blob, i) { return { path: paths[i], mode: "100644", type: "blob", sha: blob.sha }; }) } })
        .then(function (tree) {
          return api(cfg, "/git/commits", { method: "POST", body: { message: "Add photo: " + p.title + (p.sub ? " (by " + p.by + ")" : ""), tree: tree.sha, parents: [head] } });
        }).then(function (commit) {
          return api(cfg, "/git/refs/heads/" + branch, { method: "PATCH", body: { sha: commit.sha } });
        });
    }).then(function () { return existing || p.id; }).catch(function (e) {
      if ((e.status === 409 || e.status === 422) && !retried) return publish(cfg, p, fullBlob, thumbBlob, onStatus, true);
      throw e;
    });
  }

  /* points the Share a photo page at the inbox, by writing config.js in the repository */
  function writeConfig(cfg, inbox) {
    var branch = cfg.branch || "main";
    var text = "// Written by the admin page: the address of the club's photo inbox (see inbox/SETUP.md).\n" +
               "window.CLUB_INBOX = " + JSON.stringify(inbox) + ";\n";
    return api(cfg, "/contents/config.js?ref=" + branch).catch(function (e) { if (e.status === 404) return null; throw e; }).then(function (f) {
      if (f && f.content && decode(f.content) === text) return false;
      var body = { message: "Connect the Share a photo page to the inbox", content: encodeText(text), branch: branch };
      if (f) body.sha = f.sha;
      return api(cfg, "/contents/config.js", { method: "PUT", body: body }).then(function () { return true; });
    });
  }

  function checkBranch(cfg) { return api(cfg, "/branches/" + (cfg.branch || "main")); }

  /* the current version of a file in the repository, e.g. gallery.html */
  function readSiteFile(cfg, path) {
    return api(cfg, "/git/ref/heads/" + (cfg.branch || "main")).then(function (ref) { return readText(cfg, path, ref.object.sha); });
  }

  /* replaces Photos of the week on the home page. items: id, title, by, src, w, h, votes */
  function potwHtml(items) {
    return items.map(function (x) {
      return "    <figure class=\"print\">\n" +
        "      <a href=\"gallery.html#p-" + x.id + "\"><img src=\"" + esc(x.src) + "\" alt=\"" + esc(x.title) + "\" width=\"" + x.w + "\" height=\"" + x.h + "\" loading=\"lazy\"></a>\n" +
        "      <h3>" + esc(x.title) + "</h3>\n" +
        "      <figcaption>" + esc(x.by) + ", " + x.votes + (x.votes === 1 ? " vote" : " votes") + "</figcaption>\n" +
        "    </figure>\n";
    }).join("");
  }
  function publishHome(cfg, items, week, retried) {
    var branch = cfg.branch || "main";
    return api(cfg, "/contents/index.html?ref=" + branch).then(function (f) {
      var html = decode(f.content), a = html.indexOf("<!-- POTW:START -->"), b = html.indexOf("    <!-- POTW:END -->");
      if (a < 0 || b < 0) throw new Error("index.html is missing the <!-- POTW:START --> and <!-- POTW:END --> lines around Photos of the week.");
      a = html.indexOf("\n", a) + 1;
      var updated = html.slice(0, a) + potwHtml(items) + html.slice(b);
      return api(cfg, "/contents/index.html", { method: "PUT", body: { message: "Photos of the week (" + week + ")", content: encodeText(updated), sha: f.sha, branch: branch } });
    }).catch(function (e) {
      if ((e.status === 409 || e.status === 422) && !retried) return publishHome(cfg, items, week, true);
      throw e;
    });
  }

  /* replaces marked parts of index.html, e.g. { THEME: "...", CONTESTS: "..." } between <!-- NAME:START --> and <!-- NAME:END --> */
  function replaceSections(html, sections) {
    Object.keys(sections).forEach(function (name) {
      var a = html.indexOf("<!-- " + name + ":START -->"), b = html.indexOf("<!-- " + name + ":END -->");
      if (a < 0 || b < 0) throw new Error("index.html is missing the <!-- " + name + ":START --> and <!-- " + name + ":END --> lines. Put them back around that part of the page.");
      a = html.indexOf("\n", a) + 1;
      html = html.slice(0, a) + sections[name] + html.slice(html.lastIndexOf("\n", b) + 1);
    });
    return html;
  }
  function publishSections(cfg, sections, message, retried) {
    var branch = cfg.branch || "main";
    return api(cfg, "/contents/index.html?ref=" + branch).then(function (f) {
      var updated = replaceSections(decode(f.content), sections);
      return api(cfg, "/contents/index.html", { method: "PUT", body: { message: message, content: encodeText(updated), sha: f.sha, branch: branch } });
    }).catch(function (e) {
      if ((e.status === 409 || e.status === 422) && !retried) return publishSections(cfg, sections, message, true);
      throw e;
    });
  }

  return { publish: publish, writeConfig: writeConfig, checkBranch: checkBranch, slugify: slugify, block: block,
           readSiteFile: readSiteFile, publishHome: publishHome, potwHtml: potwHtml,
           replaceSections: replaceSections, publishSections: publishSections };
})();
