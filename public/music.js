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
  const M = { src: ls.get("music-src") === "sonos" ? "sonos" : "spotify", group: (() => { try { return JSON.parse(ls.get("music-group")); } catch (e) { return null; } })(), sonosVol: null, sdk: null, deviceId: null, local: false, sdkStarted: false, sdkNote: "", preferLocal: ls.get("music-local") === "1", activated: false, now: null, stamp: 0, queue: [], qFor: undefined, lists: null, listsAt: 0, list: null, panel: "mPlayer", poll: null, tick: null, busy: false, errShown: false, sonosDev: null, sonosDevAt: 0, spDevices: [], listMode: ls.get("music-listmode") === "favorites" ? "favorites" : "spotify", listsKey: "", tag: 0 };

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
        case "now": return { active: true, playing, progress, device: "Demo speaker", deviceId: "d1", track: songs[cur] };
        case "queue": return { queue: songs.slice(cur + 1, cur + 7) };
        case "playlists": return { playlists: lists };
        case "playlist": return { tracks: songs.slice(0, 5) };
        case "devices": return { devices: [{ id: "d1", name: "Demo speaker", type: "Speaker", active: true }, { id: "d2", name: "Demo phone", type: "Smartphone", active: false }, { id: "d3", name: "Living Room", type: "Speaker", active: false }, { id: "d4", name: "Kitchen", type: "Speaker", active: false }] };
        case "play": if (b.offset && b.offset.uri) cur = Math.max(0, songs.findIndex((s) => s.uri === b.offset.uri)); if (b.context_uri) progress = 0; playing = true; return { ok: true };
        case "pause": playing = false; return { ok: true };
        case "next": cur = (cur + 1) % songs.length; progress = 0; playing = true; return { ok: true };
        case "prev": cur = (cur + songs.length - 1) % songs.length; progress = 0; return { ok: true };
        case "seek": progress = Number(q.get("ms")) || 0; return { ok: true };
        default: return { ok: true };
      }
    };
  })();
  const mockSonos = (() => {
    const songs = ["Sonos Song One", "Sonos Song Two", "Sonos Song Three"].map((n, i) => ({ id: "s" + i, uri: null, name: n, artists: "Living Room Artist", image: null, thumb: null, duration: 210000 }));
    let cur = 0, playing = true, progress = 20000, vol = 30, last = Date.now();
    const sync = () => { const n = Date.now(); if (playing) progress += n - last; last = n; };
    return async (path, opts = {}) => {
      const q = new URL(path, "http://x").searchParams, op = q.get("op"); sync();
      switch (op) {
        case "groups": return { groups: [{ id: "g1", name: "Living Room", household: "h1" }, { id: "g2", name: "Kitchen", household: "h1" }] };
        case "favorites": return { favorites: ["Chill Mix", "Morning Radio", "Road Trip", "Focus"].map((n, i) => ({ id: "f" + i, name: n, image: null, service: "Spotify" })) };
        case "now": return { active: true, playing, progress, track: songs[cur], queue: songs.slice(cur + 1, cur + 2), volume: vol };
        case "toggle": playing = !playing; return { ok: true };
        case "play": playing = true; return { ok: true };
        case "pause": playing = false; return { ok: true };
        case "next": cur = (cur + 1) % songs.length; progress = 0; return { ok: true };
        case "prev": cur = (cur + songs.length - 1) % songs.length; progress = 0; return { ok: true };
        case "seek": progress = Number(q.get("ms")) || 0; return { ok: true };
        case "volume": vol = Number(q.get("v")) || 0; return { ok: true };
        case "loadfavorite": cur = 0; progress = 0; playing = true; return { ok: true };
        default: return { ok: true };
      }
    };
  })();
  const api = (p, o) => (MOCK ? (p.indexOf("/api/sonos") === 0 ? mockSonos(p, o) : mock(p, o)) : window.dashApi(p, o));
  const A = "/api/spotify?op=";
  const S = "/api/sonos?op=";
  const isSonos = () => M.src === "sonos" && Boolean(M.group);
  const gq = () => "&group=" + encodeURIComponent(M.group.id);
  const sPost = (op, extra) => api(S + op + gq() + (extra || ""), { method: "POST" });
  const post = (op, extra, body) => api(A + op + (extra || ""), { method: "POST", body: body ? JSON.stringify(body) : undefined });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function fail(e) {
    if (!isSonos() && /No active Spotify device/.test(e.message)) openDevices(e.message); else toast(e.message);
  }

  // ----- Sonos + Spotify together -----
  // Sonos mode still browses with Spotify: playlists, songs, the queue and album covers come from Spotify,
  // and playback is sent to the Sonos room as a Spotify Connect device (Spotify lists Sonos rooms by name).
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const sameTrack = (a, b) => { const x = norm(a), y = norm(b); return Boolean(x && y && (x === y || x.includes(y) || y.includes(x))); };
  const nameMatch = (a, b) => Boolean(norm(a)) && (norm(a) === norm(b) || norm(a) === norm(String(b || "").split("+")[0]));
  const overrides = () => { try { return JSON.parse(ls.get("music-sonos-dev")) || {}; } catch (e) { return {}; } };
  const setOverride = (gid, name) => { const o = overrides(); o[gid] = name; ls.set("music-sonos-dev", JSON.stringify(o)); };
  function matchDevice(devices, grp) {
    const want = overrides()[grp.id], full = norm(grp.name);
    return (want && devices.find((d) => d.name === want)) || devices.find((d) => nameMatch(d.name, grp.name)) ||
      devices.find((d) => { const n = norm(d.name); return Boolean(n) && full.includes(n); }) || null;
  }
  // The Spotify device that is this Sonos room (cached for 30 seconds unless fresh is true).
  async function findSonosDev(fresh) {
    const grp = M.group;
    if (!isSonos()) return null;
    if (!fresh && M.sonosDevAt && Date.now() - M.sonosDevAt < 30000) return M.sonosDev;
    try {
      const list = ((await api(A + "devices")).devices || []).filter((d) => d.id !== M.deviceId);
      if (M.group !== grp) return null;
      M.spDevices = list; M.sonosDev = matchDevice(list, grp); M.sonosDevAt = Date.now();
    } catch (e) { if (fresh) throw e; M.sonosDevAt = Date.now(); }
    return M.sonosDev;
  }
  async function needSonosDev() {
    if (!M.group) throw new Error("Pick a Sonos room first");
    const d = await findSonosDev(true);
    if (!d) throw new Error("Spotify can't see " + M.group.name + " yet. Open Spotify on your phone, play a song on " + M.group.name + " once, then try again. If it still fails, tap the speaker button and pick it there.");
    return d;
  }
  // Plays a Spotify playlist/song on the Sonos room. If the room isn't the active Spotify device yet, wake it first.
  // Fallback when Spotify can't see the room: a whole playlist can still play if it is saved in My Sonos (a Sonos Favorite) under the same name.
  const normU = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, " ").trim();
  async function savedFavorite(p) {
    if (!p || !M.group) return null;
    if (!M.favs || Date.now() - (M.favsAt || 0) > 300000) { M.favs = (await api(S + "favorites&household=" + encodeURIComponent(M.group.household))).favorites || []; M.favsAt = Date.now(); }
    const n = normU(p.name), fs = M.favs.filter((f) => !f.service || /spotify/i.test(f.service));
    return fs.find((f) => normU(f.name) === n) || fs.find((f) => n && (normU(f.name).includes(n) || n.includes(normU(f.name)))) || null;
  }
  async function playOnSonos(body) {
    let d = null, why = null;
    try { d = await needSonosDev(); } catch (e) { why = e; }
    if (!d) {
      const whole = !body.offset && !body.uris;
      let f = null;
      if (whole) { try { f = await savedFavorite(M.list); } catch (e) { f = null; } }
      if (f) { await sPost("loadfavorite", "&favorite=" + encodeURIComponent(f.id)); toast('Playing "' + f.name + '" on ' + M.group.name + " from My Sonos"); return; }
      throw new Error(whole
        ? why.message + ' Or save "' + (M.list ? M.list.name : "this playlist") + '" to My Sonos in the Sonos app, and it will play from here without that.'
        : "Playing a single song on " + M.group.name + " needs Spotify to see it. " + why.message);
    }
    const q = "&device_id=" + encodeURIComponent(d.id);
    try { await post("play", q, body); }
    catch (e) { await post("transfer", q + "&play=0"); await sleep(1000); await post("play", q, body); }
    M.sonosDev = d; M.sonosDevAt = Date.now();
  }
  // Album art for songs Sonos reports without a usable picture, looked up on Spotify once per song.
  const covers = {};
  function withCover(t) {
    if (!t || !t.name || !t.artists || (t.image && /^https:\/\//.test(t.image))) return t;
    const key = norm(t.name + " " + t.artists), c = covers[key];
    if (c && c !== "wait") { t.image = c.image; t.thumb = c.thumb || c.image; }
    else if (c === undefined) {
      covers[key] = "wait";
      api(A + "cover&name=" + encodeURIComponent(t.name) + "&artist=" + encodeURIComponent(t.artists))
        .then((j) => { covers[key] = j && j.image ? j : false; }, () => { covers[key] = false; })
        .then(applyCovers);
    }
    return t;
  }
  function applyCovers() {
    if (!isSonos() || !M.now) return;
    withCover(M.now.track); M.queue.forEach(withCover); renderNow(); renderQueue();
  }
  const viaSp = () => Boolean(M.now && M.now.viaSpotify);                                           // Spotify is what's playing on the Sonos room
  const sx = () => (isSonos() && M.sonosDev ? "&device_id=" + encodeURIComponent(M.sonosDev.id) : "");   // aims Spotify commands at the room

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
    g("mArtist").textContent = t ? t.artists : isSonos() ? "Nothing playing on " + M.group.name + ". Pick a playlist from the list." : "Start Spotify on a device, or tap the speaker button";
    art(g("mArt"), t && t.image, t ? t.name : "idle");
    g("mPlay").innerHTML = n && n.playing ? PAUSE : PLAY;
    g("mProgWrap").classList.toggle("idle", !(t && t.duration));
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
    if (M.busy || (M.local && !isSonos())) return; M.busy = true;
    const tag = M.tag;   // changes when the source or room changes, so an old answer can't overwrite the new screen
    try {
      const n = isSonos() ? await sonosNow() : await api(A + "now");
      if (tag !== M.tag) return;
      M.now = n; M.ctx = n.context || null; M.stamp = Date.now(); M.errShown = false;
      if (isSonos()) M.sonosVol = n.volume;
      renderNow();
      if (isSonos()) updateVol();
      if (!isSonos() || n.viaSpotify) {
        const id = n.track ? n.track.id : null;
        if (id !== M.qFor) { M.qFor = id; api(A + "queue").then((j) => { if (tag === M.tag) { M.queue = j.queue; renderQueue(); } }).catch(() => {}); }
      } else { M.queue = n.queue || []; M.qFor = undefined; renderQueue(); }
    } catch (e) { if (tag === M.tag && !M.errShown) { M.errShown = true; toast(e.message); } }
    finally { M.busy = false; }
  }
  function start() { stop(); pollOnce(); M.poll = setInterval(() => { if (!document.hidden) pollOnce(); }, 5000); M.tick = setInterval(drawProg, 500); }
  function stop() { clearInterval(M.poll); clearInterval(M.tick); }
  const soon = () => setTimeout(pollOnce, 600);

  async function ctl(op, extra, body) { try { await post(op, extra, body); soon(); } catch (e) { fail(e); } }
  const here = () => Boolean(M.local && M.sdk);
  // In Sonos mode, commands go through Spotify while Spotify is what the room is playing (sx() aims them at the room),
  // and through Sonos for everything else (favorites, radio, line-in).
  g("mPlay").onclick = () => {
    if (isSonos() && !viaSp()) { sonosToggle(); return; }
    if (!isSonos() && here()) { M.sdk.togglePlay(); return; }
    if (M.now && M.now.playing) { M.now.progress = curMs(); M.stamp = Date.now(); M.now.playing = false; renderNow(); ctl("pause", sx()); }
    else ctl("play", sx(), {});
  };
  g("mNext").onclick = () => (isSonos() ? (viaSp() ? ctl("next", sx()) : sCtl("next")) : here() ? M.sdk.nextTrack() : ctl("next"));
  g("mPrev").onclick = () => (isSonos() ? (viaSp() ? ctl("prev", sx()) : sCtl("prev")) : here() ? M.sdk.previousTrack() : ctl("prev"));
  g("mProgWrap").onclick = (e) => {
    const t = M.now && M.now.track; if (!t || !t.duration) return;
    const r = e.currentTarget.getBoundingClientRect(), ms = Math.floor(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * t.duration);
    M.now.progress = ms; M.stamp = Date.now(); drawProg();
    if (isSonos()) { if (viaSp()) ctl("seek", "&ms=" + ms + sx()); else sCtl("seek", "&ms=" + ms); }
    else if (here()) M.sdk.seek(ms); else ctl("seek", "&ms=" + ms);
  };
  // Ignore repeat taps for a moment so one tap can't start the same thing twice.
  let lastCmd = 0;
  const lockCmd = () => { const n = Date.now(); if (n - lastCmd < 1500) return true; lastCmd = n; return false; };
  async function skipTo(i) {
    if (isSonos() && !viaSp()) { if (!lockCmd()) sCtl("next"); return; }
    const t = M.queue[i]; if (!t || lockCmd()) return;
    const dq = isSonos() ? sx() : M.local && M.deviceId ? "&device_id=" + encodeURIComponent(M.deviceId) : "";
    if (M.ctx && t.uri) {
      try { await post("play", dq, { context_uri: M.ctx, offset: { uri: t.uri } }); soon(); return; }
      catch (e) { /* not in this playlist (for example a queued song): fall back to skipping */ }
    }
    try { for (let k = 0; k <= i; k++) { if (!isSonos() && here()) await M.sdk.nextTrack(); else await post("next", sx()); await sleep(300); } soon(); } catch (e) { fail(e); }
  }

  // ----- Sonos -----
  async function sCtl(op, extra) { try { await sPost(op, extra); setTimeout(pollOnce, 500); } catch (e) { toast(e.message); } }
  // What the Sonos room is doing. When Spotify is playing on that same room, Spotify's answer is used (it has the
  // album art, the real queue and the playlist); otherwise Sonos' own answer is used, with art looked up if it has none.
  async function sonosNow() {
    const grp = M.group;
    const [sn, sp, dev] = await Promise.all([api(S + "now" + gq()), api(A + "now").catch(() => null), findSonosDev(false).catch(() => null)]);
    const onRoom = Boolean(sp && sp.active && sp.track && (dev && sp.deviceId ? sp.deviceId === dev.id : nameMatch(sp.device, grp.name)));
    if (onRoom && !M.sonosDev && sp.deviceId && M.group === grp) { M.sonosDev = { id: sp.deviceId, name: sp.device }; M.sonosDevAt = Date.now(); }
    if (onRoom && (!sn.track || sameTrack(sn.track.name, sp.track.name))) return { ...sp, volume: sn.volume, viaSpotify: true };
    return { ...sn, track: withCover(sn.track), queue: (sn.queue || []).map(withCover), viaSpotify: false };
  }
  function sonosToggle() {
    const n = M.now; if (n) { n.progress = curMs(); M.stamp = Date.now(); n.playing = !n.playing; renderNow(); }
    sCtl("toggle");
  }
  let volTimer = null, volTouched = 0;
  const paintVol = () => g("mVol").style.setProperty("--v", g("mVol").value + "%");   // colors the filled part of the slider
  function updateVol() {
    g("mVolWrap").hidden = !isSonos();
    if (isSonos() && typeof M.sonosVol === "number" && Date.now() - volTouched > 3000) g("mVol").value = M.sonosVol;
    paintVol();
  }
  g("mVol").addEventListener("input", () => {
    paintVol(); volTouched = Date.now(); clearTimeout(volTimer);
    volTimer = setTimeout(() => { if (isSonos()) sCtl("volume", "&v=" + g("mVol").value); }, 350);
  });
  function setSource(src, group) {
    M.src = src; M.group = group || null; ls.set("music-src", src); ls.set("music-group", group ? JSON.stringify(group) : "");
    if (src === "sonos" && M.sdk && M.local) { try { M.sdk.pause(); } catch (e) {} }
    M.now = null; M.queue = []; M.qFor = undefined; M.lists = null; M.listsKey = ""; M.sonosVol = null; M.sonosDev = null; M.sonosDevAt = 0; M.favs = null; M.tag++; M.busy = false;
    renderNow(); renderQueue(); updateVol(); pollOnce();
  }
  async function playFavorite(f) {
    if (lockCmd()) return;
    try { await sPost("loadfavorite", "&favorite=" + encodeURIComponent(f.id)); toast("Playing " + f.name + " on " + M.group.name); show("mPlayer"); setTimeout(pollOnce, 1500); }
    catch (e) { toast(e.message); }
  }

  // ----- in-page player (Spotify Web Playback SDK) -----
  const sized = (imgs) => (imgs || []).slice().sort((a, b) => (a.height || a.width || 0) - (b.height || b.width || 0));
  const fromSdk = (t) => {
    const s = sized(t.album && t.album.images), big = s[s.length - 1], mid = s.find((i) => (i.height || i.width || 0) >= 150) || big;
    return { id: t.id, uri: t.uri, name: t.name, artists: (t.artists || []).map((a) => a.name).join(", "), image: big ? big.url : null, thumb: mid ? mid.url : null, duration: t.duration_ms };
  };
  function onSdkState(s) {
    if (!s || !s.track_window || !s.track_window.current_track) { M.local = false; return; }
    if (isSonos()) return;
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
    const head = (t) => { const h = document.createElement("div"); h.className = "place dhead"; h.textContent = t; l.appendChild(h); };
    const item = (label, on, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "pitem" + (on ? " on" : ""); b.textContent = label; b.onclick = fn; l.appendChild(b); };
    const move = async (id, local) => {
      g("mDev").hidden = true; M.preferLocal = local; ls.set("music-local", local ? "1" : "0");
      if (M.src !== "spotify") setSource("spotify");
      try { await post("transfer", "&device_id=" + encodeURIComponent(id)); setTimeout(pollOnce, 900); } catch (e) { toast(e.message); }
    };
    head("Spotify");
    if (M.deviceId) item("Play here (this tablet)", M.local && !isSonos(), () => { if (M.sdk) M.sdk.activateElement(); move(M.deviceId, true); });
    try {
      const j = await api(A + "devices");
      const others = j.devices.filter((d) => d.id !== M.deviceId);
      if (!others.length && !M.deviceId) { const p = document.createElement("p"); p.className = "cap"; p.textContent = "No Spotify devices found. Open Spotify on your phone or speaker and play something once."; l.appendChild(p); }
      others.forEach((d) => item(d.name, d.active && !M.local && !isSonos(), () => move(d.id, false)));
    } catch (e) { g("mDevNote").textContent = g("mDevNote").textContent || e.message; }
    try {
      const sj = await api(S + "groups");
      if (sj.groups.length) {
        head("Sonos");
        sj.groups.forEach((gr) => item(gr.name, isSonos() && M.group.id === gr.id, () => { g("mDev").hidden = true; setSource("sonos", { id: gr.id, name: gr.name, household: gr.household }); }));
      }
    } catch (e) { /* Sonos not connected yet: just don't list rooms */ }
    if (isSonos()) {
      // If Spotify lists this room under a different name, let the person pick which Spotify device it is (remembered).
      try {
        if (!(await findSonosDev(true))) {
          head("Spotify device for " + M.group.name);
          const n = document.createElement("p"); n.className = "cap"; n.textContent = "Spotify can't match this room by name. Pick it here once."; l.appendChild(n);
          M.spDevices.forEach((dv) => item(dv.name, false, () => {
            setOverride(M.group.id, dv.name); M.sonosDevAt = 0; g("mDev").hidden = true;
            toast("Using " + dv.name + " for " + M.group.name); pollOnce();
          }));
        }
      } catch (e) { /* Spotify not reachable: leave the list as it is */ }
    }
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
  // In Sonos mode the list can be your Spotify playlists (default) or your Sonos favorites; Spotify mode only has playlists.
  const favMode = () => isSonos() && M.listMode === "favorites";
  function drawTabs() {
    const tabs = g("mTabs"); if (!tabs) return;
    tabs.hidden = !isSonos();
    g("tabSp").classList.toggle("on", !favMode()); g("tabSo").classList.toggle("on", favMode());
  }
  const tabSp = g("tabSp"), tabSo = g("tabSo");
  if (tabSp && tabSo) {
    const pick = (mode) => { M.listMode = mode; ls.set("music-listmode", mode); loadLists(); };
    tabSp.onclick = () => pick("spotify"); tabSo.onclick = () => pick("favorites");
  }
  async function loadLists() {
    drawTabs();
    const key = favMode() ? "favorites" : "spotify";
    if (M.lists && M.listsKey === key && Date.now() - M.listsAt < 300000) return renderLists();
    try {
      M.lists = favMode() ? (await api(S + "favorites&household=" + encodeURIComponent(M.group.household))).favorites : (await api(A + "playlists")).playlists;
      M.listsAt = Date.now(); M.listsKey = key; renderLists();
    } catch (e) { fail(e); }
  }
  function renderLists() {
    const el = g("mPl"); el.innerHTML = "";
    if (!M.lists.length) { const p = document.createElement("p"); p.className = "cap"; p.textContent = favMode() ? "No Sonos favorites found." : "No playlists found."; el.appendChild(p); }
    M.lists.forEach((p) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "pl";
      const cv = document.createElement("div"); cv.className = "cv"; art(cv, p.image, p.name);
      const nm = document.createElement("span"); nm.textContent = p.name;
      b.append(cv, nm); b.onclick = () => (favMode() ? playFavorite(p) : openList(p)); el.appendChild(b);
    });
  }
  async function playOn(body) {
    if (lockCmd()) return;
    try {
      if (isSonos()) { await playOnSonos(body); setTimeout(pollOnce, 2500); }   // Sonos takes a couple of seconds to start
      else await post("play", M.preferLocal && M.deviceId ? "&device_id=" + encodeURIComponent(M.deviceId) : "", body);
      show("mPlayer"); setTimeout(pollOnce, 700);
    } catch (e) { fail(e); }
  }
  // "Add to queue" on Sonos: uses Spotify's queue when Spotify is playing on the room; if nothing is playing, just starts the song.
  async function sonosQueueAdd(t) {
    if (!viaSp()) {
      if (M.now && M.now.track) throw new Error("Spotify isn't playing on " + M.group.name + " right now. Start a Spotify playlist there first, then add songs.");
      await playOnSonos({ uris: [t.uri] }); setTimeout(pollOnce, 2500);
      return "Nothing was playing, so I started it on " + M.group.name;
    }
    const d = await needSonosDev();
    await post("queueadd", "&uri=" + encodeURIComponent(t.uri) + "&device_id=" + encodeURIComponent(d.id));
    return "Added to queue";
  }
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
        mn.onclick = async () => {
          try {
            const msg = isSonos() ? await sonosQueueAdd(t) : (await post("queueadd", "&uri=" + encodeURIComponent(t.uri)), "Added to queue");
            M.qFor = undefined; toast(msg);
          } catch (e) { fail(e); }
        };
        row.append(nm, mn); box.appendChild(row);
      });
    } catch (e) { box.innerHTML = ""; const m = document.createElement("p"); m.className = "cap"; m.textContent = e.message; box.appendChild(m); }
  }
  g("lCover").onclick = () => { if (M.list) playOn({ context_uri: M.list.uri }); };

  function onRoute() { if (location.hash === "#music") { show("mPlayer"); updateVol(); start(); initSdk(); } else stop(); }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && location.hash === "#music") pollOnce(); });
  window.addEventListener("hashchange", onRoute); onRoute();
})();
