/*
 * The Conscious Frame – photo inbox and members-only gallery
 * A small Cloudflare Worker that keeps members' photos private until an admin approves them,
 * keeps the approved photos in the club's gallery (shown only to members), and stores
 * members' comments and weekly votes. Photos an admin puts in the exhibition (only with the
 * photographer's permission) can be seen by anyone, on the site's Exhibition page.
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
const SERIES = "series";               // long-term series, like Life in Germany
const DEFAULT_SERIES = [{ id: "life-in-germany", name: "Life in Germany", open: true,
  desc: "The club's long-term series: everyday life in Germany as we live it. Streets, kitchens, festivals, train platforms, winter mornings." },
  { id: "from-the-dining-table", name: "From the Dining Table", open: true,
  desc: "Food and the people who make it: family recipes cooked with German ingredients, festival meals, Sunday lunches, the spice shelf, a table set for friends." }];
// Series added to the site later reach clubs that had already saved their own list, once (removing one afterwards sticks)
const SERIES_ADDED = { 2: ["from-the-dining-table"] }, SERIES_VERSION = "2", SERIES_SEEN = "series-version";
const ARCHIVE = "archive";             // each month's theme and most-voted photos, for the theme archive
const REPORTS = "reports";             // comments members have reported to the admins
const REPORTS_PER_DAY = 10;            // per member
const PEOPLE = "people";               // members' lines about themselves, by name, for their photographer pages
const EVENTS = "events";               // photo walks, workshops, exhibitions; sign-ups are kept in rsvp:EVENT
const EVENT_KINDS = ["Photo walk", "Workshop", "Exhibition", "Meet-up", "Other"];
const SIZES = "sizes";                 // sizes of photos added before sizes were kept, for the storage meter
const STORAGE_KB = 1024 * 1024;        // Cloudflare's free plan: 1 GB
const TOTALS = "vote-totals";          // each photo's votes from weeks that are over; this week's are in tally:WEEK

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
  if (parts[0] === "me" && method === "POST" && parts[1] === "profile") return saveProfile(request, env);
  if (parts[0] === "events" && method === "GET" && !parts[1]) return listEvents(url, request, env);
  if (parts[0] === "events" && method === "POST" && parts[1] && parts[2] === "rsvp") return rsvp(request, env, parts[1]);
  if (parts[0] === "submit" && method === "POST") return submit(request, env);
  if (parts[0] === "gallery" && method === "GET") return gallery(request, env);
  if (parts[0] === "exhibition" && method === "GET") return exhibition(env);
  if (parts[0] === "archive" && method === "GET") return archive(request, env);
  if (parts[0] === "report" && method === "POST") return report(request, env);
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
    if (what === "theme" && method === "POST") return saveTheme(request, env);
    if (what === "series" && method === "POST") return saveSeries(request, env);
    if (what === "reports" && method === "GET" && !a) return json({ reports: ((await env.INBOX.get(REPORTS, "json")) || []).map(adminReport) });
    if (what === "reports" && a === "dismiss" && method === "POST") return dismissReport(request, env);
    if (what === "members" && method === "GET" && !a) return listMembers(env);
    if (what === "members" && method === "POST" && !a) return addMember(request, env);
    if (what === "members" && method === "DELETE" && a) return removeMember(env, a);
    if (what === "members" && method === "POST" && a && b === "new-code") return newCode(env, a);
    if (what === "members" && method === "POST" && a && b === "bio") return adminBio(request, env, a);
    if (what === "events" && method === "POST" && !a) return saveEvent(request, env);
    if (what === "events" && method === "DELETE" && a) return deleteEvent(env, a);
    if (what === "storage" && method === "GET") return storage(env);
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
  const series = (await seriesList(env)).filter((s) => s.open).map((s) => ({ id: s.id, name: s.name }));
  return json({ name: m.name, photos: own, weeklyLimit: weeklyLimit(env), series, theme: await entryTheme(env, Date.now()), bio: m.bio || "" });
}

// A member's line about themselves, shown to members on their photographer page
async function saveProfile(request, env) {
  const m = await member(request, env);
  const body = await request.json().catch(() => ({}));
  const bio = clean(body.bio, 200, "line about you");
  await setBio(env, m.code, bio);
  return json({ ok: true, bio });
}
async function adminBio(request, env, raw) {
  const body = await request.json().catch(() => ({}));
  const bio = clean(body.bio, 200, "line");
  if (!(await setBio(env, normalize(raw), bio))) throw fail(404, "That member isn't in the club any more. Refresh the list.");
  return json({ ok: true, bio });
}
async function setBio(env, code, bio) {
  const rec = await env.INBOX.get("member:" + code, "json");
  if (!rec) return false;
  if (bio) rec.bio = bio; else delete rec.bio;
  await env.INBOX.put("member:" + code, JSON.stringify(rec), { metadata: { name: rec.name, created: rec.created } });
  await setPerson(env, rec.name, bio, rec.created);
  return true;
}
async function setPerson(env, name, bio, since) {
  const people = (await env.INBOX.get(PEOPLE, "json")) || {};
  if (bio) people[name] = { bio, since };
  else if (people[name]) delete people[name];
  else return;
  await env.INBOX.put(PEOPLE, JSON.stringify(people));
}

// The theme members can enter now: the newest one published, from last month to next month (as on the home page)
async function entryTheme(env, now) {
  const months = (await env.INBOX.get(ARCHIVE, "json")) || [];
  if (months.some((x) => x.week)) return null;               // archive not converted to months yet
  const cur = monthId(now, env);
  for (const month of [nextMonth(cur), cur, previousMonth(cur)]) {
    const m = months.find((x) => x.month === month && x.theme);
    if (m) return { month, title: m.theme.title };
  }
  return null;
}
function checkMonth(v) {
  v = String(v == null ? "" : v).trim();
  if (v && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw fail(400, "Unknown month.");
  return v;
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
// One or more categories (a photo can be Street and Night), in the order of CATEGORIES
function categories(v) {
  const given = new Set((Array.isArray(v) ? v : [v]).flatMap((x) => String(x == null ? "" : x).split(",")).map((x) => x.trim()).filter(Boolean));
  if (!given.size) throw fail(400, "Choose a category.");
  for (const c of given) if (!CATEGORIES.includes(c)) throw fail(400, "Choose one of the categories.");
  return CATEGORIES.filter((c) => given.has(c));
}
// cat is the first category (as before), cats all of them when there are several
function setCats(x, cats) { x.cat = cats[0]; if (cats.length > 1) x.cats = cats; else delete x.cats; }
function setSeries(x, ids) { if (ids.length) x.series = ids; else delete x.series; }
function catsOf(cats) { return cats.length > 1 ? { cat: cats[0], cats } : { cat: cats[0], cats: undefined }; }
// The text, sizes and both image files of a photo sent as a form (Share a photo, or an admin posting one).
async function photoFields(form) {
  const int = (k) => {
    const v = parseInt(form.get(k), 10);
    if (!(v > 0 && v <= 5000)) throw fail(400, "The photo size information is missing. Choose the photo again.");
    return v;
  };
  const p = {
    title: clean(form.get("title"), 80, "title", true), desc: clean(form.get("desc"), 400, "description"),
    lens: clean(form.get("lens"), 30, "lens"), ap: clean(form.get("ap"), 30, "aperture"), sh: clean(form.get("sh"), 30, "shutter speed"), iso: clean(form.get("iso"), 30, "ISO"),
    w: int("w"), h: int("h"), tw: int("tw"), th: int("th"),
  };
  setCats(p, categories(form.getAll("cat")));
  const full = form.get("full"), thumb = form.get("thumb");
  const fullBytes = await image(full, MAX_FULL, "photo");
  const thumbBytes = await image(thumb, MAX_THUMB, "thumbnail");
  if (thumb.type !== full.type) throw fail(400, "The photo and thumbnail must be the same format.");
  p.ext = full.type === "image/webp" ? "webp" : "jpg";
  return { p, files: { full: fullBytes, thumb: thumbBytes, type: full.type } };
}

async function submit(request, env) {
  const m = await member(request, env);
  const form = await readForm(request);
  const { p, files } = await photoFields(form);
  setSeries(p, await checkSeries(env, form.getAll("series"), true));
  if (form.get("pubOk") === "1") p.pubOk = true;     // the member agrees the photo may go in the public exhibition
  if (form.get("fb") === "share") p.fb = "share";    // "Just sharing": no critique wanted
  if (form.get("entry") === "1") {                    // an entry for the monthly theme
    const t = await entryTheme(env, Date.now());
    if (!t) throw fail(400, "There's no monthly theme to enter at the moment. Untick the theme box and send it again.");
    p.theme = t.month;
  }
  p.kb = Math.round((files.full.byteLength + files.thumb.byteLength) / 1024);
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
  const out = { photo: id, week, perWeek, comments: comments.map((c) => publicComment(c)), votes: (await voteCounts(env, Date.now()))[id] || 0 };
  if (who.code) {
    const [mine, owner] = await Promise.all([env.INBOX.get("v:" + week + ":" + who.code, "json"), env.INBOX.get("owner:" + id)]);
    const votes = mine || [];
    Object.assign(out, { member: who.name, voted: votes.includes(id), votesLeft: Math.max(0, perWeek - votes.length), own: !!owner && who.codes.includes(owner) });
    out.comments = comments.map((c) => publicComment(c, who.codes));
    if (comments.length) {   // which comments this member has already reported
      const reports = (await env.INBOX.get(REPORTS, "json")) || [];
      const mine = new Set(reports.filter((r) => r.photo === id && r.by.some((b) => who.codes.includes(b.code))).map((r) => r.cid));
      for (const c of out.comments) if (mine.has(c.cid)) c.reported = true;
    }
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
  const [list, potw, token, top, series, archived, people] = await Promise.all([env.INBOX.get(GALLERY), env.INBOX.get(POTW), photoToken(env, now), lastWeeksTop(env, now),
    seriesRaw(env), env.INBOX.get(ARCHIVE, "json"), env.INBOX.get(PEOPLE)]);
  const themes = (archived || []).filter((m) => m.month && m.theme).map((m) => ({ month: m.month, title: m.theme.title }));   // newest first
  const cur = monthId(now, env), entry = [nextMonth(cur), cur, previousMonth(cur)].map((mo) => themes.find((t) => t.month === mo)).filter(Boolean)[0] || null;
  const head = { name: who.name, admin: !!who.admin, today: clubDate(now, env), weekStart: weekStart(now, env), week: weekId(now, env),
                 perWeek: votesPerWeek(env), token, top, themes, entry, votes: await voteCounts(env, now) };
  // the list is sent on exactly as stored, without reading it through, which keeps the Worker quick
  const body = JSON.stringify(head).slice(0, -1) + ',"photos":' + (list || "[]") + ',"potw":' + (potw || "null") + ',"series":' + series +
    ',"people":' + (people || "{}") + "}";
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
  await addFinishedWeeks(env, now);
  return { week, items };
}

/* ------------------------------------------------------------------ vote counts */
// Every photo shows how many votes it has, as they come in (who voted for what stays secret).
// This week's counts are recounted from members' votes after each vote; weeks that are over are added to the totals once.
async function voteCounts(env, now) {
  const [totals, tally] = await Promise.all([voteTotals(env, now), env.INBOX.get("tally:" + weekId(now, env), "json")]);
  const out = Object.assign({}, totals.totals);
  for (const [id, n] of Object.entries(tally || {})) out[id] = (out[id] || 0) + n;
  return out;
}
async function voteTotals(env, now) {
  const kept = await env.INBOX.get(TOTALS, "json");
  if (kept) return kept;
  return addFinishedWeeks(env, now, { weeks: [], totals: {} });     // the first time: from all the votes still kept (up to 120 days)
}
async function addFinishedWeeks(env, now, start) {
  const totals = start || (await voteTotals(env, now)), current = weekId(now, env), done = new Set(totals.weeks);
  let added = false;
  for (const k of await listAll(env, "v:")) {
    const week = k.name.split(":")[1];
    if (!/^\d{4}-W\d{2}$/.test(week) || week >= current || done.has(week)) continue;
    if (!totals.weeks.includes(week)) totals.weeks.push(week);
    for (const id of (k.metadata && k.metadata.votes) || []) totals.totals[id] = (totals.totals[id] || 0) + 1;
    added = true;
  }
  if (added || start) {
    totals.weeks = totals.weeks.sort().slice(-40);
    await env.INBOX.put(TOTALS, JSON.stringify(totals));
  }
  return totals;
}
// this week's count for every photo, from members' vote records; fresh = the record just saved (lists can lag a moment)
async function recountWeek(env, week, fresh) {
  const tally = {};
  let seen = false;
  for (const k of await listAll(env, "v:" + week + ":")) {
    const votes = k.name === fresh.key ? (seen = true, fresh.votes) : (k.metadata && k.metadata.votes) || [];
    for (const id of votes) tally[id] = (tally[id] || 0) + 1;
  }
  if (!seen) for (const id of fresh.votes) tally[id] = (tally[id] || 0) + 1;
  await env.INBOX.put("tally:" + week, JSON.stringify(tally), { expirationTtl: 14 * 86400 });
  return tally;
}

/* ------------------------------------------------------------------ the public exhibition */
// The photos in the exhibition, for anyone. Each one comes with its own photo link key, which only
// opens that photo; taking a photo out of the exhibition stops its key working within a day.
async function exhibition(env) {
  const now = Date.now(), step = LINK_HOURS * 3600 * 1000, exp = (Math.floor(now / step) + 2) * step;
  const [list, series] = await Promise.all([env.INBOX.get(GALLERY, "json"), seriesList(env)]);
  const photos = [];
  for (const p of list || []) {
    if (!p.pub) continue;
    const x = { id: p.id, title: p.title, by: p.by, cat: p.cat, w: p.w, h: p.h, tw: p.tw, th: p.th, added: p.added, v: p.v };
    for (const k of ["desc", "lens", "ap", "sh", "iso", "series", "cats"]) if (p[k]) x[k] = p[k];
    x.t = exp.toString(36) + "." + (await sign(env, "public photo " + p.id + " until " + exp));
    photos.push(x);
  }
  return json({ photos, series: series.map((s) => ({ id: s.id, name: s.name, desc: s.desc })) });   // never kept by browsers: a photo taken out goes at once
}

/* ------------------------------------------------------------------ series */
// The series list as stored (text), with any series added to the site since the club saved its own list
async function seriesRaw(env) {
  const [raw, seen] = await Promise.all([env.INBOX.get(SERIES), env.INBOX.get(SERIES_SEEN)]);
  if (!raw) return JSON.stringify(DEFAULT_SERIES);
  if (seen === SERIES_VERSION) return raw;
  let list;
  try { list = JSON.parse(raw); } catch { return raw; }
  for (const [v, ids] of Object.entries(SERIES_ADDED)) {
    if (seen && +seen >= +v) continue;
    for (const id of ids) if (!list.some((x) => x.id === id) && list.length < 12) list.push(DEFAULT_SERIES.find((d) => d.id === id));
  }
  const text = JSON.stringify(list);
  await env.INBOX.put(SERIES, text);
  await env.INBOX.put(SERIES_SEEN, SERIES_VERSION);
  return text;
}
async function seriesList(env) { return JSON.parse(await seriesRaw(env)); }
// A photo's series: none, one or several. Each must exist (and, for members sending a photo, take new photos).
async function checkSeries(env, v, openOnly) {
  const ids = [...new Set((Array.isArray(v) ? v : [v]).flatMap((x) => String(x == null ? "" : x).split(",")).map((x) => x.trim()).filter(Boolean))];
  if (!ids.length) return [];
  const list = await seriesList(env);
  return ids.map((id) => {
    const s = list.find((x) => x.id === id);
    if (!s) throw fail(400, "That series doesn't exist any more. Choose another one.");
    if (openOnly && !s.open) throw fail(400, "The series " + s.name + " isn't taking new photos at the moment.");
    return s.id;
  });
}
// The admin saves the whole list at once: [{ id?, name, desc, open }]. Photos keep their series' id.
async function saveSeries(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.series)) throw fail(400, "No series sent.");
  if (body.series.length > 12) throw fail(400, "Up to 12 series.");
  const out = [], taken = new Set();
  for (const s of body.series) {
    const name = clean(s && s.name, 60, "series name", true), desc = clean(s && s.desc, 300, "series description");
    let id = typeof s.id === "string" && /^[a-z0-9][a-z0-9-]{0,49}$/.test(s.id) ? s.id : slugify(name).replace(/^photo$/, "series");
    const base = id.slice(0, 45);
    for (let n = 2; taken.has(id); n++) id = base + "-" + n;
    taken.add(id);
    out.push({ id, name, desc, open: s.open !== false });
  }
  await env.INBOX.put(SERIES, JSON.stringify(out));
  await env.INBOX.put(SERIES_SEEN, SERIES_VERSION);      // what the admin removed stays removed
  return json({ ok: true, series: out });
}

/* ------------------------------------------------------------------ the theme archive */
// Every month's theme (saved when an admin publishes the home page) and the photos with the most votes that month.
// Votes stay weekly: a month's favourites add up the votes of the weeks that start in it, counted once its last week is over.
async function archive(request, env) {
  await viewer(request, env);
  const now = Date.now();
  const months = await countFinishedMonths(env, await archiveMonths(env, now), now);
  return json({ months, month: monthId(now, env) });
}
async function archiveMonths(env, now) {
  const kept = await env.INBOX.get(ARCHIVE, "json");
  if (kept && !kept.some((x) => x.week)) return kept;
  // the first time, or an archive from when themes were weekly: start it from the votes still kept (up to 120 days)
  const months = [];
  for (const w of kept || []) {
    if (!w.theme || !/^\d{4}-W\d{2}$/.test(w.week)) continue;
    const month = mondayOf(w.week).slice(0, 7), m = months.find((x) => x.month === month);
    if (m) { if (w.week > m.from) Object.assign(m, { theme: w.theme, from: w.week }); }
    else months.push({ month, theme: w.theme, from: w.week });
  }
  for (const m of months) delete m.from;
  return countFinishedMonths(env, months, now, true);
}
// Adds the most-voted photos to months whose weeks are all over. Writes only when something changed.
async function countFinishedMonths(env, months, now, always) {
  const done = weekStart(now, env).slice(0, 7);          // months before the one this week started in are finished
  const vote = (k) => { const week = k.name.split(":")[1]; return /^\d{4}-W\d{2}$/.test(week) ? mondayOf(week).slice(0, 7) : ""; };
  const prev = previousMonth(done);
  let changed = !!always;
  if (always || !months.some((m) => m.month === prev && m.counted)) {
    const tally = {}, perPhoto = {};
    for (const k of await listAll(env, "v:")) {
      const month = vote(k), votes = (k.metadata && k.metadata.votes) || [];
      for (const id of votes) perPhoto[id] = (perPhoto[id] || 0) + 1;     // every photo's votes, for the theme entries
      if (!month || month >= done || (!always && month !== prev)) continue;
      const t = tally[month] || (tally[month] = {});
      for (const id of votes) t[id] = (t[id] || 0) + 1;
    }
    const gallery = (await env.INBOX.get(GALLERY, "json")) || [];
    const counted = always ? Object.keys(tally).concat(prev in tally ? [] : [prev]) : [prev];
    for (const month of counted) {
      let m = months.find((x) => x.month === month);
      if (!m) { m = { month }; months.push(m); }
      if (m.counted) continue;
      const top = Object.entries(tally[month] || {}).map(([id, votes]) => ({ id, votes })).sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id)).slice(0, 3);
      if (top.length) m.top = top;
      // the theme's most-voted entries
      const best = gallery.filter((p) => p.theme === month && perPhoto[p.id]).map((p) => ({ id: p.id, votes: perPhoto[p.id] }))
        .sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id)).slice(0, 3);
      if (best.length) m.best = best;
      m.counted = true;
    }
    changed = true;
  }
  const out = months.filter((m) => m.theme || (m.top && m.top.length) || m.month === prev).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 240);
  if (changed) await env.INBOX.put(ARCHIVE, JSON.stringify(out));
  return out;
}
// The admin page saves the theme here when it publishes the home page: for this month or next month.
async function saveTheme(request, env) {
  const body = await request.json().catch(() => ({}));
  const now = Date.now(), month = body.which === "next" ? nextMonth(monthId(now, env)) : monthId(now, env);
  const theme = { title: clean(body.title, 80, "theme", true), lede: clean(body.lede, 300, "theme's description") };
  if (!theme.lede) delete theme.lede;
  const months = await archiveMonths(env, now);
  let m = months.find((x) => x.month === month);
  if (!m) { m = { month }; months.push(m); }
  m.theme = theme;
  months.sort((a, b) => b.month.localeCompare(a.month));
  await env.INBOX.put(ARCHIVE, JSON.stringify(months.slice(0, 240)));   // twenty years
  return json({ ok: true, month });
}

// A photo or thumbnail. Pages can't send the invite code with an <img>, so the address carries
// a signed key from /gallery instead. Keys change every 12 hours and stop working after 24.
async function servePhoto(url, env, rawId, size) {
  const id = photoId(rawId);
  const t = url.searchParams.get("t");
  if (!(await checkPhotoToken(env, t)) && !(await checkPhotoToken(env, t, id))) throw fail(403, "This photo is for club members. Sign in to the gallery to see it.");
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
let keyCache = null;
async function sign(env, text) {
  if (!keyCache || keyCache.set !== env.ADMIN_PASSWORD) keyCache = { set: env.ADMIN_PASSWORD, key: await photoKey(env) };
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", keyCache.key, new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...sig.slice(0, 18))).replace(/\+/g, "-").replace(/\//g, "_");
}
async function photoToken(env, now) {
  const step = LINK_HOURS * 3600 * 1000, exp = (Math.floor(now / step) + 2) * step;   // the same key for everyone for 12 hours, so phones can keep photos
  return exp.toString(36) + "." + (await sign(env, "photos until " + exp));
}
// A members' key opens every photo; with an id, checks an exhibition key, which opens only that photo.
async function checkPhotoToken(env, token, id) {
  const [e, sig] = String(token || "").split(".");
  const exp = parseInt(e, 36), now = Date.now(), step = LINK_HOURS * 3600 * 1000;
  if (!sig || !(exp > now && exp - now <= 2 * step)) return false;
  const enc = new TextEncoder(), a = enc.encode(await sign(env, id ? "public photo " + id + " until " + exp : "photos until " + exp)), b = enc.encode(sig);
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
  const entry = { id, title: p.title, by: p.by, cat: p.cat, cats: p.cats, desc: p.desc, lens: p.lens, ap: p.ap, sh: p.sh, iso: p.iso,
                  ext: p.ext, w: p.w, h: p.h, tw: p.tw, th: p.th, added: p.added == null ? clubDate(now, env) : p.added, at: now, v: now.toString(36),
                  series: p.series, pubOk: !!p.pubOk, pub: !!(p.pub && p.pubOk), theme: p.theme, fb: p.fb === "share" ? "share" : "",
                  kb: Math.round((files.full.byteLength + files.thumb.byteLength) / 1024) };
  if (p.sub) entry.sub = p.sub;
  for (const k of ["desc", "lens", "ap", "sh", "iso", "series", "pubOk", "pub", "theme", "fb", "cats"]) if (!entry[k]) delete entry[k];
  if (Array.isArray(entry.series) && !entry.series.length) delete entry.series;
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
  const tally = await recountWeek(env, week, { key, votes }), totals = await voteTotals(env, Date.now());
  return json({ voted: votes.includes(id), votesLeft: perWeek - votes.length, perWeek, week, votes: (totals.totals[id] || 0) + (tally[id] || 0) });
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

// A member reports a comment to the admins. The admins see who reported it and why; the person who wrote it doesn't.
async function report(request, env) {
  const m = await member(request, env);
  const body = await request.json().catch(() => ({}));
  const id = photoId(body.photo), cid = String(body.cid || "").slice(0, 40);
  const c = ((await env.INBOX.get("c:" + id, "json")) || []).find((x) => x.cid === cid);
  if (!c) throw fail(404, "That comment has already been removed.");
  if (m.codes.includes(c.code)) throw fail(400, "That's your own comment. You can delete it instead.");
  const list = (await env.INBOX.get(REPORTS, "json")) || [];
  let r = list.find((x) => x.cid === cid);
  if (r && r.by.some((b) => m.codes.includes(b.code))) return json({ ok: true, already: true });
  const quota = "rq:" + clubDate(Date.now(), env) + ":" + m.code;
  const today = parseInt((await env.INBOX.get(quota)) || "0", 10);
  if (today >= REPORTS_PER_DAY) throw fail(429, "You've reported " + REPORTS_PER_DAY + " comments today. If something needs the admins urgently, contact the club directly.");
  if (!r) { r = { photo: id, cid, name: c.name, text: cut(c.text, 500), at: c.at, by: [] }; list.unshift(r); }
  r.by = r.by.concat({ code: m.code, name: m.name, why: cut(String(body.why || "").trim().replace(/\s+/g, " "), 300), at: Date.now() }).slice(-20);
  await env.INBOX.put(REPORTS, JSON.stringify(list.slice(0, 100)));
  await env.INBOX.put(quota, String(today + 1), { expirationTtl: 2 * 86400 });
  return json({ ok: true });
}
function adminReport(r) {   // members' codes stay in the inbox
  return { photo: r.photo, cid: r.cid, name: r.name, text: r.text, at: r.at, by: r.by.map((b) => ({ name: b.name, why: b.why, at: b.at })) };
}
async function dismissReport(request, env) {
  const body = await request.json().catch(() => ({}));
  await dropReports(env, (r) => r.cid === body.cid);
  return json({ ok: true });
}
async function dropReports(env, test) {
  const list = (await env.INBOX.get(REPORTS, "json")) || [];
  const rest = list.filter((r) => !test(r));
  if (rest.length !== list.length) await env.INBOX.put(REPORTS, JSON.stringify(rest));
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
  await dropReports(env, (r) => r.cid === cid);
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
                ...catsOf(body.cats != null || body.cat != null ? categories(body.cats != null ? body.cats : body.cat) : meta.cats || [meta.cat]),
                desc: clean(body.desc == null ? meta.desc : body.desc, 400, "description"),
                series: body.series == null ? meta.series : await checkSeries(env, body.series),   // a list now; [] is no series
                pubOk: !!(meta.pubOk || body.pubOk === true), pub: body.pub === true,
                theme: body.theme == null ? meta.theme : checkMonth(body.theme), fb: body.fb == null ? meta.fb : body.fb === "share" ? "share" : "" };
    if (p.pub && !p.pubOk) throw fail(409, "Only photos the photographer has agreed to can go in the public exhibition. Ask " + meta.name + " first.");
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
  setSeries(p, await checkSeries(env, form.getAll("series")));
  if (form.get("pub") === "1") p.pub = p.pubOk = true;      // the admin has the photographer's permission
  p.theme = checkMonth(form.get("theme"));
  if (form.get("fb") === "share") p.fb = "share";
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
  if (body.cats != null || body.cat != null) setCats(x, categories(body.cats != null ? body.cats : body.cat));
  if (body.desc != null) { x.desc = clean(body.desc, 400, "description"); if (!x.desc) delete x.desc; }
  if (body.series != null) setSeries(x, await checkSeries(env, body.series));
  if (body.theme != null) { x.theme = checkMonth(body.theme); if (!x.theme) delete x.theme; }
  if (body.fb != null) { if (body.fb === "share") x.fb = "share"; else delete x.fb; }
  if (body.pubOk === true) x.pubOk = true;          // the admin has asked the photographer
  if (body.pub === true) {
    if (!x.pubOk) throw fail(409, "Only photos the photographer has agreed to can go in the public exhibition. Ask " + x.by + " first.");
    x.pub = true;
  } else if (body.pub === false) delete x.pub;
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
  await dropReports(env, (r) => r.photo === id);
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
  const [keys, people] = await Promise.all([listAll(env, "member:"), env.INBOX.get(PEOPLE, "json")]);
  const members = keys.map((k) => ({ code: k.name.slice(7), ...(k.metadata || {}) }));
  for (const m of members) if (people && people[m.name]) m.bio = people[m.name].bio;
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
  const rec = { name: m.name, created: m.created, renewed: now, prev };
  if (m.bio) rec.bio = m.bio;
  await env.INBOX.put("member:" + code, JSON.stringify(rec), { metadata: { name: m.name, created: m.created } });
  const [own, votes] = await Promise.all([env.INBOX.get("own:" + old), env.INBOX.getWithMetadata("v:" + week + ":" + old)]);
  if (own) await env.INBOX.put("own:" + code, own);
  if (votes.value) await env.INBOX.put("v:" + week + ":" + code, votes.value, { metadata: votes.metadata, expirationTtl: 120 * 86400 });
  for (const p of prev) await env.INBOX.put("moved:" + p, code);     // photos they sent earlier, still waiting, follow them
  await Promise.all(["member:" + old, "own:" + old, "v:" + week + ":" + old].map((k) => env.INBOX.delete(k)));
  return json({ code, name: m.name, created: m.created });
}

// For the admin page's backup: one part of the club's records at a time, 250 entries per call
// (a Worker may only make 1,000 storage calls per request).
const EXPORTABLE = ["member:", "c:", "owner:", "own:", "v:", "moved:", "rsvp:"];
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
        if (prefix === "member:" || prefix === "c:" || prefix === "own:" || prefix === "rsvp:") try { value = JSON.parse(raw); } catch { /* keep the text */ }
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
    } else if (key === PEOPLE) {
      if (!v || typeof v !== "object" || Array.isArray(v)) throw fail(400, "The backup's photographer lines can't be read.");
      const people = (await env.INBOX.get(PEOPLE, "json")) || {};
      let n = 0;
      for (const [name, x] of Object.entries(v).slice(0, 2000)) if (!people[name] && x && typeof x.bio === "string") { people[clean(name, 60, "name", true)] = { bio: clean(x.bio, 200, "line"), since: +x.since || 0 }; n++; }
      if (!n) { skipped++; continue; }
      await env.INBOX.put(PEOPLE, JSON.stringify(people));
      merged++;
    } else if (key === EVENTS) {
      if (!Array.isArray(v)) throw fail(400, "The backup's events can't be read.");
      const events = (await env.INBOX.get(EVENTS, "json")) || [], have = new Set(events.map((e) => e.id));
      let n = 0;
      for (const e of v.slice(0, 500)) { if (!e || typeof e.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(e.id) || have.has(e.id)) continue; events.push(eventFields(e, e.id)); n++; }
      if (!n) { skipped++; continue; }
      events.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      await env.INBOX.put(EVENTS, JSON.stringify(events.slice(-500)));
      merged++;
    } else if (prefix === "rsvp:") {
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(rest) || !Array.isArray(v)) throw fail(400, "The backup has a sign-up list that can't be read.");
      if (await env.INBOX.get(key)) { skipped++; continue; }
      await env.INBOX.put(key, JSON.stringify(v.slice(0, 500).filter((x) => x && typeof x.name === "string").map((x) => ({ code: String(x.code || "").slice(0, 32), name: x.name.slice(0, 60), at: +x.at || 0 }))));
      added++;
    } else if (key === SERIES) {
      if (await env.INBOX.get(SERIES)) { skipped++; continue; }
      if (!Array.isArray(v)) throw fail(400, "The backup's series can't be read.");
      const list = v.slice(0, 12).filter((s) => s && /^[a-z0-9][a-z0-9-]{0,49}$/.test(s.id) && typeof s.name === "string")
        .map((s) => ({ id: s.id, name: clean(s.name, 60, "series name", true), desc: clean(s.desc, 300, "series description"), open: s.open !== false }));
      await env.INBOX.put(SERIES, JSON.stringify(list));
      added++;
    } else if (key === ARCHIVE) {
      if (!Array.isArray(v)) throw fail(400, "The backup's theme archive can't be read.");
      const months = await archiveMonths(env, Date.now()), have = new Map(months.map((m) => [m.month, m]));
      const items = (a) => Array.isArray(a) ? a.slice(0, 3).map((x) => ({ id: photoId(x.id), votes: +x.votes || 0 })) : undefined;
      let changed = 0;
      for (const b of v.slice(0, 520)) {
        const month = b && /^\d{4}-\d{2}$/.test(b.month) ? b.month : b && /^\d{4}-W\d{2}$/.test(b.week) ? mondayOf(b.week).slice(0, 7) : "";
        if (!month) continue;
        const m = have.get(month) || { month };
        if (!have.has(month)) { have.set(month, m); months.push(m); }
        if (!m.theme && b.theme && b.theme.title) { m.theme = { title: clean(b.theme.title, 80, "theme", true) }; if (b.theme.lede) m.theme.lede = clean(b.theme.lede, 300, "theme's description"); changed++; }
        if (b.month && !(m.top && m.top.length) && b.top && b.top.length) { m.top = items(b.top); m.counted = true; changed++; }
        if (b.month && !(m.best && m.best.length) && b.best && b.best.length) { m.best = items(b.best); changed++; }
      }
      if (!changed) { skipped++; continue; }
      months.sort((a, b) => b.month.localeCompare(a.month));
      await env.INBOX.put(ARCHIVE, JSON.stringify(months.slice(0, 240)));
      merged++;
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
  const entry = { id, title: p.title, by: clean(form.get("by"), 60, "photographer's name", true), cat: p.cat, cats: p.cats, desc: p.desc, lens: p.lens, ap: p.ap, sh: p.sh, iso: p.iso,
                  ext: p.ext, w: p.w, h: p.h, tw: p.tw, th: p.th, added: /^\d{4}-\d{2}-\d{2}$/.test(added) ? added : "", at, v: Date.now().toString(36) };
  const sub = String(form.get("sub") || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  if (sub) entry.sub = sub;
  const series = form.getAll("series").flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter((x) => /^[a-z0-9][a-z0-9-]{0,49}$/.test(x));
  if (series.length) entry.series = [...new Set(series)];
  const yes = (k) => form.get(k) === "true" || form.get(k) === "1";
  if (yes("pubOk")) { entry.pubOk = true; if (yes("pub")) entry.pub = true; }
  const theme = String(form.get("theme") || "");
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(theme)) entry.theme = theme;
  if (form.get("fb") === "share") entry.fb = "share";
  entry.kb = Math.round((files.full.byteLength + files.thumb.byteLength) / 1024);
  for (const k of ["desc", "lens", "ap", "sh", "iso", "cats"]) if (!entry[k]) delete entry[k];
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
  const rec = await env.INBOX.get("member:" + normalize(code), "json");
  if (rec && rec.bio) await setPerson(env, rec.name, "", rec.created);
  await env.INBOX.delete("member:" + normalize(code));
  return json({ ok: true });
}

/* ------------------------------------------------------------------ events */
// Visitors see the events marked public; members see all of them, who's coming, and can sign up.
async function listEvents(url, request, env) {
  let who = null;
  if (bearer(request)) try { who = await viewer(request, env); } catch (e) { if (e.status !== 401) throw e; }
  const today = clubDate(Date.now(), env);
  const all = ((await env.INBOX.get(EVENTS, "json")) || []).filter((e) => who || e.public);
  const ends = (e) => e.date;
  const upcoming = all.filter((e) => ends(e) >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const past = all.filter((e) => ends(e) < today).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)).slice(0, who && who.admin && url.searchParams.get("all") ? 500 : 12);
  if (who) {
    const lists = await Promise.all(upcoming.concat(past).map((e) => env.INBOX.get("rsvp:" + e.id, "json")));
    upcoming.concat(past).forEach((e, i) => {
      const going = lists[i] || [];
      e.going = going.map((x) => x.name);
      if (who.codes) e.mine = going.some((x) => who.codes.includes(x.code));
    });
  }
  return json({ today, upcoming, past, member: !!(who && !who.admin), admin: !!(who && who.admin) });
}
function eventFields(b, id) {
  const time = (v) => { v = String(v || "").trim(); if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw fail(400, "Times look like 18:30."); return v; };
  const date = String(b.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + "T12:00:00Z"))) throw fail(400, "Choose the date.");
  const kind = EVENT_KINDS.includes(b.kind) ? b.kind : "Other";
  const max = Math.max(0, Math.min(500, parseInt(b.max, 10) || 0));
  const e = { id, title: clean(b.title, 80, "event's name", true), kind, date, start: time(b.start), end: time(b.end), place: clean(b.place, 160, "place"),
              desc: String(b.desc == null ? "" : b.desc).replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(), public: b.public === true, max };
  if (e.desc.length > 800) throw fail(400, "The description is too long (800 characters at most).");
  for (const k of ["start", "end", "place", "desc", "max"]) if (!e[k]) delete e[k];
  return e;
}
async function saveEvent(request, env) {
  const body = await request.json().catch(() => ({}));
  const events = (await env.INBOX.get(EVENTS, "json")) || [];
  const old = body.id ? events.find((e) => e.id === body.id) : null;
  if (body.id && !old) throw fail(404, "That event has been deleted. Refresh the list.");
  let id = old ? old.id : null;
  if (!id) {
    const base = (String(body.date || "").replace(/[^0-9-]/g, "") + "-" + slugify(body.title || "event")).slice(0, 70), taken = new Set(events.map((e) => e.id));
    id = base;
    for (let n = 2; taken.has(id); n++) id = base + "-" + n;
  }
  const e = eventFields(body, id);
  if (old) Object.assign(old, e, { public: e.public }); else events.push(e);
  for (const k of ["start", "end", "place", "desc", "max"]) if (old && !e[k]) delete old[k];
  events.sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
  await env.INBOX.put(EVENTS, JSON.stringify(events.slice(-500)));
  return json({ ok: true, event: old || e });
}
async function deleteEvent(env, id) {
  const events = (await env.INBOX.get(EVENTS, "json")) || [];
  const rest = events.filter((e) => e.id !== id);
  if (rest.length !== events.length) await env.INBOX.put(EVENTS, JSON.stringify(rest));
  await env.INBOX.delete("rsvp:" + String(id).slice(0, 80));
  return json({ ok: true });
}
// "I'm coming": tapping again takes it back. Events with a limit stop taking sign-ups when full.
async function rsvp(request, env, id) {
  const m = await member(request, env);
  const e = ((await env.INBOX.get(EVENTS, "json")) || []).find((x) => x.id === id);
  if (!e) throw fail(404, "That event has been cancelled.");
  if (e.date < clubDate(Date.now(), env)) throw fail(400, "This event is over.");
  const key = "rsvp:" + e.id, going = (await env.INBOX.get(key, "json")) || [];
  const i = going.findIndex((x) => m.codes.includes(x.code));
  if (i >= 0) going.splice(i, 1);
  else {
    if (e.max && going.length >= e.max) throw fail(409, "Sorry, this event is full.");
    going.push({ code: m.code, name: m.name, at: Date.now() });
  }
  await env.INBOX.put(key, JSON.stringify(going));
  return json({ ok: true, mine: i < 0, going: going.map((x) => x.name) });
}

/* ------------------------------------------------------------------ the storage meter */
// How much of Cloudflare's free 1 GB the photos use. Photos added before sizes were kept are measured
// a few at a time (each check measures up to 30), so the admin page asks again until it's done.
async function storage(env) {
  const [list, kept, subs] = await Promise.all([env.INBOX.get(GALLERY, "json"), env.INBOX.get(SIZES, "json"), listAll(env, "sub:")]);
  const photos = list || [], sizes = kept || {};
  const unmeasured = photos.filter((p) => !p.kb && !sizes[p.id]), now = unmeasured.slice(0, 30);
  for (const p of now) {
    const [f, t] = await Promise.all(["full", "thumb"].map((s) => env.INBOX.get("pimg:" + p.id + ":" + s, "arrayBuffer")));
    sizes[p.id] = Math.max(1, Math.round(((f ? f.byteLength : 0) + (t ? t.byteLength : 0)) / 1024));
  }
  if (now.length) {
    const ids = new Set(photos.map((p) => p.id));
    for (const id of Object.keys(sizes)) if (!ids.has(id)) delete sizes[id];
    await env.INBOX.put(SIZES, JSON.stringify(sizes));
  }
  const photosKB = photos.reduce((n, p) => n + (p.kb || sizes[p.id] || 0), 0);
  const measured = photos.filter((p) => p.kb || sizes[p.id]).length;
  const avgKB = measured ? Math.round(photosKB / measured) : 700;
  const waiting = await Promise.all(subs.map((k) => env.INBOX.get(k.name, "json")));
  const pendingKB = waiting.reduce((n, x) => n + ((x && x.kb) || avgKB), 0);
  const usedKB = photosKB + Math.round((photos.length - measured) * avgKB) + pendingKB;
  return json({ usedKB, limitKB: STORAGE_KB, photos: photos.length, photosKB, pending: subs.length, pendingKB, avgKB, measuring: photos.length - measured,
                roomFor: Math.max(0, Math.floor((STORAGE_KB - usedKB) / avgKB)) });
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
// the month in the club's time zone, e.g. 2026-10; the month after or before one
function monthId(ms, env) { return clubDate(ms, env).slice(0, 7); }
function nextMonth(m) { const [y, n] = m.split("-").map(Number); return n === 12 ? (y + 1) + "-01" : y + "-" + String(n + 1).padStart(2, "0"); }
function previousMonth(m) { const [y, n] = m.split("-").map(Number); return n === 1 ? (y - 1) + "-12" : y + "-" + String(n - 1).padStart(2, "0"); }
// the Monday of an ISO week, e.g. 2026-W42 -> 2026-10-12
function mondayOf(week) {
  const [y, w] = week.split("-W").map(Number), jan4 = new Date(Date.UTC(y, 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7);
  return jan4.toISOString().slice(0, 10);
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
