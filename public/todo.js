(function () {
  const g = (id) => document.getElementById(id);
  // Offline test mode: opening index.html straight from your computer (or adding ?mock) uses fake tasks, no server needed.
  const MOCK = location.protocol === "file:" || /[?&]mock\b/.test(location.search);
  const pad = (n) => String(n).padStart(2, "0");
  const key = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const toast = (m) => window.dashToast && window.dashToast(m);
  const T = { projects: [], tasks: [], pid: null, editing: null, loaded: false };

  // ----- fake server for offline testing -----
  const mock = (() => {
    const rid = () => String(Math.random()).slice(2, 10), day = (n) => key(new Date(Date.now() + n * 864e5));
    const projects = [{ id: "p1", name: "Inbox", inbox: true }, { id: "p2", name: "Homework", inbox: false }];
    let tasks = [
      { id: rid(), content: "Buy milk", description: "", projectId: "p1", due: day(0) },
      { id: rid(), content: "Email the teacher", description: "About Friday", projectId: "p1", due: day(1) },
      { id: rid(), content: "Read chapter 4", description: "", projectId: "p2", due: day(-1) },
      { id: rid(), content: "Science project", description: "", projectId: "p2", due: null }
    ];
    let closed = [];
    return async (path, opts = {}) => {
      const q = new URL(path, "http://x").searchParams, m = opts.method || "GET", b = opts.body ? JSON.parse(opts.body) : {}, id = q.get("id");
      if (m === "GET" && q.get("projects")) return { projects };
      if (m === "GET") return { tasks: tasks.filter((t) => !q.get("project_id") || t.projectId === q.get("project_id")) };
      if (m === "POST" && q.get("close")) { closed = tasks.filter((t) => t.id === id).concat(closed); tasks = tasks.filter((t) => t.id !== id); return { ok: true }; }
      if (m === "POST" && q.get("reopen")) { tasks = tasks.concat(closed.filter((t) => t.id === id)); closed = closed.filter((t) => t.id !== id); return { ok: true }; }
      if (m === "POST") { const t = { id: rid(), content: b.content, description: b.description || "", projectId: b.project_id, due: b.due_date || null }; tasks.push(t); return { task: t }; }
      if (m === "PATCH") { const t = tasks.find((x) => x.id === id); if (t) { t.content = b.content; t.description = b.description || ""; t.due = b.due_date || null; } return { task: t }; }
      if (m === "DELETE") { tasks = tasks.filter((t) => t.id !== id); return { ok: true }; }
    };
  })();
  const api = (p, o) => (MOCK ? mock(p, o) : window.dashApi(p, o));

  // ----- helpers -----
  const show = (id) => { g("tListP").hidden = id !== "tListP"; g("tFormP").hidden = id !== "tFormP"; };
  function dueLabel(s) {
    if (!s) return "";
    if (s === key(new Date())) return "Today";
    if (s === key(new Date(Date.now() + 864e5))) return "Tomorrow";
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }

  // ----- list -----
  function renderList() {
    const p = T.projects.find((x) => x.id === T.pid);
    g("tName").textContent = p ? p.name : "Tasks";
    const list = g("tList"); list.innerHTML = "";
    if (!T.tasks.length) { const e = document.createElement("p"); e.className = "cap"; e.textContent = T.pid ? "All clear. Nothing to do." : "No projects found."; list.appendChild(e); return; }
    const today = key(new Date());
    T.tasks.forEach((t) => {
      const row = document.createElement("div"); row.className = "task";
      const chk = document.createElement("button"); chk.type = "button"; chk.className = "chk"; chk.setAttribute("aria-label", "Complete task");
      chk.appendChild(document.createElement("i")); chk.onclick = () => complete(t, row);
      const body = document.createElement("button"); body.type = "button"; body.className = "tbody"; body.onclick = () => openForm(t);
      const title = document.createElement("div"); title.className = "et"; title.textContent = t.content;
      body.appendChild(title);
      if (t.due) { const d = document.createElement("div"); d.className = "cap" + (t.due < today ? " late" : ""); d.textContent = dueLabel(t.due) + (t.recurring ? " · repeats" : ""); body.appendChild(d); }
      row.append(chk, body); list.appendChild(row);
    });
  }
  async function loadTasks() {
    if (!T.pid) { renderList(); return; }
    g("tName").classList.add("busy");
    try { T.tasks = (await api("/api/todoist?project_id=" + encodeURIComponent(T.pid))).tasks; } catch (e) { toast(e.message); }
    g("tName").classList.remove("busy"); renderList();
  }
  async function init() {
    if (T.loaded) return; T.loaded = true;
    try {
      T.projects = (await api("/api/todoist?projects=1")).projects;
      const saved = store.get("todo-project");
      const pick = T.projects.find((p) => p.id === saved) || T.projects.find((p) => p.inbox) || T.projects[0];
      T.pid = pick ? pick.id : null;
    } catch (e) { T.loaded = false; toast(e.message); }
    await loadTasks();
  }

  // ----- complete + undo -----
  let snackTimer, lastDone = null;
  function snack(msg, undo) {
    g("tSnackT").textContent = msg; g("tUndo").hidden = !undo; g("tSnack").hidden = false;
    clearTimeout(snackTimer); snackTimer = setTimeout(() => (g("tSnack").hidden = true), 6000);
  }
  async function complete(t, row) {
    row.classList.add("done");
    try {
      await api("/api/todoist?close=1&id=" + encodeURIComponent(t.id), { method: "POST" });
      lastDone = t; snack("Completed: " + t.content.slice(0, 40), true);
      setTimeout(() => { T.tasks = T.tasks.filter((x) => x.id !== t.id); renderList(); }, 250);
    } catch (e) { row.classList.remove("done"); toast(e.message); }
  }
  g("tUndo").onclick = async () => {
    if (!lastDone) return; const t = lastDone; lastDone = null; g("tSnack").hidden = true;
    try { await api("/api/todoist?reopen=1&id=" + encodeURIComponent(t.id), { method: "POST" }); await loadTasks(); } catch (e) { toast(e.message); }
  };

  // ----- project picker -----
  g("tTitle").onclick = () => {
    const l = g("pList"); l.innerHTML = "";
    T.projects.forEach((p) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "pitem" + (p.id === T.pid ? " on" : ""); b.textContent = p.name;
      b.onclick = () => { T.pid = p.id; store.set("todo-project", p.id); g("tPick").hidden = true; loadTasks(); };
      l.appendChild(b);
    });
    g("tPick").hidden = false;
  };
  g("tPick").onclick = (e) => { if (e.target === g("tPick")) g("tPick").hidden = true; };

  // ----- add / edit -----
  function openForm(t) {
    T.editing = t || null;
    const sel = g("tfProj"); sel.innerHTML = "";
    T.projects.forEach((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; sel.appendChild(o); });
    sel.value = t ? t.projectId : T.pid; sel.disabled = Boolean(t);
    g("tfHead").textContent = t ? "Edit task" : "New task";
    g("tfTitle").value = t ? t.content : ""; g("tfNotes").value = t ? t.description : ""; g("tfDue").value = t && t.due ? t.due : "";
    g("tfDel").hidden = !t; show("tFormP");
  }
  const setDue = (n) => (g("tfDue").value = n === null ? "" : key(new Date(Date.now() + n * 864e5)));
  g("tfToday").onclick = () => setDue(0); g("tfTomorrow").onclick = () => setDue(1); g("tfNone").onclick = () => setDue(null);
  g("tAdd").onclick = () => openForm(null);
  g("tfBack").onclick = () => show("tListP");
  g("tfSave").onclick = async () => {
    const content = g("tfTitle").value.trim();
    if (!content) return toast("Add a title");
    const body = { content, description: g("tfNotes").value, due_date: g("tfDue").value };
    g("tfSave").disabled = true;
    try {
      if (T.editing) await api("/api/todoist?id=" + encodeURIComponent(T.editing.id), { method: "PATCH", body: JSON.stringify(body) });
      else { body.project_id = g("tfProj").value; await api("/api/todoist", { method: "POST", body: JSON.stringify(body) }); T.pid = body.project_id; store.set("todo-project", T.pid); }
      show("tListP"); await loadTasks();
    } catch (e) { toast(e.message); }
    g("tfSave").disabled = false;
  };
  let armed = false;
  g("tfDel").onclick = async () => {
    if (!armed) { armed = true; g("tfDel").textContent = "Tap again to delete"; setTimeout(() => { armed = false; g("tfDel").textContent = "Delete"; }, 3000); return; }
    armed = false; g("tfDel").textContent = "Delete";
    try { await api("/api/todoist?id=" + encodeURIComponent(T.editing.id), { method: "DELETE" }); show("tListP"); await loadTasks(); } catch (e) { toast(e.message); }
  };

  function onRoute() { if (location.hash === "#todo") { show("tListP"); T.loaded ? loadTasks() : init(); } }
  window.addEventListener("hashchange", onRoute); onRoute();
})();
