import { createClient } from "@supabase/supabase-js";

export const db = (env) =>
  createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function sign(env, value) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(env.DASHBOARD_PASSCODE || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Every data request must carry the passcode in the x-passcode header.
export const guard = (fn) => async ({ request, env }) => {
  const pass = env.DASHBOARD_PASSCODE;
  if (!pass || !safeEqual(request.headers.get("x-passcode") || "", pass)) return json({ error: "Wrong passcode" }, 401);
  try { return await fn(request, env); } catch (e) { return json({ error: e.message }, 500); }
};

// Trades the stored refresh token for a short-lived access token (kept while the worker stays warm).
let cached = { token: null, exp: 0 };
export async function accessToken(env) {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const { data } = await db(env).from("google_auth").select("refresh_token").eq("id", 1).maybeSingle();
  if (!data) throw new Error("Google isn't connected yet");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: data.refresh_token, grant_type: "refresh_token"
    })
  });
  const t = await res.json();
  if (!res.ok) throw new Error(t.error_description || t.error || "Token refresh failed");
  cached = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
  return cached.token;
}

export async function gcal(env, path, init = {}) {
  const res = await fetch("https://www.googleapis.com/calendar/v3" + path, {
    ...init,
    headers: { authorization: "Bearer " + (await accessToken(env)), "content-type": "application/json", ...(init.headers || {}) }
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body.error && body.error.message) || "Google error " + res.status);
  return body;
}
