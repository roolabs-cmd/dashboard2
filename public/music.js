(function () {
  const g = (id) => document.getElementById(id);
  // Offline test mode: opening index.html from your computer (or adding ?mock) uses fake songs, no Spotify needed.
  const MOCK = location.protocol === "file:" || /[?&]mock\b/.test(location.search);
  const toast = (m) => window.dashToast && window.dashToast(m);
  const ICON = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    queue: '<path d="M4 5l5 3-5 3z"/><path d="M13 6h7M4 15h16M4 19h16"/>',
    note: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="16" r="2.5"/>',
    spk: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
    menu: '<rect x="4" y="4" width="16" height="4.5" rx="2.2"/><path d="M4 13h16M4 19h16"/>'
  };
  const svg = (k) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + "</svg>";
  const PLAY = '<svg viewBox="0 0 32 40" aria-hidden="true"><path d="M2 2l28 18L2 38z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 32 40" aria-hidden="true"><rect x="3" y="2" width="9" height="36" rx="2"/><rect x="20" y="2" width="9" height="36" rx="2"/></svg>';
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const M = { sdk: null, deviceId: null, local: false, sdkStarted: false, sdkNote: "", preferLocal: ls.get("music-local") === "1", activated: false, now: null, stamp: 0, queue: [], qFor: undefined, lists: null, listsAt: 0, list: null, panel: "mPlayer", poll: null, tick: null, busy: false, errShown: false };

  // ----- fake Spotify for offline testing -----
  const mock = (() => {
    const mk = (n, i) => ({ id: "t" + i, uri: "spotify:track:t" + i, name: n, artists: "Demo Artist", image: null, thumb: null, duration: 180000 + i * 15000 });
    const songs = ["Midnight Rain", "Golden Hour", "Paper Rings", "Slow Burn", "Blue Static", "Lantern", "Afterglow", "Harbor Lights"].map(mk);
    const lists = ["My Playlist", "Focus", "Morning", "Road Trip", "Chill", "Workout"].map((n, i) => ({ id: "p" + i, uri: "spotify:playlist:p" + i, name: n, image: null }));
    let cur = 0, playing = true, progress = 40000, last = Date.now();
    const sync = () => { const n = Date.now(); if (playing) progress += n - last; last = n; };
    return async (path, opts = {}) => {
      const q = new URL(path, "http://x").searchParams, op = q.get("op"), b = opts.body ? JSON.parse(opts.body) : {};
      sync();
      switch (op) {
        case "now": return { active: true, playing, progress, device: "Demo speaker", track: songs[cur] };
        case "queue": return { queue: songs.slice(cur + 1, cur + 7) };
        case "playlists": return { playlists: lists };
        case "playlist": return { tracks: songs.slice(0, 5) };
        case "devices": return { devices: [{ id: "d1", name: "Demo speaker", type: "Speaker", active: true }, { id: "d2", name: "Demo phone", type: "Smartphone", active: false }] };
        case "play": if (b.offset && b.offset.uri) cur = Math.max(0, songs.findIndex((s) => s.uri === b.offset.uri)); if (b.context_uri) progress = 0; playing = true; return { ok: true };
        case "pause": playing = false; return { ok: true };
        case "next": cur = (cur + 1) % songs.length; progress = 0; playing = true; return { ok: true };
        case "prev": cur = (cur + songs.length - 1) % songs.length; progress = 0; return { ok: true };
        case "seek": progress = Number(q.get("ms")) || 0; return { ok: true };
        default: return { ok: true };
      }
    };
  })();
  const api = (p, o) => (MOCK ? mock(p, o) : window.dashApi(p, o));
  const A = "/api/spotify?op=";
  const post = (op, extra, body) => api(A + op + (extra || ""), { method: "POST", body: body ? JSON.stringify(body) : undefined });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function fail(e) {
    if (/No active Spotify device/.test(e.message)) openDevices(e.message); else toast(e.message);
  }

  // ----- artwork -----
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  function art(el, url, seed) {
    if (url && /^https:\/\//.test(url)) el.style.backgroundImage = 'url("' + url + '")';
    else { const h = hue(seed); el.style.backgroundImage = "linear-gradient(135deg,hsl(" + h + " 45% 38%),hsl(" + ((h + 50) % 360) + " 45% 22%))"; }
  }

  // ----- player -----
  const curMs = () => {
    const n = M.now; if (!n || !n.track) return 0;
    return Math.min(n.progress + (n.playing ? Date.now() - M.stamp : 0), n.track.duration || Infinity);
  };
  function drawProg() { const t = M.now && M.now.track; g("mFill").style.width = t && t.duration ? Math.min(100, (curMs() / t.duration) * 100) + "%" : "0%"; }
  function renderNow() {
    const n = M.now, t = n && n.track;
    g("mTitle").textContent = t ? t.name : "Nothing playing";
    g("mArtist").textContent = t ? t.artists : "Start Spotify on a device, or tap the speaker button";
    art(g("mArt"), t && t.image, t ? t.name : "idle");
    g("mPlay").innerHTML = n && n.playing ? PAUSE : PLAY;
    drawProg();
  }
  function renderQueue() {
    const s = g("mQueue"); s.innerHTML = '<div class="qh">' + svg("menu") + "</div>";
    M.queue.slice(0, 6).forEach((t, i) => {
      const d = document.createElement("button"); d.type = "button"; d.className = "qt";
      d.setAttribute("aria-label", "Skip to " + t.name); art(d, t.thumb || t.image, t.name);
      d.onclick = () => skipTo(i); s.appendChild(d);
    });
  }
  async function pollOnce() {
    if (M.busy || M.local) return; M.busy = true;
    try {
      const n = await api(A + "now");
      M.now = n; M.ctx = n.context || null; M.stamp = Date.now(); M.errShown = false; renderNow();
      const id = n.track ? n.track.id : null;
      if (id !== M.qFor) { M.qFor = id; api(A + "queue").then((j) => { M.queue = j.queue; renderQueue(); }).catch(() => {}); }
    } catch (e) { if (!M.errShown) { M.errShown = true; toast(e.message); } }
    M.busy = false;
  }
  function start() { stop(); pollOnce(); M.poll = setInterval(() => { if (!document.hidden) pollOnce(); }, 5000); M.tick = setInterval(drawProg, 500); }
  function stop() { clearInterval(M.poll); clearInterval(M.tick); }
  const soon = () => setTimeout(pollOnce, 600);

  async function ctl(op, extra, body) { try { await post(op, extra, body); soon(); } catch (e) { fail(e); } }
  const here = () => Boolean(M.local && M.sdk);
  g("mPlay").onclick = () => {
    if (here()) { M.sdk.togglePlay(); return; }
    if (M.now && M.now.playing) { M.now.progress = curMs(); M.stamp = Date.now(); M.now.playing = false; renderNow(); ctl("pause"); }
    else ctl("play", "", {});
  };
  g("mNext").onclick = () => (here() ? M.sdk.nextTrack() : ctl("next"));
  g("mPrev").onclick = () => (here() ? M.sdk.previousTrack() : ctl("prev"));
  g("mProgWrap").onclick = (e) => {
    const t = M.now && M.now.track; if (!t) return;
    const r = e.currentTarget.getBoundingClientRect(), ms = Math.floor(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * t.duration);
    M.now.progress = ms; M.stamp = Date.now(); drawProg();
    if (here()) M.sdk.seek(ms); else ctl("seek", "&ms=" + ms);
  };
  // Ignore repeat taps for a moment so one tap can't start the same thing twice.
  let lastCmd = 0;
  const lockCmd = () => { const n = Date.now(); if (n - lastCmd < 1500) return true; lastCmd = n; return false; };
  async function skipTo(i) {
    const t = M.queue[i]; if (!t || lockCmd()) return;
    if (M.ctx && t.uri) {
      try { await post("play", M.local && M.deviceId ? "&device_id=" + encodeURIComponent(M.deviceId) : "", { context_uri: M.ctx, offset: { uri: t.uri } }); soon(); return; }
      catch (e) { /* not in this playlist (for example a queued song): fall back to skipping */ }
    }
    try { for (let k = 0; k <= i; k++) { if (here()) await M.sdk.nextTrack(); else await post("next"); await sleep(300); } soon(); } catch (e) { fail(e); }
  }

  // ----- in-page player (Spotify Web Playback SDK) -----
  const sized = (imgs) => (imgs || []).slice().sort((a, b) => (a.height || a.width || 0) - (b.height || b.width || 0));
  const fromSdk = (t) => {
    const s = sized(t.album && t.album.images), big = s[s.length - 1], mid = s.find((i) => (i.height || i.width || 0) >= 150) || big;
    return { id: t.id, uri: t.uri, name: t.name, artists: (t.artists || []).map((a) => a.name).join(", "), image: big ? big.url : null, thumb: mid ? mid.url : null, duration: t.duration_ms };
  };
  function onSdkState(s) {
    if (!s || !s.track_window || !s.track_window.current_track) { M.local = false; return; }
    M.local = true; M.ctx = s.context && s.context.uri ? s.context.uri : null;
    const t = fromSdk(s.track_window.current_track);
    M.now = { active: true, playing: !s.paused, progress: s.position, device: "This tablet", track: t };
    M.stamp = Date.now(); renderNow();
    // The SDK only reports a short look-ahead (often one song), so show it instantly and then
    // fill in the full queue from the Spotify API once per track change.
    if (t.id !== M.qFor) {
      M.qFor = t.id;
      const next = (s.track_window.next_tracks || []).map(fromSdk);
      if (next.length) { M.queue = next; renderQueue(); }
      setTimeout(() => {
        if (M.qFor !== t.id) return; // the song changed again, ignore this stale answer
        api(A + "queue").then((j) => { if (M.qFor === t.id && j.queue && j.queue.length >= M.queue.length) { M.queue = j.queue; renderQueue(); } }).catch(() => {});
      }, 700);
    }
  }
  async function drmOk() {
    try { await navigator.requestMediaKeySystemAccess("com.widevine.alpha", [{ initDataTypes: ["cenc"], audioCapabilities: [{ contentType: 'audio/mp4;codecs="mp4a.40.2"' }] }]); return true; } catch (e) { return false; }
  }
  async function initSdk() {
    if (MOCK || M.sdkStarted) return; M.sdkStarted = true;
    if (!navigator.requestMediaKeySystemAccess || !(await drmOk())) { M.sdkNote = "The in-page player isn't available in this browser, so Spotify plays on another device."; return; }
    window.onSpotifyWebPlaybackSDKReady = () => {
      const p = new Spotify.Player({ name: "Wall Dashboard", volume: 0.8, getOAuthToken: (cb) => { api(A + "token").then((j) => cb(j.token)).catch((e) => toast(e.message)); } });
      p.addListener("ready", (d) => { M.deviceId = d.device_id; M.sdkNote = ""; });
      p.addListener("not_ready", () => { M.deviceId = null; M.local = false; });
      p.addListener("player_state_changed", onSdkState);
      p.addListener("initialization_error", () => { M.sdkNote = "The in-page player couldn't start in this browser."; });
      p.addListener("authentication_error", () => { M.sdkNote = "Reconnect Spotify once to allow the in-page player (open /api/spotify/start with your passcode)."; toast(M.sdkNote); });
      p.addListener("account_error", () => { M.sdkNote = "The in-page player needs a full Spotify Premium plan."; toast(M.sdkNote); });
      p.addListener("playback_error", (e) => toast((e && e.message) || "Playback error"));
      p.addListener("autoplay_failed", () => toast("Tap the screen once to allow sound."));
      p.connect().then((ok) => { if (ok) M.sdk = p; });
    };
    const s = document.createElement("script"); s.src = "https://sdk.scdn.co/spotify-player.js"; s.async = true;
    s.onerror = () => { M.sdkNote = "Couldn't load Spotify's player script."; }; document.head.appendChild(s);
  }
  // Browsers only allow sound after a tap: unlock it on the first touch of the Music screen.
  g("music").addEventListener("pointerdown", () => { if (M.sdk && !M.activated) { M.activated = true; try { M.sdk.activateElement(); } catch (e) {} } }, { passive: true });

  // ----- devices -----
  async function openDevices(note) {
    const l = g("mDevList"); l.innerHTML = "";
    g("mDevNote").textContent = note || (M.deviceId ? "" : M.sdkNote); g("mDev").hidden = false;
    const item = (label, on, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "pitem" + (on ? " on" : ""); b.textContent = label; b.onclick = fn; l.appendChild(b); };
    const move = async (id, local) => {
      g("mDev").hidden = true; M.preferLocal = local; ls.set("music-local", local ? "1" : "0");
      try { await post("transfer", "&device_id=" + encodeURIComponent(id)); setTimeout(pollOnce, 900); } catch (e) { toast(e.message); }
    };
    if (M.deviceId) item("Play here (this tablet)", M.local, () => { if (M.sdk) M.sdk.activateElement(); move(M.deviceId, true); });
    try {
      const j = await api(A + "devices");
      const others = j.devices.filter((d) => d.id !== M.deviceId);
      if (!others.length && !M.deviceId) { const p = document.createElement("p"); p.className = "cap"; p.textContent = "No devices found. Open Spotify on your phone or speaker and play something once."; l.appendChild(p); }
      others.forEach((d) => item(d.name, d.active && !M.local, () => move(d.id, false)));
    } catch (e) { g("mDevNote").textContent = e.message; }
  }
  g("mDevBtn").onclick = () => openDevices("");
  g("mDev").onclick = (e) => { if (e.target === g("mDev")) g("mDev").hidden = true; };

  // ----- panels -----
  function show(p) {
    M.panel = p;
    ["mPlayer", "mLists", "mList"].forEach((id) => (g(id).hidden = id !== p));
    g("mSwap").innerHTML = svg(p === "mPlayer" ? "queue" : "note");
    g("mSwap").setAttribute("aria-label", p === "mPlayer" ? "Playlists" : "Player");
    if (p === "mLists") loadLists();
  }
  g("mSwap").onclick = () => show(M.panel === "mPlayer" ? "mLists" : "mPlayer");
  g("mBack").onclick = () => { if (M.panel === "mPlayer") location.hash = ""; else show(M.panel === "mList" ? "mLists" : "mPlayer"); };
  g("mBack").innerHTML = svg("back"); g("mDevBtn").innerHTML = svg("spk");

  // ----- playlists -----
  async function loadLists() {
    if (M.lists && Date.now() - M.listsAt < 300000) return renderLists();
    try { M.lists = (await api(A + "playlists")).playlists; M.listsAt = Date.now(); renderLists(); } catch (e) { fail(e); }
  }
  function renderLists() {
    const el = g("mPl"); el.innerHTML = "";
    if (!M.lists.length) { const p = document.createElement("p"); p.className = "cap"; p.textContent = "No playlists found."; el.appendChild(p); }
    M.lists.forEach((p) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "pl";
      const cv = document.createElement("div"); cv.className = "cv"; art(cv, p.image, p.name);
      const nm = document.createElement("span"); nm.textContent = p.name;
      b.append(cv, nm); b.onclick = () => openList(p); el.appendChild(b);
    });
  }
  async function playOn(body) { if (lockCmd()) return; try { await post("play", M.preferLocal && M.deviceId ? "&device_id=" + encodeURIComponent(M.deviceId) : "", body); show("mPlayer"); setTimeout(pollOnce, 700); } catch (e) { fail(e); } }
  async function openList(p) {
    M.list = p; g("lTitle").textContent = p.name; art(g("lCover"), p.image, p.name);
    const box = g("lSongs"); box.innerHTML = '<p class="cap">Loading…</p>'; show("mList");
    try {
      const j = await api(A + "playlist&id=" + encodeURIComponent(p.id)); box.innerHTML = "";
      if (!j.tracks.length) box.innerHTML = '<p class="cap">No songs to show.</p>';
      j.tracks.forEach((t) => {
        const row = document.createElement("div"); row.className = "song";
        const nm = document.createElement("button"); nm.type = "button"; nm.className = "sname";
        const a = document.createElement("div"); a.textContent = t.name; const b = document.createElement("div"); b.className = "cap"; b.textContent = t.artists;
        nm.append(a, b); nm.onclick = () => playOn({ context_uri: p.uri, offset: { uri: t.uri } });
        const mn = document.createElement("button"); mn.type = "button"; mn.className = "smenu"; mn.setAttribute("aria-label", "Add to queue"); mn.innerHTML = svg("menu");
        mn.onclick = async () => { try { await post("queueadd", "&uri=" + encodeURIComponent(t.uri)); M.qFor = undefined; toast("Added to queue"); } catch (e) { fail(e); } };
        row.append(nm, mn); box.appendChild(row);
      });
    } catch (e) { box.innerHTML = ""; const m = document.createElement("p"); m.className = "cap"; m.textContent = e.message; box.appendChild(m); }
  }
  g("lCover").onclick = () => { if (M.list) playOn({ context_uri: M.list.uri }); };

  function onRoute() { if (location.hash === "#music") { show("mPlayer"); start(); initSdk(); } else stop(); }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && location.hash === "#music") pollOnce(); });
  window.addEventListener("hashchange", onRoute); onRoute();
})();
