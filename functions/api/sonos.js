import { guard, json } from "../../lib/shared.js";
import { so } from "../../lib/sonos.js";

const ID = /^[A-Za-z0-9_.:\-]{1,80}$/;
const bad = (m) => json({ error: m }, 400);
const enc = encodeURIComponent;

const trackOut = (t, container) => {
  if (!t && !container) return null;
  t = t || {};
  const img = t.imageUrl || (t.images && t.images[0] && t.images[0].url) || (container && (container.imageUrl || (container.images && container.images[0] && container.images[0].url))) || null;
  const name = t.name || (container && container.name) || "";
  if (!name) return null;
  return {
    id: name + "|" + ((t.artist && t.artist.name) || ""), uri: null, name,
    artists: (t.artist && t.artist.name) || (container && container.name && container.name !== name ? container.name : ""),
    image: img, thumb: img, duration: t.durationMillis || 0
  };
};

// ?op=groups | favorites&household= | now&group=      (GET)
// ?op=play|pause|toggle|next|prev|seek&ms=|volume&v=|loadfavorite&favorite=&group=   (POST)
export const onRequest = guard(async (req, env) => {
  const q = new URL(req.url).searchParams, op = q.get("op") || "";
  const group = q.get("group") || "", household = q.get("household") || "";
  if (group && !ID.test(group)) return bad("Bad room");
  if (household && !ID.test(household)) return bad("Bad household");
  const G = "/groups/" + enc(group);
  const need = () => (group ? null : bad("Pick a Sonos room first"));
  const post = async (path, body) => { await so(env, G + path, { method: "POST", body: JSON.stringify(body || {}) }); return json({ ok: true }); };

  switch (op) {
    case "groups": {
      const hh = ((await so(env, "/households")).body.households || []).slice(0, 3);
      const lists = await Promise.all(hh.map(async (h) => {
        const r = (await so(env, `/households/${enc(h.id)}/groups`)).body || {};
        return (r.groups || []).map((g) => ({ id: g.id, name: g.name, household: h.id, state: g.playbackState }));
      }));
      return json({ groups: lists.flat() });
    }
    case "favorites": {
      if (!household) return bad("Missing household");
      const r = (await so(env, `/households/${enc(household)}/favorites`)).body || {};
      return json({ favorites: (r.items || []).map((f) => ({ id: f.id, name: f.name, image: f.imageUrl || (f.images && f.images[0] && f.images[0].url) || null, service: f.service && f.service.name })) });
    }
    case "now": {
      const e = need(); if (e) return e;
      const [pb, md, vol] = await Promise.all([
        so(env, G + "/playback"),
        so(env, G + "/playbackMetadata").catch(() => null),
        so(env, G + "/groupVolume").catch(() => null)
      ]);
      const m = (md && md.body) || {}, p = pb.body || {};
      const cur = m.currentItem && m.currentItem.track, nxt = m.nextItem && m.nextItem.track;
      const track = trackOut(cur, m.container) || (m.streamInfo ? { id: m.streamInfo, uri: null, name: m.streamInfo, artists: (m.container && m.container.name) || "", image: null, thumb: null, duration: 0 } : null);
      const state = p.playbackState || "";
      return json({
        active: true, playing: state === "PLAYBACK_STATE_PLAYING" || state === "PLAYBACK_STATE_BUFFERING",
        progress: p.positionMillis || 0, track, queue: [trackOut(nxt)].filter(Boolean),
        volume: vol && vol.body && typeof vol.body.volume === "number" ? vol.body.volume : null
      });
    }
    case "play": { const e = need(); return e || post("/playback/play"); }
    case "pause": { const e = need(); return e || post("/playback/pause"); }
    case "toggle": { const e = need(); return e || post("/playback/togglePlayPause"); }
    case "next": { const e = need(); return e || post("/playback/skipToNextTrack"); }
    case "prev": { const e = need(); return e || post("/playback/skipToPreviousTrack"); }
    case "seek": { const e = need(); return e || post("/playback/seek", { positionMillis: Math.max(0, parseInt(q.get("ms"), 10) || 0) }); }
    case "volume": {
      const e = need(); if (e) return e;
      return post("/groupVolume", { volume: Math.max(0, Math.min(100, parseInt(q.get("v"), 10) || 0)) });
    }
    case "loadfavorite": {
      const e = need(); if (e) return e;
      const fav = (q.get("favorite") || "").slice(0, 36);
      if (!fav) return bad("Missing favorite");
      return post("/favorites", { favoriteId: fav, action: "REPLACE", playOnCompletion: true });
    }
    default: return bad("Unknown request");
  }
});
