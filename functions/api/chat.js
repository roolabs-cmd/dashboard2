import { db, json, safeEqual } from "../../lib/shared.js";

// Chat API. It does not use the dashboard passcode: chat has its own admin password (CHAT_ADMIN_PASSWORD) and one
// code per chat, so a guest can use chat without ever knowing the dashboard passcode.
//
//   POST ?op=login     {code}                       -> {token, role}   the admin password, or a guest's code
//   GET  ?op=me                                     -> {role, chat?, realtime}
//   GET  ?op=chats                                  -> admin only: every chat with its latest message
//   POST ?op=create    {name, code, photo?}         -> admin only
//   POST ?op=update    {id, name?, photo?, code?}   -> admin only: rename, change/remove photo, reset the guest's code
//   GET  ?op=messages  &chat=&before=|after=&limit= -> messages, oldest first
//   POST ?op=send      {chat, text}                 -> text only; admin and guest
//
// Messages are only ever added, never edited or deleted, and only plain text is accepted.

const enc = new TextEncoder();
const NAME_MAX = 40, TEXT_MAX = 2000, CODE_MIN = 8, CODE_MAX = 100, PAGE = 50, AFTER_MAX = 200;
const PHOTO_MAX = 150000, BODY_MAX = 250000;
const PHOTO_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_TTL = 14 * 86400, GUEST_TTL = 90 * 86400;     // how long a login lasts, in seconds
const FAIL_LIMIT = 8, FAIL_WINDOW_MS = 15 * 60 * 1000;    // wrong codes allowed per visitor per window
const SEND_LIMIT = 30;                                    // messages per person per minute
const CHAT_COLS = "id,name,photo,rt,code_ver,created_at";

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const bad = (message, status = 400) => json({ error: message }, status);

// A database error becomes a generic message, except "table missing", which tells the admin what to do.
function must(error) {
  if (!error) return;
  console.error("chat db error", error.code, error.message);
  if (error.code === "42P01" || error.code === "PGRST205") fail(503, "Chat isn't set up yet. Run supabase/chat.sql in Supabase.");
  fail(500, "Something went wrong. Try again.");
}

// ---------- signing ----------
let keyCache = { secret: "", key: null };
async function getKey(env) {
  if (!keyCache.key || keyCache.secret !== env.CHAT_SECRET) {
    keyCache = { secret: env.CHAT_SECRET, key: await crypto.subtle.importKey("raw", enc.encode(env.CHAT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]) };
  }
  return keyCache.key;
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const macHex = async (env, msg) => hex(await crypto.subtle.sign("HMAC", await getKey(env), enc.encode(msg)));
const b64uEnc = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uDec = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

// Normalising means a code that looks the same always matches, whatever keyboard typed it.
const norm = (s) => String(s == null ? "" : s).normalize("NFKC").trim();
const len = (s) => [...s].length;
const adminTag = async (env) => (await macHex(env, "admin:" + norm(env.CHAT_ADMIN_PASSWORD))).slice(0, 32);   // changes when the admin password changes
const codeHash = (env, code) => macHex(env, "code:" + code);

async function issue(env, claims, ttlSeconds) {
  const body = b64uEnc(enc.encode(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await getKey(env), enc.encode(body)));
  return body + "." + b64uEnc(sig);
}
async function readToken(env, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    if (!(await crypto.subtle.verify("HMAC", await getKey(env), b64uDec(parts[1]), enc.encode(parts[0])))) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64uDec(parts[0])));
    return claims && typeof claims === "object" && claims.exp > Date.now() / 1000 ? claims : null;
  } catch (e) { return null; }
}

// Who is calling? Admin sessions die when the admin password changes; guest sessions die when their code is reset.
async function whoAmI(req, env, sb) {
  const h = req.headers.get("authorization") || "";
  const c = await readToken(env, h.startsWith("Bearer ") ? h.slice(7) : "");
  if (!c) return null;
  if (c.r === "a") {
    if (!env.CHAT_ADMIN_PASSWORD || !safeEqual(String(c.a), await adminTag(env))) return null;
    return { role: "admin" };
  }
  if (c.r === "g" && UUID.test(String(c.c))) {
    const { data, error } = await sb.from("chats").select(CHAT_COLS).eq("id", c.c).maybeSingle();
    must(error);
    if (data && data.code_ver === c.v) return { role: "guest", chat: data };
  }
  return null;
}

// ---------- input checks ----------
async function readBody(req) {
  if (Number(req.headers.get("content-length") || 0) > BODY_MAX) fail(413, "That's too big");
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? b : {};
}
function cleanName(v) {
  const n = String(v == null ? "" : v).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!n) fail(400, "Give the chat a name");
  if (len(n) > NAME_MAX) fail(400, "The name is too long (40 characters max)");
  return n;
}
function cleanCode(env, v) {
  const c = norm(v);
  if (len(c) < CODE_MIN) fail(400, "The code needs at least 8 characters");
  if (len(c) > CODE_MAX) fail(400, "That code is too long");
  if (env.CHAT_ADMIN_PASSWORD && safeEqual(c, norm(env.CHAT_ADMIN_PASSWORD))) fail(400, "Pick a code that's different from the admin password");
  return c;
}
function cleanPhoto(v) {
  if (v === null) return null;
  if (typeof v !== "string" || v.length > PHOTO_MAX || !PHOTO_RE.test(v)) fail(400, "That photo isn't supported. Use a JPG, PNG or WebP image.");
  return v;
}
function cleanText(v) {
  if (typeof v !== "string") fail(400, "Messages are text only");
  const t = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!t) fail(400, "Type a message first");
  if (len(t) > TEXT_MAX) fail(400, "That message is too long (2000 characters max)");
  return t;
}
const intParam = (v) => (v !== null && /^\d{1,15}$/.test(v) ? Number(v) : null);
const admin = (s) => { if (s.role !== "admin") fail(403, "Only the admin can do that"); };

// ---------- shapes sent to the browser ----------
const chatOut = (c) => ({ id: c.id, name: c.name, photo: c.photo || null, rt: c.rt, created_at: c.created_at });
const msgOut = (m) => ({ id: m.id, sender: m.sender, body: m.body, at: m.created_at });
const rtConfig = (env) => {
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  return key && env.SUPABASE_URL ? { url: env.SUPABASE_URL, key } : null;
};

// Tells whoever has the chat open that something new arrived. It carries no message text; the other side then
// asks the API for new messages. Best effort only: if it fails, the page's regular check picks the message up.
function ping(env, ctx, rt) {
  const cfg = rtConfig(env);
  if (!cfg) return;
  const p = fetch(cfg.url + "/realtime/v1/api/broadcast", {
    method: "POST",
    headers: { apikey: cfg.key, "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ topic: "chat-" + rt, event: "ping", payload: {}, private: false }] }),
    signal: AbortSignal.timeout(3000)
  }).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}

// ---------- operations ----------
async function login(req, env, sb) {
  const code = norm((await readBody(req)).code);
  if (!code || len(code) > CODE_MAX) fail(400, "Enter your code");

  const ipTag = await macHex(env, "ip:" + (req.headers.get("cf-connecting-ip") || "unknown"));
  const since = new Date(Date.now() - FAIL_WINDOW_MS).toISOString();
  const tries = await sb.from("chat_login_attempts").select("ip_hash", { count: "exact", head: true }).eq("ip_hash", ipTag).gt("at", since);
  must(tries.error);
  if ((tries.count || 0) >= FAIL_LIMIT) fail(429, "Too many tries. Wait a few minutes and try again.");

  if (env.CHAT_ADMIN_PASSWORD) {
    const same = safeEqual(await macHex(env, "pw:" + code), await macHex(env, "pw:" + norm(env.CHAT_ADMIN_PASSWORD)));
    if (same) return json({ role: "admin", token: await issue(env, { r: "a", a: await adminTag(env) }, ADMIN_TTL) });
  }
  const { data, error } = await sb.from("chats").select("id,code_ver").eq("code_hash", await codeHash(env, code)).maybeSingle();
  must(error);
  if (data) return json({ role: "guest", token: await issue(env, { r: "g", c: data.id, v: data.code_ver }, GUEST_TTL) });

  const day = new Date(Date.now() - 86400000).toISOString();
  const [a, b] = await Promise.all([sb.from("chat_login_attempts").insert({ ip_hash: ipTag }), sb.from("chat_login_attempts").delete().lt("at", day)]);
  must(a.error); must(b.error);
  fail(401, "That code didn't work");
}

async function chatFor(s, sb, id) {
  if (s.role === "guest") {
    if (id && id !== s.chat.id) fail(403, "That isn't your chat");
    return s.chat;
  }
  if (!UUID.test(String(id || ""))) fail(400, "Missing chat");
  const { data, error } = await sb.from("chats").select(CHAT_COLS).eq("id", id).maybeSingle();
  must(error);
  if (!data) fail(404, "Chat not found");
  return data;
}

async function handle(req, env, ctx) {
  if (!env.CHAT_SECRET || String(env.CHAT_SECRET).length < 16) fail(503, "Chat isn't set up yet. Add CHAT_SECRET (16+ characters) in Cloudflare.");
  const url = new URL(req.url), op = url.searchParams.get("op") || "", q = url.searchParams;
  const posts = ["login", "create", "update", "send"], gets = ["me", "chats", "messages"];
  if (!posts.includes(op) && !gets.includes(op)) fail(404, "Not found");
  if (req.method !== (posts.includes(op) ? "POST" : "GET")) fail(405, "Method not allowed");

  const sb = db(env);
  if (op === "login") return login(req, env, sb);
  const s = await whoAmI(req, env, sb);
  if (!s) fail(401, "Signed out");

  switch (op) {
    case "me":
      return json({ role: s.role, chat: s.role === "guest" ? chatOut(s.chat) : null, realtime: rtConfig(env) });

    case "chats": {
      admin(s);
      const { data, error } = await sb.from("chats").select("id,name,photo,rt,created_at").order("created_at", { ascending: true });
      must(error);
      const rows = await Promise.all(data.map(async (c) => {
        const r = await sb.from("chat_messages").select("id,sender,body,created_at").eq("chat_id", c.id).order("id", { ascending: false }).limit(1);
        must(r.error);
        const m = r.data && r.data[0];
        return { ...chatOut(c), last: m ? { id: m.id, sender: m.sender, body: [...m.body].slice(0, 140).join(""), at: m.created_at } : null };
      }));
      rows.sort((a, b) => Date.parse((b.last && b.last.at) || b.created_at) - Date.parse((a.last && a.last.at) || a.created_at));
      return json({ chats: rows });
    }

    case "create": {
      admin(s);
      const b = await readBody(req);
      const row = { name: cleanName(b.name), photo: b.photo == null ? null : cleanPhoto(b.photo), rt: randHex(24) };
      row.code_hash = await codeHash(env, cleanCode(env, b.code));
      const { data, error } = await sb.from("chats").insert(row).select(CHAT_COLS).single();
      if (error && error.code === "23505") fail(409, "That code is already used by another chat");
      must(error);
      return json({ chat: chatOut(data) });
    }

    case "update": {
      admin(s);
      const b = await readBody(req);
      const chat = await chatFor(s, sb, b.id);
      const patch = {};
      if ("name" in b) patch.name = cleanName(b.name);
      if ("photo" in b) patch.photo = cleanPhoto(b.photo);
      if (b.code != null && b.code !== "") {
        patch.code_hash = await codeHash(env, cleanCode(env, b.code));
        patch.code_ver = chat.code_ver + 1;   // signs the old guest session out
        patch.rt = randHex(24);               // and moves the live channel
      }
      if (!Object.keys(patch).length) fail(400, "Nothing to change");
      const { data, error } = await sb.from("chats").update(patch).eq("id", chat.id).select(CHAT_COLS).single();
      if (error && error.code === "23505") fail(409, "That code is already used by another chat");
      must(error);
      return json({ chat: chatOut(data) });
    }

    case "messages": {
      const chat = await chatFor(s, sb, q.get("chat"));
      const after = intParam(q.get("after")), before = intParam(q.get("before"));
      const limit = Math.min(Math.max(intParam(q.get("limit")) || PAGE, 1), 100);
      let query = sb.from("chat_messages").select("id,sender,body,created_at").eq("chat_id", chat.id);
      if (after !== null) {
        const { data, error } = await query.gt("id", after).order("id", { ascending: true }).limit(AFTER_MAX);
        must(error);
        return json({ messages: data.map(msgOut), more: false });
      }
      if (before !== null) query = query.lt("id", before);
      const { data, error } = await query.order("id", { ascending: false }).limit(limit + 1);
      must(error);
      return json({ messages: data.slice(0, limit).reverse().map(msgOut), more: data.length > limit });
    }

    case "send": {
      const b = await readBody(req);
      const chat = await chatFor(s, sb, b.chat);
      const text = cleanText(b.text);
      const recent = await sb.from("chat_messages").select("id", { count: "exact", head: true })
        .eq("chat_id", chat.id).eq("sender", s.role).gt("created_at", new Date(Date.now() - 60000).toISOString());
      must(recent.error);
      if ((recent.count || 0) >= SEND_LIMIT) fail(429, "Slow down a little");
      const { data, error } = await sb.from("chat_messages").insert({ chat_id: chat.id, sender: s.role, body: text }).select("id,sender,body,created_at").single();
      must(error);
      ping(env, ctx, chat.rt);
      return json({ message: msgOut(data) });
    }
  }
  fail(404, "Not found");
}

export async function onRequest({ request, env, ctx }) {
  try {
    return await handle(request, env, ctx);
  } catch (e) {
    if (e instanceof HttpError) return bad(e.message, e.status);
    console.error("chat error", e && e.message);
    return bad("Something went wrong. Try again.", 500);
  }
}
