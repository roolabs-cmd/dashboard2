(function () {
  const SHOW_FROM = 6, SHOW_UNTIL = 12;   // home button shows 6am to noon (set SHOW_UNTIL = 24 to test)
  const g = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  let current = null, speaking = false, busy = false;

  function pill() { const h = new Date().getHours(); g("briefPill").hidden = !(h >= SHOW_FROM && h < SHOW_UNTIL); }
  pill(); setInterval(pill, 60000);

  function status(msg) {
    g("bText").textContent = msg; g("bSrc").textContent = ""; g("bDate").textContent = "";
    g("bTalk").hidden = true;
  }
  function render(b) {
    current = b;
    g("bDate").textContent = new Date(b.created_at).toLocaleString([], { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const box = g("bText"); box.innerHTML = "";
    b.text.split(/\n{2,}/).forEach((t) => { const p = document.createElement("p"); p.textContent = t.trim(); box.appendChild(p); });
    g("bSrc").textContent = b.sources && b.sources.length ? "Headlines from: " + b.sources.join(", ") : "";
    g("bTalk").hidden = false;
  }
  async function load(force) {
    if (busy) return; busy = true; stop();
    status("Gathering your weather, calendar, and news. This can take up to 30 seconds…");
    try {
      const j = await window.dashApi("/api/brief", { method: "POST", body: JSON.stringify({ day: today(), force: Boolean(force) }) });
      render(j.brief);
    } catch (e) {
      const timedOut = /\b(502|504)\b/.test(e.message);
      status("Couldn’t make the brief: " + (timedOut ? "the server timed out. Try again, it often works the second time." : e.message));
    }
    busy = false;
  }

  function stop() {
    try { if (window.fully && window.fully.stopTextToSpeech) window.fully.stopTextToSpeech(); } catch (e) {}
    try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch (e) {}
    speaking = false; g("bTalk").textContent = "Talk";
  }
  g("bTalk").onclick = () => {
    if (speaking) return stop();
    if (!current) return;
    speaking = true; g("bTalk").textContent = "Stop";
    try {
      if (window.fully && window.fully.textToSpeech) {
        window.fully.textToSpeech(current.text);
        setTimeout(() => { if (speaking) stop(); }, Math.max(8000, current.text.length * 75));
        return;
      }
    } catch (e) {}
    if (!("speechSynthesis" in window)) { stop(); window.dashToast("Speech isn’t available in this browser"); return; }
    const u = new SpeechSynthesisUtterance(current.text);
    u.lang = "en-US"; u.onend = u.onerror = stop; speechSynthesis.speak(u);
  };
  g("bRegen").onclick = () => load(true);

  function onRoute() { if (location.hash === "#brief") load(false); else if (speaking) stop(); }
  window.addEventListener("hashchange", onRoute); onRoute();
})();
