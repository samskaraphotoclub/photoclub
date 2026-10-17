/*
 * The Conscious Frame – photo inbox and members-only gallery
 * A small Cloudflare Worker that keeps members' photos private until an admin approves them,
 * keeps the approved photos in the club's gallery (shown only to members), and stores
 * members' comments and weekly votes.
 *
 * Needs (set in the Cloudflare dashboard, see SETUP.md):
 *   INBOX           KV namespace binding
 *   ADMIN_PASSWORD  secret, at least 12 characters
 *   ALLOWED_ORIGIN  variable, the site's address, e.g. https://yourname.github.io
 * Optional variables:
 *   WEEKLY_LIMIT    photos each member can send per 7 days (default 5)
 *   VOTES_PER_WEEK  votes each member can give per week (default 3)
 *   TIMEZONE        the club's time zone, for when weeks start (default Europe/Berlin)
 */

const MAX_FULL = 3 * 1024 * 1024;      // bytes, large version (the site resizes to ~200–450 KB)
const MAX_THUMB = 600 * 1024;          // bytes, thumbnail
const MAX_WAITING = 10;                // photos per member waiting for approval at once
const HISTORY = 30;                    // decisions each member can see on their page
const MAX_COMMENT = 1000;              // characters (Malayalam needs more of them per word than English)
const COMMENTS_PER_DAY = 20;           // per member
const MAX_COMMENTS_PER_PHOTO = 300;
const RECENT_COMMENTS = 60;            // kept for the admin's Comments tab
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";   // no 0/O or 1/I
const CATEGORIES = ["Landscape", "Nature", "Travel", "Street", "Architecture", "Night", "Abstract"];
const GALLERY = "gallery";             // the approved photos, newest first, kept as one list
const POTW = "potw";                   // Photos of the week, chosen by an admin on Mondays
const LINK_HOURS = 12;                 // photo links work for 12 to 24 hours, then the page gets new ones

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let response;
    try {
      response = await route(request, env);
    } catch (err) {
      if (!err.status && /limit/i.test(String(err && err.message))) {   // e.g. "KV put() limit exceeded for the day"
        err.status = 429;
        err.message = "Cloudflare's free daily limit of saved changes is used up. Try again tomorrow; nothing already saved is lost.";
      }
      response = json({ error: err.status ? err.message : "The inbox had a problem. Try again in a minute." }, err.status || 500);
      if (!err.status) console.error(err);
    }
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    return response;
  },
};

/* ------------------------------------------------------------------ routing */
async function route(request, env) {
  if (!env.INBOX) throw fail(500, "The inbox has no storage connected. Add a KV binding called INBOX in the Worker settings.");
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const method = request.method;

  if (parts[0] === "" && method === "GET") return json({ ok: true, service: "photo inbox" });
  if (parts[0] === "me" && method === "GET") return me(request, env);
  if (parts[0] === "submit" && method === "POST") return submit(request, env);
  if (parts[0] === "gallery" && method === "GET") return gallery(request, env);
  if (parts[0] === "img" && method === "GET" && parts[1] && (parts[2] === "full" || parts[2] === "thumb")) return servePhoto(url, env, parts[1], parts[2]);
  if (parts[0] === "photo" && method === "GET" && parts[1]) return photoInfo(request, env, parts[1]);
  if (parts[0] === "vote" && method === "POST") return vote(request, env);
  if (parts[0] === "comment" && method === "POST" && !parts[1]) return addComment(request, env);
  if (parts[0] === "comment" && method === "POST" && parts[1] === "delete") {
    const m = await member(request, env);
    const body = await request.json().catch(() => ({}));
    return removeComment(env, body.photo, body.cid, m.codes);
  }

  if (parts[0] === "admin") {
    await requireAdmin(request, env);
    const [, what, a, b] = parts;
    if (what === "ping" && method === "GET") return json({ ok: true });
    if (what === "pending" && method === "GET") return pending(env);
    if (what === "photo" && method === "GET" && a && (b === "full" || b === "thumb")) return photo(env, a, b);
    if (what === "decide" && method === "POST" && a) return decide(request, env, a);
    if (what === "post" && method === "POST") return post(request, env);
    if (what === "gallery" && method === "POST" && a) return editPhoto(request, env, a);
    if (what === "gallery" && method === "DELETE" && a) return deletePhoto(env, a);
    if (what === "potw" && method === "POST") return setPotw(request, env);
    if (what === "members" && method === "GET" && !a) return listMembers(env);
    if (what === "members" && method === "POST" && !a) return addMember(request, env);
    if (what === "members" && method === "DELETE" && a) return removeMember(env, a);
    if (what === "members" && method === "POST" && a && b === "new-code") return newCode(env, a);
    if (what === "export" && method === "GET") return exportPart(url, env);
    if (what === "restore" && a === "records" && method === "POST") return restoreRecords(request, env);
    if (what === "restore" && a === "photo" && method === "POST") return restorePhoto(request, env);
    if (what === "votes" && method === "GET") return standings(url, env);
    if (what === "comments" && method === "GET") return json({ comments: (await env.INBOX.get("recent-comments", "json")) || [] });
    if (what === "comment" && a === "delete" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      return removeComment(env, body.photo, body.cid, null);
    }
  }
  throw fail(404, "Not found.");
}

/* ------------------------------------------------------------------ members and photos */
async function member(request, env) {
  const code = normalize(bearer(request));
  if (!code) throw fail(401, "Enter your invite code.");
  const m = await env.INBOX.get("member:" + code, "json");
  if (!m) throw fail(401, "That invite code isn't valid. Check it, or ask the club for a new one.");
  return { code, ...m, codes: [code].concat(m.prev || []) };
}

async function me(request, env) {
  const m = await member(request, env);
  const own = (await env.INBOX.get("own:" + m.code, "json")) || [];
  return json({ name: m.name, photos: own, weeklyLimit: weeklyLimit(env) });
}

async function readForm(request) {
  try { return await request.formData(); } catch { throw fail(400, "The photo didn't arrive in one piece. Try again."); }
}
function clean(v, max, label, required) {
  v = String(v == null ? "" : v).trim().replace(/\s+/g, " ");
  if (required && !v) throw fail(400, label === "title" ? "Add a title." : "Add the " + label + ".");
  if (v.length > max) throw fail(400, "The " + label + " is too long (" + max + " characters at most).");
  return v;
}
function category(v) {
  if (!CATEGORIES.includes(v)) throw fail(400, "Choose one of the categories.");
  return v;
}
// The text, sizes and both image files of a photo sent as a form (Share a photo, or an admin posting one).
async function photoFields(form) {
  const int = (k) => {
    const v = parseInt(form.get(k), 10);
    if (!(v > 0 && v <= 5000)) throw fail(400, "The photo size information is missing. Choose the photo again.");
    return v;
  };
  const p = {
    title: clean(form.get("title"), 80, "title", true), desc: clean(form.get("desc"), 400, "description"), cat: category(clean(form.get("cat"), 20, "category", true)),
    lens: clean(form.get("lens"), 30, "lens"), ap: clean(form.get("ap"), 30, "aperture"), sh: clean(form.get("sh"), 30, "shutter speed"), iso: clean(form.get("iso"), 30, "ISO"),
    w: int("w"), h: int("h"), tw: int("tw"), th: int("th"),
  };
  const full = form.get("full"), thumb = form.get("thumb");
  const fullBytes = await image(full, MAX_FULL, "photo");
  const thumbBytes = await image(thumb, MAX_THUMB, "thumbnail");
  if (thumb.type !== full.type) throw fail(400, "The photo and thumbnail must be the same format.");
  p.ext = full.type === "image/webp" ? "webp" : "jpg";
  return { p, files: { full: fullBytes, thumb: thumbBytes, type: full.type } };
}

async function submit(request, env) {
  const m = await member(request, env);
  const { p, files } = await photoFields(await readForm(request));
  const fullBytes = files.full, thumbBytes = files.thumb, ext = p.ext;
  const full = { type: files.type }, thumb = { type: files.type };

  const own = (await env.INBOX.get("own:" + m.code, "json")) || [];
  const now = Date.now();
  if (own.filter((x) => x.status === "waiting").length >= MAX_WAITING)
    throw fail(429, "You have " + MAX_WAITING + " photos waiting for approval. Wait until some have been checked before sending more.");
  const limit = weeklyLimit(env);
  const recent = own.filter((x) => now - x.sent < 7 * 864e5).length;
  if (recent >= limit) throw fail(429, "You've sent " + limit + " photos in the last 7 days, which is the club's limit. Try again in a few days.");

  const sid = now.toString(36) + "-" + randomString(6).toLowerCase();
  const meta = { sid, code: m.code, name: m.name, ...p, ext, sent: now };
  await env.INBOX.put("img:" + sid + ":full", fullBytes, { metadata: { type: full.type } });
  await env.INBOX.put("img:" + sid + ":thumb", thumbBytes, { metadata: { type: thumb.type } });
  await env.INBOX.put("sub:" + sid, JSON.stringify(meta), { metadata: { code: m.code, sent: now } });
  own.unshift({ sid, title: p.title, status: "waiting", sent: now });
  await env.INBOX.put("own:" + m.code, JSON.stringify(own.slice(0, HISTORY)));
  return json({ ok: true, sid });
}

async function image(file, max, label) {
  if (!file || typeof file === "string") throw fail(400, "The " + label + " is missing. Choose the photo again.");
  if (file.type !== "image/webp" && file.type !== "image/jpeg") throw fail(400, "Only WebP or JPEG photos can be sent.");
  if (file.size > max) throw fail(413, "The " + label + " is too large. Choose the photo again so it can be resized.");
  const bytes = await file.arrayBuffer();
  const b = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  const isJpeg = b[0] === 0xff && b[1] === 0xd8;
  const isWebp = String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP";
  if (!isJpeg && !isWebp) throw fail(400, "That file isn't a photo the club can show.");
  return bytes;
}

/* ------------------------------------------------------------------ comments and votes */
// A photo's comments, for members (and admins). For a member, the reply also says whether
// they've voted for it, how many votes they have left and which comments are theirs.
async function photoInfo(request, env, rawId) {
  const who = await viewer(request, env);
  const id = photoId(rawId);
  const comments = (await env.INBOX.get("c:" + id, "json")) || [];
  const week = weekId(Date.now(), env), perWeek = votesPerWeek(env);
  const out = { photo: id, week, perWeek, comments: comments.map((c) => publicComment(c)) };
  if (who.code) {
    const [mine, owner] = await Promise.all([env.INBOX.get("v:" + week + ":" + who.code, "json"), env.INBOX.get("owner:" + id)]);
    const votes = mine || [];
    Object.assign(out, { member: who.name, voted: votes.includes(id), votesLeft: Math.max(0, perWeek - votes.length), own: !!owner && who.codes.includes(owner) });
    out.comments = comments.map((c) => publicComment(c, who.codes));
  }
  return json(out);
}

/* ------------------------------------------------------------------ the members-only gallery */
// Who is asking: a member (invite code) or an admin (admin password). Anyone else is turned away.
async function viewer(request, env) {
  const given = bearer(request);
  if (!given) throw fail(401, "Sign in with your invite code to see the gallery.");
  const code = normalize(given);
  const m = code ? await env.INBOX.get("member:" + code, "json") : null;
  if (m) return { code, name: m.name, codes: [code].concat(m.prev || []) };
  if (await isAdmin(given, env)) return { admin: true, name: "Admin" };
  throw fail(401, "That invite code isn't valid. Check it, or ask the club for a new one.");
}

// The whole gallery, Photos of the week and a photo link key that works for 12 to 24 hours.
async function gallery(request, env) {
  const who = await viewer(request, env);
  const now = Date.now();
  const [list, potw, token, top] = await Promise.all([env.INBOX.get(GALLERY), env.INBOX.get(POTW), photoToken(env, now), lastWeeksTop(env, now)]);
  const head = { name: who.name, admin: !!who.admin, today: clubDate(now, env), weekStart: weekStart(now, env), week: weekId(now, env),
                 perWeek: votesPerWeek(env), token, top };
  // the list is sent on exactly as stored, without reading it through, which keeps the Worker quick
  const body = JSON.stringify(head).slice(0, -1) + ',"photos":' + (list || "[]") + ',"potw":' + (potw || "null") + "}";
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

// Last week's most-voted photos, best first: [{ id, votes }]. Last week's votes can't change any more,
// so this is worked out once, on the first visit of the week, and kept (one storage write a week).
// This week's votes stay secret until the week is over.
async function lastWeeksTop(env, now) {
  const week = weekId(now - 7 * 864e5, env), key = "top:" + week;
  const kept = await env.INBOX.get(key, "json");
  if (kept) return { week, items: kept.items };
  const tally = {};
  for (const k of await listAll(env, "v:" + week + ":")) for (const id of (k.metadata && k.metadata.votes) || []) tally[id] = (tally[id] || 0) + 1;
  const items = Object.entries(tally).map(([id, votes]) => ({ id, votes })).sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id)).slice(0, 10);
  await env.INBOX.put(key, JSON.stringify({ items }), { expirationTtl: 30 * 86400 });
  return { week, items };
}

// A photo or thumbnail. Pages can't send the invite code with an <img>, so the address carries
// a signed key from /gallery instead. Keys change every 12 hours and stop working after 24.
async function servePhoto(url, env, rawId, size) {
  const id = photoId(rawId);
  if (!(await checkPhotoToken(env, url.searchParams.get("t")))) throw fail(403, "This photo is for club members. Sign in to the gallery to see it.");
  const { value, metadata } = await env.INBOX.getWithMetadata("pimg:" + id + ":" + size, { type: "stream" });
  if (!value) throw fail(404, "This photo isn't in the gallery any more.");
  return new Response(value, { headers: { "Content-Type": (metadata && metadata.type) || "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}

async function photoKey(env) {
  const set = env.ADMIN_PASSWORD || "";
  if (set.length < 12) throw fail(503, "Set an ADMIN_PASSWORD secret of at least 12 characters in the Worker settings.");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("conscious-frame photo links:" + set));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function signExpiry(env, exp) {
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await photoKey(env), new TextEncoder().encode("photos until " + exp)));
  return btoa(String.fromCharCode(...sig.slice(0, 18))).replace(/\+/g, "-").replace(/\//g, "_");
}
async function photoToken(env, now) {
  const step = LINK_HOURS * 3600 * 1000, exp = (Math.floor(now / step) + 2) * step;   // the same key for everyone for 12 hours, so phones can keep photos
  return exp.toString(36) + "." + (await signExpiry(env, exp));
}
async function checkPhotoToken(env, token) {
  const [e, sig] = String(token || "").split(".");
  const exp = parseInt(e, 36), now = Date.now(), step = LINK_HOURS * 3600 * 1000;
  if (!sig || !(exp > now && exp - now <= 2 * step)) return false;
  const enc = new TextEncoder(), a = enc.encode(await signExpiry(env, exp)), b = enc.encode(sig);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

// Puts a photo into the gallery: both images first, then its entry at the top of the list.
// p.id keeps an existing name (when moving photos from the old gallery); p.sub stops one submission going in twice.
async function addToGallery(env, p, files) {
  const list = (await env.INBOX.get(GALLERY, "json")) || [];
  if (p.sub) { const same = list.find((x) => x.sub === p.sub); if (same) return same; }
  if (p.id && p.keepId) { const same = list.find((x) => x.id === p.id); if (same) return same; }
  const taken = new Set(list.map((x) => x.id));
  const base = p.id || slugify(p.title);
  let id = base, n = 2;
  while (taken.has(id)) id = base.slice(0, 70) + "-" + n++;
  const now = Date.now();
  const entry = { id, title: p.title, by: p.by, cat: p.cat, desc: p.desc, lens: p.lens, ap: p.ap, sh: p.sh, iso: p.iso,
                  ext: p.ext, w: p.w, h: p.h, tw: p.tw, th: p.th, added: p.added == null ? clubDate(now, env) : p.added, at: now, v: now.toString(36) };
  if (p.sub) entry.sub = p.sub;
  for (const k of ["desc", "lens", "ap", "sh", "iso"]) if (!entry[k]) delete entry[k];
  await env.INBOX.put("pimg:" + id + ":full", files.full, { metadata: { type: files.type } });
  await env.INBOX.put("pimg:" + id + ":thumb", files.thumb, { metadata: { type: files.type } });
  list.unshift(entry);
  await env.INBOX.put(GALLERY, JSON.stringify(list));
  return entry;
}

async function vote(request, env) {
  const m = await member(request, env);
  const body = await request.json().catch(() => ({}));
  const id = photoId(body.photo);
  const week = weekId(Date.now(), env), perWeek = votesPerWeek(env), key = "v:" + week + ":" + m.code;
  const votes = (await env.INBOX.get(key, "json")) || [];
  if (votes.includes(id)) votes.splice(votes.indexOf(id), 1);          // voting again takes the vote back
  else {
    if (m.codes.includes(await env.INBOX.get("owner:" + id))) throw fail(403, "You can't vote for your own photo.");
    if (votes.length >= perWeek) throw fail(409, "You've used your " + perWeek + " votes this week. Take one back to vote for this photo.");
    votes.push(id);
  }
  // the votes also go in the key's metadata, so the admin's standings need only one list request
  await env.INBOX.put(key, JSON.stringify(votes), { metadata: { votes }, expirationTtl: 120 * 86400 });
  return json({ voted: votes.includes(id), votesLeft: perWeek - votes.length, perWeek, week });
}

async function addComment(request, env) {
  const m = await member(request, env);
  const body = await request.json().catch(() => ({}));
  const id = photoId(body.photo);
  const text = String(body.text || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw fail(400, "Write a comment first.");
  if (text.length > MAX_COMMENT) throw fail(400, "Comments can be up to " + MAX_COMMENT + " characters.");
  const quota = "cq:" + clubDate(Date.now(), env) + ":" + m.code;
  const today = parseInt((await env.INBOX.get(quota)) || "0", 10);
  if (today >= COMMENTS_PER_DAY) throw fail(429, "You've posted " + COMMENTS_PER_DAY + " comments today, which is the club's daily limit. Try again tomorrow.");
  const list = (await env.INBOX.get("c:" + id, "json")) || [];
  if (list.length >= MAX_COMMENTS_PER_PHOTO) throw fail(409, "This photo has reached the comment limit.");
  const c = { cid: Date.now().toString(36) + "-" + randomString(4).toLowerCase(), code: m.code, name: m.name, text, at: Date.now() };
  list.push(c);
  try { await env.INBOX.put("c:" + id, JSON.stringify(list)); }
  catch { throw fail(503, "Someone else commented at the same moment. Post your comment again."); }
  await env.INBOX.put(quota, String(today + 1), { expirationTtl: 2 * 86400 });
  try {
    const recent = (await env.INBOX.get("recent-comments", "json")) || [];
    recent.unshift({ photo: id, cid: c.cid, name: c.name, text: cut(c.text, 300), at: c.at });   // whole letters, so smileys and Malayalam letters aren't cut in half
    await env.INBOX.put("recent-comments", JSON.stringify(recent.slice(0, RECENT_COMMENTS)));
  } catch { /* the admin list is a convenience; the comment itself is saved */ }
  return json({ comment: publicComment(c, m.codes) });
}

async function removeComment(env, rawId, cid, codes) {
  const id = photoId(rawId);
  const list = (await env.INBOX.get("c:" + id, "json")) || [];
  const i = list.findIndex((c) => c.cid === cid);
  if (i < 0) return json({ ok: true, already: true });
  if (codes && !codes.includes(list[i].code)) throw fail(403, "You can only delete your own comments.");
  list.splice(i, 1);
  await env.INBOX.put("c:" + id, JSON.stringify(list));
  try {
    const recent = (await env.INBOX.get("recent-comments", "json")) || [];
    await env.INBOX.put("recent-comments", JSON.stringify(recent.filter((r) => r.cid !== cid)));
  } catch {}
  return json({ ok: true });
}

async function standings(url, env) {
  const now = Date.now();
  const current = weekId(now, env), previous = weekId(now - 7 * 864e5, env);
  const week = url.searchParams.get("week") || current;
  if (!/^\d{4}-W\d{2}$/.test(week)) throw fail(400, "Unknown week.");
  const keys = await listAll(env, "v:" + week + ":");
  const tally = {};
  let voters = 0;
  for (const k of keys) {
    const v = (k.metadata && k.metadata.votes) || [];
    if (v.length) voters++;
    for (const id of v) tally[id] = (tally[id] || 0) + 1;
  }
  const ranking = Object.entries(tally).map(([photo, votes]) => ({ photo, votes }))
    .sort((a, b) => b.votes - a.votes || a.photo.localeCompare(b.photo));
  return json({ week, current, previous, voters, ranking });
}

function publicComment(c, codes) {
  const out = { cid: c.cid, name: c.name, text: c.text, at: c.at };   // member codes are never shown
  if (codes && codes.includes(c.code)) out.mine = true;
  return out;
}

/* ------------------------------------------------------------------ admin */
async function isAdmin(given, env) {
  const set = env.ADMIN_PASSWORD || "";
  if (set.length < 12 || !given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(given)), crypto.subtle.digest("SHA-256", enc.encode(set))]);
  return crypto.subtle.timingSafeEqual(a, b);
}
async function requireAdmin(request, env) {
  if ((env.ADMIN_PASSWORD || "").length < 12) throw fail(503, "Set an ADMIN_PASSWORD secret of at least 12 characters in the Worker settings.");
  if (!(await isAdmin(bearer(request), env))) throw fail(401, "Wrong admin password.");
}

async function pending(env) {
  const keys = await listAll(env, "sub:");
  const subs = (await Promise.all(keys.map((k) => env.INBOX.get(k.name, "json")))).filter(Boolean);
  subs.sort((x, y) => x.sent - y.sent);
  return json({ photos: subs });
}

async function photo(env, sid, size) {
  const { value, metadata } = await env.INBOX.getWithMetadata("img:" + sid + ":" + size, "arrayBuffer");
  if (!value) throw fail(404, "This photo has already been dealt with.");
  return new Response(value, { headers: { "Content-Type": (metadata && metadata.type) || "image/jpeg", "Cache-Control": "private, no-store" } });
}

async function decide(request, env, sid) {
  const body = await request.json().catch(() => ({}));
  const decision = body.decision;
  if (decision !== "approved" && decision !== "declined") throw fail(400, "Choose approve or decline.");
  const meta = await env.INBOX.get("sub:" + sid, "json");
  if (!meta) return json({ ok: true, already: true });            // decided on another device a moment ago
  const update = { status: decision, decided: Date.now() };
  if (decision === "approved") {
    // the admin may have corrected the title, category or description
    const p = { ...meta, by: meta.name, sub: sid,
                title: clean(body.title == null ? meta.title : body.title, 80, "title", true),
                cat: category(body.cat == null ? meta.cat : body.cat),
                desc: clean(body.desc == null ? meta.desc : body.desc, 400, "description") };
    const [full, thumb] = await Promise.all(["full", "thumb"].map((s) => env.INBOX.getWithMetadata("img:" + sid + ":" + s, "arrayBuffer")));
    if (!full.value || !thumb.value) throw fail(409, "This photo's files are missing from the inbox. Decline it and ask the member to send it again.");
    const entry = await addToGallery(env, p, { full: full.value, thumb: thumb.value, type: (full.metadata && full.metadata.type) || "image/jpeg" });
    update.galleryId = entry.id;
  }
  if (decision === "declined" && body.note) update.note = cut(String(body.note).trim(), 300);
  const code = (await env.INBOX.get("moved:" + meta.code)) || meta.code;   // the member may have had a new code since
  const own = (await env.INBOX.get("own:" + code, "json")) || [];
  const entry = own.find((x) => x.sid === sid);
  if (entry) Object.assign(entry, update);
  else own.unshift({ sid, title: meta.title, sent: meta.sent, ...update });
  await env.INBOX.put("own:" + code, JSON.stringify(own.slice(0, HISTORY)));
  if (update.galleryId) await env.INBOX.put("owner:" + update.galleryId, code);   // so members can't vote for their own photo
  await Promise.all(["sub:" + sid, "img:" + sid + ":full", "img:" + sid + ":thumb"].map((k) => env.INBOX.delete(k)));
  return json({ ok: true, id: update.galleryId });
}

// An admin posts a photo straight into the gallery. Also used to move photos from the old public gallery:
// then "id" keeps the photo's old name (so its comments and votes stay with it) and "added" its old date.
async function post(request, env) {
  const form = await readForm(request);
  const { p, files } = await photoFields(form);
  p.by = clean(form.get("by"), 60, "photographer's name", true);
  if (form.get("id")) { p.id = photoId(form.get("id")); p.keepId = true; }
  const added = String(form.get("added") || "");
  if (form.has("added")) p.added = /^\d{4}-\d{2}-\d{2}$/.test(added) ? added : "";
  if (form.get("sub")) p.sub = String(form.get("sub")).replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  const entry = await addToGallery(env, p, files);
  return json({ ok: true, id: entry.id, photo: entry });
}

async function editPhoto(request, env, rawId) {
  const id = photoId(rawId);
  const body = await request.json().catch(() => ({}));
  const list = (await env.INBOX.get(GALLERY, "json")) || [];
  const x = list.find((e) => e.id === id);
  if (!x) throw fail(404, "This photo isn't in the gallery any more.");
  if (body.title != null) x.title = clean(body.title, 80, "title", true);
  if (body.by != null) x.by = clean(body.by, 60, "photographer's name", true);
  if (body.cat != null) x.cat = category(body.cat);
  if (body.desc != null) { x.desc = clean(body.desc, 400, "description"); if (!x.desc) delete x.desc; }
  await env.INBOX.put(GALLERY, JSON.stringify(list));
  return json({ ok: true, photo: x });
}

// Removes a photo from the gallery for good, with its comments.
async function deletePhoto(env, rawId) {
  const id = photoId(rawId);
  const list = (await env.INBOX.get(GALLERY, "json")) || [];
  const rest = list.filter((e) => e.id !== id);
  if (rest.length !== list.length) await env.INBOX.put(GALLERY, JSON.stringify(rest));
  const potw = await env.INBOX.get(POTW, "json");
  if (potw && potw.items && potw.items.some((x) => x.id === id)) {
    potw.items = potw.items.filter((x) => x.id !== id);
    await env.INBOX.put(POTW, JSON.stringify(potw));
  }
  await Promise.all(["pimg:" + id + ":full", "pimg:" + id + ":thumb", "owner:" + id, "c:" + id].map((k) => env.INBOX.delete(k)));
  return json({ ok: true });
}

// Photos of the week: up to three photos from last week's vote, shown on the home page to members.
async function setPotw(request, env) {
  const body = await request.json().catch(() => ({}));
  const week = String(body.week || "");
  if (!/^\d{4}-W\d{2}$/.test(week)) throw fail(400, "Unknown week.");
  const list = (await env.INBOX.get(GALLERY, "json")) || [];
  const ids = new Set(list.map((e) => e.id));
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 3)
    .map((x) => ({ id: photoId(x.id), votes: Math.max(0, parseInt(x.votes, 10) || 0) }))
    .filter((x) => ids.has(x.id));
  if (!items.length) throw fail(400, "None of those photos are in the gallery.");
  const potw = { week, items, at: Date.now() };
  await env.INBOX.put(POTW, JSON.stringify(potw));
  return json({ ok: true, potw });
}

async function listMembers(env) {
  const keys = await listAll(env, "member:");
  const members = keys.map((k) => ({ code: k.name.slice(7), ...(k.metadata || {}) }));
  members.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return json({ members });
}

async function addMember(request, env) {
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  if (!name) throw fail(400, "Enter the member's name.");
  if (name.length > 60) throw fail(400, "That name is too long (60 characters at most).");
  const code = randomString(12);
  const m = { name, created: Date.now() };
  await env.INBOX.put("member:" + code, JSON.stringify(m), { metadata: m });
  return json({ code, ...m });
}

// A new invite code for a member, e.g. when theirs has been shared by mistake. The old code stops
// working at once; their photos, comments, votes and sent-photo history stay theirs.
async function newCode(env, raw) {
  const old = normalize(raw);
  const m = await env.INBOX.get("member:" + old, "json");
  if (!m) throw fail(404, "That member isn't in the club any more. Refresh the list.");
  const code = randomString(12), now = Date.now(), week = weekId(now, env);
  const prev = (m.prev || []).concat(old).slice(-10);
  await env.INBOX.put("member:" + code, JSON.stringify({ name: m.name, created: m.created, renewed: now, prev }), { metadata: { name: m.name, created: m.created } });
  const [own, votes] = await Promise.all([env.INBOX.get("own:" + old), env.INBOX.getWithMetadata("v:" + week + ":" + old)]);
  if (own) await env.INBOX.put("own:" + code, own);
  if (votes.value) await env.INBOX.put("v:" + week + ":" + code, votes.value, { metadata: votes.metadata, expirationTtl: 120 * 86400 });
  for (const p of prev) await env.INBOX.put("moved:" + p, code);     // photos they sent earlier, still waiting, follow them
  await Promise.all(["member:" + old, "own:" + old, "v:" + week + ":" + old].map((k) => env.INBOX.delete(k)));
  return json({ code, name: m.name, created: m.created });
}

// For the admin page's backup: one part of the club's records at a time, 250 entries per call
// (a Worker may only make 1,000 storage calls per request).
const EXPORTABLE = ["member:", "c:", "owner:", "own:", "v:", "moved:"];
async function exportPart(url, env) {
  const prefix = url.searchParams.get("prefix") || "";
  if (!EXPORTABLE.includes(prefix)) throw fail(400, "Unknown part of the backup.");
  const limit = Math.min(250, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 250));
  const page = await env.INBOX.list({ prefix, cursor: url.searchParams.get("cursor") || undefined, limit });
  const entries = prefix === "v:"
    ? page.keys.map((k) => ({ key: k.name, value: (k.metadata && k.metadata.votes) || [] }))   // votes are kept in the key's metadata too
    : await Promise.all(page.keys.map(async (k) => {
        const raw = await env.INBOX.get(k.name);
        let value = raw;                                   // owner: and moved: hold a plain invite code
        if (prefix === "member:" || prefix === "c:" || prefix === "own:") try { value = JSON.parse(raw); } catch { /* keep the text */ }
        return { key: k.name, value };
      }));
  return json({ prefix, entries, cursor: page.list_complete ? null : page.cursor });
}

/* ------------------------------------------------------------------ restoring from a backup */
// Restoring only ever adds what's missing: nothing already in the club is overwritten or deleted,
// and running it twice changes nothing. Comments and members' sent-photo lists are merged.
const CODE_RE = /^[0-9A-Z]{8,32}$/;
async function restoreRecords(request, env) {
  const body = await request.json().catch(() => ({}));
  const entries = Array.isArray(body.entries) ? body.entries.slice(0, 120) : [];
  let added = 0, merged = 0, skipped = 0;
  for (const e of entries) {
    const key = String(e && e.key || ""), v = e && e.value;
    const [prefix, rest] = [key.slice(0, key.indexOf(":") + 1), key.slice(key.indexOf(":") + 1)];
    if (prefix === "member:") {
      if (!CODE_RE.test(rest) || !v || typeof v.name !== "string") throw fail(400, "The backup has a member that can't be read.");
      // never bring back a code that has since been replaced, or one that's still there
      if ((await env.INBOX.get("member:" + rest)) || (await env.INBOX.get("moved:" + rest))) { skipped++; continue; }
      const m = { name: clean(v.name, 60, "name", true), created: +v.created || Date.now() };
      if (Array.isArray(v.prev)) m.prev = v.prev.filter((c) => CODE_RE.test(c)).slice(-10);
      await env.INBOX.put("member:" + rest, JSON.stringify(m), { metadata: { name: m.name, created: m.created } });
      added++;
    } else if (prefix === "c:") {
      const id = photoId(rest);
      const list = (await env.INBOX.get("c:" + id, "json")) || [], have = new Set(list.map((c) => c.cid));
      const extra = (Array.isArray(v) ? v : []).filter((c) => c && typeof c.cid === "string" && !have.has(c.cid) && typeof c.text === "string")
        .map((c) => ({ cid: c.cid.slice(0, 40), code: String(c.code || "").slice(0, 32), name: String(c.name || "").slice(0, 60), text: c.text.slice(0, MAX_COMMENT), at: +c.at || 0 }));
      if (!extra.length) { skipped++; continue; }
      const all = list.concat(extra).sort((x, y) => x.at - y.at).slice(-MAX_COMMENTS_PER_PHOTO);
      await env.INBOX.put("c:" + id, JSON.stringify(all));
      list.length ? merged++ : added++;
    } else if (prefix === "own:") {
      if (!CODE_RE.test(rest)) throw fail(400, "The backup has a record that can't be read.");
      const list = (await env.INBOX.get("own:" + rest, "json")) || [], have = new Set(list.map((x) => x.sid));
      const extra = (Array.isArray(v) ? v : []).filter((x) => x && typeof x.sid === "string" && !have.has(x.sid));
      if (!extra.length) { skipped++; continue; }
      const all = list.concat(extra).sort((x, y) => (y.sent || 0) - (x.sent || 0)).slice(0, HISTORY);
      await env.INBOX.put("own:" + rest, JSON.stringify(all));
      list.length ? merged++ : added++;
    } else if (prefix === "owner:" || prefix === "moved:") {
      const name = prefix === "owner:" ? photoId(rest) : rest;
      if (!CODE_RE.test(name) && prefix === "moved:") throw fail(400, "The backup has a record that can't be read.");
      if (typeof v !== "string" || !CODE_RE.test(v)) throw fail(400, "The backup has a record that can't be read.");
      if (await env.INBOX.get(prefix + name)) { skipped++; continue; }
      await env.INBOX.put(prefix + name, v);
      added++;
    } else if (prefix === "v:") {
      const m = rest.match(/^(\d{4}-W\d{2}):([0-9A-Z]{8,32})$/);
      if (!m || !Array.isArray(v)) throw fail(400, "The backup has a vote that can't be read.");
      if (await env.INBOX.get(key)) { skipped++; continue; }
      const votes = v.map((x) => photoId(x)).slice(0, 10);
      await env.INBOX.put(key, JSON.stringify(votes), { metadata: { votes }, expirationTtl: 120 * 86400 });
      added++;
    } else if (key === POTW) {
      if (await env.INBOX.get(POTW)) { skipped++; continue; }
      if (!v || !/^\d{4}-W\d{2}$/.test(v.week) || !Array.isArray(v.items)) throw fail(400, "The backup's Photos of the week can't be read.");
      await env.INBOX.put(POTW, JSON.stringify({ week: v.week, items: v.items.slice(0, 3).map((x) => ({ id: photoId(x.id), votes: +x.votes || 0 })), at: +v.at || Date.now() }));
      added++;
    } else throw fail(400, "The backup has a record the inbox doesn't know.");
  }
  return json({ ok: true, added, merged, skipped });
}

// One photo from a backup, with its original name, dates and details. Skipped if it's already in the gallery.
async function restorePhoto(request, env) {
  const form = await readForm(request);
  const id = photoId(form.get("id"));
  const list = (await env.INBOX.get(GALLERY, "json")) || [];
  if (list.some((x) => x.id === id)) return json({ ok: true, already: true, id });
  const { p, files } = await photoFields(form);
  const at = parseInt(form.get("at"), 10) || Date.now(), added = String(form.get("added") || "");
  const entry = { id, title: p.title, by: clean(form.get("by"), 60, "photographer's name", true), cat: p.cat, desc: p.desc, lens: p.lens, ap: p.ap, sh: p.sh, iso: p.iso,
                  ext: p.ext, w: p.w, h: p.h, tw: p.tw, th: p.th, added: /^\d{4}-\d{2}-\d{2}$/.test(added) ? added : "", at, v: Date.now().toString(36) };
  const sub = String(form.get("sub") || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  if (sub) entry.sub = sub;
  for (const k of ["desc", "lens", "ap", "sh", "iso"]) if (!entry[k]) delete entry[k];
  await env.INBOX.put("pimg:" + id + ":full", files.full, { metadata: { type: files.type } });
  await env.INBOX.put("pimg:" + id + ":thumb", files.thumb, { metadata: { type: files.type } });
  const fresh = (await env.INBOX.get(GALLERY, "json")) || [];       // read again: the images took a moment
  if (fresh.some((x) => x.id === id)) return json({ ok: true, already: true, id });
  let i = fresh.findIndex((x) => (x.at || 0) < at);                 // back in its place, newest first
  if (i < 0) i = fresh.length;
  fresh.splice(i, 0, entry);
  await env.INBOX.put(GALLERY, JSON.stringify(fresh));
  return json({ ok: true, id, photo: entry });
}

async function removeMember(env, code) {
  await env.INBOX.delete("member:" + normalize(code));
  return json({ ok: true });
}

/* ------------------------------------------------------------------ helpers */
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  // Forgiving about capitals, a trailing slash or a pasted path: keep only scheme + host.
  const allowed = String(env.ALLOWED_ORIGIN || "*").split(",").map((s) => {
    s = s.trim().toLowerCase();
    const m = s.match(/^https?:\/\/[^/]+/);
    return m ? m[0] : s;
  });
  const h = { "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type",
              "Access-Control-Max-Age": "86400", Vary: "Origin" };
  if (allowed.includes("*")) h["Access-Control-Allow-Origin"] = "*";
  else if (origin && allowed.includes(origin.toLowerCase())) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function fail(status, message) { const e = new Error(message); e.status = status; return e; }
function bearer(request) { return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim(); }
function normalize(code) { return String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 32); }
function photoId(x) {
  const v = String(x || "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(v)) throw fail(400, "Unknown photo.");
  return v;
}
function weeklyLimit(env) { const n = parseInt(env.WEEKLY_LIMIT, 10); return n > 0 ? n : 5; }
function votesPerWeek(env) { const n = parseInt(env.VOTES_PER_WEEK, 10); return n > 0 ? n : 3; }
// the club's calendar date, YYYY-MM-DD
function clubDate(ms, env) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: env.TIMEZONE || "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  } catch { return new Date(ms).toISOString().slice(0, 10); }
}
// ISO week in the club's time zone, e.g. 2026-W42 (weeks start on Monday)
function weekId(ms, env) {
  const [y, m, d] = clubDate(ms, env).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);           // the Thursday of this week
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return t.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
}
// the Monday of this week in the club's time zone, YYYY-MM-DD
function weekStart(ms, env) {
  const [y, m, d] = clubDate(ms, env).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}
// a photo's name in links, from its title: "Autumn in Dresden" -> autumn-in-dresden
function slugify(s) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "").slice(0, 50).replace(/-+$/, "") || "photo";
}
// the first n letters of a text, never splitting a letter made of several characters
// (a Malayalam conjunct, an emoji with a skin tone)
function cut(s, n) {
  s = String(s || "");
  if (s.length <= n) return s;
  try {
    const out = [];
    for (const g of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)) { if (out.length >= n) break; out.push(g.segment); }
    return noHalfLetter(out.join(""));
  } catch { return noHalfLetter(Array.from(s).slice(0, n).join("")); }
}
// some systems split a Malayalam conjunct (like ക്ഷ) into two letters: don't end on its first half
function noHalfLetter(s) { return s.replace(/[\u0D00-\u0D7F][\u0D4D\u200C\u200D]+$/, ""); }
function randomString(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
async function listAll(env, prefix) {
  let cursor, out = [];
  do {
    const page = await env.INBOX.list({ prefix, cursor });
    out = out.concat(page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}
