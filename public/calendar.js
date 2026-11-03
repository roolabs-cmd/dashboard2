(function () {
  const g = (id) => document.getElementById(id);
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pad = (n) => String(n).padStart(2, "0");
  const key = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const hm = (d) => pad(d.getHours()) + ":" + pad(d.getMinutes());
  const fmtT = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const colorOk = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : "#f0a24b");
  const now = new Date();
  const S = { cals: [], hidden: [], events: [], month: new Date(now.getFullYear(), now.getMonth(), 1), sel: null, editing: null, loaded: false, back: "cGrid" };
  const cal = (id) => S.cals.find((c) => c.id === id) || {};

  // ----- passcode + API -----
  let mem = "", pending = null;
  const getPass = () => { try { return localStorage.getItem("dash-pass") || mem; } catch (e) { return mem; } };
  const setPass = (v) => { mem = v; try { v ? localStorage.setItem("dash-pass", v) : localStorage.removeItem("dash-pass"); } catch (e) {} };
  function askPass(note) {
    if (pending) return pending;
    g("lockNote").textContent = note || "Enter your dashboard passcode";
    g("lockIn").value = ""; g("cLock").hidden = false;
    pending = new Promise((res) => {
      g("lockGo").onclick = () => {
        const v = g("lockIn").value.trim(); if (!v) return;
        setPass(v); g("cLock").hidden = true; pending = null; res();
      };
    });
    return pending;
  }
  g("lockIn").addEventListener("keydown", (e) => { if (e.key === "Enter") g("lockGo").click(); });

  async function api(path, opts = {}) {
    if (!getPass()) await askPass();
    const r = await fetch(path, { ...opts, headers: { "x-passcode": getPass(), "content-type": "application/json" } });
    if (r.status === 401) { setPass(""); await askPass("Wrong passcode, try again"); return api(path, opts); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Request failed (" + r.status + ")");
    return j;
  }
  let tt;
  function toast(m) { const e = g("cMsg"); e.textContent = m; e.hidden = false; clearTimeout(tt); tt = setTimeout(() => (e.hidden = true), 4500); }

  // ----- data -----
  const gridStart = (m) => addDays(m, -m.getDay());
  async function loadEvents() {
    const gs = gridStart(S.month);
    const ids = S.cals.filter((c) => !S.hidden.includes(c.id)).map((c) => c.id);
    if (!ids.length) { S.events = []; return; }
    const j = await api("/api/events?" + new URLSearchParams({ timeMin: gs.toISOString(), timeMax: addDays(gs, 42).toISOString(), calendarIds: ids.join(",") }));
    S.events = j.events;
  }
  const startMs = (e) => (e.allDay ? parseKey(e.start.date) : new Date(e.start.dateTime)).getTime();
  function dayMap() {
    const m = {};
    S.events.forEach((e) => {
      let s, en;
      if (e.allDay) { s = parseKey(e.start.date); en = addDays(parseKey(e.end.date), -1); }
      else {
        s = new Date(e.start.dateTime); en = new Date(e.end.dateTime);
        if (en > s && en.getHours() === 0 && en.getMinutes() === 0) en = addDays(en, -1);
        s = new Date(s.getFullYear(), s.getMonth(), s.getDate()); en = new Date(en.getFullYear(), en.getMonth(), en.getDate());
      }
      for (let d = s, i = 0; d <= en && i < 31; d = addDays(d, 1), i++) (m[key(d)] = m[key(d)] || []).push(e);
    });
    Object.values(m).forEach((a) => a.sort((x, y) => (y.allDay ? 1 : 0) - (x.allDay ? 1 : 0) || startMs(x) - startMs(y)));
    return m;
  }
  const when = (e) => (e.allDay ? "All day" : fmtT(new Date(e.start.dateTime)) + " – " + fmtT(new Date(e.end.dateTime)));

  // ----- views -----
  const show = (id) => ["cGrid", "cDay", "cForm"].forEach((p) => (g(p).hidden = p !== id));
  function renderGrid() {
    g("cTitle").textContent = S.month.toLocaleDateString([], { month: "long", year: "numeric" });
    const gs = gridStart(S.month), dm = dayMap(), today = key(new Date()), el = g("mGrid");
    el.innerHTML = "";
    for (let i = 0; i < 42; i++) {
      const d = addDays(gs, i), k = key(d), evs = dm[k] || [];
      const c = document.createElement("button"); c.type = "button";
      c.className = "cell" + (d.getMonth() !== S.month.getMonth() ? " out" : "") + (k === today ? " today" : "");
      const b = document.createElement("b"); b.textContent = d.getDate();
      const dots = document.createElement("span"); dots.className = "dots";
      evs.slice(0, 3).forEach((e) => { const i2 = document.createElement("i"); i2.style.background = colorOk(cal(e.calendarId).color); dots.appendChild(i2); });
      c.append(b, dots); c.onclick = () => openDay(k); el.appendChild(c);
    }
  }
  function renderDay() {
    g("dTitle").textContent = parseKey(S.sel).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    const evs = dayMap()[S.sel] || [], list = g("dList"); list.innerHTML = "";
    if (!evs.length) { const p = document.createElement("p"); p.className = "cap"; p.textContent = "Nothing scheduled."; list.appendChild(p); }
    evs.forEach((e) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "ev";
      const dot = document.createElement("i"); dot.style.background = colorOk(cal(e.calendarId).color);
      const box = document.createElement("div");
      const t = document.createElement("div"); t.className = "et"; t.textContent = e.summary;
      const w = document.createElement("div"); w.className = "cap"; w.textContent = when(e) + (e.location ? " · " + e.location : "");
      box.append(t, w);
      if (e.description) { const n = document.createElement("div"); n.className = "cap notes"; n.textContent = e.description.slice(0, 200); box.appendChild(n); }
      b.append(dot, box); b.onclick = () => openForm(e); list.appendChild(b);
    });
  }
  function openDay(k) { S.sel = k; renderDay(); show("cDay"); }
  async function refresh() {
    g("cTitle").classList.add("busy");
    try { await loadEvents(); } catch (e) { toast(e.message); }
    g("cTitle").classList.remove("busy"); renderGrid(); if (!g("cDay").hidden) renderDay();
  }
  function step(n) { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + n, 1); refresh(); }

  // ----- form -----
  const timeRows = () => ["fSt", "fEt"].forEach((i) => (g(i).hidden = g("fAll").checked));
  g("fAll").onchange = timeRows;
  function openForm(e) {
    S.editing = e || null; S.back = g("cDay").hidden ? "cGrid" : "cDay";
    const sel = g("fCal"); sel.innerHTML = "";
    const opts = S.cals.filter((c) => c.canEdit);
    if (e && !opts.find((c) => c.id === e.calendarId)) opts.push(cal(e.calendarId));
    opts.forEach((c) => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.name || c.id; sel.appendChild(o); });
    const ro = Boolean(e) && !cal(e.calendarId).canEdit;
    const pri = S.cals.find((c) => c.primary && c.canEdit);
    sel.value = e ? e.calendarId : pri ? pri.id : opts[0] ? opts[0].id : "";
    sel.disabled = Boolean(e);
    g("fHead").textContent = e ? (ro ? "Event (read only)" : "Edit event") : "New event";
    let sd, ed, st = "09:00", et = "10:00", all = false;
    if (e && e.allDay) { all = true; sd = e.start.date; ed = key(addDays(parseKey(e.end.date), -1)); }
    else if (e) { const a = new Date(e.start.dateTime), b = new Date(e.end.dateTime); sd = key(a); ed = key(b); st = hm(a); et = hm(b); }
    else { sd = ed = S.sel || key(new Date()); }
    g("fTitle").value = e ? e.summary : ""; g("fAll").checked = all;
    g("fSd").value = sd; g("fEd").value = ed; g("fSt").value = st; g("fEt").value = et;
    g("fLoc").value = e ? e.location : ""; g("fNotes").value = e ? e.description : "";
    ["fTitle", "fAll", "fSd", "fEd", "fSt", "fEt", "fLoc", "fNotes"].forEach((i) => (g(i).disabled = ro));
    g("fSave").hidden = ro; g("fDel").hidden = !e || ro; timeRows(); show("cForm");
  }
  g("fSave").onclick = async () => {
    const all = g("fAll").checked, sd = g("fSd").value, ed = g("fEd").value || sd;
    if (!sd) return toast("Pick a date");
    const calId = g("fCal").value; if (!calId) return toast("No editable calendar available");
    let start, end;
    if (all) {
      if (parseKey(ed) < parseKey(sd)) return toast("End must be after start");
      start = { date: sd }; end = { date: key(addDays(parseKey(ed), 1)) };
      if (S.editing) { start.dateTime = null; end.dateTime = null; }
    } else {
      const a = new Date(sd + "T" + (g("fSt").value || "09:00")), b = new Date(ed + "T" + (g("fEt").value || "10:00"));
      if (b <= a) return toast("End must be after start");
      start = { dateTime: a.toISOString(), timeZone: TZ }; end = { dateTime: b.toISOString(), timeZone: TZ };
      if (S.editing) { start.date = null; end.date = null; }
    }
    const body = JSON.stringify({ summary: g("fTitle").value.trim() || "(No title)", location: g("fLoc").value, description: g("fNotes").value, start, end });
    g("fSave").disabled = true;
    try {
      const q = "calendarId=" + encodeURIComponent(calId);
      if (S.editing) await api("/api/events?" + q + "&eventId=" + encodeURIComponent(S.editing.id), { method: "PATCH", body });
      else await api("/api/events?" + q, { method: "POST", body });
      S.month = new Date(parseKey(sd).getFullYear(), parseKey(sd).getMonth(), 1);
      await loadEvents(); S.sel = sd; renderGrid(); openDay(sd);
    } catch (e) { toast(e.message); }
    g("fSave").disabled = false;
  };
  let armed = false;
  g("fDel").onclick = async () => {
    if (!armed) { armed = true; g("fDel").textContent = "Tap again to delete"; setTimeout(() => { armed = false; g("fDel").textContent = "Delete"; }, 3000); return; }
    armed = false; g("fDel").textContent = "Delete";
    try {
      await api("/api/events?calendarId=" + encodeURIComponent(S.editing.calendarId) + "&eventId=" + encodeURIComponent(S.editing.id), { method: "DELETE" });
      await loadEvents(); renderGrid(); renderDay(); show(S.back === "cDay" ? "cDay" : "cGrid");
    } catch (e) { toast(e.message); }
  };

  // ----- sidebar -----
  function renderSide() {
    const l = g("sList"); l.innerHTML = "";
    S.cals.forEach((c) => {
      const row = document.createElement("label"); row.className = "srow";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !S.hidden.includes(c.id);
      const dot = document.createElement("i"); dot.style.background = colorOk(c.color);
      const nm = document.createElement("span"); nm.textContent = c.name;
      cb.onchange = () => {
        S.hidden = cb.checked ? S.hidden.filter((x) => x !== c.id) : [...S.hidden, c.id];
        api("/api/calendars", { method: "PUT", body: JSON.stringify({ hidden: S.hidden }) }).catch((e) => toast(e.message));
        refresh();
      };
      row.append(cb, dot, nm); l.appendChild(row);
    });
  }
  g("cMenu").onclick = () => (g("cSide").hidden = false);
  g("sClose").onclick = () => (g("cSide").hidden = true);
  g("sPass").onclick = () => { setPass(""); g("cSide").hidden = true; askPass("Enter a new passcode"); };

  // ----- wiring -----
  g("cPrev").onclick = () => step(-1);
  g("cNext").onclick = () => step(1);
  g("cTitle").onclick = () => { S.month = new Date(now.getFullYear(), now.getMonth(), 1); refresh(); };
  g("cAdd").onclick = () => { S.sel = null; openForm(null); };
  g("dAdd").onclick = () => openForm(null);
  g("dBack").onclick = () => show("cGrid");
  g("fBack").onclick = () => show(S.back);
  let x0 = null;
  g("mGrid").addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  g("mGrid").addEventListener("touchend", (e) => {
    if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 70) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  async function init() {
    if (S.loaded) return; S.loaded = true;
    try { const j = await api("/api/calendars"); S.cals = j.calendars; S.hidden = j.hidden; renderSide(); await loadEvents(); }
    catch (e) { S.loaded = false; toast(e.message); }
    renderGrid();
  }
  function onRoute() { if (location.hash === "#calendar") { renderGrid(); init(); } }
  window.addEventListener("hashchange", onRoute); onRoute();
  window.dashApi = api; window.dashToast = toast;
})();
