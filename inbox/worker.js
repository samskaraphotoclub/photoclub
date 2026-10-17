/*
 * The Conscious Frame – photo inbox
 * A small Cloudflare Worker that keeps members' photos private until an admin approves them,
 * and stores members' comments and weekly votes.
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
const MAX_COMMENT = 500;               // characters
const COMMENTS_PER_DAY = 20;           // per member
const MAX_COMMENTS_PER_PHOTO = 300;
const RECENT_COMMENTS = 60;            // kept for the admin's Comments tab
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";   // no 0/O or 1/I
const CATEGORIES = ["Landscape", "Nature", "Travel", "Street", "Architecture", "Night", "Abstract"];

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let response;
    try {
      response = await route(request, env);
    } catch (err) {
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
  if (parts[0] === "photo" && method === "GET" && parts[1]) return photoInfo(request, env, parts[1]);
  if (parts[0] === "vote" && method === "POST") return vote(request, env);
  if (parts[0] === "comment" && method === "POST" && !parts[1]) return addComment(request, env);
  if (parts[0] === "comment" && method === "POST" && parts[1] === "delete") {
    const m = await member(request, env);
    const body = await request.json().catch(() => ({}));
    return removeComment(env, body.photo, body.cid, m.code);
  }

  if (parts[0] === "admin") {
    await requireAdmin(request, env);
    const [, what, a, b] = parts;
    if (what === "ping" && method === "GET") return json({ ok: true });
    if (what === "pending" && method === "GET") return pending(env);
    if (what === "photo" && method === "GET" && a && (b === "full" || b === "thumb")) return photo(env, a, b);
    if (what === "decide" && method === "POST" && a) return decide(request, env, a);
    if (what === "members" && method === "GET" && !a) return listMembers(env);
    if (what === "members" && method === "POST" && !a) return addMember(request, env);
    if (what === "members" && method === "DELETE" && a) return removeMember(env, a);
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
  return { code, ...m };
}

async function me(request, env) {
  const m = await member(request, env);
  const own = (await env.INBOX.get("own:" + m.code, "json")) || [];
  return json({ name: m.name, photos: own, weeklyLimit: weeklyLimit(env) });
}

async function submit(request, env) {
  const m = await member(request, env);
  let form;
  try { form = await request.formData(); } catch { throw fail(400, "The photo didn't arrive in one piece. Try again."); }

  const text = (k, max, required) => {
    const v = String(form.get(k) || "").trim().replace(/\s+/g, " ");
    if (required && !v) throw fail(400, k === "title" ? "Add a title." : "Missing " + k + ".");
    if (v.length > max) throw fail(400, "The " + k + " is too long (" + max + " characters at most).");
    return v;
  };
  const int = (k) => {
    const v = parseInt(form.get(k), 10);
    if (!(v > 0 && v <= 5000)) throw fail(400, "The photo size information is missing. Choose the photo again.");
    return v;
  };
  const p = {
    title: text("title", 80, true), desc: text("desc", 400), cat: text("cat", 20, true),
    lens: text("lens", 30), ap: text("ap", 30), sh: text("sh", 30), iso: text("iso", 30),
    w: int("w"), h: int("h"), tw: int("tw"), th: int("th"),
  };
  if (!CATEGORIES.includes(p.cat)) throw fail(400, "Choose one of the categories.");

  const full = form.get("full"), thumb = form.get("thumb");
  const fullBytes = await image(full, MAX_FULL, "photo");
  const thumbBytes = await image(thumb, MAX_THUMB, "thumbnail");
  const ext = full.type === "image/webp" ? "webp" : "jpg";
  if (thumb.type !== full.type) throw fail(400, "The photo and thumbnail must be the same format.");

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
// Anyone can read a photo's comments. With a valid member code, the reply also says
// whether they've voted for it, how many votes they have left and which comments are theirs.
async function photoInfo(request, env, rawId) {
  const id = photoId(rawId);
  const comments = (await env.INBOX.get("c:" + id, "json")) || [];
  const week = weekId(Date.now(), env), perWeek = votesPerWeek(env);
  const out = { photo: id, week, perWeek, comments: comments.map((c) => publicComment(c)) };
  const code = normalize(bearer(request));
  if (code) {
    const m = await env.INBOX.get("member:" + code, "json");
    if (!m) out.signedOut = true;
    else {
      const [mine, owner] = await Promise.all([env.INBOX.get("v:" + week + ":" + code, "json"), env.INBOX.get("owner:" + id)]);
      const votes = mine || [];
      Object.assign(out, { member: m.name, voted: votes.includes(id), votesLeft: Math.max(0, perWeek - votes.length), own: owner === code });
      out.comments = comments.map((c) => publicComment(c, code));
    }
  }
  return json(out);
}

async function vote(request, env) {
  const m = await member(request, env);
  const body = await request.json().catch(() => ({}));
  const id = photoId(body.photo);
  const week = weekId(Date.now(), env), perWeek = votesPerWeek(env), key = "v:" + week + ":" + m.code;
  const votes = (await env.INBOX.get(key, "json")) || [];
  if (votes.includes(id)) votes.splice(votes.indexOf(id), 1);          // voting again takes the vote back
  else {
    if ((await env.INBOX.get("owner:" + id)) === m.code) throw fail(403, "You can't vote for your own photo.");
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
    recent.unshift({ photo: id, cid: c.cid, name: c.name, text: Array.from(c.text).slice(0, 300).join(""), at: c.at });   // whole characters, so smileys aren't cut in half
    await env.INBOX.put("recent-comments", JSON.stringify(recent.slice(0, RECENT_COMMENTS)));
  } catch { /* the admin list is a convenience; the comment itself is saved */ }
  return json({ comment: publicComment(c, m.code) });
}

async function removeComment(env, rawId, cid, code) {
  const id = photoId(rawId);
  const list = (await env.INBOX.get("c:" + id, "json")) || [];
  const i = list.findIndex((c) => c.cid === cid);
  if (i < 0) return json({ ok: true, already: true });
  if (code && list[i].code !== code) throw fail(403, "You can only delete your own comments.");
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

function publicComment(c, code) {
  const out = { cid: c.cid, name: c.name, text: c.text, at: c.at };   // member codes are never shown
  if (code && c.code === code) out.mine = true;
  return out;
}

/* ------------------------------------------------------------------ admin */
async function requireAdmin(request, env) {
  const set = env.ADMIN_PASSWORD || "";
  if (set.length < 12) throw fail(503, "Set an ADMIN_PASSWORD secret of at least 12 characters in the Worker settings.");
  const given = bearer(request);
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(given)), crypto.subtle.digest("SHA-256", enc.encode(set))]);
  if (!given || !crypto.subtle.timingSafeEqual(a, b)) throw fail(401, "Wrong admin password.");
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
  const own = (await env.INBOX.get("own:" + meta.code, "json")) || [];
  const entry = own.find((x) => x.sid === sid);
  const update = { status: decision, decided: Date.now() };
  if (decision === "approved" && body.galleryId) update.galleryId = photoId(body.galleryId);
  if (decision === "declined" && body.note) update.note = String(body.note).trim().slice(0, 300);
  if (entry) Object.assign(entry, update);
  else own.unshift({ sid, title: meta.title, sent: meta.sent, ...update });
  await env.INBOX.put("own:" + meta.code, JSON.stringify(own.slice(0, HISTORY)));
  if (update.galleryId) await env.INBOX.put("owner:" + update.galleryId, meta.code);   // so members can't vote for their own photo
  await Promise.all(["sub:" + sid, "img:" + sid + ":full", "img:" + sid + ":thumb"].map((k) => env.INBOX.delete(k)));
  return json({ ok: true });
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

async function removeMember(env, code) {
  await env.INBOX.delete("member:" + normalize(code));
  return json({ ok: true });
}

/* ------------------------------------------------------------------ helpers */
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGIN || "*").split(",").map((s) => s.trim().replace(/\/+$/, ""));
  const h = { "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type",
              "Access-Control-Max-Age": "86400", Vary: "Origin" };
  if (allowed.includes("*")) h["Access-Control-Allow-Origin"] = "*";
  else if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
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
