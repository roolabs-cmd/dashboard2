import { db } from "./shared.js";

let cached = { token: null, exp: 0 };

async function tokenRequest(env, params) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET)
    },
    body: new URLSearchParams(params)
  });
  const t = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(t.error_description || t.error || "Spotify token error " + res.status);
  return t;
}

export const exchangeCode = (env, code) =>
  tokenRequest(env, { grant_type: "authorization_code", code, redirect_uri: env.SITE_URL + "/api/spotify/callback" });

// Trades the stored refresh token for a short-lived access token.
export async function spotifyToken(env) {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const supa = db(env);
  const { data } = await supa.from("spotify_auth").select("refresh_token").eq("id", 1).maybeSingle();
  if (!data) throw new Error("Spotify isn't connected yet");
  const t = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: data.refresh_token });
  if (t.refresh_token && t.refresh_token !== data.refresh_token)
    await supa.from("spotify_auth").upsert({ id: 1, refresh_token: t.refresh_token, updated_at: new Date().toISOString() });
  cached = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
  return cached.token;
}

export async function sp(env, path, init = {}) {
  const res = await fetch("https://api.spotify.com/v1" + path, {
    ...init,
    headers: { authorization: "Bearer " + (await spotifyToken(env)), ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) }
  });
  if (res.status === 204) return { status: 204, body: null };
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
  if (!res.ok) {
    const reason = body && body.error && (body.error.reason || body.error.message);
    const msg = res.status === 429 ? "Spotify is rate limiting requests. Wait a moment and try again."
      : reason === "NO_ACTIVE_DEVICE" ? "No active Spotify device. Open Spotify on your phone or speaker, play something once, then tap the speaker button."
      : reason === "PREMIUM_REQUIRED" ? "Spotify Premium is required to control playback."
      : (body && body.error && body.error.message) || "Spotify error " + res.status;
    const err = new Error(msg); err.status = res.status; err.reason = reason; throw err;
  }
  return { status: res.status, body };
}
