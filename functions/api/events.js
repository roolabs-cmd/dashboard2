import { guard, json, gcal } from "../../lib/shared.js";

// Only these fields are ever passed through to Google.
const pick = (b) => { const o = {}; for (const k of ["summary", "description", "location", "start", "end"]) if (b[k] !== undefined) o[k] = b[k]; return o; };
const clean = (e, calendarId) => ({
  id: e.id, calendarId, summary: e.summary || "(No title)", description: e.description || "",
  location: e.location || "", start: e.start, end: e.end, allDay: Boolean(e.start && e.start.date)
});

export const onRequest = guard(async (req, env) => {
  const u = new URL(req.url), q = u.searchParams;

  if (req.method === "GET") {   // /api/events?timeMin=ISO&timeMax=ISO&calendarIds=a,b
    const ids = (q.get("calendarIds") || "").split(",").filter(Boolean);
    if (!q.get("timeMin") || !q.get("timeMax")) return json({ error: "timeMin and timeMax are required" }, 400);
    const qs = new URLSearchParams({ timeMin: q.get("timeMin"), timeMax: q.get("timeMax"), singleEvents: "true", orderBy: "startTime", maxResults: "250" });
    const lists = await Promise.all(ids.map(async (id) => {
      const r = await gcal(env, `/calendars/${encodeURIComponent(id)}/events?${qs}`);
      return r.items.filter((e) => e.status !== "cancelled").map((e) => clean(e, id));
    }));
    return json({ events: lists.flat() });
  }

  const cal = encodeURIComponent(q.get("calendarId") || "primary");
  const eid = q.get("eventId") ? encodeURIComponent(q.get("eventId")) : null;

  if (req.method === "POST") {
    const e = await gcal(env, `/calendars/${cal}/events`, { method: "POST", body: JSON.stringify(pick(await req.json())) });
    return json({ event: clean(e, q.get("calendarId") || "primary") }, 201);
  }
  if (req.method === "PATCH" && eid) {
    const e = await gcal(env, `/calendars/${cal}/events/${eid}`, { method: "PATCH", body: JSON.stringify(pick(await req.json())) });
    return json({ event: clean(e, q.get("calendarId")) });
  }
  if (req.method === "DELETE" && eid) {
    await gcal(env, `/calendars/${cal}/events/${eid}`, { method: "DELETE" });
    return json({ ok: true });
  }
  return json({ error: "Unsupported request" }, 405);
});
