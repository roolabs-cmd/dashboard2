// Chat: one admin (you) and one guest per chat. Text only. Live updates come from Supabase Realtime;
// if that isn't available the page simply checks for new messages every few seconds.
(function () {
  const $ = (id) => document.getElementById(id);
  const root = $("chat");
  if (!root) return;
  const toast = (m) => window.dashToast && window.dashToast(m);
  const SB_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.100.0";
  const POLL_FAST = 4000, POLL_SLOW = 30000, LIST_POLL = 15000;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
  };
  const seenMap = () => { try { return JSON.parse(store.get("chat.seen") || "{}") || {}; } catch (e) { return {}; } };
  const markSeen = (id, last) => { if (!last) return; const m = seenMap(); if ((m[id] || 0) >= last) return; m[id] = last; store.set("chat.seen", JSON.stringify(m)); };

  let token = store.get("chat.token");
  let role = null;          // "admin" | "guest"
  let rtCfg = null;
  let chat = null;          // chat currently open
  let msgs = [], more = false;
  let listTimer = 0, pollTimer = 0, channel = null, client = null, live = false, libPromise = null;
  let fetching = false, again = false, sending = false;
  let formMode = null, formPhoto, formChat = null;

  // ---------- api (does not use the dashboard passcode) ----------
  async function api(op, { method = "GET", body, query } = {}) {
    const qs = new URLSearchParams({ op, ...(query || {}) });
    const h = {};
    if (token) h.authorization = "Bearer " + token;
    if (body !== undefined) h["content-type"] = "application/json";
    let r;
    try { r = await fetch("/api/chat?" + qs, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { const er = new Error("Can't reach the chat right now"); er.net = true; throw er; }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && token && op !== "login") { signOut(true); const er = new Error("Signed out"); er.status = 401; throw er; }
    if (!r.ok) { const er = new Error(j.error || "Something went wrong"); er.status = r.status; throw er; }
    return j;
  }

  // ---------- small helpers ----------
  const show = (id) => { ["chLogin", "chList", "chForm", "chConv"].forEach((s) => { $(s).hidden = s !== id; }); };
  function avatar(el, name, photo) {
    el.textContent = "";
    if (typeof photo === "string" && photo.startsWith("data:image/")) {
      const i = document.createElement("img"); i.alt = ""; i.src = photo; el.appendChild(i);
    } else el.textContent = ([...(name || "?").trim()][0] || "?").toUpperCase();
  }
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dayKey = (iso) => { const d = new Date(iso); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); };
  function dayLabel(iso) {
    const d = new Date(iso), n = new Date();
    if (dayKey(iso) === dayKey(n.toISOString())) return "Today";
    const y = new Date(n); y.setDate(n.getDate() - 1);
    if (dayKey(iso) === dayKey(y.toISOString())) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === n.getFullYear() ? undefined : "numeric" });
  }
  const ago = (iso) => {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "now"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  };

  // ---------- sign in / out ----------
  function signOut(expired) {
    stopLive(); clearInterval(listTimer);
    token = null; role = null; chat = null; rtCfg = null; msgs = [];
    store.set("chat.token", null);
    $("chCode").value = ""; $("chErr").textContent = expired === true ? "You were signed out. Enter your code again." : "";
    show("chLogin");
  }

  async function doLogin() {
    const code = $("chCode").value;
    if (!code.trim()) { $("chErr").textContent = "Enter your code"; return; }
    $("chGo").disabled = true; $("chErr").textContent = "";
    try {
      const j = await api("login", { method: "POST", body: { code } });
      token = j.token; store.set("chat.token", token); $("chCode").value = "";
      await enter();
    } catch (e) { $("chErr").textContent = e.message; }
    $("chGo").disabled = false;
  }
  $("chGo").addEventListener("click", doLogin);
  $("chCode").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  $("chOutA").addEventListener("click", () => signOut());
  $("chOutG").addEventListener("click", () => signOut());

  // ---------- entering the page ----------
  async function enter() {
    if (!token) { show("chLogin"); return; }
    try {
      const j = await api("me");
      role = j.role; rtCfg = j.realtime || null;
      if (role === "admin") showList(); else openChat(j.chat);
    } catch (e) {
      if (e.status === 401) return;
      show("chLogin"); $("chErr").textContent = e.message;
    }
  }

  function leave() { stopLive(); clearInterval(listTimer); listTimer = 0; }

  // ---------- admin: chat list ----------
  async function loadList() {
    try {
      const j = await api("chats");
      const box = $("chItems"); box.textContent = "";
      if (!j.chats.length) {
        const d = document.createElement("div"); d.className = "chempty"; d.textContent = "No chats yet. Tap New to make one."; box.appendChild(d); return;
      }
      const seen = seenMap();
      j.chats.forEach((c) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "chrow";
        const av = document.createElement("div"); av.className = "chav"; avatar(av, c.name, c.photo);
        const mid = document.createElement("div"); mid.className = "mid";
        const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = c.name;
        const pv = document.createElement("div"); pv.className = "pv";
        pv.textContent = c.last ? (c.last.sender === "admin" ? "You: " : "") + c.last.body.replace(/\s+/g, " ") : "No messages yet";
        mid.append(nm, pv); b.append(av, mid);
        if (c.last) {
          const t = document.createElement("div"); t.className = "cap"; t.textContent = ago(c.last.at); b.appendChild(t);
          if (c.last.sender === "guest" && c.last.id > (seen[c.id] || 0)) { const d = document.createElement("i"); d.className = "dot"; d.setAttribute("aria-label", "New message"); b.appendChild(d); }
        }
        b.addEventListener("click", () => openChat(c));
        box.appendChild(b);
      });
    } catch (e) { if (e.status !== 401) toast(e.message); }
  }
  function showList() {
    stopLive(); chat = null; show("chList"); loadList();
    clearInterval(listTimer); listTimer = setInterval(loadList, LIST_POLL);
  }
  $("chNew").addEventListener("click", () => openForm(null));

  // ---------- admin: create / edit ----------
  function openForm(c) {
    formMode = c ? "edit" : "create"; formChat = c; formPhoto = undefined;
    $("chFHead").textContent = c ? "Edit chat" : "New chat";
    $("chFName").value = c ? c.name : ""; $("chFCode").value = ""; $("chFErr").textContent = "";
    $("chFCode").placeholder = c ? "Leave empty to keep the current code" : "At least 8 characters";
    $("chFNote").textContent = c ? "Setting a new code signs the guest out until they enter it. Codes can't be shown again, only replaced." : "Give this code to the one person who will chat with you. At least 8 characters.";
    drawFormPhoto(c ? c.photo : null);
    clearInterval(listTimer); listTimer = 0;
    show("chForm");
  }
  function drawFormPhoto(p) {
    avatar($("chFAv"), $("chFName").value || "?", p);
    $("chFRm").hidden = !(typeof p === "string" && p);
  }
  $("chFName").addEventListener("input", () => { if (formPhoto === undefined ? !(formChat && formChat.photo) : !formPhoto) drawFormPhoto(null); });
  $("chFPick").addEventListener("click", () => $("chFFile").click());
  $("chFRm").addEventListener("click", () => { formPhoto = null; drawFormPhoto(null); });
  $("chFFile").addEventListener("change", async () => {
    const f = $("chFFile").files[0]; $("chFFile").value = "";
    if (!f) return;
    try { formPhoto = await shrink(f); drawFormPhoto(formPhoto); $("chFErr").textContent = ""; }
    catch (e) { $("chFErr").textContent = "That file couldn't be used as a photo"; }
  });
  function shrink(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(jpeg|png|webp|gif|heic)/i.test(file.type) && file.type) return reject(new Error("type"));
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        try {
          const S = 256, c = document.createElement("canvas"); c.width = c.height = S;
          const x = c.getContext("2d"), m = Math.min(img.width, img.height);
          x.fillStyle = "#26201b"; x.fillRect(0, 0, S, S);
          x.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
          resolve(c.toDataURL("image/jpeg", 0.82));
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
      img.src = url;
    });
  }
  $("chFBack").addEventListener("click", () => { if (formMode === "edit" && chat) { show("chConv"); startLive(); } else showList(); });
  $("chFSave").addEventListener("click", async () => {
    const name = $("chFName").value.trim(), code = $("chFCode").value;
    const err = (m) => { $("chFErr").textContent = m; };
    if (!name) return err("Give the chat a name");
    if (formMode === "create" && [...code.trim()].length < 8) return err("The code needs at least 8 characters");
    if (code && [...code.trim()].length < 8) return err("The code needs at least 8 characters");
    $("chFSave").disabled = true; err("");
    try {
      if (formMode === "create") {
        const body = { name, code }; if (formPhoto) body.photo = formPhoto;
        await api("create", { method: "POST", body });
        toast("Chat created"); showList();
      } else {
        const body = { id: formChat.id };
        if (name !== formChat.name) body.name = name;
        if (formPhoto !== undefined) body.photo = formPhoto;
        if (code) body.code = code;
        if (Object.keys(body).length === 1) { $("chFBack").click(); }
        else {
          const j = await api("update", { method: "POST", body });
          chat = j.chat; paintHead(); toast(code ? "Saved. The guest must use the new code." : "Saved");
          if (code) { stopLive(); show("chConv"); await loadFirst(); } else { show("chConv"); startLive(); }
        }
      }
    } catch (e) { err(e.message); }
    $("chFSave").disabled = false;
  });
  $("chEdit").addEventListener("click", () => { stopLive(); openForm(chat); });

  // ---------- conversation ----------
  function paintHead() {
    avatar($("chAv"), chat.name, chat.photo);
    $("chTitle").textContent = chat.name;
  }
  async function openChat(c) {
    chat = c; msgs = []; more = false;
    clearInterval(listTimer); listTimer = 0;
    paintHead(); $("chEdit").hidden = role !== "admin"; $("chOutG").hidden = role === "admin";
    $("chState").textContent = ""; $("chIn").value = ""; autoGrow();
    $("chMsgs").textContent = "";
    show("chConv");
    await loadFirst();
  }
  async function loadFirst() {
    try {
      const j = await api("messages", { query: role === "admin" ? { chat: chat.id } : {} });
      msgs = j.messages; more = j.more; renderAll(true); noteSeen();
      startLive();
    } catch (e) { if (e.status !== 401) { toast(e.message); startLive(); } }
  }
  const lastId = () => (msgs.length ? msgs[msgs.length - 1].id : 0);
  function noteSeen() { if (role === "admin" && chat) markSeen(chat.id, lastId()); }

  function renderAll(stick, keepFrom) {
    const box = $("chMsgs");
    const nearEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    const prevH = box.scrollHeight, prevTop = box.scrollTop;
    box.textContent = "";
    if (more) {
      const b = document.createElement("button"); b.type = "button"; b.className = "chmore"; b.textContent = "Load earlier messages";
      b.addEventListener("click", loadEarlier); box.appendChild(b);
    }
    let day = "";
    msgs.forEach((m) => {
      const k = dayKey(m.at);
      if (k !== day) { day = k; const d = document.createElement("div"); d.className = "chday"; d.textContent = dayLabel(m.at); box.appendChild(d); }
      const b = document.createElement("div"); b.className = "chb " + (m.sender === role ? "me" : "them");
      b.appendChild(document.createTextNode(m.body));
      const t = document.createElement("time"); t.dateTime = m.at; t.textContent = fmtTime(m.at); b.appendChild(t);
      box.appendChild(b);
    });
    if (keepFrom) box.scrollTop = prevTop + (box.scrollHeight - prevH);
    else if (stick || nearEnd) box.scrollTop = box.scrollHeight;
    else box.scrollTop = prevTop;
  }
  async function loadEarlier() {
    if (!msgs.length) return;
    try {
      const j = await api("messages", { query: { ...(role === "admin" ? { chat: chat.id } : {}), before: String(msgs[0].id) } });
      msgs = j.messages.concat(msgs); more = j.more; renderAll(false, true);
    } catch (e) { if (e.status !== 401) toast(e.message); }
  }
  function merge(list) {
    const have = new Set(msgs.map((m) => m.id)); let added = 0;
    list.forEach((m) => { if (!have.has(m.id)) { msgs.push(m); added++; } });
    if (added) msgs.sort((a, b) => a.id - b.id);
    return added;
  }
  async function fetchNew() {
    if (!chat || $("chConv").hidden) return;
    if (fetching) { again = true; return; }
    fetching = true;
    const mine = chat.id;
    try {
      do {
        again = false;
        const j = await api("messages", { query: { ...(role === "admin" ? { chat: chat.id } : {}), after: String(lastId()) } });
        if (!chat || chat.id !== mine) break;
        if (merge(j.messages)) { renderAll(false); noteSeen(); }
      } while (again);
    } catch (e) { /* the next check will try again */ }
    fetching = false;
  }

  // ---------- sending ----------
  function autoGrow() { const t = $("chIn"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }
  $("chIn").addEventListener("input", autoGrow);
  $("chIn").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(pointer:fine)").matches) { e.preventDefault(); send(); }
  });
  $("chBar").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  async function send() {
    const text = $("chIn").value.trim();
    if (!text || sending || !chat) return;
    sending = true; $("chSend").disabled = true;
    try {
      const body = { text }; if (role === "admin") body.chat = chat.id;
      const j = await api("send", { method: "POST", body });
      $("chIn").value = ""; autoGrow();
      merge([j.message]); renderAll(true); noteSeen();
    } catch (e) { if (e.status !== 401) toast(e.message); }
    sending = false; $("chSend").disabled = false;
    if (matchMedia("(pointer:fine)").matches) $("chIn").focus();
  }

  // ---------- live updates ----------
  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    if (libPromise) return libPromise;
    libPromise = new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = SB_LIB; s.onload = res; s.onerror = () => { libPromise = null; rej(new Error("lib")); };
      document.head.appendChild(s);
    });
    return libPromise;
  }
  function setLive(v) {
    live = v; $("chState").textContent = v ? "Live" : "";
    schedulePoll();
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!chat || $("chConv").hidden) return;
    pollTimer = setTimeout(async () => { await fetchNew(); schedulePoll(); }, live ? POLL_SLOW : POLL_FAST);
  }
  async function startLive() {
    stopLive(); if (!chat) return;
    const mine = chat;
    schedulePoll();
    if (!rtCfg || !chat.rt) return;
    try {
      await loadLib();
      if (chat !== mine || $("chConv").hidden) return;
      client = window.supabase.createClient(rtCfg.url, rtCfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      channel = client.channel("chat-" + mine.rt, { config: { broadcast: { self: false } } })
        .on("broadcast", { event: "ping" }, () => fetchNew())
        .subscribe((status) => {
          if (chat !== mine) return;
          if (status === "SUBSCRIBED") { setLive(true); fetchNew(); } else if (live) setLive(false);
        });
    } catch (e) { setLive(false); }
  }
  function stopLive() {
    clearTimeout(pollTimer); pollTimer = 0; live = false;
    try { if (client && channel) client.removeChannel(channel); } catch (e) {}
    channel = null; client = null;
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && chat && !$("chConv").hidden) fetchNew(); });

  $("chBack").addEventListener("click", () => {
    if (role === "admin") showList(); else { leave(); location.hash = ""; }
  });

  // ---------- routing ----------
  function onRoute() {
    if (location.hash === "#chat") { if (!root.dataset.started) { root.dataset.started = "1"; enter(); } }
    else if (root.dataset.started) { delete root.dataset.started; leave(); }
  }
  window.addEventListener("hashchange", onRoute);
  setTimeout(onRoute, 0);
})();
