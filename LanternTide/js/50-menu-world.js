"use strict";
// ===== World options (menu): aurora, star brightness, wave height, how fine the marks in the sand are =====
const MAP_RANGES = [["Off", 0], ["Close", 700], ["Medium", 1800], ["Far", 3600]];
const STAR_LEVELS = [["Dim", 0.4], ["Normal", 1], ["Bright", 1.8], ["Brilliant", 3]];
const WAVE_LEVELS = [["Calm", 0.45], ["Normal", 1], ["High", 1.5], ["Huge", 2.1]];
const SAND_LEVELS = [["Low", 1024], ["Medium", 1536], ["High", 2048]];
const FLIGHT_SPEEDS = [["Slow", 25], ["Normal", 90], ["Fast", 350], ["Rocket", 1800], ["Warp", 7000]]; // metres per second
const BOAT_SPEEDS = [["Slow", 0.55], ["Normal", 1], ["Fast", 1.7]];
const opts = { sunI: 1, moonI: 1, aurora: 1, stars: 1, waves: 1, sand: 1, flight: 1, map: 2, flightSpd: 1, boatSpd: 1, festival: 0 };
try {
  const saved = JSON.parse(localStorage.getItem("lanternTideOpts") || "null");
  if (saved) {
    if (saved.aurora === 0 || saved.aurora === 1) opts.aurora = saved.aurora;
    for (const k of ["sunI", "moonI"]) if (typeof saved[k] === "number" && saved[k] >= 0 && saved[k] <= 2) opts[k] = saved[k];
    if (saved.flight === 0 || saved.flight === 1) opts.flight = saved.flight;
    if (saved.festival === 0 || saved.festival === 1) opts.festival = saved.festival;
    for (const k of ["stars", "waves", "sand", "map", "flightSpd", "boatSpd"]) if (Number.isInteger(saved[k]) && saved[k] >= 0 && saved[k] <= (k === "sand" || k === "boatSpd" ? 2 : k === "flightSpd" ? 4 : 3)) opts[k] = saved[k];
  }
} catch (e) {}
// the festival lanterns (in the sky, floating on the sea as lotus, strung along the beach) are off unless you ask for them
function setFestival() {
  const on = !!opts.festival;
  skyMesh.visible = on;
  for (const l of skyLanterns) l.sprite.visible = on;
  for (const l of lotuses) l.g.visible = on;
  garland.group.visible = on;
}
function applyOpts() {
  setFestival();
  shared.uStarGain.value = STAR_LEVELS[opts.stars][1];
  waveMul = WAVE_LEVELS[opts.waves][1];
  setImprintRes(SAND_LEVELS[opts.sand][1]);
  try { localStorage.setItem("lanternTideOpts", JSON.stringify(opts)); } catch (e) {}
}
applyOpts();

// ===== Performance settings: the raymarched clouds and the god rays are the costly parts of the picture =====
// Clouds: the size of the sky map they are drawn into and how finely each point is marched. Rays: samples per point.
// (Both are drawn into maps a strip at a time, then smoothed, so even High is cheap compared with marching every pixel.)
const PERF_CLOUDS = [
  ["Off", { steps: 0, light: 1, detail: 0, w: 0, h: 0 }],
  ["Low", { steps: 12, light: 1, detail: 0, w: 512, h: 128 }],
  ["Medium", { steps: 18, light: 2, detail: 1, w: 768, h: 192 }],
  ["High", { steps: 26, light: 2, detail: 1, w: 1024, h: 256 }],
];
const PERF_RAYS = [["Off", 0], ["Low", 8], ["Medium", 14], ["High", 24]];
const perf = { clouds: 2, rays: 2, shadows: 0, fps: 0, ms: 0, worstMs: 0, acc: 0, n: 0, worst: 0 }; // (defaults: medium clouds and god rays, no cloud shadows)
try {
  const saved = JSON.parse(localStorage.getItem("lanternTidePerf") || "null");
  if (saved) for (const k of ["clouds", "rays", "shadows"]) if (Number.isInteger(saved[k])) perf[k] = saved[k];
} catch (e) {}
function applyPerf() {
  const c = PERF_CLOUDS[perf.clouds][1];
  shared.uCloudSteps.value = c.steps;
  shared.uCloudLight.value = c.light;
  shared.uCloudDetail.value = c.detail;
  shared.uRaySteps.value = PERF_RAYS[perf.rays][1];
  shared.uCloudShadows.value = perf.shadows;
  skyCache.setQuality(c.w, c.h, PERF_RAYS[perf.rays][1] > 0);
  try { localStorage.setItem("lanternTidePerf", JSON.stringify({ clouds: perf.clouds, rays: perf.rays, shadows: perf.shadows })); } catch (e) {}
}
applyPerf();
// a running frame-rate reading, from the real time between frames, refreshed twice a second
function samplePerf(rawDt) {
  perf.acc += rawDt;
  perf.n++;
  perf.worst = Math.max(perf.worst, rawDt);
  if (perf.acc >= 0.5) {
    perf.fps = perf.n / perf.acc;
    perf.ms = (1000 * perf.acc) / perf.n;
    perf.worstMs = perf.worst * 1000;
    perf.acc = perf.n = perf.worst = 0;
  }
}
const fpsText = () => (perf.fps ? `${Math.round(perf.fps)} fps · ${perf.ms.toFixed(1)} ms` : "measuring…");
const fpsColor = () => (perf.fps >= 60 ? "#7ff0c8" : perf.fps >= 40 ? "#f2c230" : "#ff7a5a");

// ===== The menu (X): time of day, weather and performance =====
// In VR: press X on the left controller; a panel floats in front of you. Point a controller at it and pull the trigger
// (drag along the bar to scrub the time). On a screen: press X.
const menu = { open: false, sig: "", tab: 0 };
const WEATHER_PRESETS = {
  clear: { v: 0.05, fog: 0 },
  cloudy: { v: 0.35, fog: 0 },
  rain: { v: 0.6, fog: 0 },
  storm: { v: 0.95, fog: 0 },
  fog: { v: 0.1, fog: 0.8 },
  mist: { v: 0.28, fog: 0.5 },
};
function setWeatherPreset(name) {
  const p = WEATHER_PRESETS[name];
  weather.locked = true; // stays this way until you pick Random again
  weather.target = p.v;
  weather.fogTarget = p.fog;
  weather.fogDay = p.fog > 0;
  weather.preset = name;
}
function setRandomWeather() {
  weather.locked = false;
  weather.preset = "random";
  weather.timer = rand(10, 30);
  weather.fogTimer = rand(10, 30);
}
const setTime = (h) => {
  // set the time of day where you stand: the planet is turned to match
  const hh = ((h % 24) + 24) % 24;
  if (curBody || sp.on) { game.hours = hh; return; } // (the clock is the home world's)
  updatePlayerFrame();
  game.spin = spinForHour(hh);
  game.hours = hh;
  prevHours = hh;
};
// ----- teleport: key places on and around the island -----
function teleportTo(x, z, lookX, lookZ) {
  if (curBody || sp.on) exitToEarth();
  player.x = x;
  player.z = z;
  player.y = surfaceAt(x, z);
  player.vy = 0;
  player.swim = false;
  player.grounded = true;
  player.under = false;
  player.sv.set(0, 0, 0);
  player.waterSm = waveHeight(x, z, shared.uTime.value);
  yaw = Math.atan2(-(lookX - x), -(lookZ - z));
  pitch = 0;
  lastFoot = null;
  screenFade = 1;
  toggleMenu(false);
}
const DOCK_BOARD = { x: ISL.x + DOCK.nx * (DOCK.r0 + (DOCK.r1 - DOCK.r0) * 0.72), z: ISL.z + DOCK.nz * (DOCK.r0 + (DOCK.r1 - DOCK.r0) * 0.72) };
const nearestPOI = (id) => {
  const def = POI_DEFS[id];
  for (const a of cellsByDistance(player.x, player.z)) {
    if (!a.type || !def.types.includes(a.type)) continue;
    const p = islandPOIs(a).find((q) => q.def.id === id);
    if (p) return p;
  }
  return null;
};
const TELEPORTS = [
  ["Beach (start)", () => teleportTo(ISL.x, ISL.z + ISL.r - 9, ISL.x, ISL.z + ISL.r + 20)],
  ["Campfire", () => {
    const a = Math.PI / 2 - 0.09, r = ISL.r - 11;
    const fx = ISL.x + Math.cos(a) * r, fz = ISL.z + Math.sin(a) * r;
    teleportTo(fx + 2.4, fz - 1.2, fx, fz);
  }],
  ["Lighthouse", () => {
    const lp = lighthouse.group.position;
    teleportTo(lp.x - 2.5, lp.z + 5.5, lp.x, lp.z);
  }],
  ["Rocks at sea", () => {
    let best = null, top = -Infinity;
    for (const r of seaRocks) {
      const p = r.getWorldPosition(new THREE.Vector3());
      const h = rockSurfaceAt(p.x, p.z);
      if (h > top) (top = h), (best = p);
    }
    if (best) teleportTo(best.x, best.z, ISL.x, ISL.z);
  }],
  ["End of the dock", () => teleportTo(ISL.x + DOCK.nx * (DOCK.r1 - 2), ISL.z + DOCK.nz * (DOCK.r1 - 2), ISL.x + DOCK.nx * (DOCK.r1 + 60), ISL.z + DOCK.nz * (DOCK.r1 + 60))],
  ["Board the boat", () => { teleportTo(DOCK_BOARD.x, DOCK_BOARD.z, DOCK_BOARD.x + DOCK.nx * 30, DOCK_BOARD.z + DOCK.nz * 30); boardBoat(); }],
  ...[["rig", "Nearest: oil rig"], ["wind", "Nearest: wind farm"]].map(([kind, name]) => [name, () => {
    const best = cellsByDistance(player.x, player.z).find((a) => a.feature === kind);
    if (!best) return flashHint("None in this world");
    const ch = loadChunkNow(best);
    if (kind === "rig") teleportTo(best.x + 8, best.z, best.x + 30, best.z + 5); // onto the rig's deck
    else teleportTo(ch.deck.x, ch.deck.z, best.x, best.z); // onto the first turbine's landing platform
  }]),
  ["Island hilltop", () => teleportTo(ISL.x, ISL.z, ISL.x, ISL.z + ISL.r)],
  ...[["moon", "the Moon"], ["mars", "the red world"], ["ice", "the ice world"], ["giant", "the gas giant"]].map(([id, name]) => ["Fly to " + name, () => warpToBody(BODIES[id])]),
  ...[[1, "Tropical island"], [2, "Volcano"], [3, "Temple island"], [4, "Swamp"], [5, "City island"], [6, "Airport island"]].map(([ty, name]) => ["Nearest: " + name.toLowerCase(), () => {
    const a = nearestIsland(ty, player.x, player.z);
    a ? teleportToIsland(a) : flashHint("No " + name.toLowerCase() + " in this world");
  }]),
  ...[["fishingCabin", "Fishing cabin"], ["abandonedCamp", "Abandoned camp"], ["forestShrine", "Forest shrine"], ["lighthouse", "Lighthouse"], ["shipwreck", "Shipwreck"], ["observatory", "Observatory"], ["ruins", "Hidden ruins"]].map(([id, name]) => ["Nearest: " + name.toLowerCase(), () => {
    const p = nearestPOI(id);
    if (!p) return flashHint("None found");
    loadChunkNow(p.a);
    const front = { forestShrine: 12, fishingCabin: 9, lighthouse: 10, shipwreck: 14, observatory: 11, ruins: 14 }[id] || 8;
    teleportTo(p.x + Math.sin(p.yaw) * front, p.z + Math.cos(p.yaw) * front, p.x, p.z);
  }]),
];
const TIME_PRESETS = [["Dawn", 6], ["Noon", 12], ["Dusk", 18], ["Night", 0]];
const TIME_SPEEDS = [["Pause", 0], ["1×", 1], ["4×", 4], ["16×", 16]];
const WEATHER_BUTTONS = [["Clear", "clear"], ["Cloudy", "cloudy"], ["Rain", "rain"], ["Storm", "storm"], ["Fog", "fog"], ["Mist", "mist"], ["Random", "random"]];
const weatherIs = (id) => (id === "random" ? !weather.locked : weather.locked && weather.preset === id);
const clockText = (h) => `${String(Math.floor(h) % 24).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;

// ----- the panel in VR -----
const MW = 900, MH = 960, PW = 0.84, PH = (0.84 * 960) / 900;
const menuCanvas = document.createElement("canvas");
menuCanvas.width = MW;
menuCanvas.height = MH;
const menuTex = new THREE.CanvasTexture(menuCanvas);
const menuPanel = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({ map: menuTex, transparent: true, toneMapped: false, depthTest: false }));
menuPanel.renderOrder = 60;
menuPanel.visible = false;
rig.add(menuPanel); // lives in your play space, so it stays put relative to you as you walk, swim or turn
const SLIDER = { x: 60, y: 168, w: 780, h: 34 };
const mbtns = [];
const mlabels = []; // { tab, text, x, y, size, color }
const MENU_TABS = ["Time", "World", "Performance", "Teleport", "Travel"];
const TAB_X0 = 60, TAB_W = 140, TAB_GAP = 8;
{
  let curTab = 0;
  const label = (text, y, size = 22, color = "#8fa6a8", x = 60) => mlabels.push({ tab: curTab, text, x, y, size, color });
  const row = (list, y, h, gap, onClick, active, x0 = 60, total = 780) => {
    const w = (total - gap * (list.length - 1)) / list.length;
    const tab = curTab;
    list.forEach(([lab, val], i) => mbtns.push({ tab, x: x0 + i * (w + gap), y, w, h, label: lab, click: () => onClick(val), active: () => active(val) }));
  };
  MENU_TABS.forEach((name, i) => mbtns.push({ x: TAB_X0 + i * (TAB_W + TAB_GAP), y: 16, w: TAB_W, h: 52, label: name, tab: -1, isTab: true, click: () => (menu.tab = i), active: () => menu.tab === i }));
  // Time & weather
  curTab = 0;
  label("Set the time", 224);
  label("How fast time passes", 316);
  label("Weather", 414);
  row(TIME_PRESETS, 228, 56, 16, (h) => setTime(h), () => false);
  row(TIME_SPEEDS, 322, 56, 16, (s) => (game.speed = s), (s) => game.speed === s);
  row(WEATHER_BUTTONS.slice(0, 4), 420, 56, 16, (id) => setWeatherPreset(id), weatherIs);
  row(WEATHER_BUTTONS.slice(4), 490, 56, 16, (id) => (id === "random" ? setRandomWeather() : setWeatherPreset(id)), weatherIs);
  // World
  curTab = 1;
  label("World", 160, 30, "#e6efee");
  label("Aurora (on clear nights)", 214);
  row([["Off", 0], ["On", 1]], 226, 60, 16, (i) => ((opts.aurora = i), applyOpts()), (i) => opts.aurora === i, 60, 380);
  label("Star brightness", 326);
  row(STAR_LEVELS.map(([n], i) => [n, i]), 338, 60, 16, (i) => ((opts.stars = i), applyOpts()), (i) => opts.stars === i);
  label("Wave height", 438);
  row(WAVE_LEVELS.map(([n], i) => [n, i]), 450, 60, 16, (i) => ((opts.waves = i), applyOpts()), (i) => opts.waves === i);
  label("Sand mark detail (changing it smooths the sand)", 550);
  row(SAND_LEVELS.map(([n], i) => [n, i]), 562, 60, 16, (i) => ((opts.sand = i), applyOpts()), (i) => opts.sand === i, 60, 590);
  label("Festival lanterns: sky, lotus on the sea, beach garland", 842);
  row([["Off", 0], ["On", 1]], 854, 52, 16, (i) => ((opts.festival = i), applyOpts()), (i) => opts.festival === i, 60, 380);
  label("Minimap (M on a keyboard)", 748);
  row(MAP_RANGES.map(([n], i) => [n, i]), 760, 56, 16, (i) => ((opts.map = i), applyOpts()), (i) => opts.map === i);
  mbtns.push({ tab: 1, x: 60, y: 660, w: 380, h: 60, label: "Smooth the sand", click: () => clearImprint(), active: () => false });
  // Performance
  curTab = 2;
  label("Performance", 160, 30, "#e6efee");
  const q = [["Off", 0], ["Low", 1], ["Medium", 2], ["High", 3]];
  label("Clouds (the costliest part of the sky)", 214);
  row(q, 226, 60, 16, (i) => ((perf.clouds = i), applyPerf()), (i) => perf.clouds === i);
  label("God rays", 326);
  row(q, 338, 60, 16, (i) => ((perf.rays = i), applyPerf()), (i) => perf.rays === i);
  label("Clouds shade the sea and sand", 438);
  row([["Off", 0], ["On", 1]], 450, 60, 16, (i) => ((perf.shadows = i), applyPerf()), (i) => perf.shadows === i, 60, 380);
  // Teleport
  curTab = 3;
  label("Teleport", 160, 30, "#e6efee");
  label("Jump to a place on the island", 214);
  for (let i = 0; i < TELEPORTS.length; i += 3) row(TELEPORTS.slice(i, i + 3).map(([n, f]) => [n, f]), 226 + (i / 3) * 84, 70, 12, (f) => f(), () => false);
  // Travel
  curTab = 4;
  label("Travel", 160, 30, "#e6efee");
  label("Flight: jump, then hold a trigger and point", 214);
  row([["Off", 0], ["On", 1]], 226, 60, 16, (i) => ((opts.flight = i), applyOpts()), (i) => opts.flight === i, 60, 380);
  label("Flight speed", 326);
  row(FLIGHT_SPEEDS.map(([n], i) => [n, i]), 338, 60, 16, (i) => ((opts.flightSpd = i), applyOpts()), (i) => opts.flightSpd === i);
  label("Boat speed", 438);
  row(BOAT_SPEEDS.map(([n], i) => [n, i]), 450, 60, 16, (i) => ((opts.boatSpd = i), applyOpts()), (i) => opts.boatSpd === i, 60, 580);
  mbtns.push({ tab: 4, x: 60, y: 560, w: 380, h: 70, label: "Return the boat to the dock", click: () => resetBoat(), active: () => false });
  mbtns.push({ tab: -1, x: 812, y: 16, w: 72, h: 52, label: "✕", click: () => toggleMenu(false), active: () => false });
}
const tabBtns = () => mbtns.filter((b) => b.tab === -1 || b.tab === menu.tab);
const menuLasers = [];
for (const h of hands) {
  const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 1, 6).rotateX(Math.PI / 2).translate(0, 0, -0.5), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.8, depthTest: false }));
  laser.renderOrder = 61;
  laser.visible = false;
  h.ray.add(laser);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
  dot.renderOrder = 62;
  dot.visible = false;
  scene.add(dot);
  menuLasers.push({ h, laser, dot, trigWas: false, hover: null, drag: false });
}
function drawMenu() {
  const c = menuCanvas.getContext("2d");
  c.clearRect(0, 0, MW, MH);
  c.fillStyle = "rgba(8, 20, 28, 0.93)";
  c.beginPath();
  c.roundRect ? c.roundRect(0, 0, MW, MH, 34) : c.rect(0, 0, MW, MH);
  c.fill();
  c.strokeStyle = "rgba(160, 220, 235, 0.35)";
  c.lineWidth = 3;
  c.stroke();
  c.textAlign = "left";
  if (menu.tab === 0) {
    c.font = "600 54px system-ui, sans-serif";
    c.fillStyle = "#ffd98a";
    c.fillText(clockText(game.hours), 60, 140);
    c.font = "26px system-ui, sans-serif";
    c.fillStyle = "#9fd8d2";
    c.fillText(weather.locked ? "Weather: " + (weather.preset || "") : "Weather: random", 280, 134);
    c.fillStyle = "rgba(255,255,255,0.14)";
    c.fillRect(SLIDER.x, SLIDER.y + 11, SLIDER.w, 12);
    const grd = c.createLinearGradient(SLIDER.x, 0, SLIDER.x + SLIDER.w, 0);
    grd.addColorStop(0, "#15204a");
    grd.addColorStop(0.25, "#ff9a5a");
    grd.addColorStop(0.5, "#8fd0ff");
    grd.addColorStop(0.75, "#ff6a5a");
    grd.addColorStop(1, "#15204a");
    c.fillStyle = grd;
    c.fillRect(SLIDER.x, SLIDER.y + 13, SLIDER.w, 8);
    const kx = SLIDER.x + (game.hours / 24) * SLIDER.w;
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(kx, SLIDER.y + 17, 17, 0, 6.283);
    c.fill();
  }
  for (const l of mlabels) {
    if (l.tab !== menu.tab) continue;
    c.fillStyle = l.color;
    c.font = (l.size > 24 ? "700 " : "") + l.size + "px system-ui, sans-serif";
    c.fillText(l.text, l.x, l.y);
  }
  c.textAlign = "right";
  c.fillStyle = fpsColor();
  c.font = "700 30px system-ui, sans-serif";
  c.fillText(fpsText(), 840, 140);
  c.textAlign = "left";
  for (const b of tabBtns()) {
    const hot = menuLasers.some((l) => l.hover === b);
    const on = b.active();
    c.fillStyle = on ? "#2fa88a" : hot ? "#3b5a68" : "#26363f";
    c.beginPath();
    c.roundRect ? c.roundRect(b.x, b.y, b.w, b.h, 14) : c.rect(b.x, b.y, b.w, b.h);
    c.fill();
    if (hot) {
      c.strokeStyle = "#bff3ff";
      c.lineWidth = 3;
      c.stroke();
    }
    c.fillStyle = on ? "#06231b" : "#e6efee";
    c.font = (b.isTab ? "600 21px" : "600 26px") + " system-ui, sans-serif";
    c.textAlign = "center";
    c.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 9);
    c.textAlign = "left";
  }
  c.fillStyle = "#8fa6a8";
  c.font = "20px system-ui, sans-serif";
  c.fillText("Point a controller · trigger to press · drag the bar to scrub time · X closes", 60, 944);
  menuTex.needsUpdate = true;
}
const _mo = new THREE.Vector3(), _mdv = new THREE.Vector3(), _mq = new THREE.Quaternion(), _mInv = new THREE.Matrix4();
function menuHit(h) {
  h.ray.getWorldPosition(_mo);
  h.ray.getWorldQuaternion(_mq);
  _mdv.set(0, 0, -1).applyQuaternion(_mq);
  menuPanel.updateMatrixWorld(true);
  _mInv.copy(menuPanel.matrixWorld).invert();
  const o = _mo.clone().applyMatrix4(_mInv);
  const d = _mdv.clone().transformDirection(_mInv);
  if (Math.abs(d.z) < 1e-4) return null;
  const t = -o.z / d.z;
  if (t < 0.05 || t > 6) return null;
  const x = o.x + d.x * t, y = o.y + d.y * t;
  if (Math.abs(x) > PW / 2 + 0.03 || Math.abs(y) > PH / 2 + 0.03) return null;
  return { px: ((x + PW / 2) / PW) * MW, py: ((PH / 2 - y) / PH) * MH, t, point: _mo.clone().addScaledVector(_mdv, t) };
}

// ----- the panel on a screen -----
const gm = $("gmenu");
gm.innerHTML = `<div class="tabs" id="gm-tabs"></div>
<h3><span id="gm-fps"></span></h3>
<div class="pane" data-tab="0"><div class="big" id="gm-clock"></div>
<input id="gm-slider" type="range" min="0" max="24" step="0.05">
<div class="lbl">Set the time</div><div class="row" id="gm-presets"></div>
<div class="lbl">How fast time passes</div><div class="row" id="gm-speed"></div>
<div class="lbl">Weather</div><div class="row" id="gm-weather"></div></div>
<div class="pane" data-tab="1">
<div class="lbl">Sun brightness <span id="gm-sunv"></span></div><input id="gm-sun" type="range" min="0" max="2" step="0.05">
<div class="lbl">Moon brightness <span id="gm-moonv"></span></div><input id="gm-moon" type="range" min="0" max="2" step="0.05">
<div class="lbl">Aurora (on clear nights)</div><div class="row" id="gm-aurora"></div>
<div class="lbl">Star brightness</div><div class="row" id="gm-stars"></div>
<div class="lbl">Wave height</div><div class="row" id="gm-waves"></div>
<div class="lbl">Sand mark detail (changing it smooths the sand)</div><div class="row" id="gm-sand"></div>
<div class="row" style="margin-top:8px"><button id="gm-smooth">Smooth the sand</button></div>
<div class="lbl">Minimap (M on a keyboard)</div><div class="row" id="gm-map"></div>
<div class="lbl">Festival lanterns: sky, lotus on the sea, beach garland</div><div class="row" id="gm-fest"></div></div>
<div class="pane" data-tab="2">
<div class="lbl">Clouds (the costliest part of the sky)</div><div class="row" id="gm-clouds"></div>
<div class="lbl">God rays</div><div class="row" id="gm-rays"></div>
<div class="lbl">Clouds shade the sea and sand</div><div class="row" id="gm-shadows"></div></div>
<div class="pane" data-tab="3"><div class="lbl">Jump to a place on the island</div><div class="row" id="gm-tp"></div></div>
<div class="pane" data-tab="4"><div class="lbl">Flight (jump, then hold the trigger and point where to fly; on a screen, hold Space in the air)</div><div class="row" id="gm-flight"></div>
<div class="lbl">Flight speed</div><div class="row" id="gm-fspd"></div>
<div class="lbl">Boat speed</div><div class="row" id="gm-bspd"></div>
<div class="row" style="margin-top:8px"><button id="gm-boatreset">Return the boat to the dock</button></div></div>
<div class="hint">X or Esc closes</div>`;
const gmButtons = [];
const addDomRow = (id, list, onClick, active) => {
  for (const [label, val] of list) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => (onClick(val), refreshDomMenu());
    $(id).appendChild(b);
    gmButtons.push({ b, active: () => active(val) });
  }
};
MENU_TABS.forEach((name, i) => {
  const b = document.createElement("button");
  b.textContent = name;
  b.onclick = () => ((menu.tab = i), refreshDomMenu());
  $("gm-tabs").appendChild(b);
  gmButtons.push({ b, active: () => menu.tab === i });
});
addDomRow("gm-tp", TELEPORTS, (f) => f(), () => false);
addDomRow("gm-fest", [["Off", 0], ["On", 1]], (i) => ((opts.festival = i), applyOpts()), (i) => opts.festival === i);
addDomRow("gm-map", MAP_RANGES.map(([n], i) => [n, i]), (i) => ((opts.map = i), applyOpts()), (i) => opts.map === i);
addDomRow("gm-fspd", FLIGHT_SPEEDS.map(([n], i) => [n, i]), (i) => ((opts.flightSpd = i), applyOpts()), (i) => opts.flightSpd === i);
addDomRow("gm-bspd", BOAT_SPEEDS.map(([n], i) => [n, i]), (i) => ((opts.boatSpd = i), applyOpts()), (i) => opts.boatSpd === i);
$("gm-boatreset").onclick = () => resetBoat();
addDomRow("gm-aurora", [["Off", 0], ["On", 1]], (i) => ((opts.aurora = i), applyOpts()), (i) => opts.aurora === i);
addDomRow("gm-flight", [["Off", 0], ["On", 1]], (i) => ((opts.flight = i), applyOpts()), (i) => opts.flight === i);
addDomRow("gm-stars", STAR_LEVELS.map(([n], i) => [n, i]), (i) => ((opts.stars = i), applyOpts()), (i) => opts.stars === i);
addDomRow("gm-waves", WAVE_LEVELS.map(([n], i) => [n, i]), (i) => ((opts.waves = i), applyOpts()), (i) => opts.waves === i);
addDomRow("gm-sand", SAND_LEVELS.map(([n], i) => [n, i]), (i) => ((opts.sand = i), applyOpts()), (i) => opts.sand === i);
$("gm-smooth").onclick = () => clearImprint();
addDomRow("gm-presets", TIME_PRESETS, (h) => setTime(h), () => false);
addDomRow("gm-speed", TIME_SPEEDS, (s) => (game.speed = s), (s) => game.speed === s);
addDomRow("gm-clouds", [["Off", 0], ["Low", 1], ["Medium", 2], ["High", 3]], (i) => ((perf.clouds = i), applyPerf()), (i) => perf.clouds === i);
addDomRow("gm-rays", [["Off", 0], ["Low", 1], ["Medium", 2], ["High", 3]], (i) => ((perf.rays = i), applyPerf()), (i) => perf.rays === i);
addDomRow("gm-shadows", [["Off", 0], ["On", 1]], (i) => ((perf.shadows = i), applyPerf()), (i) => perf.shadows === i);
addDomRow("gm-weather", WEATHER_BUTTONS, (id) => (id === "random" ? setRandomWeather() : setWeatherPreset(id)), weatherIs);
$("gm-slider").oninput = (e) => setTime(+e.target.value);
for (const [id, k] of [["gm-sun", "sunI"], ["gm-moon", "moonI"]]) {
  $(id).value = opts[k];
  $(id + "v").textContent = Math.round(opts[k] * 100) + "%";
  $(id).oninput = (e) => { opts[k] = +e.target.value; $(id + "v").textContent = Math.round(opts[k] * 100) + "%"; applyOpts(); };
}
function refreshDomMenu() {
  $("gm-clock").textContent = clockText(game.hours);
  $("gm-fps").textContent = fpsText();
  $("gm-fps").style.color = fpsColor();
  if (document.activeElement !== $("gm-slider")) $("gm-slider").value = game.hours;
  for (const g of gmButtons) g.b.classList.toggle("on", g.active());
  gm.querySelectorAll(".pane").forEach((p) => (p.hidden = +p.dataset.tab !== menu.tab));
}

function toggleMenu(force) {
  const want = typeof force === "boolean" ? force : !menu.open;
  if (want === menu.open) return;
  menu.open = want;
  if (renderer.xr.isPresenting) {
    if (want) {
      // float it in front of you, turned to face you
      camera.getWorldDirection(_sD);
      _sD.y = 0;
      _sD.normalize();
      _sD.applyQuaternion(_mq.copy(rig.quaternion).invert()); // into the rig's own space
      const cl = camera.position;
      menuPanel.position.set(cl.x + _sD.x * 1.1, cl.y - 0.1, cl.z + _sD.z * 1.1);
      menuPanel.rotation.set(0, Math.atan2(cl.x - menuPanel.position.x, cl.z - menuPanel.position.z), 0);
      menu.sig = "";
    }
    menuPanel.visible = want;
    if (!want) for (const l of menuLasers) l.laser.visible = l.dot.visible = false;
  } else gm.hidden = !want;
  if (want && !renderer.xr.isPresenting) refreshDomMenu();
}
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "KeyX") toggleMenu();
  if (e.code === "Escape") toggleMenu(false);
});
let xWas = false;
function updateMenu(dt) {
  if (!renderer.xr.isPresenting) {
    if (menu.open) refreshDomMenu();
    return;
  }
  const Lh = handOf("left");
  const xDown = !!(Lh && Lh.gamepad && Lh.gamepad.buttons[4] && Lh.gamepad.buttons[4].pressed);
  if (xDown && !xWas) toggleMenu();
  xWas = xDown;
  if (!menu.open) return;
  let hoverSig = "";
  for (const l of menuLasers) {
    const h = l.h;
    if (!h.side) {
      l.laser.visible = l.dot.visible = false;
      continue;
    }
    const hit = menuHit(h);
    l.hover = null;
    l.laser.visible = true;
    l.laser.scale.z = hit ? hit.t : 2.5;
    l.dot.visible = !!hit;
    const trig = trigDown(h);
    if (hit) {
      l.dot.position.copy(hit.point);
      for (const b of tabBtns()) if (hit.px >= b.x && hit.px <= b.x + b.w && hit.py >= b.y && hit.py <= b.y + b.h) l.hover = b;
      const onBar = menu.tab === 0 && hit.px >= SLIDER.x - 20 && hit.px <= SLIDER.x + SLIDER.w + 20 && hit.py >= SLIDER.y - 14 && hit.py <= SLIDER.y + SLIDER.h + 14;
      if (trig && !l.trigWas) {
        if (l.hover) {
          l.hover.click();
          buzz(h, 0.35, 30);
        } else if (onBar) l.drag = true;
      }
      if (l.drag && trig) setTime(clamp((hit.px - SLIDER.x) / SLIDER.w, 0, 1) * 24);
    }
    if (!trig) l.drag = false;
    l.trigWas = trig;
    hoverSig += (l.hover ? l.hover.label : "-") + "|";
  }
  const sig = `${menu.tab}|${Math.floor(game.hours * 60)}|${game.speed}|${weather.locked}|${weather.preset}|${perf.clouds}${perf.rays}${perf.shadows}|${opts.aurora}${opts.stars}${opts.waves}${opts.sand}${opts.flight}${opts.map}${opts.flightSpd}${opts.boatSpd}${opts.festival}|${fpsText()}|${hoverSig}`;
  if (sig !== menu.sig) {
    menu.sig = sig;
    drawMenu();
  }
}

// ===== The wider world: islands that stream in as you travel =====
// Every cell of the world grid may hold an island (see islandCell: the same island, always, for a given seed). Cells within one cell of you
// are "loaded": the land is built (a mesh drawn with the same sand and grass shader as the home beach, tinted for its biome), then its
// forest, then, as you get near, its detailed trees and its places of interest. They are built a little each frame (a time budget), well
// out of sight in the haze, and the whole land bends gently away below the horizon, so islands rise out of the sea as you approach.
const worldRoot = new THREE.Group();
scene.add(worldRoot);
const chunks = new Map();
const mulberry = (seed) => {
  let s = Math.floor(seed * 4294967296) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const forestDensity = (x, z) => vnz(x / 70, z / 70, 21) * 0.65 + vnz(x / 25, z / 25, 22) * 0.35;

// ----- the curve of the earth: things in a chunk sink below the horizon with distance (the sea stays flat) -----
function curved(mat) {
  mat.userData.shared = true; // (the curve itself is applied to every material now)
  return mat;
}
const chunkLandMat = (() => {
  const base = land.material;
  let fs = base.fragmentShader;
  const must = (a, b) => {
    if (!fs.includes(a)) throw new Error("land shader patch failed: " + a.slice(0, 40));
    fs = fs.replace(a, b);
  };
  must("varying vec3 vN;", "varying vec3 vN;\n      varying vec4 vTint;\n      varying float vLava;\n      varying float vField;\n      varying vec4 vGrass;");
  must("green *= 0.65 + 0.7 * blades;", `green *= 0.65 + 0.7 * blades;
        green *= vGrass.rgb;
        {
          float fk;
          float fs = scatter(p + 33.0, 3.5, 0.1, 0.06, fk) * vGrass.a * near;
          green = mix(green, fk < 0.33 ? vec3(0.96, 0.86, 0.3) : fk < 0.66 ? vec3(0.9, 0.42, 0.52) : vec3(0.86, 0.86, 0.96), fs * 0.9);
        }`);
  must("      void main() {", `      // Coastline's fields: a warped patchwork of crops, offset row by row, with hedgerows and tractor lines
      vec3 fieldColor(vec2 p, out float kind, out float hedge) {
        vec2 w = p + vec2(vnoise(p * 0.012), vnoise(p * 0.012 + 7.0)) * 44.0 - 22.0;
        vec2 q = mat2(0.94, -0.34, 0.34, 0.94) * w;
        vec2 size = vec2(46.0, 62.0);
        float row = floor(q.y / size.y);
        q.x += hash(vec2(row, 3.0)) * size.x;
        vec2 cell = floor(q / size);
        vec2 f = fract(q / size) * size;
        float edge = min(min(f.x, size.x - f.x), min(f.y, size.y - f.y));
        hedge = 1.0 - smoothstep(0.8, 2.2, edge);
        kind = floor(hash(cell) * 6.0);
        vec3 c = kind < 1.0 ? vec3(0.78, 0.66, 0.3) : kind < 2.0 ? vec3(0.82, 0.74, 0.46) : kind < 3.0 ? vec3(0.4, 0.62, 0.2) : kind < 4.0 ? vec3(0.18, 0.42, 0.14) : kind < 5.0 ? vec3(0.34, 0.24, 0.16) : vec3(0.7, 0.62, 0.32);
        float sd = hash(cell + 9.0) > 0.5 ? f.x : f.y;
        c *= 1.0 + (kind >= 5.0 ? 0.06 : 0.03) * sin(sd * 1.9);
        c *= 0.9 + 0.18 * hash(cell + 4.0);
        float tree = smoothstep(0.5, 0.8, vnoise(p * 0.16));
        return mix(c, vec3(0.14, 0.26, 0.1) * (0.75 + 0.45 * tree), hedge);
      }
      void main() {`);
  must(
    "albedo = mix(albedo, albedo * vec3(0.78, 0.7, 0.62), smoothstep(0.1, 0.9, I0)); // damp, packed sand at the bottom of a groove",
    `albedo = mix(albedo, albedo * vec3(0.78, 0.7, 0.62), smoothstep(0.1, 0.9, I0)); // damp, packed sand at the bottom of a groove
        // this island's own ground: rock, ash, mud, paving, the dirt of a path
        float tnA = clamp(vTint.a * (0.7 + 0.6 * vnoise(p * 0.35)), 0.0, 1.0);
        albedo = mix(albedo, vTint.rgb * (0.78 + 0.44 * vnoise(p * 2.7)) * (0.9 + 0.2 * vnoise(p * 11.0)), tnA);
        if (vField > 0.01) {
          float fk, fh;
          vec3 fc = fieldColor(p, fk, fh);
          albedo = mix(albedo, fc, clamp(vField * 1.4, 0.0, 1.0));
        }
        float lava = vLava * smoothstep(0.25, 0.6, fbm(p * 0.07 + uTime * 0.02));
        albedo = mix(albedo, vec3(0.06, 0.03, 0.02), lava);`
  );
  must(
    "col = mix(col, mix(uHorizon, uUnderCol, uUnder), smoothstep(uFogN, uFogF, dist));",
    `col += vec3(1.3, 0.42, 0.07) * lava * (0.75 + 0.35 * sin(uTime * 1.4 + p.x * 0.17 + p.y * 0.13)); // molten rock glows
        col = mix(col, mix(uHorizon, uUnderCol, uUnder), smoothstep(uFogN, uFogF, dist));`
  );
  must("float gloss = max(wet * 0.55, shine) * (1.0 - gt);", "float gloss = max(wet * 0.55, shine) * (1.0 - gt) * (1.0 - tnA);");
  const m = new THREE.ShaderMaterial({
    uniforms: landUniforms,
    vertexShader: /* glsl */ `
      attribute vec4 aTint;
      attribute float aLava;
      attribute float aField;
      attribute vec4 aGrass;
      uniform float uCurve;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec4 vTint;
      varying float vLava;
      varying float vField;
      varying vec4 vGrass;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vN = normal;
        vTint = aTint;
        vLava = aLava;
        vField = aField;
        vGrass = aGrass;
        vec2 cd = wp.xz - cameraPosition.xz;
        gl_Position = projectionMatrix * viewMatrix * (wp - vec4(0.0, dot(cd, cd) * uCurve, 0.0, 0.0));
      }
    `,
    fragmentShader: fs,
  });
  m.userData.shared = true;
  return m;
})();

// ----- paths: a dirt track from each place of interest to the beach, and between neighbouring places -----
function distToPaths(a, x, z) {
  let best = 1e9;
  for (const path of a.paths) {
    for (let k = 0; k + 1 < path.length; k++) {
      const p = path[k], q = path[k + 1];
      const vx = q.x - p.x, vz = q.z - p.z, wx = x - p.x, wz = z - p.z;
      const t = clamp((wx * vx + wz * vz) / (vx * vx + vz * vz + 1e-6), 0, 1);
      const d = Math.hypot(wx - vx * t, wz - vz * t);
      if (d < best) best = d;
    }
  }
  return best;
}

// ----- the tint of the ground for each kind of island (r, g, b, how much), and whether it is molten -----
const _tint = { r: 0, g: 0, b: 0, a: 0, lava: 0 };
function groundTint(a, x, z, h, slope, rho, th) {
  let r = 0, g = 0, b = 0, al = 0, lava = 0;
  const ty = a.type;
  // rocky where steep
  const rock = smooth(0.45, 0.85, slope);
  if (rock > 0 && h > 0.8) {
    const band = 0.82 + 0.18 * Math.sin(h * 1.7 + vnz(x * 0.05, z * 0.05, 40) * 4);
    (r = 0.5 * band), (g = 0.43 * band), (b = 0.35 * band), (al = rock * 0.95);
  }
  if (ty === 2 && h > 0.5) {
    const ash = smooth(1.5, 14, h);
    const hi = smooth(0.45, 0.8, h / a.h);
    r = lerp(0.09, 0.2, hi); g = lerp(0.085, 0.19, hi); b = lerp(0.08, 0.18, hi);
    al = Math.max(al, ash * 0.94);
    const crater = 1 - smooth(0.075, 0.1, rho);
    const stream = Math.pow(Math.max(0, Math.sin(th * 4 + a.p1 + Math.sin(rho * 16) * 0.7)), 22) * smooth(0.5, 0.14, rho) * smooth(0.1, 0.16, rho);
    lava = Math.max(crater, stream * 0.9);
    if (lava > 0.05) (r = 0.1), (g = 0.04), (b = 0.02), (al = 1);
  } else if (ty === 3 && h > 2.5) (r = 0.5), (g = 0.47), (b = 0.4), (al = Math.max(al, 0.55 * smooth(2.5, 3.5, h)));
  else if (ty === 4 && h > -0.4) (r = 0.17), (g = 0.22), (b = 0.1), (al = Math.max(al, 0.85 * smooth(-0.4, 0.2, h)));
  else if (ty === 5 && h > 1.0 && inCityZone(a, x, z, 12)) {
    const v = 0.43 + 0.06 * vnz(x * 0.2, z * 0.2, 61);
    (r = v), (g = v * 0.99), (b = v * 0.95);
    al = Math.max(al, 0.9 * smooth(1.0, 2.2, h));
  }
  // paths
  if (a.paths && h > 0.9) {
    const dp = distToPaths(a, x, z);
    const pm = (1 - smooth(1.0, 2.2, dp + 0.6 * (vnz(x * 0.7, z * 0.7, 31) - 0.5))) * 0.88;
    if (pm > al) (r = 0.46), (g = 0.36), (b = 0.24), (al = pm);
  }
  _tint.r = r; _tint.g = g; _tint.b = b; _tint.a = al; _tint.lava = lava;
  return _tint;
}

// ----- the land of one island -----
const fineStep = (a) => (a.r > 230 ? 8 : 6);
// each island's own greens (a multiplier on the meadow colour) and how many wildflowers it has
function grassPalette(a) {
  const v = a.veg;
  if (a.type === 2) return [0.95, 0.82, 0.55, 0];       // scorched, ash-dusted
  if (a.type === 3) return [1.3, 1.15, 0.72, 0.1];       // dry, golden, old
  if (a.type === 4) return [0.62, 0.8, 0.5, 0];          // dark, wet
  if (a.type === 5 || a.type === 6) return [1.0, 1.05, 0.9, 0.1];
  return v === 0 ? [1.0, 1.08, 0.82, 0.55] : v === 1 ? [0.85, 1.0, 0.7, 0.35] : [0.66, 0.9, 0.58, 0.15]; // lush / mixed / deep woodland
}
function* buildTerrain(c, step) {
  const a = c.a;
  islandPOIs(a);
  const E = 1.42 * a.r + 230;
  const n = Math.ceil((2 * E) / step) + 1, x0 = a.x - E, z0 = a.z - E;
  const H = new Float32Array(n * n), own = new Uint8Array(n * n); // own: 1 = this island rules the point, 0 = a neighbouring island does, 2 = none does
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const X = x0 + i * step, Z = z0 + j * step;
      H[j * n + i] = bedHeightJS(X, Z);
      const m = isleMix(X, Z, false);
      own[j * n + i] = m.a === a ? 1 : m.a ? 0 : 2;
    }
    if (j % 10 === 9) yield;
  }
  const pos = new Float32Array(n * n * 3), tint = new Float32Array(n * n * 4), lava = new Float32Array(n * n), field = new Float32Array(n * n), grass = new Float32Array(n * n * 4);
  const pal = grassPalette(a);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, x = x0 + i * step, z = z0 + j * step, h = H[k];
      pos[k * 3] = x; pos[k * 3 + 1] = own[k] === 0 ? h - 0.05 : h; pos[k * 3 + 2] = z; // (where a neighbour's land overlaps, this island's copy sits a hair lower, so the two never fight for the same pixels)
      if (h > -0.5) {
        const hx = H[j * n + Math.min(n - 1, i + 1)] - H[j * n + Math.max(0, i - 1)], hz = H[Math.min(n - 1, j + 1) * n + i] - H[Math.max(0, j - 1) * n + i];
        const slope = Math.hypot(hx, hz) / (2 * step);
        const qx = x - a.x, qz = z - a.z, th = Math.atan2(qz, qx);
        const t = groundTint(a, x, z, h, slope, Math.hypot(qx, qz) / isleCoastR(a, th), th);
        tint[k * 4] = t.r; tint[k * 4 + 1] = t.g; tint[k * 4 + 2] = t.b; tint[k * 4 + 3] = t.a;
        const gv = 0.9 + 0.2 * vnz(x / 240, z / 240, 90);
        grass[k * 4] = pal[0] * gv; grass[k * 4 + 1] = pal[1] * (0.95 + 0.1 * gv); grass[k * 4 + 2] = pal[2] * gv; grass[k * 4 + 3] = pal[3] * smooth(0.4, 0.6, vnz(x / 90, z / 90, 91));
        lava[k] = t.lava;
        if (a.farm) field[k] = farmMask(a, x, z);
      }
    }
    if (j % 8 === 7) yield;
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const k = j * n + i;
      if (Math.max(H[k], H[k + 1], H[k + n], H[k + n + 1]) < -3.2) continue; // (the deep sea floor is never seen)
      if (!(own[k] | own[k + 1] | own[k + n] | own[k + n + 1])) continue; // (land that wholly belongs to a neighbouring island is drawn by its mesh, not twice)
      idx.push(k, k + n, k + 1, k + 1, k + n, k + n + 1); // (wound to face up)
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aTint", new THREE.BufferAttribute(tint, 4));
  geo.setAttribute("aLava", new THREE.BufferAttribute(lava, 1));
  geo.setAttribute("aField", new THREE.BufferAttribute(field, 1));
  geo.setAttribute("aGrass", new THREE.BufferAttribute(grass, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, chunkLandMat);
  if (c.terrain) {
    c.group.remove(c.terrain);
    c.terrain.geometry.dispose();
  }
  c.group.add(mesh);
  c.terrain = mesh;
  c.terrainStep = step;
  yield;
}

// ----- trees: one cheap instanced palm for the distance, and the real wind-blown ones when you are near -----
const chunkWindMat = curved(windMaterial());
let lowPalmGeo = null, lowPalmMat = null;
function lowPalm() {
  if (!lowPalmGeo) {
    const trunk = new THREE.CylinderGeometry(0.1, 0.2, 6, 5).translate(0, 3, 0);
    const crown = new THREE.ConeGeometry(2.4, 1.8, 7).translate(0, 6.4, 0);
    lowPalmGeo = mergeGeos([{ g: trunk, color: 0x7d6445 }, { g: crown, color: 0x35692a }]);
    lowPalmMat = curved(new THREE.MeshLambertMaterial({ vertexColors: true }));
  }
  return [lowPalmGeo, lowPalmMat];
}
function nearRoad(a, x, z, m) {
  if (!a.road) return false;
  for (const run of islandRoad(a)) for (const p of run.pts) if (Math.abs(p.x - x) < m && Math.abs(p.z - z) < m) return true;
  return false;
}
function palmSpots(c) {
  if (c.spots) return c.spots;
  const a = c.a, R = mulberry(a.seed * 31 + 5), out = [];
  const want = a.type === 6 ? 0 : a.type === 1 ? Math.floor(a.r * a.r * 0.0026 * (a.veg === 2 ? 0.2 : a.veg === 1 ? 0.55 : 1)) : a.type === 4 ? Math.floor(a.r * a.r * 0.0008) : a.type === 2 ? Math.floor(a.r * a.r * 0.0004) : a.type === 3 ? Math.floor(a.r * a.r * 0.0006) : a.type === 5 ? Math.floor(a.r * a.r * 0.0011) : Math.floor(a.r * a.r * 0.0003);
  for (let tries = 0; tries < want * 6 && out.length < want; tries++) {
    const th = R() * 6.2832, rr = Math.sqrt(R()) * isleCoastR(a, th);
    const x = a.x + Math.cos(th) * rr, z = a.z + Math.sin(th) * rr;
    const d = isleDist(a, x, z), h = bedHeightJS(x, z);
    if (d > (a.type === 1 || a.type === 2 ? -6 : -14) || h < 1.2 || h > (a.type === 2 ? 22 : 14)) continue;
    const f = forestDensity(x, z);
    if (R() > smooth(0.36, 0.62, f) * 0.92 + 0.1) continue;
    if (a.type === 5 && inCityZone(a, x, z, 26)) continue;
    if (poiKeepClear(a, x, z, 4)) continue;
    if (a.paths && distToPaths(a, x, z) < 2.6) continue;
    if (a.farm && farmMask(a, x, z) > 0.1) continue;
    if (nearRoad(a, x, z, 9)) continue;
    if (Math.abs(bedHeightJS(x + 3, z) - h) > 2.2 || Math.abs(bedHeightJS(x, z + 3) - h) > 2.2) continue;
    out.push({ x, z, h: 5.5 + R() * 3, lean: 0.1 + R() * 0.22, dir: R() * 6.2832 });
  }
  c.spots = out;
  return out;
}
function* buildLowPalms(c) {
  const spots = palmSpots(c);
  if (!spots.length) return;
  const [geo, mat] = lowPalm();
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  spots.forEach((s, i) => {
    e.set(0, s.dir, 0);
    q.setFromEuler(e);
    const k = s.h / 6;
    m4.compose(p.set(s.x, bedHeightJS(s.x, s.z) - 0.1, s.z), q, sc.set(k, k, k));
    im.setMatrixAt(i, m4);
  });
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;
  c.group.add(im);
  c.lowPalms = im;
  yield;
}
function* buildHiPalms(c) {
  const spots = palmSpots(c);
  const m = plantNew();
  const before = colliders.length;
  for (let i = 0; i < spots.length; i++) {
    buildPalm(m, spots[i].x, spots[i].z, spots[i].h, spots[i].lean, spots[i].dir);
    if (i % 5 === 4) yield;
  }
  for (let i = before; i < colliders.length; i++) colliders[i].chunk = c.a.id;
  if (!spots.length) return;
  const mesh = new THREE.Mesh(plantGeometry(m), chunkWindMat);
  mesh.frustumCulled = false;
  c.group.add(mesh);
  c.hiPalms = mesh;
  if (c.lowPalms) c.lowPalms.visible = false;
  yield;
}
function dropHiPalms(c) {
  if (!c.hiPalms) return;
  c.group.remove(c.hiPalms);
  c.hiPalms.geometry.dispose();
  c.hiPalms = null;
  for (let i = colliders.length - 1; i >= 0; i--) if (colliders[i].chunk === c.a.id && !colliders[i].poi) colliders.splice(i, 1);
  if (c.lowPalms) c.lowPalms.visible = true;
}

// ----- loading and unloading -----
function loadChunk(a) {
  const c = { a, group: new THREE.Group(), gen: null, done: false, hi: null, poiNodes: [], updaters: [], terrain: null, lowPalms: null, hiPalms: null };
  worldRoot.add(c.group);
  c.gen = (function* () {
    if (a.type) {
      yield* buildTerrain(c, 14); // coarse at first; refined when you are near
      yield* buildLowPalms(c);
      yield* buildIslandExtras(c);
      yield* extrasHillTurbines(c);
      yield* extrasIslandBoats(c);
    } else if (a.feature === "rig") yield* extrasRig(c);
    else if (a.feature === "wind") yield* extrasWind(c);
    else if (a.feature === "ship") yield* extrasShips(c);
  })();
  chunks.set(a.id, c);
  return c;
}
function unloadChunk(c) {
  for (const s of c.surf || []) { const i = poiSurfaces.indexOf(s); if (i >= 0) poiSurfaces.splice(i, 1); }
  for (const o of c.obstacles || []) { const i = seaObstacles.indexOf(o); if (i >= 0) seaObstacles.splice(i, 1); }
  worldRoot.remove(c.group);
  c.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && !(o.material.userData && o.material.userData.shared)) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
  for (let i = colliders.length - 1; i >= 0; i--) if (colliders[i].chunk === c.a.id) colliders.splice(i, 1);
  poiUnloadChunk(c);
  chunks.delete(c.a.id);
}
function chunkDist(c) {
  return Math.max(0, Math.hypot(camPos.x - c.a.x, camPos.z - c.a.z) - c.a.r);
}
function updateWorld(dt, t, lampsOn) {
  if (spaceState.alt > 2500) return; // high above, the planet's map stands in for the islands: nothing to stream
  const around = cellsAround(player.x, player.z, 1), keep = new Set();
  for (const a of around) {
    keep.add(a.id);
    if ((a.type || a.feature) && !chunks.has(a.id)) loadChunk(a);
  }
  for (const c of [...chunks.values()]) if (!keep.has(c.a.id)) unloadChunk(c);
  // build a little each frame, nearest first
  const t0 = performance.now();
  const order = [...chunks.values()].filter((c) => !c.done || true).sort((p, q) => chunkDist(p) - chunkDist(q));
  for (const c of order) {
    while (!c.done && performance.now() - t0 < 3.5) if (c.gen.next().done) c.done = true;
    if (!c.done) break;
    // detail trees when near, and a finer land
    const d = chunkDist(c);
    if (c.terrain && !c.up && d < 600 && c.terrainStep > 10) c.up = buildTerrain(c, fineStep(c.a));
    if (c.terrain && !c.up && d > 1000 && c.terrainStep < 10) c.up = buildTerrain(c, 14);
    if (c.up) while (performance.now() - t0 < 3.5) if (c.up.next().done) { c.up = null; break; }
    if (c.a.type && d < 420 && !c.hi && !c.hiBuilding) c.hi = buildHiPalms(c), (c.hiBuilding = true);
    if (c.hi && c.hiBuilding) while (performance.now() - t0 < 3.5) if (c.hi.next().done) { c.hiBuilding = false; c.hiDone = true; break; }
    if (d > 650 && (c.hiDone || c.hiBuilding)) { dropHiPalms(c); c.hi = null; c.hiBuilding = false; c.hiDone = false; }
    for (const u of c.updaters) u(t, dt, lampsOn);
  }
  updatePOIs(dt, t, lampsOn);
}
// build everything about an island at once (used when you teleport right to it)
function loadChunkNow(a) {
  const c = chunks.get(a.id) || loadChunk(a);
  while (!c.done) if (c.gen.next().done) c.done = true;
  if (c.terrain && c.terrainStep > 10) { const g = buildTerrain(c, fineStep(a)); while (!g.next().done); }
  return c;
}
// every island and sea feature on the planet (there are a few thousand; made once)
function planetCells() {
  if (planetCells.list) return planetCells.list;
  const out = [];
  for (let f = 0; f < 6; f++) {
    const Cx = FACE_C[f][0], Cz = FACE_C[f][1];
    const j0 = Math.floor((Cz - FACE_W / 2 - GRID_OZ) / CELL), j1 = Math.floor((Cz + FACE_W / 2 - GRID_OZ) / CELL);
    for (let j = j0; j <= j1; j++) {
      const i0 = Math.floor((Cx - FACE_W / 2 - GRID_OX - rowOff(j)) / CELL), i1 = Math.floor((Cx + FACE_W / 2 - GRID_OX - rowOff(j)) / CELL);
      for (let i = i0; i <= i1; i++) {
        const a = islandCell(i, j);
        if (a.face === f && (a.type || a.feature)) out.push(a);
      }
    }
  }
  planetCells.list = out;
  return out;
}
const _na = new THREE.Vector3(), _nb = new THREE.Vector3();
// the cells on the planet nearest first (by the angle between them over the globe), starting from a point on the flat chart
function cellsByDistance(fromX, fromZ) {
  const f0 = faceAt(fromX, fromZ);
  faceDir(f0, fromX - FACE_C[f0][0], fromZ - FACE_C[f0][1], _na);
  return planetCells().map((a) => ({ a, d: Math.acos(clamp(_na.dot(faceDir(a.face, a.x - FACE_C[a.face][0], a.z - FACE_C[a.face][1], _nb)), -1, 1)) })).sort((p, q) => p.d - q.d).map((e) => e.a);
}
function nearestIsland(type, fromX, fromZ) {
  for (const a of cellsByDistance(fromX, fromZ)) if (a.type === type) return a;
  return null;
}
function teleportToIsland(a) {
  loadChunkNow(a);
  // a spot on the beach on the side facing you
  // (from another face there is no flat line to follow: come in from the side facing the middle of its face)
  const near = faceAt(player.x, player.z) === a.face;
  const dx = (near ? player.x : FACE_C[a.face][0]) - a.x, dz = (near ? player.z : FACE_C[a.face][1]) - a.z, th = Math.atan2(dz, dx);
  const R = isleCoastR(a, th) - 22;
  const x = a.x + Math.cos(th) * R, z = a.z + Math.sin(th) * R;
  teleportTo(x, z, a.x, a.z);
}

