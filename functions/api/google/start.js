import { sign, safeEqual } from "../../../lib/shared.js";

// Visit once: /api/google/start?pass=YOUR_PASSCODE
export async function onRequestGet({ request, env }) {
  const pass = new URL(request.url).searchParams.get("pass") || "";
  if (!env.DASHBOARD_PASSCODE || !safeEqual(pass, env.DASHBOARD_PASSCODE)) return new Response("Wrong passcode", { status: 401 });
  const ts = String(Date.now());
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.SITE_URL + "/api/google/callback",
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar",
    access_type: "offline",
    prompt: "consent",
    state: ts + "." + (await sign(env, ts))
  });
  return Response.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + p, 302);
}
