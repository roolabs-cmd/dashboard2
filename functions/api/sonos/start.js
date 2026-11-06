import { sign, safeEqual } from "../../../lib/shared.js";

// Visit once: /api/sonos/start?pass=YOUR_PASSCODE
export async function onRequestGet({ request, env }) {
  const pass = new URL(request.url).searchParams.get("pass") || "";
  if (!env.DASHBOARD_PASSCODE || !safeEqual(pass, env.DASHBOARD_PASSCODE)) return new Response("Wrong passcode", { status: 401 });
  const ts = String(Date.now());
  const p = new URLSearchParams({
    client_id: env.SONOS_CLIENT_ID,
    response_type: "code",
    state: ts + "." + (await sign(env, ts)),
    scope: "playback-control-all",
    redirect_uri: env.SITE_URL + "/api/sonos/callback"
  });
  return Response.redirect("https://api.sonos.com/login/v3/oauth?" + p, 302);
}
