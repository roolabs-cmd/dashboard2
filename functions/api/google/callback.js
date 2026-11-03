import { db, sign, safeEqual } from "../../../lib/shared.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const page = (msg, status = 200) =>
  new Response(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#1a1613;color:#f1e9df;padding:32px"><p>${esc(msg)}</p>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } });

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const [ts, sig] = (u.searchParams.get("state") || "").split(".");
  if (!ts || !sig || !safeEqual(sig, await sign(env, ts)) || Date.now() - Number(ts) > 10 * 60 * 1000)
    return page("This link is invalid or expired. Start again from /api/google/start.", 400);
  const code = u.searchParams.get("code");
  if (!code) return page("Google didn't return a code: " + (u.searchParams.get("error") || "unknown reason"), 400);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.SITE_URL + "/api/google/callback", grant_type: "authorization_code"
    })
  });
  const t = await res.json();
  if (!res.ok) return page("Google rejected the login: " + (t.error_description || t.error), 400);
  if (!t.refresh_token)
    return page("Google sent no refresh token. Remove this app at myaccount.google.com/permissions, then start again.", 400);

  const { error } = await db(env).from("google_auth").upsert({ id: 1, refresh_token: t.refresh_token, scope: t.scope });
  if (error) return page("Couldn't save to Supabase: " + error.message, 500);
  return page("Connected. You can close this tab and reload the dashboard.");
}
