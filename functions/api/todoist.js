import { guard, json } from "../../lib/shared.js";

async function td(env, path, init = {}) {
  const token = env.TODOIST_TOKEN;
  if (!token) throw new Error("TODOIST_TOKEN isn't set in Netlify");
  const res = await fetch("https://api.todoist.com/api/v1" + path, {
    ...init, headers: { authorization: "Bearer " + token, "content-type": "application/json", ...(init.headers || {}) }
  });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch (e) { body = {}; }
  if (!res.ok) throw new Error((body && (body.error || body.message)) || "Todoist error " + res.status);
  return body;
}

const clean = (t) => ({
  id: t.id, content: t.content, description: t.description || "", projectId: t.project_id,
  due: t.due ? String(t.due.date).slice(0, 10) : null, recurring: Boolean(t.due && t.due.is_recurring)
});
// Only these fields are passed through to Todoist.
function fields(b, isNew) {
  const o = {};
  if (b.content !== undefined) o.content = String(b.content);
  if (b.description !== undefined) o.description = String(b.description);
  if (b.due_date) o.due_date = b.due_date;
  else if (b.due_date === "" && !isNew) o.due_string = "no date";
  if (isNew && b.project_id) o.project_id = b.project_id;
  return o;
}

// GET ?projects=1 | GET ?project_id=X | POST (create) | PATCH ?id=X | POST ?id=X&close=1 | POST ?id=X&reopen=1 | DELETE ?id=X
export const onRequest = guard(async (req, env) => {
  const q = new URL(req.url).searchParams, id = q.get("id"), eid = id ? encodeURIComponent(id) : null;

  if (req.method === "GET") {
    if (q.get("projects")) {
      const r = await td(env, "/projects?limit=200");
      return json({ projects: (r.results || []).filter((p) => !p.is_archived && !p.is_deleted)
        .map((p) => ({ id: p.id, name: p.name, inbox: Boolean(p.inbox_project || p.is_inbox_project) })) });
    }
    let all = [], cursor = null;
    for (let i = 0; i < 3; i++) {
      const qs = new URLSearchParams({ limit: "200" });
      if (q.get("project_id")) qs.set("project_id", q.get("project_id"));
      if (cursor) qs.set("cursor", cursor);
      const r = await td(env, "/tasks?" + qs);
      all = all.concat(r.results || []); cursor = r.next_cursor;
      if (!cursor) break;
    }
    return json({ tasks: all.map(clean) });
  }
  if (req.method === "POST" && eid && q.get("close")) { await td(env, `/tasks/${eid}/close`, { method: "POST" }); return json({ ok: true }); }
  if (req.method === "POST" && eid && q.get("reopen")) { await td(env, `/tasks/${eid}/reopen`, { method: "POST" }); return json({ ok: true }); }
  if (req.method === "POST") {
    const t = await td(env, "/tasks", { method: "POST", body: JSON.stringify(fields(await req.json(), true)) });
    return json({ task: t && t.id ? clean(t) : null }, 201);
  }
  if (req.method === "PATCH" && eid) {
    const t = await td(env, `/tasks/${eid}`, { method: "POST", body: JSON.stringify(fields(await req.json(), false)) });
    return json({ task: t && t.id ? clean(t) : null });
  }
  if (req.method === "DELETE" && eid) { await td(env, `/tasks/${eid}`, { method: "DELETE" }); return json({ ok: true }); }
  return json({ error: "Unsupported request" }, 405);
});
