import { db, sign, safeEqual } from "../../../lib/shared.js";
import { exchangeCode } from "../../../lib/sonos.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const page = (msg, status = 200) =>
  new Response(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#1a1613;color:#f1e9df;padding:32px"><p>${esc(msg)}</p>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } });

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const [ts, sig] = (u.searchParams.get("state") || "").split(".");
  if (!ts || !sig || !safeEqual(sig, await sign(env, ts)) || Date.now() - Number(ts) > 10 * 60 * 1000)
    return page("This link is invalid or expired. Start again from /api/sonos/start.", 400);
  const code = u.searchParams.get("code");
  if (!code) return page("Sonos didn't return a code: " + (u.searchParams.get("error") || "unknown reason"), 400);
  let t;
  try { t = await exchangeCode(env, code); } catch (e) { return page("Sonos rejected the login: " + e.message, 400); }
  if (!t.refresh_token) return page("Sonos sent no refresh token. Start again.", 400);
  const { error } = await db(env).from("sonos_auth").upsert({ id: 1, refresh_token: t.refresh_token, scope: t.scope || "" });
  if (error) return page("Couldn't save to Supabase: " + error.message, 500);
  return page("Sonos connected. You can close this tab and open the Music tile.");
}
