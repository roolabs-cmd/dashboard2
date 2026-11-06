import * as calendars from "./functions/api/calendars.js";
import * as events from "./functions/api/events.js";
import * as brief from "./functions/api/brief.js";
import * as todoist from "./functions/api/todoist.js";
import * as gStart from "./functions/api/google/start.js";
import * as gCallback from "./functions/api/google/callback.js";
import * as spotify from "./functions/api/spotify.js";
import * as sStart from "./functions/api/spotify/start.js";
import * as sCallback from "./functions/api/spotify/callback.js";
import * as sonos from "./functions/api/sonos.js";
import * as soStart from "./functions/api/sonos/start.js";
import * as soCallback from "./functions/api/sonos/callback.js";

// Only /api/* requests reach this Worker; everything else is served from the public folder.
const routes = {
  "/api/calendars": calendars,
  "/api/events": events,
  "/api/brief": brief,
  "/api/todoist": todoist,
  "/api/google/start": gStart,
  "/api/google/callback": gCallback,
  "/api/spotify": spotify,
  "/api/spotify/start": sStart,
  "/api/spotify/callback": sCallback,
  "/api/sonos": sonos,
  "/api/sonos/start": soStart,
  "/api/sonos/callback": soCallback
};

export default {
  async fetch(request, env, ctx) {
    const mod = routes[new URL(request.url).pathname];
    if (!mod) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
    const m = request.method;
    const fn = mod["onRequest" + m[0] + m.slice(1).toLowerCase()] || mod.onRequest;
    if (!fn) return new Response("Method not allowed", { status: 405 });
    return fn({ request, env, ctx });
  }
};
