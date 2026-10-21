/*
 * The Conscious Frame – photo inbox and members-only gallery
 * A small Cloudflare Worker that keeps members' photos private until an admin approves them,
 * keeps the approved photos in the club's gallery (shown only to members), and stores
 * members' comments and hearts. Photos an admin puts in the exhibition (only with the
 * photographer's permission) can be seen by anyone, on the site's Exhibition page. Also keeps the
 * club's downloads: posters, cheat sheets and guides the admins share, for everyone or only members.
 *
 * Needs (set in the Cloudflare dashboard, see SETUP.md):
 *   INBOX           KV namespace binding
 *   ADMIN_PASSWORD  secret, at least 12 characters
 *   ALLOWED_ORIGIN  variable, the site's address, e.g. https://yourname.github.io
 * Optional variables:
 *   WEEKLY_LIMIT    photos each member can send per 7 days (default 5)
 *   HEARTS_PER_DAY  hearts each member can give per day (default 20; keeps within the free plan's daily writes)
 *   TIMEZONE        the club's time zone, for when weeks and months start (default Europe/Berlin)
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
const POTW = "potw";                   // Photos of the month, chosen by an admin when a month is over
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
const PEOPLE = "people";               // members' lines about themselves and their pictures, by member ID, for their photographer pages
// Every member has a permanent ID (in member:CODE as "id"), which stays when they change their name or get a new code.
// Photos, comments and event sign-ups carry it, so each shows the member's current name.
const MEMBER_IDS = "member-ids";       // { v, done, m: { ID: { n: name, was: [earlier names], gone: 1 } }, c: { CODE: ID } }; never sent to pages (it has invite codes)
const ID_RE = /^[a-z0-9]{10}$/;
const RENAME_DAYS = 30;                // members can change their own name once in this many days (admins any time)
const RESERVED_NAMES = ["admin", "admins", "administrator", "clubadmin", "theadmin", "theadmins", "moderator", "theconsciousframe", "consciousframe", "samskara", "samskaragermany", "samskaragermanyev"];
const MAX_PICTURE = 200 * 1024;        // bytes, a member's picture (the phone makes it about 20–40 KB); kept in avatar:ID
const EVENTS = "events";               // photo walks, workshops, exhibitions; sign-ups are kept in rsvp:EVENT
const EVENT_KINDS = ["Photo walk", "Workshop", "Exhibition", "Meet-up", "Other"];
const SIZES = "sizes";                 // sizes of photos added before sizes were kept, for the storage meter
const STORAGE_KB = 1024 * 1024;        // Cloudflare's free plan: 1 GB
const HEARTS = "hearts";               // each photo's number of hearts { totals }, worked out again after every heart
const HEARTERS = "hearters";           // { codes }: the invite codes with hearts in h:CODE, so counting needs no list request
// h:CODE = { photoId: "YYYY-MM-DD" }: the photos a member gave a heart, and on which day (one heart per photo, ever)
const FILES = "files";                 // the club's downloads, newest first; each file is in file:ID, its preview in fthumb:ID
const FILE_KINDS = ["Poster", "Cheat sheet", "Guide", "Form", "Other"];
const MAX_FILE = 20 * 1024 * 1024;     // bytes, one download (Cloudflare keeps up to 25 MB in one item)
const MAX_FILES = 100;
// what can be shared, by file ending: its type, and whether browsers open it themselves (the rest are saved)
const FILE_TYPES = {
  pdf: ["application/pdf", true], png: ["image/png", true], jpg: ["image/jpeg", true], jpeg: ["image/jpeg", true], webp: ["image/webp", true],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], odt: ["application/vnd.oasis.opendocument.text"],
  ods: ["application/vnd.oasis.opendocument.spreadsheet"], odp: ["application/vnd.oasis.opendocument.presentation"], zip: ["application/zip"],
};

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

/* ------------------------------------------------------------------ limits kept in memory */
// Best-effort limits in the Worker's memory (each Cloudflare location keeps its own, and it empties now and then).
// They slow down someone guessing the admin password or invite codes, and stop one phone making hundreds of
// changes in a few minutes (which would use up the free plan's 1,000 saves a day), without saving anything themselves.
const recent = new Map();
function seen(key, ms) { const now = Date.now(), list = (recent.get(key) || []).filter((t) => now - t < ms); recent.set(key, list); return list; }
function note(key) {
  const list = recent.get(key) || [];
  list.push(Date.now()); recent.set(key, list);
  if (recent.size > 5000) for (const [k, v] of recent) if (!v.length || Date.now() - v[v.length - 1] > 3600e3) recent.delete(k);
}
const WRONG = 20, WRONG_MS = 15 * 60e3;         // wrong passwords or codes from one address, per quarter of an hour
const CHANGES = 60, CHANGES_MS = 10 * 60e3;     // changes by one member, per 10 minutes
function who(request) { return request.headers.get("CF-Connecting-IP") || ""; }   // the visitor's address, as Cloudflare saw it (visitors can't set it)
function guard(request) {
  const ip = who(request);
  if (ip && seen("wrong:" + ip, WRONG_MS).length >= WRONG) throw fail(429, "Too many wrong codes or passwords from this connection. Wait a quarter of an hour, then try again.");
}
function wrong(request) { const ip = who(request); if (ip) note("wrong:" + ip); }

/* ------------------------------------------------------------------ routing */
async function route(request, env) {
  if (!env.INBOX) throw fail(500, "The inbox has no storage connected. Add a KV binding called INBOX in the Worker settings.");
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const method = request.method;

  if (parts[0] === "" && method === "GET") return json({ ok: true, service: "photo inbox" });
  if (parts[0] === "me" && method === "GET") return me(request, env);
  if (parts[0] === "me" && method === "POST" && parts[1] === "profile") return saveProfile(request, env);
  if (parts[0] === "me" && method === "POST" && parts[1] === "picture") return savePicture(request, env);
  if (parts[0] === "me" && method === "POST" && parts[1] === "name") return renameSelf(request, env);
  if (parts[0] === "avatar" && method === "GET" && parts[1]) return servePicture(url, env, parts[1]);
  if (parts[0] === "events" && method === "GET" && !parts[1]) return listEvents(url, request, env);
  if (parts[0] === "events" && method === "POST" && parts[1] && parts[2] === "rsvp") return rsvp(request, env, parts[1]);
  if (parts[0] === "submit" && method === "POST") return submit(request, env);
  if (parts[0] === "gallery" && method === "GET") return gallery(request, env);
  if (parts[0] === "exhibition" && method === "GET") return exhibition(env);
  if (parts[0] === "archive" && method === "GET") return archive(request, env);
  if (parts[0] === "report" && method === "POST") return report(request, env);
  if (parts[0] === "img" && method === "GET" && parts[1] && (parts[2] === "full" || parts[2] === "thumb")) return servePhoto(url, env, parts[1], parts[2]);
  if (parts[0] === "photo" && method === "GET" && parts[1]) return photoInfo(request, env, parts[1]);
  if (parts[0] === "photo" && method === "POST" && parts[1] && parts[2] === "details") return editOwnPhoto(request, env, parts[1]);
  if (parts[0] === "files" && method === "GET" && !parts[1]) return listFiles(request, env);
  if (parts[0] === "file" && method === "GET" && parts[1] && (!parts[2] || parts[2] === "thumb")) return serveFile(url, env, parts[1], parts[2] === "thumb");
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
    if (what === "archive" && method === "GET" && !a) return adminArchive(env);
    if (what === "archive" && method === "POST" && a) return hideMonth(request, env, a);
    if (what === "series" && method === "POST") return saveSeries(request, env);
    if (what === "reports" && method === "GET" && !a) return adminReports(env);
    if (what === "reports" && a === "dismiss" && method === "POST") return dismissReport(request, env);
    if (what === "members" && method === "GET" && !a) return listMembers(env);
    if (what === "members" && method === "POST" && !a) return addMember(request, env);
    if (what === "members" && method === "DELETE" && a) return removeMember(env, a);
    if (what === "members" && method === "POST" && a && b === "new-code") return newCode(env, a);
    if (what === "members" && method === "POST" && a && b === "bio") return adminBio(request, env, a);
    if (what === "members" && method === "POST" && a && b === "picture") return adminRemovePicture(env, a);
    if (what === "members" && method === "POST" && a && b === "name") return adminRename(request, env, a);
    if (what === "members" && method === "POST" && a && b === "delete-all") return deleteEverything(env, a);
    if (what === "events" && method === "POST" && !a) return saveEvent(request, env);
    if (what === "events" && method === "DELETE" && a) return deleteEvent(env, a);
    if (what === "files" && method === "POST" && !a) return addFile(request, env);
    if (what === "files" && method === "POST" && a) return editFile(request, env, a);
    if (what === "files" && method === "DELETE" && a) return deleteFile(env, a);
    if (what === "storage" && method === "GET") return storage(env);
    if (what === "export" && method === "GET") return exportPart(url, env);
    if (what === "restore" && a === "records" && method === "POST") return restoreRecords(request, env);
    if (what === "restore" && a === "photo" && method === "POST") return restorePhoto(request, env);
    if (what === "restore" && a === "picture" && method === "POST") return restorePicture(request, env);
    if (what === "votes" && method === "GET") return standings(url, env);
    if (what === "comments" && method === "GET") return recentComments(env);
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
  guard(request);
  let m = await env.INBOX.get("member:" + code, "json");
  if (!m || m.del) { wrong(request); throw fail(401, "That invite code isn't valid. Check it, or ask the club for a new one."); }   // (del: being deleted)
  if (request.method === "POST") {
    if (seen("change:" + code, CHANGES_MS).length >= CHANGES) throw fail(429, "That's a lot of changes in a few minutes. Wait a little, then try again.");
    note("change:" + code);
  }
  m = await ensureId(env, code, m);
  return { code, ...m, codes: [code].concat(m.prev || []) };
}

async function me(request, env) {
  const m = await member(request, env);
  const own = (await env.INBOX.get("own:" + m.code, "json")) || [];
  const series = (await seriesList(env)).filter((s) => s.open).map((s) => ({ id: s.id, name: s.name }));
  const people = (await env.INBOX.get(PEOPLE, "json")) || {}, person = people[m.id] || {};
  return json({ name: m.name, id: m.id, renameFrom: renameFrom(m, env), photos: own, weeklyLimit: weeklyLimit(env), series, theme: await entryTheme(env, Date.now()), bio: m.bio || person.bio || "",
                picture: person.av || "", token: person.av ? await photoToken(env, Date.now()) : "" });
}

/* ------------------------------------------------------------------ member IDs and names */
// Saves a member's record. The list of members (each record's metadata) has their name, ID, earlier codes and
// latest earlier names too, so the admin page and the list of who is who needn't open every record.
async function saveMember(env, code, rec) {
  const md = { name: rec.name, created: rec.created };
  if (rec.id) md.id = rec.id;
  if (rec.prev && rec.prev.length) md.prev = rec.prev;
  if (rec.was && rec.was.length) md.was = rec.was.slice(0, 2);
  if (rec.del) md.del = 1;
  const size = () => new TextEncoder().encode(JSON.stringify(md)).length;   // Cloudflare keeps up to 1,024 bytes
  if (size() > 1000 && md.was) md.was = md.was.slice(0, 1);
  if (size() > 1000) delete md.was;
  await env.INBOX.put("member:" + code, JSON.stringify(rec), { metadata: md });
}
function newMemberId() { return randomString(10).toLowerCase(); }
// Members from before IDs get one made from their first code, so it comes out the same however often it's worked out
async function legacyId(code) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("conscious-frame member " + code)));
  return Array.from(b.slice(0, 10), (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("").toLowerCase();
}
async function ensureId(env, code, rec) {
  if (ID_RE.test(rec.id || "")) return rec;
  await memberIndex(env);                                        // the first request after the update gives everyone their ID
  const again = await env.INBOX.get("member:" + code, "json");
  if (again && ID_RE.test(again.id || "")) return again;
  rec.id = await legacyId((rec.prev && rec.prev[0]) || code);    // (a very big club whose turn hasn't come yet)
  await saveMember(env, code, rec);
  await indexMember(env, code, rec);
  return rec;
}

// Who is who, for the inbox only: each member's ID, name and earlier names, and the invite codes they've had
// (comments and sign-ups from before IDs only have the code). Made from the member records the first time,
// and again after a restore; members who left keep their entry (gone), so photos and comments kept keep their name.
async function memberIndex(env) {
  const kept = await env.INBOX.get(MEMBER_IDS, "json");
  if (kept && kept.v === 1 && kept.done) return kept;
  return buildIndex(env, kept);
}
async function buildIndex(env, kept) {
  const index = { v: 1, done: true, m: {}, c: {} };
  if (kept && kept.m) for (const [id, x] of Object.entries(kept.m)) if (x && x.gone) index.m[id] = x;
  if (kept && kept.c) for (const [code, id] of Object.entries(kept.c)) if (index.m[id]) index.c[code] = id;
  let opened = 0;
  for (const k of await listAll(env, "member:")) {
    const code = k.name.slice(7);
    let x = k.metadata || {};
    if (!ID_RE.test(x.id || "")) {
      if (opened >= 300) { index.done = false; continue; }       // a very big club: the rest on the next request
      const rec = await env.INBOX.get(k.name, "json"); opened++;
      if (!rec) continue;
      if (!ID_RE.test(rec.id || "")) rec.id = await legacyId((rec.prev && rec.prev[0]) || code);
      await saveMember(env, code, rec);
      x = rec;
    }
    index.m[x.id] = entryFor(code, x);
    for (const c of [code].concat(x.prev || [])) index.c[c] = x.id;
  }
  await linkGallery(env, index);
  await linkPeople(env, index);
  await linkNotes(env, index);
  await env.INBOX.put(MEMBER_IDS, JSON.stringify(index));
  return index;
}
function entryFor(code, rec) {   // k: their code now
  const e = { n: rec.name, k: code };
  if (rec.was && rec.was.length) e.was = rec.was.slice(0, 5);
  return e;
}
// adds or updates one member in the list of who is who
async function indexMember(env, code, rec) {
  const index = await memberIndex(env);
  index.m[rec.id] = entryFor(code, rec);
  for (const c of [code].concat(rec.prev || [])) index.c[c] = rec.id;
  await env.INBOX.put(MEMBER_IDS, JSON.stringify(index));
  return index;
}
// Photos and photographer lines from before IDs get their member's ID, found by name
// (if two members have the same name, by who sent the photo)
async function linkGallery(env, index) {
  const list = (await env.INBOX.get(GALLERY, "json")) || [];
  let changed = false;
  for (const p of list) {
    if (p.uid) continue;
    let ids = idsNamed(index, p.by);
    if (ids.length > 1) { const owner = await env.INBOX.get("owner:" + p.id); ids = ids.filter((id) => owner && index.c[owner] === id); }
    if (ids.length === 1) { p.uid = ids[0]; changed = true; }
  }
  if (changed) await env.INBOX.put(GALLERY, JSON.stringify(list));
}
async function linkPeople(env, index) {
  const people = (await env.INBOX.get(PEOPLE, "json")) || {};
  let changed = false;
  for (const [k, x] of Object.entries(people)) {
    if (index.m[k]) continue;
    const ids = idsNamed(index, k);
    if (ids.length !== 1) continue;
    people[ids[0]] = Object.assign({}, x, people[ids[0]]);
    delete people[k]; changed = true;
  }
  if (changed) await env.INBOX.put(PEOPLE, JSON.stringify(people));
}
// The admins' lists of recent and reported comments, from before IDs: who wrote each one, from the comment itself
async function linkNotes(env, index) {
  const [recent, reports] = await Promise.all([env.INBOX.get("recent-comments", "json"), env.INBOX.get(REPORTS, "json")]);
  const photos = [...new Set((recent || []).concat(reports || []).filter((r) => !r.uid && r.photo).map((r) => r.photo))].slice(0, 150);
  const comments = {};
  for (const id of photos) comments[id] = (await env.INBOX.get("c:" + id, "json")) || [];
  const author = (r) => { const c = (comments[r.photo] || []).find((x) => x.cid === r.cid); return c ? idOf(index, c) : ""; };
  let a = false, b = false;
  for (const r of recent || []) if (!r.uid) { const u = author(r); if (u) { r.uid = u; a = true; } }
  for (const r of reports || []) {
    if (!r.uid) { const u = author(r); if (u) { r.uid = u; b = true; } }
    for (const x of r.by || []) if (!x.uid && index.c[x.code]) { x.uid = index.c[x.code]; b = true; }
  }
  if (a) await env.INBOX.put("recent-comments", JSON.stringify(recent));
  if (b) await env.INBOX.put(REPORTS, JSON.stringify(reports));
}
// The name to show for something a member did: from their ID (or the code it was done with), else the name kept with it
function nameIn(index, x) {
  const id = idOf(index, x);
  return (id && index.m[id] && index.m[id].n) || x.name || "";
}
function idOf(index, x) { return (x.uid && index.m[x.uid]) ? x.uid : index.c[x.code] || x.uid || ""; }
function idsNamed(index, name) {   // members in the club with this name
  const key = nameKey(name);
  return Object.keys(index.m).filter((id) => !index.m[id].gone && nameKey(index.m[id].n) === key);
}
// a people key from a backup (a member's ID, or a name from before IDs) as it should be kept now
function personKey(index, k) {
  if (index.m[k]) return k;
  const ids = idsNamed(index, k);
  return ids.length === 1 ? ids[0] : k;
}

// "Mara K." and "mara k" are the same name; so are names that differ only in spaces, dots, dashes or emoji
function nameKey(s) { return String(s || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}\p{Cf}]+/gu, ""); }
function memberName(v, empty) {
  const name = String(v == null ? "" : v).normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(BIDI, "").trim().replace(/\s+/g, " ");
  if (!name) throw fail(400, empty);
  if (name.length > 60) throw fail(400, "That name is too long (60 characters at most).");
  if (!/\p{L}/u.test(name) || nameKey(name).length < 2) throw fail(400, "A name needs at least two letters.");
  return name;
}
// The name of the member already using this one (ignoring capitals, spaces and dots), or "".
// Checks the list of members and the list of who is who, as a member just added may take a minute to show in the first.
async function nameClash(env, name, selfCode) {
  const key = nameKey(name);
  const [keys, index] = await Promise.all([listAll(env, "member:"), memberIndex(env)]);
  const self = selfCode ? index.c[selfCode] : "";
  for (const k of keys) {
    const md = k.metadata || {};
    if (k.name.slice(7) === selfCode || md.del || (self && md.id === self)) continue;
    if (nameKey(md.name) === key) return md.name;
  }
  for (const [id, x] of Object.entries(index.m)) if (id !== self && !x.gone && nameKey(x.n) === key) return x.n;
  return "";
}
// The day a member may change their name again ("" if they can now)
function renameFrom(rec, env) {
  const until = (rec.renamed || 0) + RENAME_DAYS * 864e5;
  return rec.renamed && Date.now() < until ? clubDate(until, env) : "";
}

// A member changes their own name: one nobody else in the club uses, once a month
// (only changing capitals or spaces, like "mara" to "Mara", doesn't count)
async function renameSelf(request, env) {
  const m = await member(request, env);
  const body = await request.json().catch(() => ({}));
  const name = memberName(body.name, "Enter your name.");
  let rec = await env.INBOX.get("member:" + m.code, "json");
  if (!rec || rec.del) throw fail(401, "That invite code isn't valid. Check it, or ask the club for a new one.");
  if (name === rec.name) return json({ ok: true, name, renameFrom: renameFrom(rec, env) });
  const small = nameKey(name) === nameKey(rec.name);
  if (!small) {
    if (RESERVED_NAMES.includes(nameKey(name))) throw fail(400, "That name is kept for the club itself. Choose another one.");
    const from = renameFrom(rec, env);
    if (from) throw fail(429, "You changed your name on " + niceDay(clubDate(rec.renamed, env)) + ". You can change it again from " + niceDay(from) + ".");
    const clash = await nameClash(env, name, m.code);
    if (clash) throw fail(409, "Someone in the club is already called " + clash + ". Choose another name: adding your surname or an initial usually works.");
    rec.renamed = Date.now();
  }
  rec = await renameMember(env, m.code, rec, name);
  return json({ ok: true, name, renameFrom: renameFrom(rec, env) });
}
// An admin changes a member's name: any time, as long as nobody else uses it
async function adminRename(request, env, raw) {
  const code = normalize(raw);
  let rec = await env.INBOX.get("member:" + code, "json");
  if (!rec || rec.del) throw fail(404, "That member isn't in the club any more. Refresh the list.");
  const body = await request.json().catch(() => ({}));
  const name = memberName(body.name, "Enter the member's name.");
  if (name !== rec.name) {
    const clash = nameKey(name) === nameKey(rec.name) ? "" : await nameClash(env, name, code);
    if (clash) throw fail(409, "There's already a member called " + clash + ". Use another name, for example with their surname or an initial.");
    rec = await renameMember(env, code, rec, name);
  }
  return json({ ok: true, code, name, was: rec.was || [] });
}
// The new name goes on their photos in the gallery first (so if today's saving limit has run out, nothing has changed),
// then in their record and the list of who is who. Comments, sign-ups and their photographer page follow by themselves.
async function renameMember(env, code, rec, name) {
  rec = await ensureId(env, code, rec);
  const list = (await env.INBOX.get(GALLERY, "json")) || [];
  let n = 0;
  for (const p of list) if (p.uid === rec.id && p.by !== name) { p.by = name; n++; }
  if (n) await env.INBOX.put(GALLERY, JSON.stringify(list));
  // earlier names, newest first (fixing capitals or spaces doesn't make one)
  const was = (rec.was || []).filter((w) => nameKey(w) !== nameKey(name));
  rec.was = (nameKey(rec.name) !== nameKey(name) ? [rec.name].concat(was) : was).slice(0, 5);
  if (!rec.was.length) delete rec.was;
  rec.name = name;
  await saveMember(env, code, rec);
  await indexMember(env, code, rec);
  return rec;
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
  let rec = await env.INBOX.get("member:" + code, "json");
  if (!rec || rec.del) return false;
  rec = await ensureId(env, code, rec);
  if (bio) rec.bio = bio; else delete rec.bio;
  await saveMember(env, code, rec);
  await setPerson(env, rec.id, { bio, since: rec.created });
  return true;
}
// changes a member's entry on the photographer pages, kept under their ID: { bio, since, av } (left out: kept; "": removed)
async function setPerson(env, id, change) {
  const people = (await env.INBOX.get(PEOPLE, "json")) || {};
  const p = Object.assign({}, people[id] || {});
  for (const k of ["bio", "since", "av"]) if (change[k] !== undefined) { if (change[k]) p[k] = change[k]; else delete p[k]; }
  if (p.bio || p.av) people[id] = p;
  else if (people[id]) delete people[id];
  else return;
  await env.INBOX.put(PEOPLE, JSON.stringify(people));
}

// A member's picture, shown as a small round icon to members on the Photographers page and their own page.
// The phone crops and resizes it first. Each new picture gets a new name, so phones don't keep showing the old one.
async function savePicture(request, env) {
  const m = await member(request, env);
  const form = await readForm(request);
  if (form.get("remove") === "1") { await dropPicture(env, m.id); return json({ ok: true, picture: "" }); }
  const file = form.get("picture");
  const bytes = await image(file, MAX_PICTURE, "picture");
  const id = randomString(12).toLowerCase(), old = (((await env.INBOX.get(PEOPLE, "json")) || {})[m.id] || {}).av;
  await env.INBOX.put("avatar:" + id, bytes, { metadata: { type: file.type } });
  await setPerson(env, m.id, { av: id, since: m.created });
  if (old) await env.INBOX.delete("avatar:" + old);
  return json({ ok: true, picture: id, token: await photoToken(env, Date.now()) });
}
async function dropPicture(env, id) {
  const old = (((await env.INBOX.get(PEOPLE, "json")) || {})[id] || {}).av;
  if (old) await env.INBOX.delete("avatar:" + old);
  await setPerson(env, id, { av: "" });
}
async function adminRemovePicture(env, raw) {
  const code = normalize(raw);
  let rec = await env.INBOX.get("member:" + code, "json");
  if (!rec) throw fail(404, "That member isn't in the club any more. Refresh the list.");
  rec = await ensureId(env, code, rec);
  await dropPicture(env, rec.id);
  return json({ ok: true });
}
async function servePicture(url, env, id) {
  if (!/^[a-z0-9]{6,20}$/.test(id)) throw fail(404, "Not found.");
  if (!(await checkPhotoToken(env, url.searchParams.get("t")))) throw fail(403, "Pictures are for club members.");
  const { value, metadata } = await env.INBOX.getWithMetadata("avatar:" + id, { type: "stream" });
  if (!value) throw fail(404, "That picture isn't there any more.");
  return new Response(value, { headers: { "Content-Type": (metadata && metadata.type) || "image/webp", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}
// a picture from a backup: kept under its old name, unless the member already has one
// ("name" is the member's ID, or their name in backups from before IDs)
async function restorePicture(request, env) {
  const form = await readForm(request);
  const id = String(form.get("id") || ""), key = personKey(await memberIndex(env), clean(form.get("name"), 60, "name", true));
  if (!/^[a-z0-9]{6,20}$/.test(id)) throw fail(400, "The backup has a picture that can't be read.");
  const people = (await env.INBOX.get(PEOPLE, "json")) || {};
  if (people[key] && people[key].av) return json({ ok: true, already: true });
  const file = form.get("picture");
  await env.INBOX.put("avatar:" + id, await image(file, MAX_PICTURE, "picture"), { metadata: { type: file.type } });
  await setPerson(env, key, { av: id });
  return json({ ok: true });
}

// The theme members can enter now: the newest one published, from last month to next month (as on the home page)
async function entryTheme(env, now) {
  const months = (await env.INBOX.get(ARCHIVE, "json")) || [];
  if (months.some((x) => x.week)) return null;               // archive not converted to months yet
  const cur = monthId(now, env);
  for (const month of [nextMonth(cur), cur, previousMonth(cur)]) {
    const m = months.find((x) => x.month === month && x.theme && !x.hidden);
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
// (also takes out the invisible characters that flip the direction of text, which can make one name look like another)
const BIDI = /[\u202a-\u202e\u2066-\u2069]/g;
function clean(v, max, label, required) {
  v = String(v == null ? "" : v).replace(BIDI, "").trim().replace(/\s+/g, " ");
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
  const meta = { sid, code: m.code, uid: m.id, name: m.name, ...p, ext, sent: now };
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
  const [comments, index] = await Promise.all([env.INBOX.get("c:" + id, "json").then((x) => x || []), memberIndex(env)]);
  const out = { photo: id, comments: comments.map((c) => publicComment(c, null, index)), votes: (await heartCounts(env))[id] || 0, perDay: heartsPerDay(env) };
  if (who.code) {
    const [recs, owner] = await Promise.all([Promise.all(who.codes.map((c) => env.INBOX.get("h:" + c, "json"))), env.INBOX.get("owner:" + id)]);
    const day = recs.map((r) => r && r[id]).find(Boolean) || null;    // the day this member gave it a heart
    Object.assign(out, { member: who.name, voted: !!day, day, canUndo: !!day && day === clubDate(Date.now(), env), own: !!owner && who.codes.includes(owner) });
    out.comments = comments.map((c) => publicComment(c, who.codes, index));
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
  guard(request);
  const code = normalize(given);
  let m = code ? await env.INBOX.get("member:" + code, "json") : null;
  if (m && !m.del) { m = await ensureId(env, code, m); return { code, id: m.id, name: m.name, codes: [code].concat(m.prev || []) }; }
  if (await isAdmin(given, env)) return { admin: true, name: "Admin" };
  wrong(request);
  throw fail(401, "That invite code isn't valid. Check it, or ask the club for a new one.");
}

// The whole gallery, Photos of the month, each photo's hearts and a photo link key that works for 12 to 24 hours.
async function gallery(request, env) {
  const who = await viewer(request, env);
  const now = Date.now();
  const index = await memberIndex(env);                // (the first time after the update, this gives photos their photographer's ID)
  const [list, potw, token, top, series, archived, people] = await Promise.all([env.INBOX.get(GALLERY), env.INBOX.get(POTW), photoToken(env, now), lastMonthsTop(env, now),
    seriesRaw(env), env.INBOX.get(ARCHIVE, "json"), env.INBOX.get(PEOPLE, "json")]);
  const themes = (archived || []).filter((m) => m.month && m.theme && !m.hidden).map((m) => ({ month: m.month, title: m.theme.title }));   // newest first
  const cur = monthId(now, env), entry = [nextMonth(cur), cur, previousMonth(cur)].map((mo) => themes.find((t) => t.month === mo)).filter(Boolean)[0] || null;
  // monthStart: for the "This month" filter (older pages call it weekStart); votes: each photo's number of hearts
  const head = { name: who.name, admin: !!who.admin, today: clubDate(now, env), monthStart: cur + "-01", weekStart: cur + "-01", month: cur,
                 perDay: heartsPerDay(env), token, top, themes, entry, votes: await heartCounts(env) };
  // the list is sent on exactly as stored, without reading it through, which keeps the Worker quick.
  // people: each photographer's line and picture by their current name; was: earlier names, so old links to their page still work
  const byName = {}, was = {};
  for (const [k, x] of Object.entries(people || {})) if (!index.m[k]) byName[k] = x;          // (from before IDs, not matched to a member)
  for (const [k, x] of Object.entries(people || {})) if (index.m[k] && !index.m[k].gone) byName[index.m[k].n] = x;
  const inUse = new Set(Object.values(index.m).filter((x) => !x.gone).map((x) => nameKey(x.n)));
  for (const x of Object.values(index.m)) if (!x.gone) for (const w of x.was || []) if (!inUse.has(nameKey(w)) && !(w in was)) was[w] = x.n;
  const body = JSON.stringify(head).slice(0, -1) + ',"photos":' + (list || "[]") + ',"potw":' + (potw || "null") + ',"series":' + series +
    ',"people":' + JSON.stringify(byName) + ',"was":' + JSON.stringify(was) + "}";
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

// Last month's favourites, best first: { month, items: [{ id, votes }] }, by the hearts given during that month
// (to any photo, old or new). Worked out once, on the first visit of the month, and kept.
async function lastMonthsTop(env, now) {
  const month = previousMonth(monthId(now, env)), key = "top:" + month;
  const kept = await env.INBOX.get(key, "json");
  if (kept) return { month, items: kept.items };
  const items = ranked(heartsIn(await allHearts(env), month)).slice(0, 10);
  await env.INBOX.put(key, JSON.stringify({ items }), { expirationTtl: 40 * 86400 });
  return { month, items };
}
function ranked(tally) {
  return Object.entries(tally).map(([id, votes]) => ({ id, votes })).sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------ hearts */
// A member gives a photo a heart: one per photo, any photo, at any time. It can be taken back on the same day
// (a mis-tap), after that it stays. Each photo shows its number of hearts; who gave them stays secret.
// Each month's favourites are the photos that got the most hearts during that month.
function heartsPerDay(env) { const n = parseInt(env.HEARTS_PER_DAY, 10); return n > 0 ? n : 20; }

// The codes with hearts. The first time, votes from before hearts (weekly or monthly records, kept up to 150 days)
// become hearts, dated the Monday of their week or the 1st of their month.
async function heartIndex(env) {
  const kept = await env.INBOX.get(HEARTERS, "json");
  if (kept) return kept;
  const byCode = {};
  for (const k of await listAll(env, "v:")) {
    const [, period, code] = k.name.split(":");
    const day = /^\d{4}-W\d{2}$/.test(period) ? mondayOf(period) : /^\d{4}-\d{2}$/.test(period) ? period + "-01" : "";
    if (!day || !CODE_RE.test(code || "")) continue;
    const r = byCode[code] || (byCode[code] = {});
    for (const id of (k.metadata && k.metadata.votes) || []) if (!r[id] || day < r[id]) r[id] = day;
  }
  const codes = new Set((await listAll(env, "h:")).map((k) => k.name.slice(2)));     // (and anyone with hearts already, if the list was lost)
  for (const [code, r] of Object.entries(byCode)) { await mergeHearts(env, code, r); codes.add(code); }
  const index = { codes: [...codes] };
  await env.INBOX.put(HEARTERS, JSON.stringify(index));
  return index;
}
// adds hearts to a member's record, keeping the earliest day for each photo
async function mergeHearts(env, code, add) {
  const rec = (await env.INBOX.get("h:" + code, "json")) || {};
  let changed = false;
  for (const [id, day] of Object.entries(add)) if (!rec[id] || day < rec[id]) { rec[id] = day; changed = true; }
  if (changed) await env.INBOX.put("h:" + code, JSON.stringify(rec));
  return changed;
}
async function addHearter(env, index, code) {
  if (index.codes.includes(code)) return;
  index.codes.push(code);
  await env.INBOX.put(HEARTERS, JSON.stringify(index));
}
async function allHearts(env, index) {   // [[code, { photo: day }]]
  index = index || (await heartIndex(env));
  const recs = await Promise.all(index.codes.map((c) => env.INBOX.get("h:" + c, "json")));
  return index.codes.map((c, i) => [c, recs[i] || {}]);
}
function heartsIn(recs, month) {         // hearts given during a month, per photo
  const t = {};
  for (const [, r] of recs) for (const [id, day] of Object.entries(r)) if (String(day).startsWith(month)) t[id] = (t[id] || 0) + 1;
  return t;
}
async function heartCounts(env) {        // each photo's hearts, from the kept counts
  const kept = await env.INBOX.get(HEARTS, "json");
  return kept ? kept.totals : (await recountHearts(env)).totals;
}
// counts every photo's hearts again from members' records; fresh = [code, record] just saved (another place may not see it yet)
async function recountHearts(env, index, fresh) {
  index = index || (await heartIndex(env));
  const recs = await allHearts(env, index);
  if (fresh) { const i = recs.findIndex((x) => x[0] === fresh[0]); if (i >= 0) recs[i] = fresh; else recs.push(fresh); }
  const totals = {};
  for (const [, r] of recs) for (const id of Object.keys(r)) totals[id] = (totals[id] || 0) + 1;
  await env.INBOX.put(HEARTS, JSON.stringify({ totals, at: Date.now() }));
  return { totals, recs };
}
function niceDay(day) {
  try { return new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }); } catch { return day; }
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
// A month's favourites, by the hearts given during it, are counted once the month is over.
async function archive(request, env) {
  await viewer(request, env);
  const now = Date.now();
  const months = await countFinishedMonths(env, await archiveMonths(env, now), now);
  return json({ months: months.filter((m) => !m.hidden), month: monthId(now, env) });   // (hidden: taken out by an admin)
}
// The admin page's list: every month, with the ones taken out of the archive marked hidden
async function adminArchive(env) {
  const now = Date.now();
  return json({ months: await countFinishedMonths(env, await archiveMonths(env, now), now), month: monthId(now, env) });
}
// An admin takes a month that's over out of the archive (say, one with too few entries), or brings it back.
// Its photos stay in the gallery; they just stop being shown as entries for that month's theme. The month stays
// in the record, marked hidden, so it isn't worked out again and can be brought back as it was.
async function hideMonth(request, env, raw) {
  const month = checkMonth(raw), now = Date.now();
  if (!month) throw fail(400, "Unknown month.");
  const body = await request.json().catch(() => ({}));
  const hide = body.hidden !== false;
  if (hide && month >= monthId(now, env)) throw fail(400, "Only months that are over can be taken out of the archive. To change this month's theme, publish another one.");
  const months = await countFinishedMonths(env, await archiveMonths(env, now), now);
  const m = months.find((x) => x.month === month);
  if (!m) throw fail(404, "That month isn't in the archive.");
  if (hide) m.hidden = true; else delete m.hidden;
  await env.INBOX.put(ARCHIVE, JSON.stringify(months));
  return json({ ok: true, month, hidden: !!m.hidden });
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
  const done = monthId(now, env);                        // months before this one are finished
  const prev = previousMonth(done);
  let changed = !!always;
  if (always || !months.some((m) => m.month === prev && m.counted)) {
    const recs = await allHearts(env), perPhoto = {}, tally = {};
    for (const [, r] of recs) for (const [id, day] of Object.entries(r)) {
      perPhoto[id] = (perPhoto[id] || 0) + 1;                // every photo's hearts, for the theme entries
      const month = String(day).slice(0, 7);
      if (month < done && (always || month === prev)) (tally[month] ||= {})[id] = (tally[month][id] || 0) + 1;
    }
    const gallery = (await env.INBOX.get(GALLERY, "json")) || [];
    const counted = always ? Object.keys(tally).concat(prev in tally ? [] : [prev]) : [prev];
    for (const month of counted) {
      let m = months.find((x) => x.month === month);
      if (!m) { m = { month }; months.push(m); }
      if (m.counted) continue;
      const top = ranked(tally[month] || {}).slice(0, 3);
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
  return new Response(value, { headers: { "Content-Type": (metadata && metadata.type) || "image/jpeg", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
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
  const entry = { id, title: p.title, by: p.by, uid: ID_RE.test(p.uid || "") ? p.uid : "", cat: p.cat, cats: p.cats, desc: p.desc, lens: p.lens, ap: p.ap, sh: p.sh, iso: p.iso,
                  ext: p.ext, w: p.w, h: p.h, tw: p.tw, th: p.th, added: p.added == null ? clubDate(now, env) : p.added, at: now, v: now.toString(36),
                  series: p.series, pubOk: !!p.pubOk, pub: !!(p.pub && p.pubOk), theme: p.theme, fb: p.fb === "share" ? "share" : "",
                  kb: Math.round((files.full.byteLength + files.thumb.byteLength) / 1024) };
  if (p.sub) entry.sub = p.sub;
  for (const k of ["uid", "desc", "lens", "ap", "sh", "iso", "series", "pubOk", "pub", "theme", "fb", "cats"]) if (!entry[k]) delete entry[k];
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
  const today = clubDate(Date.now(), env), index = await heartIndex(env);
  const recs = await Promise.all(m.codes.map((c) => env.INBOX.get("h:" + c, "json")));
  const at = m.codes.findIndex((c, i) => recs[i] && recs[i][id]);
  let code = m.code, rec = recs[0] || {};
  if (at >= 0) {                                                     // tapping again takes the heart back, on the day it was given
    code = m.codes[at]; rec = recs[at];
    if (rec[id] !== today) throw fail(409, "You gave this photo a heart on " + niceDay(rec[id]) + ". A heart can only be taken back on the day you give it.");
    delete rec[id];
  } else {
    const [owner, list] = await Promise.all([env.INBOX.get("owner:" + id), env.INBOX.get(GALLERY, "json")]);
    const x = (list || []).find((p) => p.id === id);
    if (m.codes.includes(owner) || (x && x.uid && x.uid === m.id)) throw fail(403, "You can't give your own photo a heart.");
    if (!x) throw fail(404, "This photo isn't in the gallery any more.");
    const perDay = heartsPerDay(env), given = recs.reduce((n, r) => n + Object.values(r || {}).filter((d) => d === today).length, 0);
    if (given >= perDay) throw fail(429, "You've given " + perDay + " hearts today. You can give more tomorrow.");
    rec[id] = today;
  }
  await env.INBOX.put("h:" + code, JSON.stringify(rec));
  await addHearter(env, index, code);
  const { totals } = await recountHearts(env, index, [code, rec]);
  return json({ voted: at < 0, day: at < 0 ? today : null, canUndo: at < 0, votes: totals[id] || 0 });
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
  const c = { cid: Date.now().toString(36) + "-" + randomString(4).toLowerCase(), code: m.code, uid: m.id, name: m.name, text, at: Date.now() };
  list.push(c);
  try { await env.INBOX.put("c:" + id, JSON.stringify(list)); }
  catch { throw fail(503, "Someone else commented at the same moment. Post your comment again."); }
  await env.INBOX.put(quota, String(today + 1), { expirationTtl: 2 * 86400 });
  try {
    const recent = (await env.INBOX.get("recent-comments", "json")) || [];
    recent.unshift({ photo: id, cid: c.cid, uid: m.id, name: c.name, text: cut(c.text, 300), at: c.at });   // whole letters, so smileys and Malayalam letters aren't cut in half
    await env.INBOX.put("recent-comments", JSON.stringify(recent.slice(0, RECENT_COMMENTS)));
  } catch { /* the admin list is a convenience; the comment itself is saved */ }
  return json({ comment: publicComment(c, m.codes, { m: { [m.id]: { n: m.name } }, c: {} }) });
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
  if (!r) { const index = await memberIndex(env); r = { photo: id, cid, uid: idOf(index, c), name: nameIn(index, c), text: cut(c.text, 500), at: c.at, by: [] }; list.unshift(r); }
  r.by = r.by.concat({ code: m.code, uid: m.id, name: m.name, why: cut(String(body.why || "").trim().replace(/\s+/g, " "), 300), at: Date.now() }).slice(-20);
  await env.INBOX.put(REPORTS, JSON.stringify(list.slice(0, 100)));
  await env.INBOX.put(quota, String(today + 1), { expirationTtl: 2 * 86400 });
  return json({ ok: true });
}
async function adminReports(env) {   // members' codes stay in the inbox
  const [list, index] = await Promise.all([env.INBOX.get(REPORTS, "json"), memberIndex(env)]);
  return json({ reports: (list || []).map((r) => ({ photo: r.photo, cid: r.cid, name: nameIn(index, r), text: r.text, at: r.at,
    by: r.by.map((b) => ({ name: nameIn(index, b), why: b.why, at: b.at })) })) });
}
async function recentComments(env) {
  const [list, index] = await Promise.all([env.INBOX.get("recent-comments", "json"), memberIndex(env)]);
  return json({ comments: (list || []).map((r) => ({ photo: r.photo, cid: r.cid, name: nameIn(index, r), text: r.text, at: r.at })) });
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

// A month's ranking for the admin page: the hearts given during it, and how many members gave hearts (never who gave which)
async function standings(url, env) {
  const now = Date.now();
  const current = monthId(now, env), previous = previousMonth(current);
  const month = url.searchParams.get("month") || current;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail(400, "Unknown month.");
  const recs = await allHearts(env);
  const voters = recs.filter(([, r]) => Object.values(r).some((d) => String(d).startsWith(month))).length;
  const ranking = ranked(heartsIn(recs, month)).map((x) => ({ photo: x.id, votes: x.votes }));
  return json({ month, current, previous, voters, ranking });
}

function publicComment(c, codes, index) {
  const out = { cid: c.cid, name: index ? nameIn(index, c) : c.name, text: c.text, at: c.at };   // member codes are never shown
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
  guard(request);
  if (!(await isAdmin(bearer(request), env))) { wrong(request); throw fail(401, "Wrong admin password."); }
}

async function pending(env) {
  const [keys, index] = await Promise.all([listAll(env, "sub:"), memberIndex(env)]);
  const subs = (await Promise.all(keys.map((k) => env.INBOX.get(k.name, "json")))).filter(Boolean);
  for (const x of subs) x.name = nameIn(index, x);
  subs.sort((x, y) => x.sent - y.sent);
  return json({ photos: subs });
}

async function photo(env, sid, size) {
  const { value, metadata } = await env.INBOX.getWithMetadata("img:" + sid + ":" + size, "arrayBuffer");
  if (!value) throw fail(404, "This photo has already been dealt with.");
  return new Response(value, { headers: { "Content-Type": (metadata && metadata.type) || "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

async function decide(request, env, sid) {
  const body = await request.json().catch(() => ({}));
  const decision = body.decision;
  if (decision !== "approved" && decision !== "declined") throw fail(400, "Choose approve or decline.");
  const meta = await env.INBOX.get("sub:" + sid, "json");
  if (!meta) return json({ ok: true, already: true });            // decided on another device a moment ago
  const update = { status: decision, decided: Date.now() };
  if (decision === "approved") {
    // the photographer's name as it is now (they may have changed it since sending), and their ID
    const index = await memberIndex(env);
    meta.name = nameIn(index, meta);
    // the admin may have corrected the title, category or description
    const p = { ...meta, by: meta.name, uid: idOf(index, meta), sub: sid,
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
  const index = await memberIndex(env), ids = idsNamed(index, p.by);
  if (ids.length === 1) { p.uid = ids[0]; p.by = index.m[ids[0]].n; }     // a member's photo: theirs, with their name as it's written
  const entry = await addToGallery(env, p, files);
  if (entry.uid && index.m[entry.uid] && index.m[entry.uid].k && !(await env.INBOX.get("owner:" + entry.id))) await env.INBOX.put("owner:" + entry.id, index.m[entry.uid].k);
  return json({ ok: true, id: entry.id, photo: entry });
}

async function editPhoto(request, env, rawId) {
  const id = photoId(rawId);
  const body = await request.json().catch(() => ({}));
  const list = (await env.INBOX.get(GALLERY, "json")) || [];
  const x = list.find((e) => e.id === id);
  if (!x) throw fail(404, "This photo isn't in the gallery any more.");
  if (body.title != null) x.title = clean(body.title, 80, "title", true);
  let owner;                                           // the photo's new photographer, when it changes: their code, or "" for none
  if (body.by != null) {
    const by = clean(body.by, 60, "photographer's name", true), index = await memberIndex(env), ids = idsNamed(index, by);
    if (ids.length === 1) {                            // a member: the photo becomes theirs (and follows their name)
      x.by = index.m[ids[0]].n;
      if (x.uid !== ids[0]) { x.uid = ids[0]; owner = index.m[ids[0]].k || ""; }
    } else if (by !== x.by) { x.by = by; if (x.uid) { delete x.uid; owner = ""; } }
  }
  if (body.cats != null || body.cat != null) setCats(x, categories(body.cats != null ? body.cats : body.cat));
  photoDetails(x, body);
  if (body.series != null) setSeries(x, await checkSeries(env, body.series));
  if (body.theme != null) { x.theme = checkMonth(body.theme); if (!x.theme) delete x.theme; }
  if (body.fb != null) { if (body.fb === "share") x.fb = "share"; else delete x.fb; }
  if (body.pubOk === true) x.pubOk = true;          // the admin has asked the photographer
  if (body.pub === true) {
    if (!x.pubOk) throw fail(409, "Only photos the photographer has agreed to can go in the public exhibition. Ask " + x.by + " first.");
    x.pub = true;
  } else if (body.pub === false) delete x.pub;
  await env.INBOX.put(GALLERY, JSON.stringify(list));
  if (owner !== undefined) await (owner ? env.INBOX.put("owner:" + id, owner) : env.INBOX.delete("owner:" + id));
  return json({ ok: true, photo: x });
}

// The description and camera settings: given ones are changed, empty ones removed, missing ones kept
function photoDetails(x, body) {
  for (const [k, max, label] of [["desc", 400, "description"], ["lens", 30, "lens"], ["ap", 30, "aperture"], ["sh", 30, "shutter speed"], ["iso", 30, "ISO"]]) {
    if (body[k] == null) continue;
    const v = clean(body[k], max, label);
    if (v) x[k] = v; else delete x[k];
  }
}
// The photographer corrects their own photo's description and camera settings. The photo keeps its name,
// so its hearts, comments and place in the gallery stay as they are.
async function editOwnPhoto(request, env, rawId) {
  const m = await member(request, env);
  const id = photoId(rawId);
  const [owner, list] = await Promise.all([env.INBOX.get("owner:" + id), env.INBOX.get(GALLERY, "json").then((x) => x || [])]);
  const x = list.find((e) => e.id === id);
  if (!(owner && m.codes.includes(owner)) && !(x && x.uid && x.uid === m.id)) throw fail(403, "Only the photographer can change a photo's details. Ask a club admin if something needs fixing.");
  if (!x) throw fail(404, "This photo isn't in the gallery any more.");
  const body = await request.json().catch(() => ({}));
  photoDetails(x, body);
  x.edited = Date.now();
  await env.INBOX.put(GALLERY, JSON.stringify(list));
  const out = { id };
  for (const k of ["desc", "lens", "ap", "sh", "iso"]) out[k] = x[k] || "";
  return json({ ok: true, photo: out });
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

// Photos of the month: up to three photos from last month's vote, shown on the home page to members.
async function setPotw(request, env) {
  const body = await request.json().catch(() => ({}));
  const month = String(body.month || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail(400, "Unknown month.");
  const list = (await env.INBOX.get(GALLERY, "json")) || [];
  const ids = new Set(list.map((e) => e.id));
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 3)
    .map((x) => ({ id: photoId(x.id), votes: Math.max(0, parseInt(x.votes, 10) || 0) }))
    .filter((x) => ids.has(x.id));
  if (!items.length) throw fail(400, "None of those photos are in the gallery.");
  const potw = { month, items, at: Date.now() };   // Photos of the month
  await env.INBOX.put(POTW, JSON.stringify(potw));
  return json({ ok: true, potw });
}

async function listMembers(env) {
  const index = await memberIndex(env);
  const [keys, people] = await Promise.all([listAll(env, "member:"), env.INBOX.get(PEOPLE, "json")]);
  const members = keys.map((k) => {
    const md = k.metadata || {}, code = k.name.slice(7), id = md.id || index.c[code] || "", e = index.m[id];
    const m = { code, id, name: (e && e.n) || md.name, created: md.created };   // (the list of who is who is up to date at once; the members list can take a minute)
    const was = (e && e.was) || md.was;
    if (was && was.length) m.was = was;
    if (md.del) m.deleting = true;
    const p = people && people[id];
    if (p) { m.bio = p.bio; m.picture = p.av; }
    return m;
  });
  members.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return json({ members, token: members.some((m) => m.picture) ? await photoToken(env, Date.now()) : "" });
}

async function addMember(request, env) {
  const body = await request.json().catch(() => ({}));
  const name = memberName(body.name, "Enter the member's name.");
  const clash = await nameClash(env, name, "");
  if (clash) throw fail(409, "There's already a member called " + clash + ". Add their surname or an initial, so members can tell them apart.");
  const code = randomString(12);
  const rec = { name, created: Date.now(), id: newMemberId() };
  await saveMember(env, code, rec);
  await indexMember(env, code, rec);
  return json({ code, id: rec.id, name, created: rec.created });
}

// A new invite code for a member, e.g. when theirs has been shared by mistake. The old code stops
// working at once; their photos, comments, votes and sent-photo history stay theirs.
async function newCode(env, raw) {
  const old = normalize(raw);
  let m = await env.INBOX.get("member:" + old, "json");
  if (!m || m.del) throw fail(404, "That member isn't in the club any more. Refresh the list.");
  m = await ensureId(env, old, m);
  const code = randomString(12), now = Date.now(), index = await heartIndex(env);
  const prev = (m.prev || []).concat(old).slice(-10);
  const rec = Object.assign({}, m, { renewed: now, prev });              // keeps their ID, line and earlier names
  await saveMember(env, code, rec);
  await indexMember(env, code, rec);
  const [own, hearts] = await Promise.all([env.INBOX.get("own:" + old), env.INBOX.get("h:" + old)]);
  if (own) await env.INBOX.put("own:" + code, own);
  if (hearts) {                                                      // their hearts move to the new code
    await env.INBOX.put("h:" + code, hearts);
    index.codes = index.codes.filter((c) => c !== old).concat(code);
    await env.INBOX.put(HEARTERS, JSON.stringify(index));
  }
  for (const p of prev) await env.INBOX.put("moved:" + p, code);     // photos they sent earlier, still waiting, follow them
  await Promise.all(["member:" + old, "own:" + old, "h:" + old].map((k) => env.INBOX.delete(k)));
  return json({ code, name: m.name, created: m.created });
}

// For the admin page's backup: one part of the club's records at a time, 250 entries per call
// (a Worker may only make 1,000 storage calls per request).
const EXPORTABLE = ["member:", "c:", "owner:", "own:", "h:", "v:", "moved:", "rsvp:"];
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
        if (prefix === "member:" || prefix === "c:" || prefix === "own:" || prefix === "rsvp:" || prefix === "h:") try { value = JSON.parse(raw); } catch { /* keep the text */ }
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
  let added = 0, merged = 0, skipped = 0, hearts = false;
  const index = await heartIndex(env);
  for (const e of entries) {
    const key = String(e && e.key || ""), v = e && e.value;
    const [prefix, rest] = [key.slice(0, key.indexOf(":") + 1), key.slice(key.indexOf(":") + 1)];
    if (prefix === "member:") {
      if (!CODE_RE.test(rest) || !v || typeof v.name !== "string") throw fail(400, "The backup has a member that can't be read.");
      // never bring back a code that has since been replaced, or one that's still there
      if ((await env.INBOX.get("member:" + rest)) || (await env.INBOX.get("moved:" + rest))) { skipped++; continue; }
      const m = { name: clean(v.name, 60, "name", true), created: +v.created || Date.now() };
      if (Array.isArray(v.prev)) m.prev = v.prev.filter((c) => CODE_RE.test(c)).slice(-10);
      m.id = ID_RE.test(v.id || "") ? v.id : await legacyId((m.prev && m.prev[0]) || rest);   // the same ID as before (backups from before IDs: worked out as before)
      if (Array.isArray(v.was)) { const was = v.was.filter((w) => typeof w === "string" && w).map((w) => clean(w, 60, "name")).slice(0, 5); if (was.length) m.was = was; }
      if (+v.renamed) m.renamed = +v.renamed;
      if (typeof v.bio === "string" && v.bio) m.bio = clean(v.bio, 200, "line");
      await saveMember(env, rest, m);
      await indexMember(env, rest, m);
      added++;
    } else if (prefix === "c:") {
      const id = photoId(rest);
      const list = (await env.INBOX.get("c:" + id, "json")) || [], have = new Set(list.map((c) => c.cid));
      const extra = (Array.isArray(v) ? v : []).filter((c) => c && typeof c.cid === "string" && !have.has(c.cid) && typeof c.text === "string")
        .map((c) => Object.assign({ cid: c.cid.slice(0, 40), code: String(c.code || "").slice(0, 32), name: String(c.name || "").slice(0, 60), text: c.text.slice(0, MAX_COMMENT), at: +c.at || 0 }, ID_RE.test(c.uid || "") ? { uid: c.uid } : {}));
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
    } else if (prefix === "h:" || prefix === "v:") {
      // hearts, or votes from a backup made before hearts (they become hearts, dated their week's Monday or month's 1st)
      let code, add = {};
      if (prefix === "h:") {
        code = rest;
        if (!CODE_RE.test(code) || !v || typeof v !== "object" || Array.isArray(v)) throw fail(400, "The backup has hearts that can't be read.");
        for (const [id, day] of Object.entries(v).slice(0, 5000)) if (/^\d{4}-\d{2}-\d{2}$/.test(day)) add[photoId(id)] = day;
      } else {
        const m = rest.match(/^(\d{4}-W\d{2}|\d{4}-(?:0[1-9]|1[0-2])):([0-9A-Z]{8,32})$/);
        if (!m || !Array.isArray(v)) throw fail(400, "The backup has a vote that can't be read.");
        code = m[2];
        const day = m[1].includes("W") ? mondayOf(m[1]) : m[1] + "-01";
        for (const id of v.slice(0, 10)) add[photoId(id)] = day;
      }
      if (!(await mergeHearts(env, code, add))) { skipped++; continue; }
      await addHearter(env, index, code);
      hearts = true; added++;
    } else if (key === PEOPLE) {
      if (!v || typeof v !== "object" || Array.isArray(v)) throw fail(400, "The backup's photographer lines can't be read.");
      const people = (await env.INBOX.get(PEOPLE, "json")) || {}, index = await memberIndex(env);
      let n = 0;
      // kept under the member's ID (backups have each photographer by name, or by ID); pictures come back separately
      for (const [name, x] of Object.entries(v).slice(0, 2000)) {
        const k = personKey(index, clean(name, 60, "name", true));
        if (!(people[k] && people[k].bio) && x && typeof x.bio === "string" && x.bio) { people[k] = Object.assign({}, people[k], { bio: clean(x.bio, 200, "line"), since: +x.since || 0 }); n++; }
      }
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
      await env.INBOX.put(key, JSON.stringify(v.slice(0, 500).filter((x) => x && typeof x.name === "string").map((x) => Object.assign({ code: String(x.code || "").slice(0, 32), name: x.name.slice(0, 60), at: +x.at || 0 }, ID_RE.test(x.uid || "") ? { uid: x.uid } : {}))));
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
      const period = v && (/^\d{4}-\d{2}$/.test(v.month) ? { month: v.month } : /^\d{4}-W\d{2}$/.test(v.week) ? { week: v.week } : null);
      if (!period || !Array.isArray(v.items)) throw fail(400, "The backup's Photos of the month can't be read.");
      await env.INBOX.put(POTW, JSON.stringify({ ...period, items: v.items.slice(0, 3).map((x) => ({ id: photoId(x.id), votes: +x.votes || 0 })), at: +v.at || Date.now() }));
      added++;
    } else throw fail(400, "The backup has a record the inbox doesn't know.");
  }
  if (hearts) await recountHearts(env, index);
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
  // its photographer: the member's ID from the backup, or (backups from before IDs) the member with that name
  const index = await memberIndex(env), uid = String(form.get("uid") || ""), named = idsNamed(index, entry.by);
  if (ID_RE.test(uid)) entry.uid = uid; else if (named.length === 1) entry.uid = named[0];
  if (entry.uid && index.m[entry.uid] && !index.m[entry.uid].gone) entry.by = index.m[entry.uid].n;
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

// Removes a member from the club: their code stops working, their picture and line go. Their photos and comments stay,
// with the name they had (the list of who is who keeps them as gone).
async function removeMember(env, raw) {
  const code = normalize(raw);
  let rec = await env.INBOX.get("member:" + code, "json");
  if (rec) {
    rec = await ensureId(env, code, rec);
    await dropPerson(env, rec.id);
    const index = await memberIndex(env);
    index.m[rec.id] = { n: rec.name, gone: 1 };
    for (const c of [code].concat(rec.prev || [])) index.c[c] = rec.id;
    await env.INBOX.put(MEMBER_IDS, JSON.stringify(index));
  }
  await env.INBOX.delete("member:" + code);
  return json({ ok: true });
}
async function dropPerson(env, id) {   // a member's picture and line
  const people = (await env.INBOX.get(PEOPLE, "json")) || {};
  if (!people[id]) return;
  if (people[id].av) await env.INBOX.delete("avatar:" + people[id].av);
  delete people[id];
  await env.INBOX.put(PEOPLE, JSON.stringify(people));
}

// Deletes a member and everything they shared: their photos (with the comments on them), their comments on other
// photos, the hearts they gave, their event sign-ups, photos waiting for approval, picture and line. Their code stops
// working at once. It can be a lot, so each call does part of it (a Worker may make 1,000 storage calls per request)
// and the admin page calls again until it says done. If the day's saving limit runs out, pressing again tomorrow carries on.
async function deleteEverything(env, raw) {
  const code = normalize(raw);
  let rec = await env.INBOX.get("member:" + code, "json");
  if (!rec) return json({ ok: true, done: true, already: true });
  rec = await ensureId(env, code, rec);
  const id = rec.id, codes = [code].concat(rec.prev || []), has = (c) => !!c && codes.includes(c), theirs = (x) => (x.uid && x.uid === id) || has(x.code);
  let budget = 600;                                        // storage calls this time, leaving room for the rest
  const pause = async (left, extra) => { await saveMember(env, code, rec); return json({ ok: true, done: false, left, ...extra }); };
  if (!rec.del) { rec.del = { at: Date.now() }; await saveMember(env, code, rec); budget--; }    // from now on their code doesn't work
  const job = rec.del;

  // their photos, with the comments on them: up to 100 at a time
  const list = (await env.INBOX.get(GALLERY, "json")) || [];
  const photos = list.filter((p) => p.uid === id), batch = photos.slice(0, 100);
  if (batch.length) {
    const gone = new Set(batch.map((p) => p.id));
    await Promise.all(batch.flatMap((p) => ["pimg:" + p.id + ":full", "pimg:" + p.id + ":thumb", "owner:" + p.id, "c:" + p.id].map((k) => env.INBOX.delete(k))));
    await env.INBOX.put(GALLERY, JSON.stringify(list.filter((p) => !gone.has(p.id))));
    const potw = await env.INBOX.get(POTW, "json");
    if (potw && potw.items && potw.items.some((x) => gone.has(x.id))) { potw.items = potw.items.filter((x) => !gone.has(x.id)); await env.INBOX.put(POTW, JSON.stringify(potw)); }
    await dropReports(env, (r) => gone.has(r.photo));
    budget -= batch.length * 4 + 6;
    if (photos.length > batch.length) return pause("photos", { photos: photos.length - batch.length });
  }
  // photos still waiting for approval
  if (!job.subs) {
    const subs = (await listAll(env, "sub:")).filter((k) => has(k.metadata && k.metadata.code));
    await Promise.all(subs.flatMap((k) => { const sid = k.name.slice(4); return [k.name, "img:" + sid + ":full", "img:" + sid + ":thumb"].map((x) => env.INBOX.delete(x)); }));
    budget -= 1 + subs.length * 3; job.subs = 1;
  }
  // their comments on other photos: 100 photos' comments at a time
  while (!job.comments) {
    if (budget < 210) return pause("comments");
    const page = await env.INBOX.list({ prefix: "c:", cursor: job.cursor || undefined, limit: 100 });
    budget--;
    for (const k of page.keys) {
      const cs = (await env.INBOX.get(k.name, "json")) || [], rest = cs.filter((c) => !theirs(c));
      budget--;
      if (rest.length !== cs.length) { await (rest.length ? env.INBOX.put(k.name, JSON.stringify(rest)) : env.INBOX.delete(k.name)); budget--; }
    }
    if (page.list_complete) { job.comments = 1; delete job.cursor; } else job.cursor = page.cursor;
  }
  // the hearts they gave (and votes from before hearts)
  if (!job.hearts) {
    const index = await heartIndex(env);
    if (budget < index.codes.length + 40) return pause("hearts");
    const mine = index.codes.filter(has), votes = (await listAll(env, "v:")).filter((k) => has(k.name.split(":")[2]));
    await Promise.all(mine.map((c) => env.INBOX.delete("h:" + c)).concat(votes.map((k) => env.INBOX.delete(k.name))));
    if (mine.length) { index.codes = index.codes.filter((c) => !has(c)); await env.INBOX.put(HEARTERS, JSON.stringify(index)); await recountHearts(env, index); }
    budget -= index.codes.length + mine.length + votes.length + 4; job.hearts = 1;
  }
  // event sign-ups
  if (!job.rsvp) {
    const keys = await listAll(env, "rsvp:");
    if (budget < keys.length * 2 + 20) return pause("sign-ups");
    for (const k of keys) {
      const going = (await env.INBOX.get(k.name, "json")) || [], rest = going.filter((x) => !theirs(x));
      if (rest.length !== going.length) await env.INBOX.put(k.name, JSON.stringify(rest));
    }
    job.rsvp = 1;
  }
  // the admins' lists, their picture and line, sent-photo history, earlier codes, and who they were
  const [recent, reports] = await Promise.all([env.INBOX.get("recent-comments", "json"), env.INBOX.get(REPORTS, "json")]);
  if (recent) await env.INBOX.put("recent-comments", JSON.stringify(recent.filter((r) => r.uid !== id)));
  if (reports) {
    const rest = [];
    for (const r of reports) { if (r.uid === id) continue; r.by = (r.by || []).filter((b) => !theirs(b)); if (r.by.length) rest.push(r); }
    await env.INBOX.put(REPORTS, JSON.stringify(rest));
  }
  await dropPerson(env, id);
  await Promise.all(codes.map((c) => env.INBOX.delete("own:" + c)).concat((rec.prev || []).map((c) => env.INBOX.delete("moved:" + c))));
  const index = await memberIndex(env);
  delete index.m[id];
  for (const [c, x] of Object.entries(index.c)) if (x === id) delete index.c[c];
  await env.INBOX.put(MEMBER_IDS, JSON.stringify(index));
  await env.INBOX.delete("member:" + code);
  return json({ ok: true, done: true });
}

/* ------------------------------------------------------------------ events */
// Visitors see the events marked public; members see all of them, who's coming, and can sign up.
async function listEvents(url, request, env) {
  let who = null, badCode = false;      // badCode: a code that no longer works (the page then forgets it)
  if (bearer(request)) try { who = await viewer(request, env); } catch (e) { if (e.status !== 401) throw e; badCode = true; }
  const today = clubDate(Date.now(), env);
  const all = ((await env.INBOX.get(EVENTS, "json")) || []).filter((e) => who || e.public);
  const ends = (e) => e.date;
  const upcoming = all.filter((e) => ends(e) >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const past = all.filter((e) => ends(e) < today).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)).slice(0, who && who.admin && url.searchParams.get("all") ? 500 : 12);
  if (who) {
    const [lists, index] = await Promise.all([Promise.all(upcoming.concat(past).map((e) => env.INBOX.get("rsvp:" + e.id, "json"))), memberIndex(env)]);
    upcoming.concat(past).forEach((e, i) => {
      const going = lists[i] || [];
      e.going = going.map((x) => nameIn(index, x));
      if (who.codes) e.mine = going.some((x) => who.codes.includes(x.code));
    });
  }
  return json({ today, upcoming, past, member: !!(who && !who.admin), admin: !!(who && who.admin), badCode });
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
    going.push({ code: m.code, uid: m.id, name: m.name, at: Date.now() });
  }
  await env.INBOX.put(key, JSON.stringify(going));
  const index = await memberIndex(env);
  return json({ ok: true, mine: i < 0, going: going.map((x) => nameIn(index, x)) });
}

/* ------------------------------------------------------------------ the storage meter */
// How much of Cloudflare's free 1 GB the photos use. Photos added before sizes were kept are measured
// a few at a time (each check measures up to 30), so the admin page asks again until it's done.
/* ------------------------------------------------------------------ downloads */
// Posters, cheat sheets and guides the admins share. Visitors see the ones for everyone; members see all of them.
async function listFiles(request, env) {
  let who = null, badCode = false;      // badCode: a code that no longer works (the page then forgets it)
  if (bearer(request)) try { who = await viewer(request, env); } catch (e) { if (e.status !== 401) throw e; badCode = true; }
  const all = (await env.INBOX.get(FILES, "json")) || [];
  const files = who ? all : all.filter((f) => f.pub);
  const out = { files, kinds: FILE_KINDS, member: !!(who && !who.admin), admin: !!(who && who.admin), forMembers: all.length - files.length, badCode };
  if (who && all.some((f) => !f.pub)) out.token = await photoToken(env, Date.now());   // opens the members-only files for 12 to 24 hours
  return json(out);
}

async function serveFile(url, env, rawId, thumb) {
  const id = photoId(rawId);
  const f = ((await env.INBOX.get(FILES, "json")) || []).find((x) => x.id === id);
  if (!f || (thumb && !f.tw)) throw fail(404, "This download isn't available any more.");
  if (!f.pub && !(await checkPhotoToken(env, url.searchParams.get("t")))) throw fail(403, "This download is for club members. Sign in on the club's website to get it.");
  const value = await env.INBOX.get((thumb ? "fthumb:" : "file:") + id, { type: "stream" });
  if (!value) throw fail(404, "This download isn't available any more.");
  const headers = { "Cache-Control": (f.pub ? "public" : "private") + ", max-age=3600", "X-Content-Type-Options": "nosniff" };
  if (thumb) headers["Content-Type"] = f.tt || "image/webp";
  else {
    const [type, opens] = FILE_TYPES[f.ext] || ["application/octet-stream"];
    const name = (f.title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "download") + "." + f.ext;
    headers["Content-Type"] = type;
    headers["Content-Disposition"] = (opens && url.searchParams.get("dl") !== "1" ? "inline" : "attachment") +
      '; filename="' + name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "") + "\"; filename*=UTF-8''" + encodeURIComponent(name);
  }
  return new Response(value, { headers });
}

// the first bytes of each kind of file, so a renamed file can't pretend to be a PDF
function fileMatches(ext, b) {
  const text = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  if (ext === "pdf") return text(0, 5) === "%PDF-";
  if (ext === "png") return b[0] === 0x89 && text(1, 3) === "PNG";
  if (ext === "jpg" || ext === "jpeg") return b[0] === 0xff && b[1] === 0xd8;
  if (ext === "webp") return text(0, 4) === "RIFF" && text(8, 4) === "WEBP";
  return text(0, 4) === "PK\u0003\u0004";                // Word, Excel, PowerPoint, OpenDocument and ZIP files are all ZIP inside
}
function fileFields(b, f) {
  f.title = clean(b.title, 80, "title", true);
  f.kind = FILE_KINDS.includes(b.kind) ? b.kind : "Other";
  const desc = clean(b.desc, 300, "description");
  if (desc) f.desc = desc; else delete f.desc;
  f.pub = b.pub === true || b.pub === "1" || b.pub === "true";
  return f;
}

// A new download (or one from a backup, which keeps its name and date and is skipped if it's already here)
async function addFile(request, env) {
  const form = await readForm(request);
  const file = form.get("file");
  if (!file || typeof file === "string") throw fail(400, "Choose the file to share.");
  const ext = String(file.name || "").toLowerCase().split(".").pop();
  if (!FILE_TYPES[ext]) throw fail(400, "That kind of file can't be shared here. Use a PDF, an image (PNG, JPEG or WebP), a Word, Excel or PowerPoint file, or a ZIP file.");
  if (file.size > MAX_FILE) throw fail(413, "That file is larger than 20 MB. Save a smaller version (for a PDF, choose a smaller file size when exporting) and try again.");
  const list = (await env.INBOX.get(FILES, "json")) || [];
  const keep = form.get("id") ? photoId(form.get("id")) : "";
  if (keep && list.some((x) => x.id === keep)) return json({ ok: true, already: true, id: keep });
  if (list.length >= MAX_FILES) throw fail(409, "There are " + MAX_FILES + " downloads already. Delete ones that are no longer needed first.");
  const bytes = await file.arrayBuffer();
  if (!fileMatches(ext, new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength)))) throw fail(400, "That file doesn't look like a ." + ext + " file. Check that it opens on your computer, then try again.");
  const entry = fileFields({ title: form.get("title"), kind: form.get("kind"), desc: form.get("desc"), pub: form.get("pub") }, {});
  const taken = new Set(list.map((x) => x.id));
  const slug = slugify(entry.title) === "photo" && !/photo/i.test(entry.title) ? "download" : slugify(entry.title);   // titles in Malayalam have no letters for an address
  let id = keep || slug, n = 2;
  while (taken.has(id)) id = slug.slice(0, 44) + "-" + n++;
  Object.assign(entry, { id, ext, size: bytes.byteLength, added: Math.min(+form.get("added") || Date.now(), Date.now()) });
  const t = form.get("thumb");
  let thumb = null;
  if (t && typeof t !== "string" && t.size) {
    thumb = await image(t, MAX_THUMB, "preview");
    entry.tw = Math.min(4000, Math.max(1, parseInt(form.get("tw"), 10) || 1)); entry.th = Math.min(4000, Math.max(1, parseInt(form.get("th"), 10) || 1));
    entry.tt = t.type; entry.tkb = Math.max(1, Math.round(thumb.byteLength / 1024));
  }
  await env.INBOX.put("file:" + id, bytes, { metadata: { type: FILE_TYPES[ext][0] } });
  if (thumb) await env.INBOX.put("fthumb:" + id, thumb);
  const fresh = ((await env.INBOX.get(FILES, "json")) || []).filter((x) => x.id !== id);   // read again: the file took a moment
  fresh.push(entry);
  fresh.sort((a, b) => b.added - a.added);
  await env.INBOX.put(FILES, JSON.stringify(fresh));
  return json({ ok: true, file: entry });
}

async function editFile(request, env, raw) {
  const id = photoId(raw), b = await request.json().catch(() => ({}));
  const list = (await env.INBOX.get(FILES, "json")) || [], f = list.find((x) => x.id === id);
  if (!f) throw fail(404, "That download isn't there any more.");
  fileFields(b, f);
  await env.INBOX.put(FILES, JSON.stringify(list));
  return json({ ok: true, file: f });
}

async function deleteFile(env, raw) {
  const id = photoId(raw), list = (await env.INBOX.get(FILES, "json")) || [];
  const rest = list.filter((x) => x.id !== id);
  if (rest.length !== list.length) await env.INBOX.put(FILES, JSON.stringify(rest));
  await Promise.all([env.INBOX.delete("file:" + id), env.INBOX.delete("fthumb:" + id)]);
  return json({ ok: true });
}

async function storage(env) {
  const [list, kept, subs, shared] = await Promise.all([env.INBOX.get(GALLERY, "json"), env.INBOX.get(SIZES, "json"), listAll(env, "sub:"), env.INBOX.get(FILES, "json")]);
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
  const files = shared || [], filesKB = files.reduce((n, f) => n + Math.round((f.size || 0) / 1024) + (f.tkb || 0), 0);
  const usedKB = photosKB + Math.round((photos.length - measured) * avgKB) + pendingKB + filesKB;
  return json({ usedKB, limitKB: STORAGE_KB, photos: photos.length, photosKB, pending: subs.length, pendingKB, files: files.length, filesKB, avgKB, measuring: photos.length - measured,
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
// the club's calendar date, YYYY-MM-DD
function clubDate(ms, env) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: env.TIMEZONE || "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  } catch { return new Date(ms).toISOString().slice(0, 10); }
}
// the month in the club's time zone, e.g. 2026-10; the month after or before one
function monthId(ms, env) { return clubDate(ms, env).slice(0, 7); }
function nextMonth(m) { const [y, n] = m.split("-").map(Number); return n === 12 ? (y + 1) + "-01" : y + "-" + String(n + 1).padStart(2, "0"); }
function previousMonth(m) { const [y, n] = m.split("-").map(Number); return n === 1 ? (y - 1) + "-12" : y + "-" + String(n - 1).padStart(2, "0"); }
// the Monday of an ISO week, e.g. 2026-W42 -> 2026-10-12 (for vote records from when votes were weekly)
function mondayOf(week) {
  const [y, w] = week.split("-W").map(Number), jan4 = new Date(Date.UTC(y, 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7);
  return jan4.toISOString().slice(0, 10);
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
