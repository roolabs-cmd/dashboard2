// Launches an app from a home tile, adapting to wherever the dashboard is running.
// Tiles opt in with data-launch="<key>" (see APPS below). To change an app, edit its entry only.
(function () {
  const APPS = {
    music: {
      android: "com.spotify.music",      // Android package name (verify in Fully Remote Admin > Manage Apps)
      ios: "spotify://",                  // iOS URL scheme (optional)
      web: "https://open.spotify.com"     // used on desktop and as a fallback
    },
    ai: {
      android: "com.anthropic.claude",    // swap for the AI app you use, e.g. com.openai.chatgpt
      web: "https://claude.ai"
    }
  };

  const ua = navigator.userAgent || "";
  const fully = window.fully && typeof window.fully.startApplication === "function" ? window.fully : null;
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function say(msg) {
    try { if (window.fully && window.fully.showToast) window.fully.showToast(msg); } catch (e) { /* ignore */ }
  }

  function androidIntent(app) {
    // Inside Fully there is nowhere to come back from a web fallback, so only add one in a normal browser.
    const fallback = !/fully/i.test(ua) && app.web ? "S.browser_fallback_url=" + encodeURIComponent(app.web) + ";" : "";
    return "intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=" + app.android + ";" + fallback + "end";
  }

  function iosOpen(app) {
    const t = setTimeout(function () { if (!document.hidden && app.web) location.href = app.web; }, 900);
    document.addEventListener("visibilitychange", function () { clearTimeout(t); }, { once: true });
    location.href = app.ios;
  }

  function launch(app) {
    if (fully && app.android) {
      try { fully.startApplication(app.android); } catch (e) { say("Couldn't open the app"); }
      return;
    }
    if (isAndroid && app.android) { location.href = androidIntent(app); return; }
    if (isIOS && app.ios) { iosOpen(app); return; }
    if (app.web) window.open(app.web, "_blank", "noopener");
  }

  document.querySelectorAll("[data-launch]").forEach(function (el) {
    el.addEventListener("click", function () {
      const app = APPS[el.getAttribute("data-launch")];
      if (app) launch(app);
    });
  });
})();
