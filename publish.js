/* The Conscious Frame – admin only.
   Changes the GitHub repository that hosts the site: the home page text, config.js, and the one-time
   move of photos from the old public gallery. (Photos themselves now live in the members-only inbox.) */
var Publish = (function () {
  "use strict";
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

  /* ---------- moving photos from the old public gallery into the members-only gallery ---------- */
  // The newest version of gallery.html that still has photos in it, or null once the photos folder is gone.
  function findOldGallery(cfg) {
    var branch = cfg.branch || "main";
    return api(cfg, "/contents/photos?ref=" + branch).then(function () {
      return api(cfg, "/commits?path=gallery.html&sha=" + branch + "&per_page=30");
    }, function (e) { if (e.status === 404) return null; throw e; }).then(function (commits) {
      if (!commits) return null;
      var i = 0;
      function next() {
        if (i >= commits.length) return null;
        var sha = commits[i++].sha;
        return readText(cfg, "gallery.html", sha).then(function (html) {
          return html.indexOf('<figure class="tile') >= 0 ? { sha: sha, photos: parseOldGallery(html) } : next();
        });
      }
      return next();
    });
  }
  // The photos in an old gallery.html, newest first, with everything needed to move them.
  function parseOldGallery(html) {
    var doc = new DOMParser().parseFromString(html, "text/html"), out = [];
    doc.querySelectorAll("figure.tile").forEach(function (t) {
      var thumb = t.querySelector(":scope > a img"), full = t.querySelector(".viewer .pic img"), info = t.querySelector(".viewer .info");
      if (!thumb || !full || !info) return;
      var by = (info.querySelector(".by") || {}).textContent || "", cat = by.split(", ").pop();
      var rows = {};
      info.querySelectorAll("dt").forEach(function (dt) { var dd = dt.nextElementSibling; if (dd) rows[dt.textContent.trim()] = dd.textContent.trim(); });
      var src = full.getAttribute("src") || "";
      out.push({
        id: t.id.replace(/^t-/, ""), title: (info.querySelector("h2") || {}).textContent || "", by: by.slice(0, by.length - cat.length - 2) || by,
        cat: cat, desc: (info.querySelector(".desc") || {}).textContent || "", lens: rows.Lens || "", ap: rows.Aperture || "", sh: rows.Shutter || "", iso: rows.ISO || "",
        added: t.getAttribute("data-added") || "", sub: t.getAttribute("data-sub") || "",
        full: src, thumb: thumb.getAttribute("src") || "", ext: /\.webp$/i.test(src) ? "webp" : "jpg",
        w: +full.getAttribute("width") || 1200, h: +full.getAttribute("height") || 800, tw: +thumb.getAttribute("width") || 600, th: +thumb.getAttribute("height") || 400
      });
    });
    return out;
  }
  // One file from the repository as it was at a given commit, as a Blob.
  function fileAt(cfg, sha, path) {
    return fetch("https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + sha, {
      headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" }
    }).then(function (r) {
      if (!r.ok) throw new Error("Couldn't get " + path + " from GitHub (" + r.status + ").");
      return r.blob();
    }, function () { throw new Error("Couldn't reach GitHub. Check your internet connection and try again."); });
  }
  // Deletes every file in a folder (e.g. photos/) in one commit. Resolves with how many were deleted.
  function removeFolder(cfg, folder, message) {
    var branch = cfg.branch || "main", head, baseTree;
    return api(cfg, "/git/ref/heads/" + branch).then(function (ref) {
      head = ref.object.sha;
      return api(cfg, "/git/commits/" + head);
    }).then(function (commit) {
      baseTree = commit.tree.sha;
      return api(cfg, "/git/trees/" + baseTree + "?recursive=1");
    }).then(function (t) {
      var files = t.tree.filter(function (e) { return e.type === "blob" && e.path.indexOf(folder + "/") === 0; });
      if (!files.length) return 0;
      return api(cfg, "/git/trees", { method: "POST", body: { base_tree: baseTree,
        tree: files.map(function (f) { return { path: f.path, mode: "100644", type: "blob", sha: null }; }) } })
        .then(function (tree) { return api(cfg, "/git/commits", { method: "POST", body: { message: message, tree: tree.sha, parents: [head] } }); })
        .then(function (c) { return api(cfg, "/git/refs/heads/" + branch, { method: "PATCH", body: { sha: c.sha } }); })
        .then(function () { return files.length; });
    });
  }

  /* replaces marked parts of index.html, e.g. { THEME: "..." } between <!-- NAME:START --> and <!-- NAME:END --> */
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

  return { writeConfig: writeConfig, checkBranch: checkBranch, readSiteFile: readSiteFile,
           replaceSections: replaceSections, publishSections: publishSections,
           findOldGallery: findOldGallery, parseOldGallery: parseOldGallery, fileAt: fileAt, removeFolder: removeFolder };
})();
