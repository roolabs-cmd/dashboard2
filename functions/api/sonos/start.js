import { sign, safeEqual } from "../../../lib/shared.js";
import { redirectUri, sonosKey } from "../../../lib/sonos.js";

// Visit once: /api/sonos/start?pass=YOUR_PASSCODE
export async function onRequestGet({ request, env }) {
  const pass = new URL(request.url).searchParams.get("pass") || "";
  if (!env.DASHBOARD_PASSCODE || !safeEqual(pass, env.DASHBOARD_PASSCODE)) return new Response("Wrong passcode", { status: 401 });
  const ts = String(Date.now());
  const p = new URLSearchParams({
    client_id: sonosKey(env),
    response_type: "code",
    state: ts + "." + (await sign(env, ts)),
    scope: "playback-control-all",
    redirect_uri: redirectUri(env)
  });
  return Response.redirect("https://api.sonos.com/login/v3/oauth?" + p, 302);
}
