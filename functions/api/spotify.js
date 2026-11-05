import { guard, json } from "../../lib/shared.js";
import { sp, spotifyTokenInfo } from "../../lib/spotify.js";

const URI = /^spotify:(track|playlist|album|episode):[A-Za-z0-9]+$/;
const ID = /^[A-Za-z0-9]+$/;
const img = (arr, i) => (arr && arr.length ? (arr[Math.min(i, arr.length - 1)] || arr[0]).url : null);
const trackOut = (t) => t && t.uri ? {
  id: t.id, uri: t.uri, name: t.name,
  artists: t.artists ? t.artists.map((a) => a.name).join(", ") : (t.show ? t.show.name : ""),
  image: img(t.album ? t.album.images : t.images, 0), thumb: img(t.album ? t.album.images : t.images, 1), duration: t.duration_ms
} : null;
const bad = (m) => json({ error: m }, 400);

// ?op=now|queue|playlists|playlist&id=|devices   (GET)
// ?op=play|pause|next|prev|seek|transfer|queueadd (POST/PUT)
export const onRequest = guard(async (req, env) => {
  const q = new URL(req.url).searchParams, op = q.get("op") || "";
  const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
  const dev = q.get("device_id");
  if (dev && !ID.test(dev)) return bad("Bad device");
  const dq = dev ? "?device_id=" + dev : "";

  switch (op) {
    case "token": return json(await spotifyTokenInfo(env));
    case "now": {
      const r = await sp(env, "/me/player?additional_types=track,episode");
      if (r.status === 204 || !r.body || !r.body.device) return json({ active: false });
      const s = r.body;
      return json({ active: true, playing: Boolean(s.is_playing), progress: s.progress_ms || 0, device: s.device.name, track: trackOut(s.item), context: s.context ? s.context.uri : null });
    }
    case "queue": {
      try {
        const r = await sp(env, "/me/player/queue");
        return json({ queue: ((r.body && r.body.queue) || []).map(trackOut).filter(Boolean).slice(0, 8) });
      } catch (e) { return json({ queue: [] }); }
    }
    case "playlists": {
      const r = await sp(env, "/me/playlists?limit=50");
      return json({ playlists: (r.body.items || []).filter(Boolean).map((p) => ({ id: p.id, uri: p.uri, name: p.name, image: img(p.images, 0) })) });
    }
    case "playlist": {
      const id = q.get("id") || "";
      if (!ID.test(id)) return bad("Bad playlist");
      try {
        const r = await sp(env, `/playlists/${id}/items?limit=50&additional_types=track`);
        const tracks = (r.body.items || []).map((x) => trackOut(x && (x.item || x.track))).filter(Boolean);
        return json({ tracks });
      } catch (e) {
        if (e.status === 403) throw new Error("Spotify only lists songs for playlists you own or collaborate on. Tap the cover to play it anyway.");
        throw e;
      }
    }
    case "devices": {
      const r = await sp(env, "/me/player/devices");
      return json({ devices: ((r.body && r.body.devices) || []).filter((d) => d.id).map((d) => ({ id: d.id, name: d.name, type: d.type, active: Boolean(d.is_active) })) });
    }
    case "play": {
      const b = {};
      if (body.context_uri) { if (!URI.test(body.context_uri)) return bad("Bad uri"); b.context_uri = body.context_uri; }
      if (Array.isArray(body.uris)) { if (!body.uris.every((u) => URI.test(u))) return bad("Bad uri"); b.uris = body.uris.slice(0, 50); }
      if (body.offset && body.offset.uri) { if (!URI.test(body.offset.uri)) return bad("Bad uri"); b.offset = { uri: body.offset.uri }; }
      await sp(env, "/me/player/play" + dq, { method: "PUT", body: JSON.stringify(b) });
      return json({ ok: true });
    }
    case "pause": await sp(env, "/me/player/pause" + dq, { method: "PUT", body: "" }); return json({ ok: true });
    case "next": await sp(env, "/me/player/next" + dq, { method: "POST", body: "" }); return json({ ok: true });
    case "prev": await sp(env, "/me/player/previous" + dq, { method: "POST", body: "" }); return json({ ok: true });
    case "seek": {
      const ms = Math.max(0, parseInt(q.get("ms"), 10) || 0);
      await sp(env, "/me/player/seek?position_ms=" + ms + (dev ? "&device_id=" + dev : ""), { method: "PUT", body: "" });
      return json({ ok: true });
    }
    case "transfer": {
      if (!dev) return bad("Pick a device");
      await sp(env, "/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [dev], play: true }) });
      return json({ ok: true });
    }
    case "queueadd": {
      const uri = q.get("uri") || body.uri || "";
      if (!URI.test(uri)) return bad("Bad uri");
      await sp(env, "/me/player/queue?uri=" + encodeURIComponent(uri) + (dev ? "&device_id=" + dev : ""), { method: "POST", body: "" });
      return json({ ok: true });
    }
    default: return bad("Unknown request");
  }
});
