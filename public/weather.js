// ---------- Settings ----------
const CONFIG = {
  name: "Upland",
  lat: 34.10,
  lon: -117.65,
  unit: "fahrenheit",   // or "celsius"
  cacheMinutes: 10      // reloads inside this window reuse saved data
};

const params = (o) => new URLSearchParams(o);
// Later these two can point at a Netlify function instead.
const forecastUrl = () => "https://api.open-meteo.com/v1/forecast?" + params({
  latitude: CONFIG.lat, longitude: CONFIG.lon,
  current: "temperature_2m,weather_code,is_day",
  hourly: "precipitation_probability,uv_index",
  daily: "temperature_2m_max,temperature_2m_min",
  temperature_unit: CONFIG.unit, timezone: "auto", forecast_days: 2
});
const airUrl = () => "https://air-quality-api.open-meteo.com/v1/air-quality?" + params({
  latitude: CONFIG.lat, longitude: CONFIG.lon, current: "us_aqi", timezone: "auto"
});

// ---------- Cache ----------
const KEY = "weather-cache-v2";
const readCache = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
function writeCache(rec) { try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) {} return rec; }
async function getJson(url) { const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }

async function loadWeather() {
  const c = readCache();
  if (c && Date.now() - c.savedAt < CONFIG.cacheMinutes * 60000) return { ...c, stale: false };
  try {
    const [forecast, air] = await Promise.all([getJson(forecastUrl()), getJson(airUrl()).catch(() => null)]);
    return { ...writeCache({ savedAt: Date.now(), forecast, air }), stale: false };
  } catch (err) {
    if (c) return { ...c, stale: true };
    throw err;
  }
}

// ---------- Labels ----------
function describe(code) {
  if (code === 0) return ["Clear", "clear"];
  if (code === 1) return ["Mostly clear", "clear"];
  if (code === 2) return ["Partly cloudy", "partly"];
  if (code === 3) return ["Cloudy", "cloud"];
  if (code === 45 || code === 48) return ["Fog", "fog"];
  if (code >= 51 && code <= 57) return ["Drizzle", "rain"];
  if (code >= 61 && code <= 67) return ["Rain", "rain"];
  if (code >= 71 && code <= 77) return ["Snow", "snow"];
  if (code >= 80 && code <= 82) return ["Showers", "rain"];
  if (code === 85 || code === 86) return ["Snow showers", "snow"];
  if (code >= 95) return ["Thunderstorm", "storm"];
  return ["Unknown", "cloud"];
}
const uvLabel = (v) => v < 3 ? "Low" : v < 6 ? "Moderate" : v < 8 ? "High" : v < 11 ? "Very high" : "Extreme";
const aqiLabel = (v) => v <= 50 ? "Good" : v <= 100 ? "Moderate" : v <= 150 ? "Unhealthy for sensitive groups" : v <= 200 ? "Unhealthy" : v <= 300 ? "Very unhealthy" : "Hazardous";

// ---------- Icons ----------
const CLOUD = '<path class="line cloud" d="M20 38h26a9 9 0 0 0 .5-18 13 13 0 0 0-25-2A10 10 0 0 0 20 38z"/>';
function sun(x, y, r) {
  let rays = "";
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
    rays += `<line class="line" x1="${x + c * (r + 4)}" y1="${y + s * (r + 4)}" x2="${x + c * (r + 8)}" y2="${y + s * (r + 8)}"/>`;
  }
  return `<g class="sun"><circle class="line" cx="${x}" cy="${y}" r="${r}"/>${rays}</g>`;
}
const MOON = '<path class="line" d="M40 8a15 15 0 1 0 14 22 12 12 0 0 1-14-22z"/>';
const DROPS = [26, 36, 46].map(x => `<line class="accent drop" x1="${x}" y1="43" x2="${x - 2}" y2="48"/>`).join("");
const FLAKES = [26, 36, 46].map(x => `<circle class="accent drop" cx="${x}" cy="45" r="1.5"/>`).join("");
const FOG = '<line class="line" x1="16" y1="44" x2="48" y2="44"/><line class="line" x1="22" y1="50" x2="54" y2="50"/>';
const BOLT = '<path class="accent" d="M36 38l-6 9h7l-5 8"/>';
function iconSvg(kind, isDay) {
  let s;
  if (kind === "clear") s = isDay ? sun(32, 28, 11) : MOON;
  else if (kind === "partly") s = (isDay ? sun(22, 18, 7) : '<g transform="translate(-14 -6) scale(.6)">' + MOON + "</g>") + CLOUD;
  else if (kind === "cloud") s = CLOUD;
  else if (kind === "fog") s = CLOUD + FOG;
  else if (kind === "rain") s = CLOUD + DROPS;
  else if (kind === "snow") s = CLOUD + FLAKES;
  else s = CLOUD + BOLT;
  return `<svg class="ico" viewBox="0 0 64 56" aria-hidden="true">${s}</svg>`;
}

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const hourLabel = (iso) => { const h = parseInt(iso.slice(11, 13), 10); return (h % 12 || 12) + (h < 12 ? "a" : "p"); };
function drawBars(barsEl, hoursEl, times, probs, start) {
  barsEl.innerHTML = ""; if (hoursEl) hoursEl.innerHTML = "";
  for (let i = start; i < start + 12 && i < times.length; i++) {
    const b = document.createElement("i");
    b.style.height = Math.max(6, probs[i]) + "%";
    barsEl.appendChild(b);
    if (hoursEl) { const s = document.createElement("span"); s.textContent = hourLabel(times[i]); hoursEl.appendChild(s); }
  }
}

// ---------- Render ----------
function render(r) {
  const f = r.forecast, cur = f.current;
  const [label, kind] = describe(cur.weather_code);
  const icon = iconSvg(kind, cur.is_day === 1);
  const temp = Math.round(cur.temperature_2m) + "°";
  const hi = Math.round(f.daily.temperature_2m_max[0]) + "°";
  const lo = Math.round(f.daily.temperature_2m_min[0]) + "°";
  const times = f.hourly.time, probs = f.hourly.precipitation_probability;
  const start = Math.max(0, times.findIndex(t => t.startsWith(cur.time.slice(0, 13))));

  // home card
  $("hIcon").innerHTML = icon; $("hCond").textContent = label; $("hTemp").textContent = temp;
  $("hHi").textContent = hi; $("hLo").textContent = lo;
  drawBars($("hBars"), null, times, probs, start);

  // weather page
  $("wPlace").textContent = CONFIG.name;
  $("wIcon").innerHTML = icon; $("wCond").textContent = label; $("wTemp").textContent = temp;
  $("wLo").textContent = lo; $("wNow").textContent = temp; $("wHi").textContent = hi;
  drawBars($("wBars"), $("wHours"), times, probs, start);

  const uv = Math.round(f.hourly.uv_index[start] || 0);
  $("uv").textContent = uv; $("uvL").textContent = uvLabel(uv);
  const aq = r.air && r.air.current ? r.air.current.us_aqi : null;
  $("aqi").textContent = aq == null ? "–" : Math.round(aq);
  $("aqiL").textContent = aq == null ? "Unavailable" : aqiLabel(aq);

  const when = new Date(r.savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("foot").textContent = r.stale ? "Can’t reach the weather service. Showing the update from " + when + "." : "Updated " + when;
}

// ---------- Clock ----------
function tick() {
  const d = new Date();
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).match(/^(.*?)\s*([AP]M)?$/i);
  $("time").innerHTML = t[1] + (t[2] ? "<small>" + t[2] + "</small>" : "");
  $("date").textContent = d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}
tick(); setInterval(tick, 20000);

// ---------- Pages (#weather = weather page) ----------
function route() {
  const h = location.hash.slice(1);
  const page = ["weather", "calendar", "brief", "todo"].includes(h) ? h : "home";
  ["home", "weather", "calendar", "brief", "todo"].forEach((id) => $(id).classList.toggle("on", id === page));
}
window.addEventListener("hashchange", route); route();

// ---------- Reload button ----------
$("reload").addEventListener("click", () => location.reload());

// ---------- Go ----------
loadWeather().then(render).catch(() => {
  $("hCond").textContent = "Weather unavailable";
  $("wCond").textContent = "Weather unavailable";
  $("foot").textContent = "Check Wi-Fi, then reload.";
});
