import { sign, safeEqual } from "../../../lib/shared.js";

// Visit once: /api/spotify/start?pass=YOUR_PASSCODE
export async function onRequestGet({ request, env }) {
  const pass = new URL(request.url).searchParams.get("pass") || "";
  if (!env.DASHBOARD_PASSCODE || !safeEqual(pass, env.DASHBOARD_PASSCODE)) return new Response("Wrong passcode", { status: 401 });
  const ts = String(Date.now());
  const p = new URLSearchParams({
    response_type: "code",
    client_id: env.SPOTIFY_CLIENT_ID,
    scope: "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative streaming user-read-email user-read-private",
    redirect_uri: env.SITE_URL + "/api/spotify/callback",
    state: ts + "." + (await sign(env, ts))
  });
  return Response.redirect("https://accounts.spotify.com/authorize?" + p, 302);
}
