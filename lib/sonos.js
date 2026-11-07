import { db } from "./shared.js";

let cached = { token: null, exp: 0 };

// Tolerate stray spaces or a trailing slash when the variables were pasted in.
const clean = (v) => String(v || "").trim();
export const siteBase = (env) => clean(env.SITE_URL).replace(/\/+$/, "");
export const redirectUri = (env) => siteBase(env) + "/api/sonos/callback";
export const sonosKey = (env) => clean(env.SONOS_CLIENT_ID);

async function tokenRequest(env, params) {
  const res = await fetch("https://api.sonos.com/login/v3/oauth/access", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      authorization: "Basic " + btoa(clean(env.SONOS_CLIENT_ID) + ":" + clean(env.SONOS_CLIENT_SECRET))
    },
    body: new URLSearchParams(params)
  });
  const t = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("HTTP " + res.status + " " + JSON.stringify(t));
  return t;
}

// Tries the standard exchange first, then two variants, and reports every result if all fail.
async function rawToken(env, params, useBasic) {
  const id = clean(env.SONOS_CLIENT_ID), secret = clean(env.SONOS_CLIENT_SECRET);
  const headers = { "content-type": "application/x-www-form-urlencoded;charset=utf-8" };
  const p = new URLSearchParams(params);
  if (useBasic) headers.authorization = "Basic " + btoa(id + ":" + secret);
  else { p.set("client_id", id); p.set("client_secret", secret); }
  const res = await fetch("https://api.sonos.com/login/v3/oauth/access", { method: "POST", headers, body: p.toString() });
  const t = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, t };
}

export async function exchangeCode(env, code) {
  const base = { grant_type: "authorization_code", code }, ru = redirectUri(env);
  const tries = [
    ["Standard (Basic login + redirect address)", { ...base, redirect_uri: ru }, true],
    ["Without the redirect address", base, true],
    ["Key and secret in the body", { ...base, redirect_uri: ru }, false]
  ];
  const log = [];
  for (const [label, params, basic] of tries) {
    const r = await rawToken(env, params, basic);
    if (r.ok) return r.t;
    log.push(label + ": HTTP " + r.status + " " + JSON.stringify(r.t));
  }
  throw new Error("\n" + log.join("\n"));
}

// Trades the stored refresh token for a short-lived access token.
export async function sonosToken(env) {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const supa = db(env);
  const { data } = await supa.from("sonos_auth").select("refresh_token").eq("id", 1).maybeSingle();
  if (!data) throw new Error("Sonos isn't connected yet");
  const t = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: data.refresh_token });
  if (t.refresh_token && t.refresh_token !== data.refresh_token)
    await supa.from("sonos_auth").upsert({ id: 1, refresh_token: t.refresh_token, updated_at: new Date().toISOString() });
  cached = { token: t.access_token, exp: Date.now() + (Math.max(60, (t.expires_in || 3600) - 60)) * 1000 };
  return cached.token;
}

export async function so(env, path, init = {}) {
  const res = await fetch("https://api.ws.sonos.com/control/api/v1" + path, {
    ...init,
    headers: {
      authorization: "Bearer " + (await sonosToken(env)),
      "x-sonos-api-key": clean(env.SONOS_CLIENT_ID),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
  if (!res.ok) {
    if (res.status === 401) cached = { token: null, exp: 0 };
    const code = body && body.errorCode;
    const msg = res.status === 429 ? "Sonos is rate limiting requests. Wait a moment and try again."
      : res.status === 401 ? "Sonos login expired. Reconnect at /api/sonos/start."
      : code ? "Sonos: " + code.replace(/^ERROR_/, "").toLowerCase().replace(/_/g, " ") + (body.reason ? " (" + body.reason + ")" : "")
      : "Sonos error " + res.status;
    const err = new Error(msg); err.status = res.status; err.code = code; throw err;
  }
  return { status: res.status, body };
}
