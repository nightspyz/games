"use strict";
// ===== Places of interest (POIs): handcrafted spots set into the generated land =====
// A POI is described by a definition (where it may go, how it is built) and, for a given island, a deterministic placement worked out
// from the island's seed alone, so it is the same place every visit and never duplicated. Three levels of detail stream in as you
// approach: metadata only (just a position and a name), a cheap proxy silhouette (within ~1 km), and the full detailed scene with its
// props, lights and interactions (within ~130 m), which is dropped again when you leave. What you did there (a fire you lit, an offering
// you made) is kept in poiSave, and in localStorage, whether or not the place is currently built.
const POI_DEFS = {};
const POI_ORDER = [];
const definePOI = (def) => ((POI_DEFS[def.id] = def), POI_ORDER.push(def));
const poiSave = (() => {
  try { return JSON.parse(localStorage.getItem("lanternTidePOI") || "{}") || {}; } catch (e) { return {}; }
})();
const poiState = (id) => poiSave[id] || (poiSave[id] = {});
function savePOI() { try { localStorage.setItem("lanternTidePOI", JSON.stringify(poiSave)); } catch (e) {} }

const isleRaw = (a, x, z) => isleBed(a, x, z, isleDist(a, x, z));
// Placement: try spots at the right distance inland, and keep the first that passes every rule of the definition
function islandPOIs(a) {
  if (a.pois) return a.pois;
  a.pois = [];
  a.paths = [];
  if (!a.type) return a.pois;
  const R = mulberry(a.seed * 977 + 3);
  for (const def of POI_ORDER) {
    if (!def.types.includes(a.type) || R() > def.chance) continue;
    for (let t = 0; t < 120; t++) {
      const th = R() * 6.2832, Rc = isleCoastR(a, th);
      const u = lerp(def.inland[0], def.inland[1], R()), rr = Rc - u;
      if (rr < 25) continue;
      const x = a.x + Math.cos(th) * rr, z = a.z + Math.sin(th) * rr;
      const h = isleRaw(a, x, z);
      if (h < def.elev[0] || h > def.elev[1]) continue;
      const gx = isleRaw(a, x + 6, z) - isleRaw(a, x - 6, z), gz = isleRaw(a, x, z + 6) - isleRaw(a, x, z - 6);
      if (Math.hypot(gx, gz) / 12 > def.maxSlope) continue;
      let lo = h, hi = h, sum = h, ok = true;
      for (let k = 0; k < 8 && ok; k++) {
        const ax = x + Math.cos(k * 0.7854) * def.radius, az = z + Math.sin(k * 0.7854) * def.radius;
        const hh = isleRaw(a, ax, az);
        if (hh < (def.minH ?? 0.8) || isleDist(a, ax, az) > (def.edgeD ?? -6)) ok = false; // no water or sea inside the footprint
        lo = Math.min(lo, hh); hi = Math.max(hi, hh); sum += hh;
      }
      if (!ok || hi - lo > def.flatTol) continue;
      const f = forestDensity(x, z);
      if (def.forest && (f < def.forest[0] || f > def.forest[1])) continue;
      if (a.pois.some((p) => Math.hypot(p.x - x, p.z - z) < Math.max(def.spacing, p.def.spacing))) continue;
      a.pois.push({ id: a.id + ":" + def.id, def, a, x, z, y: sum / 9, yaw: Math.atan2(Math.cos(th), Math.sin(th)), th, proxy: null, node: null, gen: null, building: false, surfaces: [], interacts: [], updaters: [], disp: [] });
      break;
    }
  }
  // paths: from each place down to the beach, and between neighbours
  const wob = (x0, z0, x1, z1, n, ph) => {
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const s = k / n, px = lerp(x0, x1, s), pz = lerp(z0, z1, s), len = Math.hypot(x1 - x0, z1 - z0) + 1e-6;
      const off = Math.sin(s * 5 + ph) * Math.min(4, len * 0.05) * Math.sin(s * Math.PI);
      pts.push({ x: px - ((z1 - z0) / len) * off, z: pz + ((x1 - x0) / len) * off });
    }
    return pts;
  };
  for (const p of a.pois) {
    if (p.def.noPath) continue;
    let ex = p.x, ez = p.z;
    for (let k = 0; k < 60 && isleDist(a, ex, ez) < -4; k++) (ex += Math.cos(p.th) * 8), (ez += Math.sin(p.th) * 8);
    a.paths.push(wob(p.x, p.z, ex, ez, Math.max(3, Math.floor(Math.hypot(ex - p.x, ez - p.z) / 9)), p.th * 3));
  }
  const sorted = [...a.pois].sort((p, q) => p.th - q.th);
  for (let k = 0; k + 1 < sorted.length; k++) a.paths.push(wob(sorted[k].x, sorted[k].z, sorted[k + 1].x, sorted[k + 1].z, 8, k * 2));
  return a.pois;
}
// the ground is levelled under a place and blended back into the land around it
function poiFlatten(a, x, z, h) {
  for (const p of a.pois || islandPOIs(a)) {
    if (p.def.noFlatten) continue;
    const d = Math.hypot(x - p.x, z - p.z), R = p.def.radius + 1;
    if (d < R + p.def.blend) h = lerp(h, p.y, 1 - smooth(R, R + p.def.blend, d));
  }
  return h;
}
function poiKeepClear(a, x, z, margin) {
  for (const p of a.pois || islandPOIs(a)) if (Math.hypot(x - p.x, z - p.z) < p.def.clear + margin) return true;
  return false;
}

// ----- shared materials and small geometry helpers for the prefabs -----
let _pm = null;
function poiMats() {
  if (!_pm)
    _pm = {
      wood: curved(new THREE.MeshStandardMaterial({ map: driftTex, vertexColors: true, roughness: 0.92, color: new THREE.Color(1.6, 1.6, 1.6) })), // (the weathered-wood texture is dark: lift it)
      bark: curved(new THREE.MeshStandardMaterial({ map: barkTex, vertexColors: true, roughness: 0.95 })),
      stone: curved(rockMaterial()),
      cloth: curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })),
      plain: curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 })),
      proxy: curved(new THREE.MeshLambertMaterial({ vertexColors: true })),
    };
  return _pm;
}
const _pme = new THREE.Euler(), _pmm = new THREE.Matrix4(), _pc = new THREE.Color();
let _pr = Math.random;
function part(g, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx || ry || rz) g.applyMatrix4(_pmm.makeRotationFromEuler(_pme.set(rx, ry, rz, "YXZ")));
  g.translate(x, y, z);
  _pc.set(color).multiplyScalar(0.88 + 0.24 * _pr());
  return { g, color: _pc.clone() };
}
const pBox = (w, h, d, c, x, y, z, rx, ry, rz) => part(new THREE.BoxGeometry(w, h, d), c, x, y, z, rx, ry, rz);
const pCyl = (rt, rb, h, c, x, y, z, seg = 8, rx, ry, rz) => part(new THREE.CylinderGeometry(rt, rb, h, seg), c, x, y, z, rx, ry, rz);
const pCone = (r, h, c, x, y, z, seg = 6, rx, ry, rz) => part(new THREE.ConeGeometry(r, h, seg), c, x, y, z, rx, ry, rz);
function pBlob(r, c, x, y, z, sx = 1, sy = 1, sz = 1, seg = 7) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2));
  g.scale(sx, sy, sz);
  return part(g, c, x, y, z);
}
const pMesh = (list, mat) => new THREE.Mesh(mergeGeos(list), mat);

// ----- the streaming manager -----
const poiSurfaces = []; // walkable platforms (porches, piers): { cx, cz, yaw, hw, hl, y }
const poiInteracts = [];
function poiSurfaceAt(x, z) {
  let best = -Infinity;
  for (const s of poiSurfaces) {
    const dx = x - s.cx, dz = z - s.cz, c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c; // (yaw rotates local +z toward (sin yaw, cos yaw))
    if (Math.abs(lx) < s.hw && Math.abs(lz) < s.hl && s.y > best) best = s.y;
  }
  return best;
}
function makePOICtx(p) {
  const group = new THREE.Group();
  group.position.set(p.x, p.y, p.z);
  group.rotation.y = p.yaw;
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  const toWorld = (lx, lz) => [p.x + lx * cy + lz * sy, p.z - lx * sy + lz * cy];
  return {
    p, group, mats: poiMats(), state: poiState(p.id), toWorld,
    ground: (lx, lz) => { const [wx, wz] = toWorld(lx, lz); return bedHeightJS(wx, wz) - p.y; },
    surface(lx, lz, hw, hl, y) { const [wx, wz] = toWorld(lx, lz); const s = { cx: wx, cz: wz, yaw: p.yaw, hw, hl, y: p.y + y }; poiSurfaces.push(s); p.surfaces.push(s); },
    collide(lx, lz, r) { const [wx, wz] = toWorld(lx, lz); const c = { x: wx, z: wz, r, chunk: p.a.id, poi: true }; colliders.push(c); p.surfaces.push(c); },
    interact(lx, ly, lz, label, use) { const [wx, wz] = toWorld(lx, lz); const it = { p, pos: new THREE.Vector3(wx, p.y + ly, wz), label, use }; poiInteracts.push(it); p.interacts.push(it); return it; },
    track(o) { p.disp.push(o); return o; },
    glowMat(color, emissive) { const m = curved(new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0, roughness: 0.6 })); m.userData.shared = false; p.disp.push(m); return m; },
    sprite(color, size, blending = THREE.AdditiveBlending) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture, color, transparent: true, opacity: 0, blending, depthWrite: false }));
      s.scale.setScalar(size);
      p.disp.push(s.material);
      return s;
    },
  };
}
function dropPOIDetail(p) {
  if (p.node) {
    p.a && p.proxy && (p.proxy.visible = true);
    p.node.parent && p.node.parent.remove(p.node);
    p.node.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  for (const d of p.disp) d.dispose && d.dispose();
  for (const s of p.surfaces) {
    const i = poiSurfaces.indexOf(s);
    if (i >= 0) poiSurfaces.splice(i, 1);
    const j = colliders.indexOf(s);
    if (j >= 0) colliders.splice(j, 1);
  }
  for (const it of p.interacts) { const i = poiInteracts.indexOf(it); if (i >= 0) poiInteracts.splice(i, 1); }
  p.node = null; p.gen = null; p.building = false; p.updaters = []; p.surfaces = []; p.interacts = []; p.disp = [];
}
function poiUnloadChunk(c) {
  for (const p of c.a.pois || []) {
    dropPOIDetail(p);
    if (p.proxy) { p.proxy.geometry.dispose(); p.proxy = null; }
  }
}
let poiPromptId = null, poiTrigWas = [false, false];
function updatePOIs(dt, t, lampsOn) {
  const t0 = performance.now();
  for (const c of chunks.values()) {
    if (!c.done) continue;
    for (const p of c.a.pois || []) {
      const d = Math.hypot(camPos.x - p.x, camPos.z - p.z);
      if (d < 120 && !(poiSave[p.id] && poiSave[p.id].found)) {
        poiState(p.id).found = true; savePOI();
        const n = Object.values(poiSave).filter((q) => q && q.found).length;
        flashHint("Discovered: " + p.def.name + "  (" + n + " places found)");
      }
      if (d < 1100 && !p.proxy) {
        const ctx = makePOICtx(p);
        _pr = mulberry(p.a.seed + p.x * 0.001);
        const m = pMesh(p.def.proxy(ctx), poiMats().proxy);
        m.position.set(p.x, p.y, p.z);
        m.rotation.y = p.yaw;
        c.group.add(m);
        p.proxy = m;
      } else if (d > 1400 && p.proxy) { c.group.remove(p.proxy); p.proxy.geometry.dispose(); p.proxy = null; }
      if (d < 130 && !p.node && !p.building) {
        p.ctx = makePOICtx(p);
        p.gen = p.def.detail(p.ctx);
        p.building = true;
      }
      if (p.building) {
        while (performance.now() - t0 < 3) {
          _pr = p.ctx.rnd || (p.ctx.rnd = mulberry(p.a.seed * 13 + p.x * 0.01));
          const r = p.gen.next();
          if (r.done) {
            p.node = p.ctx.group;
            c.group.add(p.node);
            if (p.proxy) p.proxy.visible = false;
            if (r.value && r.value.update) p.updaters.push(r.value.update);
            p.building = false;
            break;
          }
        }
      }
      if ((p.node || p.building) && d > 200) dropPOIDetail(p);
      if (p.node) for (const u of p.updaters) u(t, dt, lampsOn, d);
    }
  }
  // interactions: E on a screen, or the trigger with a hand held close
  let near = null, nd = 1e9;
  for (const it of poiInteracts) {
    const d = it.pos.distanceTo(camPos);
    if (d < nd) (nd = d), (near = it);
  }
  if (near && nd < 3.2) {
    if (poiPromptId !== near) {
      poiPromptId = near;
      flashHint((renderer.xr.isPresenting ? "Trigger near it: " : "E: ") + near.label);
    }
  } else if (!near || nd > 5) poiPromptId = null;
  if (eTap3) {
    eTap3 = false;
    if (near && nd < 3.2 && !renderer.xr.isPresenting) near.use();
  }
  if (renderer.xr.isPresenting) {
    hands.forEach((h, i) => {
      const down = trigDown(h);
      if (down && !poiTrigWas[i] && h.side && !props.some((q) => q.holder === h)) {
        h.grip.getWorldPosition(_pv);
        for (const it of poiInteracts) if (it.pos.distanceTo(_pv) < 1.0) { it.use(); buzz(h, 0.5, 60); break; }
      }
      poiTrigWas[i] = down;
    });
  }
}
let eTap3 = false;
const _pv = new THREE.Vector3();
addEventListener("keydown", (e) => { if (e.code === "KeyE" && !e.repeat) eTap3 = true; });

// small chime for offerings
function chime() {
  audio.chime && audio.chime();
}

// ============================ the three first places ============================
const FOUND = (p) => poiState(p.id);

// ----- the fishing cabin: a weathered hut on stilts near the shore, with a porch lantern, a drying rack, a pier and a dinghy -----
definePOI({
  id: "fishingCabin", name: "Fishing cabin", types: [1, 4], chance: 1, inland: [22, 42], elev: [1.6, 7], maxSlope: 0.1, radius: 7, flatTol: 1.4, clear: 8, blend: 7, spacing: 120, forest: null,
  proxy(ctx) {
    return [pBox(4.6, 2.6, 3.6, 0xb8a98f, 0, 1.8, 0), pBox(5.4, 0.3, 4.4, 0x3d5a58, 0, 3.3, 0, 0, 0, 0), pBox(2.4, 0.2, 3.4, 0x6e5a40, 0, 0.7, 3.2)];
  },
  *detail(ctx) {
    const { mats, state, p } = ctx;
    const W = 4.6, D = 3.6, WH = 2.4, FY = 0.55;
    const grey = 0xcbbea6, dark = 0x6a5a48, roofC = 0x3d6a66;
    const wood = [];
    for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2], [0, -D / 2], [0, D / 2]]) wood.push(pCyl(0.14, 0.16, 1.5, dark, x, FY - 0.7, z, 7));
    wood.push(pBox(W + 0.3, 0.14, D + 0.3, dark, 0, FY, 0));
    // walls, with a door opening in the front and two windows
    wood.push(pBox(W, WH, 0.14, grey, 0, FY + WH / 2, -D / 2));
    wood.push(pBox(0.14, WH, D, grey, -W / 2, FY + WH / 2, 0));
    wood.push(pBox(0.14, WH, D, grey, W / 2, FY + WH / 2, 0));
    const fw = (W - 1.1) / 2;
    wood.push(pBox(fw, WH, 0.14, grey, -(W - fw) / 2, FY + WH / 2, D / 2));
    wood.push(pBox(fw, WH, 0.14, grey, (W - fw) / 2, FY + WH / 2, D / 2));
    wood.push(pBox(1.1, 0.5, 0.14, grey, 0, FY + WH - 0.25, D / 2));
    wood.push(pBox(0.9, 1.9, 0.05, 0x6b5a45, -0.2, FY + 0.95, D / 2 + 0.35, 0, 1.15, 0)); // the door, ajar
    wood.push(pBox(0.94, 1.94, 0.06, 0x1a1410, 0, FY + 0.97, D / 2 - 0.4)); // the dark inside
    // roof: two slopes, a ridge, gable ends
    const ang = 0.46, run = D / 2 + 0.45, slope = Math.hypot(run, run * Math.tan(ang));
    wood.push(pBox(W + 0.9, 0.1, slope, roofC, 0, FY + WH + 0.58, run / 2, ang, 0, 0));
    wood.push(pBox(W + 0.9, 0.1, slope, roofC, 0, FY + WH + 0.58, -run / 2, -ang, 0, 0));
    wood.push(pBox(W + 1.0, 0.14, 0.2, 0x2c403e, 0, FY + WH + 1.08, 0));
    for (let i = 0; i < 3; i++) for (const sz of [-1, 1]) wood.push(pBox(W - 0.2 - i * 1.5, 0.32, 0.12, grey, 0, FY + WH + 0.16 + i * 0.32, sz * (D / 2 - 0.05)));
    // porch with a rail and steps
    wood.push(pBox(W, 0.1, 1.8, 0x7a6850, 0, FY + 0.02, D / 2 + 0.9));
    for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) wood.push(pCyl(0.06, 0.06, 1.0, dark, x, FY + 0.5, D / 2 + 1.75, 6));
    wood.push(pBox(W, 0.07, 0.07, dark, 0, FY + 1.0, D / 2 + 1.75));
    wood.push(pBox(1.3, 0.22, 0.45, 0x7a6850, 0, 0.3, D / 2 + 2.0));
    // the lantern's post and beam
    wood.push(pCyl(0.06, 0.06, 2.3, dark, -W / 2 + 0.1, FY + 1.15, D / 2 + 1.75, 6));
    wood.push(pBox(0.7, 0.06, 0.06, dark, -W / 2 + 0.4, FY + 2.28, D / 2 + 1.75));
    // chimney of stones
    const stoneParts = [pBox(0.6, 2.0, 0.6, 0x6e6a62, W / 2 - 0.9, FY + WH + 0.6, -0.6)];
    // barrel, crates, rope coil, rods leaning on the wall, a string of buoys
    wood.push(pCyl(0.34, 0.3, 0.85, 0x4d3a2a, -W / 2 - 0.5, 0.45, D / 2 + 0.6, 10));
    wood.push(pBox(0.7, 0.5, 0.6, 0x7a6244, -W / 2 - 0.3, 0.3, D / 2 - 0.7, 0, 0.3, 0));
    wood.push(pBox(0.6, 0.4, 0.55, 0x8a7050, -W / 2 - 0.35, 0.75, D / 2 - 0.7, 0, -0.2, 0));
    wood.push(pCyl(0.02, 0.025, 2.6, 0x5a4a30, W / 2 + 0.12, FY + 1.3, D / 2 - 0.4, 5, 0, 0, 0.1));
    wood.push(pCyl(0.02, 0.025, 2.4, 0x5a4a30, W / 2 + 0.17, FY + 1.2, D / 2 - 0.55, 5, 0, 0, 0.14));
    const buoys = [];
    for (let i = 0; i < 5; i++) buoys.push(pBlob(0.13, i % 2 ? 0xe6e2d6 : 0xb83a2a, -W / 2 - 0.14, FY + 0.5 + i * 0.32, -1.0 + (i % 2) * 0.08, 1, 1, 1, 7));
    wood.push(pBox(0.02, 1.6, 0.02, dark, -W / 2 - 0.1, FY + 1.25, -1.0));
    // drying rack with fish and a draped net
    const rx = W / 2 + 2.0, rz = 0.4;
    wood.push(pCyl(0.06, 0.07, 2.0, dark, rx, 1.0, rz - 1.0, 6), pCyl(0.06, 0.07, 2.0, dark, rx, 1.0, rz + 1.0, 6), pBox(0.07, 0.07, 2.2, dark, rx, 1.9, rz));
    const fish = [];
    for (let i = 0; i < 6; i++) fish.push(pBlob(0.22, 0xaab4b8, rx + (i % 2) * 0.08, 1.55, rz - 0.85 + i * 0.34, 0.22, 1, 0.45, 6));
    for (let i = 0; i < 9; i++) wood.push(pBox(0.015, 0.8 + 0.2 * Math.sin(i), 0.015, 0x6b6150, rx - 0.17, 1.4, rz - 0.9 + i * 0.22));
    // the pier: from the shore side of the porch out over the water
    const f = [Math.sin(p.yaw), Math.cos(p.yaw)];
    let s0 = 6, s1 = 6;
    for (let s = 4; s < 90; s += 1) {
      const wx = p.x + f[0] * s, wz = p.z + f[1] * s;
      if (bedHeightJS(wx, wz) > 1.05) s0 = s;
      if (isleDist(p.a, wx, wz) < 0) s1 = s;
    }
    s0 = Math.max(6, s0 - 2); s1 = Math.min(s1 + 14, s0 + 46);
    const deckY = 0.95 - p.y, pier = [], pl = s1 - s0;
    for (let s = s0; s < s1; s += 1) {
      pier.push(pBox(1.5, 0.08, 0.92, 0x8a7a64, 0, deckY, s + 0.5));
      if (Math.round(s - s0) % 3 === 0) pier.push(pCyl(0.1, 0.12, 3.4, dark, 0.7, deckY - 1.5, s, 6), pCyl(0.1, 0.12, 3.4, dark, -0.7, deckY - 1.5, s, 6));
    }
    pier.push(pBox(0.1, 0.6, 0.1, dark, 0.7, deckY + 0.35, s1 - 0.3), pBox(0.1, 0.6, 0.1, dark, -0.7, deckY + 0.35, s1 - 0.3));
    ctx.surface(0, (s0 + s1) / 2, 0.75, pl / 2, 0.95 - p.y + 0.04);
    ctx.surface(0, D / 2 + 0.9, W / 2, 0.9, FY + 0.08);
    ctx.surface(0, D / 2 + 2.0, 0.65, 0.25, 0.42);
    for (const x of [-1.5, 0, 1.5]) ctx.collide(x, 0, 1.9);
    // meshes
    ctx.group.add(pMesh(wood, mats.wood), pMesh(stoneParts, mats.stone), pMesh(buoys, mats.plain), pMesh(fish, mats.plain), pMesh(pier, mats.wood));
    // lights and glow: the lantern on the porch (yours to light) and a lamp in the window
    const lampMat = ctx.glowMat(0xffd9a0, 0xffa24a), winMat = ctx.glowMat(0xffe0a0, 0xffb455);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.2), lampMat);
    lamp.position.set(-W / 2 + 0.7, FY + 2.0, D / 2 + 1.75);
    const win = [];
    for (const [x, z, ry] of [[-1.5, D / 2 + 0.01, 0], [1.5, D / 2 + 0.01, 0]]) win.push(pBox(0.7, 0.55, 0.05, 0xffffff, x, FY + 1.45, z));
    win.push(pBox(0.05, 0.55, 0.7, 0xffffff, -W / 2 - 0.01, FY + 1.45, -0.4));
    const winMesh = new THREE.Mesh(mergeGeos(win), winMat);
    ctx.group.add(lamp, winMesh);
    const glow = ctx.sprite(0xffa850, 3.2);
    glow.position.copy(lamp.position);
    ctx.group.add(glow);
    ctx.interact(-W / 2 + 0.7, FY + 1.6, D / 2 + 1.75, state.lit ? "put out the lantern" : "light the lantern", function () {
      state.lit = !state.lit;
      this.label = state.lit ? "put out the lantern" : "light the lantern";
      savePOI();
      chime();
    });
    // smoke from the chimney, and a dinghy tied up at the pier
    const smoke = [];
    for (let i = 0; i < 5; i++) {
      const s = ctx.sprite(0xb9b4ac, 1.2, THREE.NormalBlending);
      ctx.group.add(s);
      smoke.push(s);
    }
    const hull = new THREE.Mesh((() => { const g = new THREE.SphereGeometry(1, 12, 8, 0, 6.2832, 1.5708, 1.5708); g.scale(0.62, 0.42, 1.6); return g; })(), curved(new THREE.MeshStandardMaterial({ color: 0x3c6a82, roughness: 0.6, side: THREE.DoubleSide })));
    ctx.track(hull.material);
    ctx.group.add(hull);
    const bx = 1.7, bz = s1 - 4;
    return {
      update(t, dt, lampsOn) {
        const lit = state.lit ? 1 : 0;
        lampMat.emissiveIntensity = (0.25 + 1.8 * lit) * (0.8 + 0.2 * Math.sin(t * 7 + 1)) * (state.lit ? 1 : 0.3 + lampsOn);
        glow.material.opacity = (lit * 0.8 + 0.35 * lampsOn) * 0.6;
        winMat.emissiveIntensity = 1.6 * smooth(0.2, 0.7, lampsOn);
        const chim = Math.max(lit, lampsOn);
        smoke.forEach((s, i) => {
          const ph = ((t * 0.18 + i / smoke.length) % 1);
          s.position.set(W / 2 - 0.9 + ph * 1.4, FY + WH + 1.7 + ph * 4, -0.6);
          s.scale.setScalar(0.6 + ph * 2.2);
          s.material.opacity = chim * 0.28 * (1 - ph) * Math.min(1, ph * 6);
        });
        const [wx, wz] = ctx.toWorld(bx, bz);
        const wy = waveHeight(wx, wz, t);
        hull.position.set(bx, wy - p.y + 0.08, bz);
        hull.rotation.set(Math.sin(t * 0.9) * 0.04, 0.2, Math.sin(t * 0.7 + 1) * 0.05);
      },
    };
  },
});

// ----- the abandoned campsite: a collapsed tent, a cold fire ring, log seats, scattered gear and a diary -----
const DIARY = [
  "\"Day 3. The boat didn't come back for us. We have the fire and fish enough.\"",
  "\"Day 9. Heard bells in the trees at night. Not the wind. Something is lighting the shrine.\"",
  "\"Day 14. The tide takes more of the path each night. Leaving the tent. Gone to the cabin on the shore.\"",
];
definePOI({
  id: "abandonedCamp", name: "Abandoned campsite", types: [1, 3, 2], chance: 1, inland: [30, 90], elev: [1.8, 11], maxSlope: 0.12, radius: 6, flatTol: 1.5, clear: 7, blend: 6, spacing: 110, forest: [0.3, 0.9],
  proxy() {
    return [pBox(2.6, 1.3, 2.4, 0x5d6a45, 0, 0.65, 0), pCyl(0.7, 0.8, 0.2, 0x333333, 0, 0.1, 3.2)];
  },
  *detail(ctx) {
    const { mats, state, p } = ctx;
    const cloth = [], wood = [], stones = [], gear = [];
    // the tent: a ridge that sags toward one end, the far side fallen in
    const tent = (() => {
      const pos = [], col = [], idx = [];
      const NX = 8, L = 2.6, Wd = 1.3;
      const ridge = (x) => 1.35 - 0.95 * smooth(0.1, 1.3, x);
      for (const side of [-1, 1])
        for (let i = 0; i <= NX; i++) {
          const x = -L / 2 + (L * i) / NX, ry = ridge(x);
          const sag = side > 0 ? 0.5 * smooth(0.0, 1.3, x) : 0;
          pos.push(x, ry, 0, x, 0.05 + 0.1 * Math.sin(i * 2.1), side * (Wd - sag));
          const c = new THREE.Color(side > 0 ? 0x4f5b3a : 0x5d6a45).multiplyScalar(0.85 + 0.2 * Math.sin(i * 1.7));
          col.push(c.r, c.g, c.b, c.r * 0.8, c.g * 0.8, c.b * 0.8);
        }
      const n = NX + 1;
      for (let s = 0; s < 2; s++) for (let i = 0; i < NX; i++) { const a = s * n * 2 + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return new THREE.Mesh(g, mats.cloth);
    })();
    tent.position.set(0, 0, -1);
    ctx.group.add(tent);
    wood.push(pCyl(0.03, 0.03, 1.5, 0x5a4a30, -1.2, 0.75, -1, 5), pCyl(0.03, 0.03, 1.5, 0x5a4a30, 1.0, 0.1, -0.2, 5, 0, 0.5, 1.45)); // an upright pole, a fallen one
    cloth.push(pBox(2.4, 0.03, 2.2, 0x3d4430, 0, 0.02, -1));
    // the fire ring: stones around ash and half-burnt logs
    const fx = 0, fz = 3.0;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 6.2832;
      const g = makeRock(1, i * 3.1 + p.x, -9);
      g.scale(0.22, 0.16, 0.22);
      stones.push(part(g, 0x7a766e, fx + Math.cos(a) * 0.62, 0.1, fz + Math.sin(a) * 0.62, 0, a * 2, 0));
    }
    gear.push(pCyl(0.55, 0.58, 0.03, 0x1c1a18, fx, 0.03, fz, 12));
    wood.push(pCyl(0.07, 0.08, 0.9, 0x2a2420, fx, 0.14, fz, 6, 0, 0.4, 1.4), pCyl(0.07, 0.08, 0.8, 0x2a2420, fx + 0.05, 0.16, fz, 6, 0, -0.9, 1.45), pCyl(0.06, 0.07, 0.7, 0x2a2420, fx, 0.2, fz + 0.1, 6, 0, 1.8, 1.4));
    // log seats around it
    for (const [a, len] of [[0.5, 1.2], [2.3, 1.1], [4.3, 1.3]]) {
      wood.push(pCyl(0.17, 0.17, len, 0x5a4636, fx + Math.cos(a) * 1.9, 0.17, fz + Math.sin(a) * 1.9, 8, 0, a + 1.57, 1.5708));
    }
    // gear: a pack, a pot, a bedroll, a kicked-over crate, cups and a lantern hung on the pole
    gear.push(pBox(0.5, 0.55, 0.28, 0x6a4a2e, 2.4, 0.3, 1.4, 0, 0.7, 0), pBox(0.4, 0.25, 0.1, 0x4a3420, 2.5, 0.2, 1.62, 0, 0.7, 0));
    gear.push(pCyl(0.2, 0.17, 0.26, 0x2d2f30, fx - 0.2, 0.16, fz + 1.1, 9), pCyl(0.025, 0.025, 0.4, 0x2d2f30, fx - 0.1, 0.3, fz + 1.1, 5, 0, 0, 1.57));
    gear.push(pCyl(0.17, 0.17, 0.9, 0x7a6a50, -1.8, 0.17, 1.8, 8, 0, 0.5, 1.5708));
    wood.push(pBox(0.6, 0.4, 0.45, 0x7a6244, -2.9, 0.2, 0.4, 0.4, 0.5, 0.2), pBox(0.58, 0.04, 0.43, 0x6a5234, -3.0, 0.45, 0.45, 0.4, 0.5, 0.2));
    gear.push(pCyl(0.05, 0.04, 0.09, 0xb0b4b8, fx + 0.9, 0.05, fz - 0.8, 8), pCyl(0.05, 0.04, 0.09, 0xb0b4b8, fx + 1.1, 0.05, fz - 0.4, 8));
    // a clothesline with tattered washing
    wood.push(pCyl(0.04, 0.05, 2.2, 0x5a4a30, -2.5, 1.1, -3.6, 6), pCyl(0.04, 0.05, 2.2, 0x5a4a30, 2.5, 1.1, -3.6, 6), pBox(5.0, 0.015, 0.015, 0xbbb2a0, 0, 2.0, -3.6));
    const washing = [];
    for (const [x, c] of [[-1.3, 0x9a8a7a], [0.2, 0x6a7a8a], [1.5, 0x8a6a5a]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.8), curved(new THREE.MeshStandardMaterial({ color: c, roughness: 1, side: THREE.DoubleSide })));
      ctx.track(m.material);
      m.position.set(x, 1.6, -3.6);
      ctx.group.add(m);
      washing.push(m);
    }
    ctx.collide(0, -1, 1.5);
    ctx.group.add(pMesh(wood, mats.wood), pMesh(stones, mats.stone), pMesh(gear, mats.plain), pMesh(cloth, mats.cloth));
    // hanging lantern (cold) and the fire itself
    const flame = [0, 1, 2].map((i) => ctx.sprite(i === 0 ? 0xffb347 : 0xff7a1c, 1.0));
    flame.forEach((s) => { s.position.set(fx, 0.5, fz); ctx.group.add(s); });
    const glow = ctx.sprite(0xff8a30, 7);
    glow.position.set(fx, 0.9, fz);
    ctx.group.add(glow);
    const emberMat = ctx.glowMat(0x2a1a10, 0xff5a10);
    const embers = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 10), emberMat);
    embers.position.set(fx, 0.06, fz);
    ctx.group.add(embers);
    ctx.interact(fx, 0.5, fz, state.fire ? "put out the fire" : "light the fire", function () {
      state.fire = !state.fire;
      this.label = state.fire ? "put out the fire" : "light the fire";
      savePOI();
      chime();
    });
    ctx.interact(-1.8, 0.4, 1.8, "read the diary", () => {
      state.read = ((state.read | 0) + 1) % DIARY.length;
      flashHint(DIARY[state.read]);
      savePOI();
    });
    return {
      update(t, dt, lampsOn) {
        const on = state.fire ? 1 : 0;
        flame.forEach((s, i) => {
          const k = 0.75 + 0.35 * Math.sin(t * (9 + i * 3) + i * 2);
          s.scale.set((0.55 - i * 0.12) * k, (0.9 - i * 0.15) * k, 1);
          s.position.y = 0.45 + i * 0.12 + 0.05 * Math.sin(t * 11 + i);
          s.material.opacity = on * 0.95;
        });
        glow.material.opacity = on * (0.5 + 0.12 * Math.sin(t * 8)) * (0.6 + 0.4 * lampsOn);
        emberMat.emissiveIntensity = on * (1.1 + 0.3 * Math.sin(t * 6));
        washing.forEach((m, i) => (m.rotation.z = 0.06 * Math.sin(t * 1.3 + i * 2) + 0.03));
      },
    };
  },
});

// ----- the forest shrine: a mossy stone shrine in a clearing, a weathered gate, stone lanterns, and an offering to make -----
definePOI({
  id: "forestShrine", name: "Forest shrine", types: [1, 3], chance: 1, inland: [35, 110], elev: [3, 12], maxSlope: 0.1, radius: 8, flatTol: 1.5, clear: 11, blend: 7, spacing: 120, forest: [0.5, 1],
  proxy() {
    return [pBox(1.6, 1.4, 1.6, 0x5a4a40, 0, 0.9, 0), pBox(2.2, 0.3, 2.2, 0x2e3a36, 0, 1.8, 0), pBox(0.5, 4.2, 0.5, 0x9c2f22, -2.2, 2.1, 7.5), pBox(0.5, 4.2, 0.5, 0x9c2f22, 2.2, 2.1, 7.5), pBox(6.4, 0.4, 0.6, 0x9c2f22, 0, 4.3, 7.5)];
  },
  *detail(ctx) {
    const { mats, state, p } = ctx;
    const stone = [], wood = [], red = [], moss = [];
    const gray = 0x8a8a82, mossG = 0x4f6a2e;
    // platform and steps
    stone.push(pCyl(3.3, 3.5, 0.4, gray, 0, 0.2, 0, 20), pBox(3.4, 0.14, 0.6, gray, 0, 0.07, 3.5), pBox(3.0, 0.14, 0.5, gray, 0, 0.21, 3.2));
    for (let i = 0; i < 9; i++) moss.push(pBlob(0.5 + 0.3 * _pr(), mossG, Math.cos(i * 2.4) * 2.6, 0.38, Math.sin(i * 2.4) * 2.6, 1, 0.14, 1, 6));
    // the shrine
    stone.push(pBox(1.9, 0.45, 1.9, gray, 0, 0.62, 0));
    wood.push(pBox(1.35, 1.3, 1.35, 0x5e3e30, 0, 1.5, 0), pBox(0.7, 0.9, 0.06, 0x1c140f, 0, 1.4, 0.7));
    const ang = 0.5, run = 1.1;
    wood.push(pBox(2.5, 0.1, 1.5, 0x2e3a36, 0, 2.5, 0.52, ang, 0, 0), pBox(2.5, 0.1, 1.5, 0x2e3a36, 0, 2.5, -0.52, -ang, 0, 0), pBox(2.6, 0.12, 0.18, 0x222c29, 0, 2.95, 0));
    stone.push(pBox(1.1, 0.34, 0.5, gray, 0, 0.5, 1.5)); // the offering box
    wood.push(pBox(0.95, 0.06, 0.4, 0x4a3426, 0, 0.72, 1.5));
    // sacred rope with paper streamers
    red.push(pCyl(0.045, 0.045, 1.5, 0xd9cfae, 0, 2.15, 0.8, 6, 0, 0, 1.5708));
    const paper = [];
    for (let i = 0; i < 4; i++) paper.push(pBox(0.1, 0.3, 0.015, 0xf2efe6, -0.5 + i * 0.33, 1.95, 0.82, 0, 0, i % 2 ? 0.2 : -0.2));
    // the gate (torii), weathered
    const rd = 0x8a2c20;
    red.push(pCyl(0.27, 0.3, 4.2, rd, -2.2, 2.1, 7.5, 10), pCyl(0.27, 0.3, 4.2, rd, 2.2, 2.1, 7.5, 10), pBox(6.6, 0.3, 0.55, rd, 0, 4.3, 7.5), pBox(5.1, 0.22, 0.32, rd, 0, 3.55, 7.5));
    red.push(pBox(0.7, 0.26, 0.56, 0x1b1b1b, -3.45, 4.5, 7.5, 0, 0, 0.35), pBox(0.7, 0.26, 0.56, 0x1b1b1b, 3.45, 4.5, 7.5, 0, 0, -0.35));
    stone.push(pBox(0.7, 0.4, 0.7, gray, -2.2, 0.2, 7.5), pBox(0.7, 0.4, 0.7, gray, 2.2, 0.2, 7.5));
    for (const x of [-2.2, 2.2]) moss.push(pBlob(0.5, mossG, x, 0.5, 7.5, 1, 0.5, 1, 6));
    // stepping stones from the gate to the platform and out into the forest
    for (let i = 0; i < 14; i++) stone.push(pBox(1.0 + 0.2 * _pr(), 0.08, 0.75, gray, (_pr() - 0.5) * 0.5, 0.05, 4.2 + i * 0.95, 0, (_pr() - 0.5) * 0.4, 0));
    // stone lanterns
    const lampMat = ctx.glowMat(0xffe0a8, 0xffb04a);
    const lampGeo = [];
    for (const x of [-2.0, 2.0]) {
      const z = 2.8;
      stone.push(pBox(0.6, 0.22, 0.6, gray, x, 0.5, z), pCyl(0.13, 0.16, 0.9, gray, x, 1.1, z, 8), pBox(0.55, 0.12, 0.55, gray, x, 1.62, z), pCone(0.62, 0.42, gray, x, 2.2, z, 4, 0, 0.785, 0), pBlob(0.1, gray, x, 2.48, z));
      lampGeo.push(pBox(0.34, 0.3, 0.34, 0xffffff, x, 1.84, z));
    }
    const lamps = new THREE.Mesh(mergeGeos(lampGeo), lampMat);
    ctx.group.add(lamps);
    // boulders around the clearing and ferns
    for (let i = 0; i < 9; i++) {
      const a = i * 0.7 + _pr() * 0.4;
      const g = makeRock(2, i * 7.3 + p.z, -9);
      const s = 0.8 + _pr() * 1.2;
      g.scale(s, s * 0.8, s);
      stone.push(part(g, 0x6e6c62, Math.cos(a) * 9.5, 0.2, Math.sin(a) * 9.5 - 1));
      moss.push(pBlob(s * 0.7, mossG, Math.cos(a) * 9.5, s * 0.55, Math.sin(a) * 9.5 - 1, 1, 0.3, 1, 6));
    }
    for (let i = 0; i < 26; i++) {
      const a = _pr() * 6.2832, r = 5.5 + _pr() * 5;
      for (let k = 0; k < 4; k++) moss.push(pCone(0.1, 0.9, 0x3f7a2c, Math.cos(a) * r, 0.4, Math.sin(a) * r - 1, 4, 0.5 * Math.cos(k * 1.6), k * 1.6, 0.5 * Math.sin(k * 1.6)));
    }
    ctx.collide(0, 0, 1.4);
    ctx.collide(-2.2, 7.5, 0.4);
    ctx.collide(2.2, 7.5, 0.4);
    ctx.surface(0, 0, 3.3, 3.3, 0.4);
    ctx.group.add(pMesh(stone, mats.stone), pMesh(wood, mats.wood), pMesh(red, mats.wood), pMesh(moss, mats.plain), pMesh(paper, mats.cloth));
    // fireflies and the offering
    const FF = 28, ffGeo = new THREE.BufferGeometry();
    ffGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(FF * 3), 3));
    const ffMat = new THREE.PointsMaterial({ color: 0xcfff7a, size: 0.22, map: dotTexture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const ff = new THREE.Points(ffGeo, ffMat);
    ff.frustumCulled = false;
    ctx.group.add(ff);
    ctx.track(ffMat);
    const halo = ctx.sprite(0xffe9a0, 6);
    halo.position.set(0, 1.4, 1.5);
    ctx.group.add(halo);
    let pulse = 0;
    ctx.interact(0, 0.9, 1.5, state.blessed ? "make another offering" : "make an offering", function () {
      state.blessed = true;
      this.label = "make another offering";
      pulse = 1;
      savePOI();
      chime();
      flashHint("The lanterns flicker awake. Something in the forest answers.");
    });
    const pos = ffGeo.attributes.position;
    return {
      update(t, dt, lampsOn) {
        const b = state.blessed ? 1 : 0;
        pulse = Math.max(0, pulse - dt * 0.5);
        lampMat.emissiveIntensity = b * (1.7 + 0.25 * Math.sin(t * 5)) + 0.12;
        halo.material.opacity = pulse * 0.9 + b * 0.12;
        halo.scale.setScalar(6 + pulse * 10);
        ffMat.opacity = Math.max(b * 0.9, lampsOn * 0.5);
        for (let i = 0; i < FF; i++) {
          const a = t * (0.15 + (i % 5) * 0.03) + i * 2.4, r = 3 + (i % 7) * 1.1;
          pos.setXYZ(i, Math.cos(a) * r, 0.8 + 1.2 * Math.sin(t * 0.7 + i) + (i % 4) * 0.4, Math.sin(a * 1.1) * r + 1);
        }
        pos.needsUpdate = true;
      },
    };
  },
});

// ===== v6: four more places: a lighthouse on the rocks, a wreck on the sand, an observatory on the heights, a ring of ruins in the woods =====
const NOTES = {
  lighthouse: ["\"Keeper's log. The lamp turns by hand now. I cannot remember who last wound it, only that someone must.\"", "\"Keeper's log. A ship's light out past the reef, three nights running. It never moves.\""],
  wreck: ["A ship's log, salt-stained: \"We saw the light on the headland and steered for it. The reef was not on any chart.\"", "Carved into the rail: \"Walk inland. The ground there is kind.\""],
  observatory: ["A star chart, pinned open. One constellation is circled in red, with a single word: \"Home?\"", "The telescope is aimed at a bright point low in the sky. A pencilled note: \"It is not a star. It moves.\""],
  ruins: ["The stones hum faintly under your palm. Far off, something answers.", "The runes brighten as you touch them. The circle remembers being a gate."],
};
definePOI({
  id: "lighthouse", name: "Lighthouse", types: [1, 3, 4, 2], chance: 1, inland: [5, 16], elev: [2.2, 16], maxSlope: 0.4, radius: 5, flatTol: 4, clear: 9, blend: 6, spacing: 150, forest: null, minH: 0.3, edgeD: -1.5,
  proxy() { return [pCyl(2.2, 3.6, 24, 0xe9e4d6, 0, 12, 0, 8), pCyl(1.6, 1.8, 2.4, 0xc23b2e, 0, 25.4, 0, 8)]; },
  *detail(ctx) {
    const { mats, state } = ctx;
    const rock = [], white = [], red = [], dark = [];
    for (let i = 0; i < 10; i++) {
      const a = i * 0.63 + _pr() * 0.3, g = makeRock(2, i * 5.1 + ctx.p.x, -4);
      const s = 1.6 + _pr() * 2.2;
      g.scale(s, s * 0.8, s);
      rock.push(part(g, 0x6c6a62, Math.cos(a) * 6.4, -0.6, Math.sin(a) * 6.4));
    }
    rock.push(pCyl(4.8, 6.2, 5, 0x77746b, 0, -1.6, 0, 10));
    // tapered white tower with red bands
    const H = 22;
    for (let k = 0; k < 4; k++) {
      const y0 = k * (H / 4), y1 = y0 + H / 4, r0 = 3.4 - 1.5 * (y0 / H), r1 = 3.4 - 1.5 * (y1 / H);
      (k % 2 ? red : white).push(pCyl(r1, r0, H / 4 + 0.02, k % 2 ? 0xd04a38 : 0xffffff, 0, y0 + H / 8, 0, 12));
    }
    dark.push(pBox(1.2, 2.2, 0.3, 0x2a2420, 0, 1.6, 3.35));
    for (let k = 0; k < 3; k++) dark.push(pBox(0.5, 0.9, 0.2, 0x1c2a36, 0, 5 + k * 5.5, 2.5 - k * 0.55));
    dark.push(pCyl(2.6, 2.6, 0.35, 0x2a2e30, 0, H + 0.1, 0, 14), pCyl(1.9, 1.9, 0.18, 0x2a2e30, 0, H + 2.7, 0, 12));
    for (let i = 0; i < 12; i++) { const a = i * 0.5236; dark.push(pBox(0.1, 1.1, 0.1, 0x2a2e30, Math.cos(a) * 2.45, H + 0.8, Math.sin(a) * 2.45)); }
    red.push(pCone(2.2, 1.8, 0xb83a2c, 0, H + 3.7, 0, 12), pBlob(0.25, 0x2a2e30, 0, H + 4.7, 0));
    ctx.collide(0, 0, 3.6);
    ctx.surface(0, 0, 5.5, 5.5, -0.2);
    ctx.group.add(pMesh(rock, mats.stone), pMesh(white, mats.plain), pMesh(red, mats.plain), pMesh(dark, mats.plain));
    const lamp = ctx.glowMat(0xfff2c0, 0xffd27a);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), lamp);
    bulb.position.y = H + 1.7;
    ctx.group.add(bulb);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe6a0, fog: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    ctx.track(beamMat);
    const bg = new THREE.CylinderGeometry(0.2, 7, 140, 10, 1, true);
    bg.rotateZ(Math.PI / 2); bg.translate(70, 0, 0);
    const pivot = new THREE.Group();
    pivot.position.y = H + 1.7;
    pivot.add(new THREE.Mesh(bg, beamMat), new THREE.Mesh(bg, beamMat));
    pivot.children[1].rotation.y = Math.PI;
    ctx.group.add(pivot);
    const halo = ctx.sprite(0xffe2a0, 14);
    halo.position.y = H + 1.7;
    ctx.group.add(halo);
    ctx.interact(0, 1.4, 3.8, "read the keeper's log", () => { state.read = ((state.read | 0) + 1) % NOTES.lighthouse.length; savePOI(); flashHint(NOTES.lighthouse[state.read]); });
    return {
      update(t, dt, lampsOn) {
        const on = Math.max(lampsOn, state.lit ? 1 : 0);
        pivot.rotation.y = t * 0.6;
        lamp.emissiveIntensity = 0.3 + 2.2 * on;
        beamMat.opacity = 0.16 * on;
        halo.material.opacity = 0.2 + 0.55 * on;
      },
    };
  },
});
definePOI({
  id: "shipwreck", name: "Shipwreck", types: [1, 2, 3, 4], chance: 1, inland: [0, 7], elev: [-1.2, 2], maxSlope: 0.25, radius: 7, flatTol: 4, clear: 10, blend: 0, spacing: 120, forest: null, minH: -2.5, edgeD: 8, noFlatten: true, noPath: true,
  proxy() { return [pBox(5, 3.4, 16, 0x5a4636, 0, 1.2, 0, 0.08, 0, 0.14), pBox(0.5, 9, 0.5, 0x4a382a, 0, 5, 1.5, 0.15, 0, 0.1)]; },
  *detail(ctx) {
    const { mats, state } = ctx;
    const wood = [], dark = [], cloth = [];
    const wd = 0x6a523e, wd2 = 0x4a382a;
    // a hull of ribs and planks listing on the sand
    const L = 15;
    ctx.group.rotation.z = 0; // (the lean is built into the parts)
    const lean = 0.2;
    for (let i = 0; i < 9; i++) {
      const z = -L / 2 + i * (L / 8), w = 2.6 - Math.pow((i - 4) / 4, 2) * 1.6;
      for (const sd of [-1, 1]) {
        dark.push(pBox(0.22, 2.0, 0.28, wd2, sd * w, 0.5, z, 0, 0, -sd * 0.7 + lean));
      }
      if (i < 6) wood.push(pBox(w * 2, 0.16, 0.3, wd2, 0, -0.4, z, 0, 0, lean));
    }
    // planks on the lower hull; the upper side is gone
    for (let k = 0; k < 14; k++) {
      const z0 = -L / 2 + 0.9 + _pr() * (L - 2.4), len = 1.8 + _pr() * 3;
      wood.push(pBox(0.1, 0.44, len, wd, -2.0 - _pr() * 0.4, 0.3 + (k % 4) * 0.5, z0, 0, 0, 0.45 + lean));
    }
    wood.push(pBox(4.6, 0.12, L - 3, wd2, 0, 0.1, 0, 0, 0, lean)); // the deck remains
    // snapped mast and a boom
    dark.push(pCyl(0.18, 0.26, 7.5, wd2, 0.3, 3.5, 1, 7, 0.2, 0, 0.35), pCyl(0.1, 0.1, 5, wd2, -1.4, 0.6, 3, 6, 0, 0.5, 1.45));
    cloth.push(pBox(2.4, 0.02, 2.8, 0xcfc4a6, 1.6, 0.35, -2, 0.12, 0.3, 0.05));
    // bowsprit toward the sea and a stern post
    dark.push(pBox(0.3, 0.3, 4, wd2, 0, 1.0, L / 2 + 1.5, -0.3, 0, lean), pBox(0.5, 3.4, 0.5, wd2, 0, 1.5, -L / 2 + 0.2, 0.05, 0, lean));
    // scatter: barrels, a chest, stones
    for (let i = 0; i < 5; i++) dark.push(pCyl(0.36, 0.36, 0.7, 0x5e4a38, (_pr() - 0.5) * 12, 0.3, (_pr() - 0.5) * 18, 8, 0.2 * _pr(), 0, 0.3 * _pr()));
    wood.push(pBox(0.9, 0.5, 0.6, 0x4e3a2a, 3.4, 0.3, 1.5, 0, 0.4, 0), pBox(0.94, 0.16, 0.64, 0x8a6c2a, 3.4, 0.62, 1.5, 0, 0.4, 0));
    ctx.group.add(pMesh(wood, mats.wood), pMesh(dark, mats.wood), pMesh(cloth, mats.cloth));
    ctx.collide(0, 0, 3);
    ctx.interact(3.4, 0.7, 1.5, "search the wreck", () => { state.read = ((state.read | 0) + 1) % NOTES.wreck.length; savePOI(); chime(); flashHint(NOTES.wreck[state.read]); });
    const glow = ctx.sprite(0xffd890, 3);
    glow.position.set(3.4, 0.9, 1.5);
    ctx.group.add(glow);
    return { update(t, dt, lampsOn) { glow.material.opacity = (0.15 + 0.55 * lampsOn) * (0.7 + 0.3 * Math.sin(t * 2)); } };
  },
});
definePOI({
  id: "observatory", name: "Observatory", types: [1, 3, 2, 4], chance: 1, inland: [40, 160], elev: [7, 60], maxSlope: 0.16, radius: 7, flatTol: 2.6, clear: 11, blend: 9, spacing: 150, forest: null,
  proxy() { return [pCyl(5, 5.4, 4, 0xd9d4c6, 0, 2, 0, 12), pBlob(5, 0xe9e6dc, 0, 4, 0, 1, 0.9, 1, 10)]; },
  *detail(ctx) {
    const { mats, state } = ctx;
    const stone = [], white = [], dark = [], brass = [];
    stone.push(pCyl(7, 7.3, 0.5, 0x8a8a82, 0, 0.1, 0, 20), pBox(4, 0.2, 3, 0x8a8a82, 0, 0.1, 8, 0, 0, 0));
    white.push(pCyl(4.6, 4.8, 3.6, 0xdcd7c9, 0, 2.2, 0, 16));
    // the dome, a hemisphere with a slit that opens
    const dg = new THREE.SphereGeometry(4.7, 16, 8, 0, 6.2832, 0, 1.5708);
    const dome = new THREE.Mesh(dg, mats.plain);
    const cols = new Float32Array(dg.attributes.position.count * 3).fill(0.92);
    dg.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    dome.position.y = 4;
    ctx.group.add(dome);
    dark.push(pBox(1.4, 2.6, 0.2, 0x2a2420, 0, 1.9, 4.7), pBox(1.0, 1.0, 0.1, 0x1c2a36, 3.3, 2.7, 3.2, 0, 0.7, 0), pBox(1.0, 1.0, 0.1, 0x1c2a36, -3.3, 2.7, 3.2, 0, -0.7, 0));
    // the telescope on a stand, outside under the sky
    brass.push(pCyl(0.12, 0.2, 1.4, 0x8a6a2a, 6, 0.9, 5, 6));
    dark.push(pBox(0.9, 0.6, 0.9, 0x3a3630, 6, 0.4, 5));
    const tele = pMesh([pCyl(0.22, 0.28, 2.8, 0xb08a3a, 0, 0, 0, 10)], mats.plain);
    tele.position.set(6, 2.4, 5);
    tele.rotation.set(0, 0.5, 1.0);
    ctx.group.add(tele);
    // a desk with a star chart indoors is skipped; the chart is pinned to a board
    dark.push(pBox(1.6, 1.1, 0.08, 0x5e4a38, -6, 1.2, 4, 0, 0.3, 0), pBox(1.4, 0.9, 0.02, 0xe8dcc0, -6, 1.2, 4.05, 0, 0.3, 0), pBox(0.1, 1.2, 0.1, 0x5e4a38, -6.4, 0.6, 4.1), pBox(0.1, 1.2, 0.1, 0x5e4a38, -5.6, 0.6, 4));
    ctx.collide(0, 0, 4.9);
    ctx.collide(6, 5, 0.7);
    ctx.surface(0, 0, 7, 7, 0.4);
    ctx.group.add(pMesh(stone, mats.stone), pMesh(white, mats.plain), pMesh(dark, mats.plain), pMesh(brass, mats.plain));
    ctx.interact(-6, 1.2, 4, "study the star chart", () => { state.read = ((state.read | 0) + 1) % NOTES.observatory.length; savePOI(); flashHint(NOTES.observatory[state.read]); });
    ctx.interact(6, 2.4, 5, "look through the telescope", () => { state.looked = true; savePOI(); chime(); flashHint("Through the lens: a pale world turning slowly, and a smaller light circling it."); });
    return {};
  },
});
definePOI({
  id: "ruins", name: "Hidden ruins", types: [3, 1, 4, 2], chance: 1, inland: [50, 170], elev: [2, 20], maxSlope: 0.13, radius: 10, flatTol: 2.2, clear: 12, blend: 8, spacing: 140, forest: [0.35, 1],
  proxy() { const o = []; for (let i = 0; i < 6; i++) o.push(pBox(1.4, 5 - (i % 2) * 2, 1.4, 0x7a786e, Math.cos(i * 1.047) * 8, 2, Math.sin(i * 1.047) * 8)); return o; },
  *detail(ctx) {
    const { mats, state } = ctx;
    const stone = [], moss = [], rune = [];
    const gray = 0x80807a, mossG = 0x4f6a2e;
    // a ring of standing stones, some fallen; each one planted to the ground beneath it
    const N = 8, R = 8;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 6.2832, x = Math.cos(a) * R, z = Math.sin(a) * R, gy = ctx.ground(x, z) - ctx.ground(0, 0);
      const h = i % 3 === 1 ? 2 : 4.4 + _pr() * 0.8;
      const fell = i === 2 || i === 5;
      if (fell) {
        stone.push(pBox(1.3, 1.1, 4.2, gray, x, gy + 0.5, z, 0, a, 0.15));
        moss.push(pBlob(0.9, mossG, x, gy + 1.0, z, 1.2, 0.3, 1.2, 6));
      } else {
        stone.push(pBox(1.3, h + 1.5, 1.2, gray, x, gy + h / 2 - 0.6, z, (_pr() - 0.5) * 0.08, a, (_pr() - 0.5) * 0.08));
        moss.push(pBlob(0.7, mossG, x, gy + 0.5, z, 1.3, 0.4, 1.3, 6));
        if (i % 2 === 0) { rune.push(pBox(0.5, 0.06, 0.04, 0xffffff, x - Math.cos(a) * 0.62, gy + 1.8, z - Math.sin(a) * 0.62, 0, a + 1.5708, 0), pBox(0.06, 0.6, 0.04, 0xffffff, x - Math.cos(a) * 0.62, gy + 2.2, z - Math.sin(a) * 0.62, 0, a + 1.5708, 0)); }
        ctx.collide(x, z, 0.8);
      }
    }
    // lintel across two stones, the stone slab at the centre with its rune
    stone.push(pCyl(3.2, 3.4, 0.35, gray, 0, 0.1, 0, 16), pBox(1.3, 1.1, 1.3, 0x6e6c64, 0, 0.85, 0));
    const rm = ctx.glowMat(0x7ad8ff, 0x3ab8ff);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), rm);
    core.position.set(0, 2.2, 0);
    ctx.group.add(core);
    for (let i = 0; i < 12; i++) moss.push(pBlob(0.4 + 0.4 * _pr(), mossG, (_pr() - 0.5) * 18, 0.1, (_pr() - 0.5) * 18, 1, 0.3, 1, 5));
    for (let i = 0; i < 6; i++) { const a = _pr() * 6.28, g = makeRock(2, i * 4.7 + ctx.p.z, -6), s = 0.7 + _pr(); g.scale(s, s * 0.7, s); stone.push(part(g, 0x6e6c62, Math.cos(a) * 13, 0.1, Math.sin(a) * 13)); }
    ctx.collide(0, 0, 1);
    ctx.surface(0, 0, 3.0, 3.0, 0.3);
    const runeMat = ctx.glowMat(0x9ae8ff, 0x3ab8ff);
    ctx.group.add(pMesh(stone, mats.stone), pMesh(moss, mats.plain), new THREE.Mesh(mergeGeos(rune), runeMat));
    const halo = ctx.sprite(0x7ad8ff, 9);
    halo.position.set(0, 2.2, 0);
    ctx.group.add(halo);
    let pulse = 0;
    ctx.interact(0, 1.8, 0, "touch the stone", () => { state.awake = true; pulse = 1; state.read = ((state.read | 0) + 1) % NOTES.ruins.length; savePOI(); chime(); flashHint(NOTES.ruins[state.read]); });
    return {
      update(t, dt, lampsOn, d) {
        pulse = Math.max(0, pulse - dt * 0.4);
        const near = 1 - smooth(8, 60, d), aw = state.awake ? 1 : 0;
        const v = 0.25 + 0.75 * Math.max(aw, near * 0.6) + pulse;
        rm.emissiveIntensity = v * 2 * (0.85 + 0.15 * Math.sin(t * 2));
        runeMat.emissiveIntensity = v * 1.6;
        core.position.y = 2.2 + 0.15 * Math.sin(t * 1.3) + pulse * 0.5;
        core.rotation.y = t * 0.5;
        halo.material.opacity = v * 0.45;
      },
    };
  },
});

// ===== What makes each kind of island itself: smoke and lava glow, a stepped temple, mangroves, a city =====
let _cityMat = null, _cityRoof = null;
function cityMats() {
  if (!_cityMat) {
    const lit = [];
    const tex = pixTex(128, 128, (u, v) => {
      const cx = Math.floor(u * 4), cy = Math.floor(v * 4), fu = (u * 4) % 1, fv = (v * 4) % 1;
      const win = fu > 0.2 && fu < 0.8 && fv > 0.22 && fv < 0.78;
      const k = 0.85 + 0.15 * jnoise(u * 40, v * 40, 2);
      return win ? [0.1 * k, 0.14 * k, 0.18 * k] : [0.82 * k, 0.78 * k, 0.7 * k];
    });
    const emi = pixTex(128, 128, (u, v) => {
      const cx = Math.floor(u * 4), cy = Math.floor(v * 4), fu = (u * 4) % 1, fv = (v * 4) % 1;
      const win = fu > 0.2 && fu < 0.8 && fv > 0.22 && fv < 0.78;
      const on = hash3(cx, cy, 77) < 0.55;
      return win && on ? [1.0, 0.82, 0.5] : [0, 0, 0];
    });
    _cityMat = curved(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: emi, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 0.85 }));
    _cityRoof = curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
  }
  return [_cityMat, _cityRoof];
}
// a building as raw arrays: four walls with window UVs, and a flat roof
function addBuilding(wall, roof, cx, cz, y0, w, d, h, rotY, color, roofCol = null) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const hw = w / 2, hd = d / 2;
  const corner = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  const P = [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)];
  for (let i = 0; i < 4; i++) {
    const A = P[i], B = P[(i + 1) % 4];
    const ex = B[0] - A[0], ez = B[1] - A[1], len = Math.hypot(ex, ez);
    // the outward normal points away from the building's middle; the triangles are wound to face the same way
    let nx = ez / len, nz = -ex / len;
    if (nx * ((A[0] + B[0]) / 2 - cx) + nz * ((A[1] + B[1]) / 2 - cz) < 0) (nx = -nx), (nz = -nz);
    const o = wall.pos.length / 3;
    wall.pos.push(A[0], y0, A[1], B[0], y0, B[1], B[0], y0 + h, B[1], A[0], y0 + h, A[1]);
    for (let k = 0; k < 4; k++) wall.nor.push(nx, 0, nz), wall.col.push(color.r, color.g, color.b);
    const uw = len / 16, vh = h / 14;
    wall.uv.push(0, 0, uw, 0, uw, vh, 0, vh);
    const faceOut = -ez * nx + ex * nz > 0; // the winding (A, B, B-up) faces (-ez, ex)
    if (faceOut) wall.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    else wall.idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  }
  const o = roof.pos.length / 3;
  for (const p of P) roof.pos.push(p[0], y0 + h, p[1]), roof.nor.push(0, 1, 0), roof.col.push(roofCol ? roofCol.r : 0.3, roofCol ? roofCol.g : 0.3, roofCol ? roofCol.b : 0.32);
  const up = (P[2][1] - P[0][1]) * (P[1][0] - P[0][0]) - (P[1][1] - P[0][1]) * (P[2][0] - P[0][0]); // y of (p1-p0)x(p2-p0)
  if (up > 0) roof.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  else roof.idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
}
// a pitched (gable) roof over a w x d footprint, ridge along the longer side, as triangles with outward normals
function addGable(buf, cx, cz, y0, w, d, rise, rotY, color, over = 0.5) {
  const c = Math.cos(rotY), s = Math.sin(rotY), alongX = w >= d;
  const hw = w / 2 + over, hd = d / 2 + over;
  const W = (lx, ly, lz) => [cx + lx * c + lz * s, y0 + ly, cz - lx * s + lz * c];
  const A = W(-hw, 0, -hd), B = W(hw, 0, -hd), C = W(hw, 0, hd), D = W(-hw, 0, hd);
  const R1 = alongX ? W(-hw, rise, 0) : W(0, rise, -hd), R2 = alongX ? W(hw, rise, 0) : W(0, rise, hd);
  const mid = [cx, y0 + rise / 2, cz];
  const tri = (p, q, r) => {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (nx * (p[0] - mid[0]) + ny * (p[1] - mid[1]) + nz * (p[2] - mid[2]) < 0) (nx = -nx), (ny = -ny), (nz = -nz);
    const o = buf.pos.length / 3;
    for (const v of [p, q, r]) buf.pos.push(v[0], v[1], v[2]), buf.nor.push(nx, ny, nz), buf.col.push(color.r, color.g, color.b);
    buf.idx.push(o, o + 1, o + 2);
  };
  if (alongX) { tri(A, B, R2); tri(A, R2, R1); tri(D, C, R2); tri(D, R2, R1); tri(A, D, R1); tri(B, C, R2); }
  else { tri(A, D, R2); tri(A, R2, R1); tri(B, C, R2); tri(B, R2, R1); tri(A, B, R1); tri(D, C, R2); }
}
const newBuf = () => ({ pos: [], nor: [], uv: [], col: [], idx: [] });
function bufMesh(b, mat, uv = true) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
  if (uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv.length ? b.uv : new Array((b.pos.length / 3) * 2).fill(0), 2));
  g.setIndex(b.idx);
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = true;
  return m;
}


// ===== Other trees: broadleaf woodland, cypresses, charred snags (cheap instanced shapes, so every island has its own look) =====
let _trees = null;
function treeGeos() {
  if (!_trees) {
    const R = mulberry(0.77);
    const blob = (r, col, x, y, z, sy = 0.85) => {
      const g = new THREE.IcosahedronGeometry(r, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 0.82 + 0.36 * R(); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * sy, p.getZ(i) * k); }
      g.computeVertexNormals();
      return part(g, col, x, y, z);
    };
    _pr = R;
    const broad = [0, 1, 2].map((k) => mergeGeos([
      pCyl(0.16, 0.3, 4.2, 0x6a5238, 0, 2.1, 0, 6), pCyl(0.09, 0.13, 2.4, 0x6a5238, 0.5, 4.2, 0.1, 5, 0, 0, -0.7),
      blob(2.6, [0x2f6a2a, 0x3d7a2c, 0x56822e][k], 0, 5.6, 0), blob(1.9, [0x2f6a2a, 0x3d7a2c, 0x56822e][k], 1.5, 4.9, 0.6), blob(1.7, [0x3a7a30, 0x4a8630, 0x6a8a32][k], -1.1, 6.4, -0.5),
    ]));
    const cypress = mergeGeos([pCyl(0.14, 0.24, 1.6, 0x5a4636, 0, 0.8, 0, 5), pCone(1.15, 7.5, 0x2d4a2a, 0, 5.2, 0, 7)]);
    const snag = mergeGeos([pCyl(0.1, 0.24, 5.4, 0x2a2420, 0, 2.7, 0, 5), pCyl(0.05, 0.09, 2.2, 0x2a2420, 0.7, 4.3, 0, 4, 0, 0, -0.9), pCyl(0.04, 0.08, 1.8, 0x2a2420, -0.6, 3.6, 0.2, 4, 0, 0, 0.8)]);
    _trees = { broad, cypress, snag, mat: curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })) };
    _pr = Math.random;
  }
  return _trees;
}
function* extrasTrees(c) {
  const a = c.a, T = treeGeos(), R = mulberry(a.seed * 43 + 17);
  let kinds; // [species, share]
  if (a.type === 1) kinds = a.veg === 2 ? [["broad", 1]] : a.veg === 1 ? [["broad", 1]] : null;
  else if (a.type === 2) kinds = [["snag", 1]];
  else if (a.type === 3) kinds = [["cypress", 0.8], ["broad", 0.2]];
  else return;
  if (!kinds) return;
  const area = a.r * a.r;
  const want = Math.floor(area * (a.type === 1 ? (a.veg === 2 ? 0.0034 : 0.0016) : a.type === 2 ? 0.0009 : 0.0016));
  const lists = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  let total = 0;
  for (let tries = 0; tries < want * 6 && total < want; tries++) {
    const th = R() * 6.2832, rr = Math.sqrt(R()) * isleCoastR(a, th), x = a.x + Math.cos(th) * rr, z = a.z + Math.sin(th) * rr;
    const d = isleDist(a, x, z), h = bedHeightJS(x, z);
    if (d > -10 || h < 1.5 || h > (a.type === 2 ? 40 : 16)) continue;
    const f = forestDensity(x, z);
    if (R() > smooth(0.34, 0.6, f) * 0.95 + 0.06) continue;
    if (poiKeepClear(a, x, z, 3) || (a.paths && distToPaths(a, x, z) < 2.4) || (a.farm && farmMask(a, x, z) > 0.1) || nearRoad(a, x, z, 8)) continue;
    if (a.type === 2 && h > 24) continue;
    const pick = R();
    let acc = 0, sp = kinds[0][0];
    for (const [k, share] of kinds) { acc += share; if (pick < acc) { sp = k; break; } }
    const key = sp === "broad" ? "broad" + Math.floor(R() * 3) : sp;
    (lists[key] ||= []).push([x, h - 0.15, z, 0.75 + R() * 0.7, R() * 6.28]);
    total++;
    if (total % 40 === 0) yield;
  }
  for (const key in lists) {
    const geo = key.startsWith("broad") ? T.broad[+key.slice(5)] : T[key];
    const im = new THREE.InstancedMesh(geo, T.mat, lists[key].length);
    lists[key].forEach(([x, y, z, s, yw], j) => { e.set(0, yw, 0); im.setMatrixAt(j, m4.compose(p.set(x, y, z), q.setFromEuler(e), sc.set(s, s * (0.85 + 0.3 * R()), s))); });
    im.frustumCulled = false;
    c.group.add(im);
  }
  yield;
}

// ===== The shore of every island: boulders at the waterline, sea stacks, driftwood, dune shrubs, and kelp forests on the shelf =====
// (corals and reef fish come from the reef system, which follows you round whichever island you are at)
let _shoreGeo = null;
function shoreGeos() {
  if (!_shoreGeo) {
    const rockC = [0, 1, 2].map((k) => { const g = makeRock(2, 17 + k * 9.1, 0.4); return g; });
    const bush = [0x3f6e2c, 0x4f7a30, 0x2f5a2a].map((c, k) => {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const r = 0.8 + 0.4 * jnoise(p.getX(i) * 2 + k, p.getY(i) * 2, p.getZ(i) * 2); p.setXYZ(i, p.getX(i) * r, p.getY(i) * r * 0.7, p.getZ(i) * r); }
      g.computeVertexNormals();
      return mergeGeos([{ g, color: new THREE.Color(c) }]);
    });
    const wood = mergeGeos([{ g: new THREE.CylinderGeometry(0.14, 0.18, 1, 6).rotateZ(1.5708), color: new THREE.Color(0xb8a98c) }]);
    _shoreGeo = { rock: rockC, bush, wood, bushMat: curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })), woodMat: curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })) };
  }
  return _shoreGeo;
}
function* extrasShore(c) {
  const a = c.a, R = mulberry(a.seed * 37 + 19), G = shoreGeos();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  // boulders at the waterline and out in the shallows, and a few tall sea stacks
  const nRock = Math.min(70, Math.floor(a.r * 0.35) + 6), rocks = [[], [], []];
  for (let k = 0; k < nRock * 3 && rocks[0].length + rocks[1].length + rocks[2].length < nRock; k++) {
    const th = R() * 6.2832, stack = R() < 0.1;
    const d = stack ? 14 + R() * 70 : -5 + R() * 16;
    const rr = isleCoastR(a, th) + d, x = a.x + Math.cos(th) * rr, z = a.z + Math.sin(th) * rr;
    const bed = bedHeightJS(x, z);
    if (stack ? bed > -2 || bed < -9 : bed < -2.2 || bed > 3) continue;
    if (nearRoad(a, x, z, 5) || poiKeepClear(a, x, z, 3)) continue;
    const sc0 = stack ? 4 + R() * 6 : 0.5 + R() * R() * 2.6;
    rocks[Math.floor(R() * 3)].push([x, bed + sc0 * (stack ? 0.35 : 0.15), z, sc0, R() * 6.28]);
  }
  rocks.forEach((list, i) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(G.rock[i], poiMats().stone, list.length);
    list.forEach(([x, y, z, s, yw], j) => { e.set(0, yw, 0); im.setMatrixAt(j, m4.compose(p.set(x, y, z), q.setFromEuler(e), sc.set(s * 1.2, s, s * 1.2))); });
    im.frustumCulled = false;
    c.group.add(im);
  });
  yield;
  // shrubs on the dunes and driftwood on the sand
  if (a.type <= 4) {
    const bushes = [[], [], []], logs = [];
    const want = Math.min(160, Math.floor(a.r * 0.9));
    for (let k = 0; k < want * 5 && bushes[0].length + bushes[1].length + bushes[2].length < want; k++) {
      const th = R() * 6.2832, d = -(4 + R() * 38), rr = isleCoastR(a, th) + d, x = a.x + Math.cos(th) * rr, z = a.z + Math.sin(th) * rr, h = bedHeightJS(x, z);
      if (h < 1.1 || h > 9) continue;
      if (a.paths && distToPaths(a, x, z) < 2.5) continue;
      if ((a.farm && farmMask(a, x, z) > 0.05) || nearRoad(a, x, z, 7) || poiKeepClear(a, x, z, 3)) continue;
      bushes[Math.floor(R() * 3)].push([x, h, z, 0.7 + R() * 1.1, R() * 6.28]);
    }
    for (let k = 0; k < 90 && logs.length < 12; k++) {
      const th = R() * 6.2832, d = -(1 + R() * 7), rr = isleCoastR(a, th) + d, x = a.x + Math.cos(th) * rr, z = a.z + Math.sin(th) * rr, h = bedHeightJS(x, z);
      if (h < 0.5 || h > 1.6 || nearRoad(a, x, z, 5)) continue;
      logs.push([x, h + 0.12, z, 2 + R() * 3, R() * 6.28]);
    }
    bushes.forEach((list, i) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(G.bush[i], G.bushMat, list.length);
      list.forEach(([x, y, z, s, yw], j) => { e.set(0, yw, 0); im.setMatrixAt(j, m4.compose(p.set(x, y + s * 0.35, z), q.setFromEuler(e), sc.set(s * 1.3, s, s * 1.3))); });
      im.frustumCulled = false;
      c.group.add(im);
    });
    if (logs.length) {
      const im = new THREE.InstancedMesh(G.wood, G.woodMat, logs.length);
      logs.forEach(([x, y, z, len, yw], j) => { e.set(0, yw, 0.05); im.setMatrixAt(j, m4.compose(p.set(x, y, z), q.setFromEuler(e), sc.set(len, 1, 1))); });
      im.frustumCulled = false;
      c.group.add(im);
    }
  }
  yield;
  // kelp forests on the shelf
  const spots = [], want = Math.min(360, Math.floor(a.r * 2.4) + 40);
  for (let k = 0, tries = 0; k < want && tries < want * 6; tries++) {
    const th = R() * 6.2832, depthWant = 2.2 + 11.8 * Math.pow(R(), 1.6);
    for (let r = isleCoastR(a, th) + 4; r < isleCoastR(a, th) + 260; r += 2) {
      const x = a.x + Math.cos(th) * r, z = a.z + Math.sin(th) * r, y = bedHeightJS(x, z);
      if (y > -depthWant) continue;
      if (jfbm(x * 0.03 + 4, z * 0.03, 7.7, 3) > 0.42) { spots.push({ x, z, y, len: -y + (R() * 3.2 - 0.6) }); k++; }
      break;
    }
  }
  if (spots.length) kelp.build(spots, c.group);
  yield;
}

function* buildIslandExtras(c) {
  const a = c.a, R = mulberry(a.seed * 53 + 11);
  const cy = bedHeightJS(a.x, a.z);
  const smokeTex = dotTexture;
  if (a.lakeR > 0) {
    // the lake's own water, so it holds water at any distance (the detailed sea only reaches a few hundred metres)
    const g = new THREE.RingGeometry(0.01, a.lakeR * 0.97, 56, 14);
    g.rotateX(-Math.PI / 2);
    const lakeMat = new THREE.MeshStandardMaterial({ color: 0x2f8f9a, transparent: true, opacity: 0.84, roughness: 0.12, metalness: 0.1, depthWrite: false });
    // very subtle waves: a few centimetres of slow, crossing ripples, bending the surface's normal as well so the light moves on it
    lakeMat.onBeforeCompile = (sh) => {
      sh.uniforms.uLakeT = shared.uTime;
      sh.vertexShader = sh.vertexShader
        .replace("void main() {", `uniform float uLakeT;
          float lkH(vec2 p) { return 0.018 * sin(dot(p, vec2(0.21, 0.13)) + uLakeT * 0.9) + 0.012 * sin(dot(p, vec2(-0.15, 0.27)) + uLakeT * 1.2) + 0.006 * sin(dot(p, vec2(0.6, -0.4)) + uLakeT * 1.9); }
          vec2 lkG(vec2 p) { float e = 0.25; return vec2(lkH(p + vec2(e, 0.0)) - lkH(p - vec2(e, 0.0)), lkH(p + vec2(0.0, e)) - lkH(p - vec2(0.0, e))) / (2.0 * e); }
          void main() {`)
        .replace("#include <beginnormal_vertex>", "vec2 lkgr = lkG(position.xz); vec3 objectNormal = normalize(vec3(-lkgr.x, 1.0, -lkgr.y));")
        .replace("#include <begin_vertex>", "vec3 transformed = vec3(position.x, position.y + lkH(position.xz), position.z);");
    };
    const m = new THREE.Mesh(g, lakeMat);
    m.position.set(a.x + Math.cos(a.p2) * 0.3 * a.r, -0.22, a.z + Math.sin(a.p2) * 0.3 * a.r);
    c.group.add(m);
  }
  if (a.type === 2) {
    // a plume rising from the crater, and a red glow in the sky above it
    const sprites = [];
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x4a4440, transparent: true, opacity: 0, depthWrite: false }));
      c.group.add(s);
      sprites.push(s);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xff5a14, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.setScalar(70);
    glow.position.set(a.x, cy + 6, a.z);
    c.group.add(glow);
    c.updaters.push((t, dt, lampsOn) => {
      const wdx = Math.cos(weather.windAngle), wdz = Math.sin(weather.windAngle);
      sprites.forEach((s, i) => {
        const ph = (t * 0.035 + i / sprites.length) % 1;
        const hgt = ph * 190;
        s.position.set(a.x + wdx * hgt * 0.55 + Math.sin(i * 3.1) * 8, cy + 4 + hgt, a.z + wdz * hgt * 0.55 + Math.cos(i * 2.3) * 8);
        s.scale.setScalar(26 + ph * 120);
        s.material.opacity = 0.5 * Math.min(1, ph * 8) * (1 - ph);
        s.material.color.setRGB(0.3 + 0.35 * ph, 0.27 + 0.3 * ph, 0.25 + 0.28 * ph);
      });
      glow.material.opacity = 0.35 + 0.2 * Math.sin(t * 1.3) + 0.3 * lampsOn;
    });
    yield;
  } else if (a.type === 3) {
    // a stepped temple on the high terrace, a ring of columns and braziers
    const stone = [], y0 = cy - 0.3, sand = 0xb59a6a, dk = 0x8e7a52;
    const tiers = [[34, 3.4], [26, 3.2], [18, 3.0], [10, 2.6]];
    let y = y0;
    for (const [sz, h] of tiers) {
      stone.push(pBox(sz, h, sz, sand, 0, y + h / 2 - y0, 0));
      y += h;
    }
    for (let i = 0; i < 12; i++) stone.push(pBox(8, 0.5, 1.4, dk, 0, i * 0.5 + 0.25, 17 + 0.7 - i * 0.6 * 1.0)); // the stair up the south face
    stone.push(pBox(7, 4.4, 7, dk, 0, y - y0 + 2.2, 0), pBox(8.4, 0.5, 8.4, sand, 0, y - y0 + 4.65, 0));
    for (const [x, z] of [[-3.2, 3.2], [3.2, 3.2], [-3.2, -3.2], [3.2, -3.2]]) stone.push(pCyl(0.5, 0.6, 4.4, sand, x, y - y0 + 2.2, z, 10));
    for (let i = 0; i < 18; i++) {
      const an = (i / 18) * 6.2832;
      const x = Math.cos(an) * 28, z = Math.sin(an) * 28;
      const fall = R() < 0.3;
      stone.push(pCyl(0.7, 0.8, fall ? 4 : 6.5, sand, x, fall ? 0.7 : 3.25, z, 10, fall ? 1.4 : 0, R() * 3, fall ? 0.2 : 0));
    }
    const mesh = new THREE.Mesh(mergeGeos(stone), poiMats().stone);
    mesh.position.set(a.x, y0, a.z);
    c.group.add(mesh);
    colliders.push({ x: a.x, z: a.z, r: 19, chunk: a.id });
    const fires = [];
    for (const [x, z] of [[-21, -21], [21, -21], [-21, 21], [21, 21]]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      s.position.set(a.x + x, bedHeightJS(a.x + x, a.z + z) + 1.6, a.z + z);
      c.group.add(s);
      fires.push(s);
    }
    c.updaters.push((t, dt, lampsOn) => fires.forEach((s, i) => (s.material.opacity = (0.3 + 0.7 * lampsOn) * (0.8 + 0.2 * Math.sin(t * 9 + i)), s.scale.setScalar(2.2 + 0.4 * Math.sin(t * 11 + i)))));
    yield;
  } else if (a.type === 4) {
    // mangroves with arching roots, and reeds in the shallows
    const trees = [];
    const want = Math.floor(a.r * a.r * 0.0011);
    for (let tries = 0; tries < want * 5 && trees.length < want; tries++) {
      const th = R() * 6.2832, rr = Math.sqrt(R()) * isleCoastR(a, th);
      const x = a.x + Math.cos(th) * rr, z = a.z + Math.sin(th) * rr, h = bedHeightJS(x, z);
      if (isleDist(a, x, z) > -6 || h < -0.7 || h > 1.6) continue;
      if (poiKeepClear(a, x, z, 2) || distToPaths(a, x, z) < 2) continue;
      trees.push([x, z, h]);
    }
    const geo = [], leaf = [];
    trees.forEach(([x, z, h], i) => {
      const th = 3 + R() * 2.5;
      geo.push(pCyl(0.12, 0.2, th, 0x4a3a2a, x, h + th / 2, z, 6));
      for (let k = 0; k < 6; k++) {
        const an = (k / 6) * 6.2832 + R();
        geo.push(pCyl(0.035, 0.05, 2.2, 0x4a3a2a, x + Math.cos(an) * 0.8, h + 0.9, z + Math.sin(an) * 0.8, 4, Math.sin(an) * 0.55, 0, -Math.cos(an) * 0.55));
      }
      for (let k = 0; k < 3; k++) leaf.push(pBlob(1.3 + R() * 0.8, 0x3a6a2a, x + (R() - 0.5) * 1.8, h + th + 0.3 + R() * 0.6, z + (R() - 0.5) * 1.8, 1, 0.65, 1, 6));
      if (i % 8 === 7) c.gen && 0;
    });
    if (geo.length) {
      const m1 = new THREE.Mesh(mergeGeos(geo), poiMats().bark), m2 = new THREE.Mesh(mergeGeos(leaf), poiMats().plain);
      c.group.add(m1, m2);
    }
    yield;
    const reeds = [];
    for (let tries = 0; tries < 2200 && reeds.length < 700; tries++) {
      const th = R() * 6.2832, rr = Math.sqrt(R()) * isleCoastR(a, th);
      const x = a.x + Math.cos(th) * rr, z = a.z + Math.sin(th) * rr, h = bedHeightJS(x, z);
      if (isleDist(a, x, z) > -3 || h < -0.45 || h > 0.7) continue;
      reeds.push([x, z, h]);
    }
    if (reeds.length) {
      const im = new THREE.InstancedMesh(new THREE.ConeGeometry(0.06, 1.5, 3).translate(0, 0.75, 0), curved(new THREE.MeshLambertMaterial({ color: 0x6f8a3a })), reeds.length);
      const m4 = new THREE.Matrix4();
      reeds.forEach(([x, z, h], i) => im.setMatrixAt(i, m4.makeScale(1, 0.6 + R() * 0.9, 1).setPosition(x, h - 0.1, z)));
      im.frustumCulled = false;
      c.group.add(im);
    }
    yield;
  } else if (a.type === 5) {
    // a city: streets of uneven blocks (a little turned), lots of different sizes with some left empty, flat and pitched roofs, buildings that
    // grow taller toward the middle on rolling ground, lit windows, street lamps and cars on the roads
    const [wallMat, roofMat] = cityMats();
    const wall = newBuf(), roof = newBuf(), asph = { pos: [], nor: [], idx: [] };
    const tmp = new THREE.Color(), rc = new THREE.Color();
    const winP = [], winC = [], lampsP = [], poles = [], runs = [];
    const ang = ((a.p2 - 3.14) / 3.14) * 0.28, cA = Math.cos(ang), sA = Math.sin(ang);
    const W2 = (u, v) => [a.x + u * cA - v * sA, a.z + u * sA + v * cA];
    const Rc = Math.min(a.r * 0.82, 330), E = Rc + 60; // the built-up core (bigger islands are not built over end to end)
    const lines = () => { const out = []; let p = -E - R() * 16; while (p < E) { out.push(p); p += 26 + R() * 24 + (out.length % 5 === 0 ? 8 : 0); } return out; };
    const U = lines(), V = lines();
    const sw = (i) => (i % 4 === 0 ? 14 : 9); // every fourth street is an avenue
    const inCity = (x, z, m) => isleDist(a, x, z) < -m && Math.hypot(x - a.x, z - a.z) < Rc + 30;
    // the streets: a ribbon of asphalt on the ground every 5 m, split where the street runs out of land
    const street = (along, k, horizontal) => {
      const width = sw(k), pos = horizontal ? V[k] : U[k];
      let run = null;
      for (let t = -E; t <= E; t += 5) {
        const [x, z] = horizontal ? W2(t, pos) : W2(pos, t);
        if (!inCity(x, z, 38)) { run = null; continue; }
        const y = bedHeightJS(x, z) + 0.12;
        const tx = horizontal ? cA : -sA, tz = horizontal ? sA : cA; // along the street
        const rx = tz, rz = -tx;
        if (!run) { run = { pts: [], loop: false }; runs.push(run); }
        run.pts.push({ x, y, z, rx, rz, tx, tz });
        const o = asph.pos.length / 3;
        asph.pos.push(x - rx * width / 2, y, z - rz * width / 2, x + rx * width / 2, y, z + rz * width / 2);
        asph.nor.push(0, 1, 0, 0, 1, 0);
        if (run.pts.length > 1) { const k0 = o - 2; asph.idx.push(k0, o, k0 + 1, k0 + 1, o, o + 1); }
        const n = run.pts.length;
        if (n % 4 === 0) { // street lamps: a pole every 20 m, alternating sides
          const side = (n / 4) % 2 ? 1 : -1, off = width / 2 + 1.1;
          lampsP.push(x + rx * off * side, y + 6.1, z + rz * off * side);
          poles.push([x + rx * off * side, y - 0.1, z + rz * off * side]);
        }
      }
    };
    U.forEach((u, i) => street(0, i, false));
    V.forEach((v, j) => street(0, j, true));
    yield;
    let n = 0;
    for (let i = 0; i < U.length - 1; i++)
      for (let j = 0; j < V.length - 1; j++) {
        const u0 = U[i] + sw(i) / 2 + 1.5, u1 = U[i + 1] - sw(i + 1) / 2 - 1.5, v0 = V[j] + sw(j) / 2 + 1.5, v1 = V[j + 1] - sw(j + 1) / 2 - 1.5;
        if (u1 - u0 < 10 || v1 - v0 < 10) continue;
        const [mx, mz] = W2((u0 + u1) / 2, (v0 + v1) / 2);
        if (!inCity(mx, mz, 55) || !inCity(...W2(u0, v0), 30) || !inCity(...W2(u1, v1), 30) || !inCity(...W2(u0, v1), 30) || !inCity(...W2(u1, v0), 30)) continue;
        if (R() < 0.11) continue; // a park or an empty block
        const rho = Math.hypot(mx - a.x, mz - a.z) / Rc;
        const nu = u1 - u0 > 34 ? (R() < 0.6 ? 2 : 1) : 1, nv = v1 - v0 > 34 ? (R() < 0.6 ? 2 : 1) : 1;
        for (let p = 0; p < nu; p++)
          for (let q = 0; q < nv; q++) {
            if (R() < 0.12 + 0.3 * smooth(0.55, 1, rho)) continue; // gaps, more of them toward the edge
            const lu0 = lerp(u0, u1, p / nu) + 1 + R() * 3, lu1 = lerp(u0, u1, (p + 1) / nu) - 1 - R() * 3, lv0 = lerp(v0, v1, q / nv) + 1 + R() * 3, lv1 = lerp(v0, v1, (q + 1) / nv) - 1 - R() * 3;
            let w = lu1 - lu0, d = lv1 - lv0;
            if (w < 7 || d < 7) continue;
            w *= 0.7 + R() * 0.3; d *= 0.7 + R() * 0.3;
            const [cx, cz] = W2((lu0 + lu1) / 2 + (R() - 0.5) * 2, (lv0 + lv1) / 2 + (R() - 0.5) * 2);
            const rotY = -ang + (R() - 0.5) * 0.04;
            // height: mostly low and mid, a few towers near the middle
            const tall = (1 - smooth(0, 0.8, rho)) * Math.pow(R(), 2.2);
            const h = 6 + R() * 9 + tall * 58;
            const hw = w / 2, hd = d / 2, cr = Math.cos(rotY), sr = Math.sin(rotY);
            let lo = 1e9, hi = -1e9;
            for (const [ex, ez] of [[0, 0], [hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd]]) { const y = bedHeightJS(cx + ex * cr + ez * sr, cz - ex * sr + ez * cr); lo = Math.min(lo, y); hi = Math.max(hi, y); }
            const by = lo - 0.5, ht = h + (hi - lo); // (the foundation reaches down to the low corner on a slope)
            const tone = R();
            if (tone < 0.38) tmp.setHSL(0.09 + R() * 0.04, 0.12 + R() * 0.16, 0.6 + R() * 0.2); // concrete
            else if (tone < 0.62) tmp.setHSL(0.03 + R() * 0.03, 0.3 + R() * 0.15, 0.5 + R() * 0.12); // brick
            else if (tone < 0.82) tmp.setHSL(0.55 + R() * 0.05, 0.1 + R() * 0.12, 0.62 + R() * 0.18); // grey-blue
            else tmp.setHSL(0.12 + R() * 0.04, 0.3 + R() * 0.2, 0.74 + R() * 0.1); // pale stucco
            let topY = by + ht;
            // roofs: pitched on low buildings, flat with a parapet and rooftop plant on the rest
            const pitched = h < 20 && R() < 0.6;
            if (pitched) {
              addBuilding(wall, roof, cx, cz, by, w, d, ht, rotY, tmp, rc.setHSL(0.02 + R() * 0.04, 0.4, 0.3));
              addGable(roof, cx, cz, by + ht, w, d, Math.min(w, d) * (0.22 + R() * 0.12), rotY, rc.setHSL(0.02 + R() * 0.05, 0.45 + R() * 0.2, 0.26 + R() * 0.12));
              topY += Math.min(w, d) * 0.3;
            } else {
              let wy = by, ww = w, wd = d, wh = ht;
              if (h > 30 && R() < 0.7) { // a setback tier on the tall ones
                addBuilding(wall, roof, cx, cz, by, w, d, ht, rotY, tmp, rc.setRGB(0.3, 0.3, 0.32));
                wy = by + ht; ww = w * (0.55 + R() * 0.15); wd = d * (0.55 + R() * 0.15); wh = 8 + R() * 14;
              }
              addBuilding(wall, roof, cx, cz, wy, ww, wd, wh, rotY, tmp, rc.setRGB(0.28 + R() * 0.08, 0.28 + R() * 0.08, 0.3 + R() * 0.08));
              topY = wy + wh;
              const par = rc.setRGB(0.4, 0.4, 0.42); // parapet: four low walls round the edge
              for (const [px, pz, pw, pd] of [[0, (wd / 2) - 0.2, ww, 0.4], [0, -(wd / 2) + 0.2, ww, 0.4], [(ww / 2) - 0.2, 0, 0.4, wd], [-(ww / 2) + 0.2, 0, 0.4, wd]])
                addBuilding(roof, roof, cx + px * cr + pz * sr, cz - px * sr + pz * cr, topY, pw, pd, 0.7, rotY, par);
              for (let k = 0, m = 1 + Math.floor(R() * 3); k < m; k++) // plant, tanks and stair heads
                addBuilding(roof, roof, cx + (R() - 0.5) * ww * 0.5 * cr, cz - (R() - 0.5) * ww * 0.5 * sr, topY, 1.4 + R() * 2.4, 1.4 + R() * 2.2, 1.0 + R() * 1.8, rotY, rc.setRGB(0.5 + R() * 0.15, 0.5 + R() * 0.12, 0.52));
              topY += 2.5;
            }
            colliders.push({ x: cx, z: cz, hw: w / 2, hd: d / 2, rot: rotY, top: topY, chunk: a.id });
            for (let k = 0; k < 8; k++) { // lit windows seen from afar
              const wl = Math.floor(R() * 4), uu = R() - 0.5, yy = by + 2 + R() * (ht - 3);
              const lx = wl < 2 ? uu * w : (wl === 2 ? 1 : -1) * (w / 2 + 0.4), lz = wl < 2 ? (wl === 0 ? 1 : -1) * (d / 2 + 0.4) : uu * d;
              winP.push(cx + lx * cr + lz * sr, yy, cz - lx * sr + lz * cr);
              const warm = R();
              winC.push(1, 0.72 + warm * 0.15, 0.4 + warm * 0.2);
            }
            if (++n % 6 === 0) yield;
          }
      }
    const wmesh = bufMesh(wall, wallMat), rmesh = bufMesh(roof, roofMat, false);
    c.group.add(wmesh, rmesh);
    if (asph.pos.length) {
      const ag = new THREE.BufferGeometry();
      ag.setAttribute("position", new THREE.Float32BufferAttribute(asph.pos, 3));
      ag.setAttribute("normal", new THREE.Float32BufferAttribute(asph.nor, 3));
      ag.setIndex(asph.idx);
      const am = new THREE.Mesh(ag, curved(new THREE.MeshStandardMaterial({ color: 0x2b2c30, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
      am.frustumCulled = false;
      c.group.add(am);
    }
    if (poles.length) {
      const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 6.2, 6).translate(0, 3.1, 0), curved(new THREE.MeshLambertMaterial({ color: 0x3a3d42 })), poles.length);
      const m4 = new THREE.Matrix4();
      poles.forEach((p, i) => pm.setMatrixAt(i, m4.makeTranslation(p[0], p[1], p[2])));
      pm.frustumCulled = false;
      c.group.add(pm);
    }
    // cars on the streets
    const long = runs.filter((r) => r.pts.length > 8), cars = [];
    const nCars = long.length ? Math.min(28, 6 + Math.floor(long.length * 0.8)) : 0;
    for (let k = 0; k < nCars; k++) {
      const run = long[Math.floor(R() * long.length)];
      const mesh = new THREE.Mesh(carGeometry(CAR_COLORS[Math.floor(R() * CAR_COLORS.length)]), poiMats().plain);
      const lights = [-0.6, 0.6].map((x) => {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture, color: 0xfff2d0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        sp.scale.setScalar(2.0);
        sp.position.set(x, 0.7, 2.4);
        mesh.add(sp);
        return sp;
      });
      c.group.add(mesh);
      cars.push({ mesh, run, s: R() * (run.pts.length - 2), dir: R() < 0.5 ? 1 : -1, speed: 1.6 + R() * 1.6, lights });
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(lampsP, 3));
    const lm = curved(new THREE.PointsMaterial({ color: 0xffc27a, size: 3, sizeAttenuation: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const pts = new THREE.Points(lg, lm);
    pts.frustumCulled = false;
    c.group.add(pts);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.Float32BufferAttribute(winP, 3));
    wg.setAttribute("color", new THREE.Float32BufferAttribute(winC, 3));
    const wm = curved(new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const wpts = new THREE.Points(wg, wm);
    wpts.frustumCulled = false;
    c.group.add(wpts);
    c.updaters.push((t, dt, lampsOn) => {
      _cityMat.emissiveIntensity = 1.5 * lampsOn;
      lm.opacity = 0.9 * lampsOn;
      wm.opacity = 0.95 * smooth(0.05, 0.5, lampsOn);
      for (const car of cars) {
        const ps = car.run.pts, np = ps.length;
        car.s += car.dir * car.speed * dt;
        if (car.s < 0 || car.s > np - 2) (car.dir *= -1), (car.s = clamp(car.s, 0, np - 2));
        const i = Math.min(Math.floor(car.s), np - 2), u = car.s - i, p = ps[i], q2 = ps[i + 1];
        car.mesh.visible = Math.hypot(camPos.x - p.x, camPos.z - p.z) < 700;
        if (!car.mesh.visible) continue;
        const lane = 2.0 * car.dir;
        car.mesh.position.set(lerp(p.x, q2.x, u) + p.rx * lane, lerp(p.y, q2.y, u) + 0.08, lerp(p.z, q2.z, u) + p.rz * lane);
        car.mesh.rotation.y = Math.atan2((q2.x - p.x) * car.dir, (q2.z - p.z) * car.dir);
        for (const l of car.lights) l.material.opacity = 0.9 * lampsOn;
      }
    });
    yield;
  }
  yield* extrasShore(c);
  yield* extrasTrees(c);
  yield* extrasRoad(c);
  yield* extrasFarm(c);
  if (a.type === 6) yield* extrasAirport(c);
}

// ===== Farmland: a patchwork of crop fields with hedges (the field shader is Coastline's), barns, a silo and hay bales =====
const farmMask = (a, x, z) => {
  if (!a.farm) return 0;
  const qx = x - a.x, qz = z - a.z, th = Math.atan2(qz, qx), R = isleCoastR(a, th), rr = Math.hypot(qx, qz);
  const dth = Math.abs(wrapAngle(th - a.farmTh));
  const u = R - rr;
  const h = bedHeightJS(x, z);
  let m = smooth(0.95, 0.6, dth) * smooth(26, 40, u) * smooth(0.8 * R, 0.62 * R, rr) * smooth(1.3, 2.2, h) * smooth(11, 7, h);
  if (m > 0 && a.pois) for (const p of a.pois) if (Math.hypot(x - p.x, z - p.z) < p.def.clear + 10) m = 0;
  return m;
};

// ===== Roads: a coast road round part of an island, with a white guard rail where the ground falls away, power lines, and cars =====
const roadTex = (() => {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#3a3a3d"; g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${90 + Math.random() * 60},${95 + Math.random() * 60},0.18)`; g.fillRect(Math.random() * 64, Math.random() * 128, 1.5, 1.5); }
  g.fillStyle = "#d8d4c4"; g.fillRect(3, 0, 2, 128); g.fillRect(59, 0, 2, 128);
  g.fillStyle = "#e6c84a"; g.fillRect(31, 8, 2, 48); g.fillRect(31, 72, 2, 48);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
})();
let _roadMat = null;
const roadMat = () => (_roadMat ||= curved(new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.88, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })));
function islandRoad(a) {
  if (a.roadRuns !== undefined) return a.roadRuns;
  a.roadRuns = [];
  if (!a.road) return a.roadRuns;
  islandPOIs(a);
  const u0 = 44 + 20 * hash3(a.i, a.j, 20), N = Math.ceil(((a.r - u0) * 6.2832) / 5);
  const pts = [];
  for (let k = 0; k < N; k++) {
    const th = (k / N) * 6.2832, rr = isleCoastR(a, th) - u0;
    if (rr < 25) return a.roadRuns;
    const x = a.x + Math.cos(th) * rr, z = a.z + Math.sin(th) * rr;
    pts.push({ x, z, h: bedHeightJS(x, z), nx: Math.cos(th), nz: Math.sin(th) });
  }
  if (a.pois.some((p) => p.def.id === "forestShrine")) return a.roadRuns; // a shrine island is left quiet
  // Coastline's settleRoad: each point rests on the highest ground under the road's width, then the line is smoothed (but never
  // dips below the ground), so the road sits on top of the land and bridges dips and rivers; its sides drop down to the ground
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % N], o = pts[(i + N - 1) % N];
    const l = Math.hypot(q.x - o.x, q.z - o.z) || 1;
    p.sx = -(q.z - o.z) / l; p.sz = (q.x - o.x) / l;
  });
  const raw = pts.map((p) => { let hi = 1.4; for (const k of [-1, -0.5, 0, 0.5, 1]) hi = Math.max(hi, bedHeightJS(p.x + p.sx * k * 3.5, p.z + p.sz * k * 3.5)); return hi; });
  let ys = raw.slice();
  for (let pass = 0; pass < 4; pass++) ys = ys.map((y, i) => Math.max(raw[i], (ys[(i + N - 2) % N] + ys[(i + N - 1) % N] + y + ys[(i + 1) % N] + ys[(i + 2) % N]) / 5));
  pts.forEach((p, i) => (p.y = ys[i] + 0.12));
  const ok = pts.map((p, i) => {
    const q = pts[(i + 1) % N];
    const slope = Math.abs(q.y - p.y) / 5;
    if (slope > 0.2) return false; // too steep (a cliff)
    for (const poi of a.pois) if (Math.hypot(p.x - poi.x, p.z - poi.z) < poi.def.clear + 4) return false;
    return true;
  });
  let start = ok.indexOf(false);
  if (start < 0) { a.roadRuns.push({ pts: [...pts, pts[0]], loop: true }); return a.roadRuns; }
  let run = [];
  for (let k = 1; k <= N; k++) {
    const i = (start + k) % N;
    if (ok[i]) run.push(pts[i]);
    else { if (run.length >= 14) a.roadRuns.push({ pts: run, loop: false }); run = []; }
  }
  if (run.length >= 14) a.roadRuns.push({ pts: run, loop: false });
  return a.roadRuns;
}
const CAR_COLORS = [0xc8342b, 0xf2f2ee, 0x2f5d8c, 0x3c3c3c, 0xe0b23a, 0x3f7a4a, 0x8a8f96];
const _carGeo = {};
function carGeometry(color) {
  return (_carGeo[color] ||= mergeGeos([
    pBox(1.8, 0.7, 4.2, color, 0, 0.65, 0), pBox(1.6, 0.6, 2.1, 0x22303a, 0, 1.25, -0.2),
    pBox(0.3, 0.15, 0.05, 0xfff2c8, -0.6, 0.7, 2.12), pBox(0.3, 0.15, 0.05, 0xfff2c8, 0.6, 0.7, 2.12),
    pBox(0.3, 0.15, 0.05, 0x8a1810, -0.6, 0.7, -2.12), pBox(0.3, 0.15, 0.05, 0x8a1810, 0.6, 0.7, -2.12),
    pCyl(0.34, 0.34, 0.25, 0x111111, -0.95, 0.34, 1.3, 10, 0, 0, 1.5708), pCyl(0.34, 0.34, 0.25, 0x111111, 0.95, 0.34, 1.3, 10, 0, 0, 1.5708),
    pCyl(0.34, 0.34, 0.25, 0x111111, -0.95, 0.34, -1.3, 10, 0, 0, 1.5708), pCyl(0.34, 0.34, 0.25, 0x111111, 0.95, 0.34, -1.3, 10, 0, 0, 1.5708),
  ]));
}
function* extrasRoad(c) {
  const a = c.a;
  const runs = islandRoad(a);
  if (!runs.length) return;
  const R = mulberry(a.seed * 71 + 3);
  const W = 3.2;
  const posts = [], poleP = [], wire = [], railPos = [], railIdx = [];
  const roadPos = [], roadUv = [], roadIdx = [];
  for (const run of runs) {
    const pts = run.pts, base = roadPos.length / 3;
    let along = 0;
    pts.forEach((p, i) => {
      const q = pts[Math.min(i + 1, pts.length - 1)], pq = pts[Math.max(i - 1, 0)];
      let tx = q.x - pq.x, tz = q.z - pq.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = tz, nz = -tx; // to the right of travel
      p.tx = tx; p.tz = tz; p.rx = nx; p.rz = nz;
      if (i) along += Math.hypot(p.x - pq.x, p.z - pq.z);
      const v = along / 16;
      roadPos.push(p.x - nx * W, p.y, p.z - nz * W, p.x + nx * W, p.y, p.z + nz * W, p.x - nx * W, p.y - 3, p.z - nz * W, p.x + nx * W, p.y - 3, p.z + nz * W);
      roadUv.push(0, v, 1, v, 0, v, 1, v);
      if (i) { const k = base + (i - 1) * 4, n = k + 4; roadIdx.push(k, n, k + 1, k + 1, n, n + 1, k, k + 2, n, n, k + 2, n + 2, k + 1, n + 1, k + 3, k + 3, n + 1, n + 3); }
    });
    // the sea side is the outward (radial) side; guard rail where the ground drops away, posts every other point
    let railRun = [];
    const flushRail = () => {
      if (railRun.length > 1) {
        const o = railPos.length / 3;
        railRun.forEach((p, i) => {
          const x = p.x + p.nx * (W + 0.7), z = p.z + p.nz * (W + 0.7);
          railPos.push(x, p.y + 0.55, z, x, p.y + 0.9, z);
          if (i) railIdx.push(o + (i - 1) * 2, o + i * 2, o + (i - 1) * 2 + 1, o + (i - 1) * 2 + 1, o + i * 2, o + i * 2 + 1);
        });
      }
      railRun = [];
    };
    pts.forEach((p, i) => {
      const drop = p.y - bedHeightJS(p.x + p.nx * (W + 4), p.z + p.nz * (W + 4));
      if (drop > 2.2 || p.h < p.y - 0.9) {
        railRun.push(p);
        if (i % 2 === 0) posts.push(p.x + p.nx * (W + 0.7), p.y, p.z + p.nz * (W + 0.7));
      } else flushRail();
    });
    flushRail();
    // power poles on the land side, with sagging wires between them
    const poles = [];
    for (let i = 3; i < pts.length; i += 8) {
      const p = pts[i], x = p.x - p.nx * (W + 3.5), z = p.z - p.nz * (W + 3.5);
      poles.push({ x, z, y: Math.max(bedHeightJS(x, z), p.y - 1), nx: p.rx, nz: p.rz });
    }
    poles.forEach((p, i) => {
      poleP.push(p);
      const n = poles[i + 1];
      if (!n) return;
      for (const s of [-0.9, 0.9]) {
        const ax = p.x + p.nx * s, az = p.z + p.nz * s, bx = n.x + n.nx * s, bz = n.z + n.nz * s;
        for (let k = 0; k < 6; k++) {
          const u0 = k / 6, u1 = (k + 1) / 6;
          wire.push(lerp(ax, bx, u0), lerp(p.y, n.y, u0) + 8.7 - Math.sin(Math.PI * u0) * 1.2, lerp(az, bz, u0), lerp(ax, bx, u1), lerp(p.y, n.y, u1) + 8.7 - Math.sin(Math.PI * u1) * 1.2, lerp(az, bz, u1));
        }
      }
    });
    yield;
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.Float32BufferAttribute(roadPos, 3));
  rg.setAttribute("uv", new THREE.Float32BufferAttribute(roadUv, 2));
  rg.setIndex(roadIdx);
  rg.computeVertexNormals();
  c.group.add(new THREE.Mesh(rg, roadMat()));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  if (posts.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.9, 0.14).translate(0, 0.45, 0), curved(new THREE.MeshLambertMaterial({ color: 0x5a4632 })), posts.length / 3);
    for (let i = 0; i < posts.length; i += 3) im.setMatrixAt(i / 3, m4.makeTranslation(posts[i], posts[i + 1], posts[i + 2]));
    im.frustumCulled = false;
    c.group.add(im);
  }
  if (railIdx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(railPos, 3));
    g.setIndex(railIdx);
    g.computeVertexNormals();
    c.group.add(new THREE.Mesh(g, curved(new THREE.MeshStandardMaterial({ color: 0xe8e8e2, metalness: 0.4, roughness: 0.4, side: THREE.DoubleSide }))));
  }
  if (poleP.length) {
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.17, 9, 6).translate(0, 4.5, 0), curved(new THREE.MeshLambertMaterial({ color: 0x5a4632 })), poleP.length);
    const am = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.14, 0.14), curved(new THREE.MeshLambertMaterial({ color: 0x4a3a28 })), poleP.length);
    poleP.forEach((p, i) => {
      pm.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(p.nx, p.nz));
      am.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, p.y + 8.6, p.z), q, one));
    });
    pm.frustumCulled = am.frustumCulled = false;
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.Float32BufferAttribute(wire, 3));
    const wl = new THREE.LineSegments(wg, curved(new THREE.LineBasicMaterial({ color: 0x1c1c1c, transparent: true, opacity: 0.7 })));
    c.group.add(pm, am, wl);
  }
  // cars
  const cars = [];
  const nCars = Math.min(5, 1 + Math.floor(R() * 4) + Math.floor(a.r / 160));
  for (let k = 0; k < nCars; k++) {
    const run = runs[Math.floor(R() * runs.length)];
    const col = CAR_COLORS[Math.floor(R() * CAR_COLORS.length)];
    const mesh = new THREE.Mesh(carGeometry(col), poiMats().plain);
    const lights = [-0.6, 0.6].map((x) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture, color: 0xfff2d0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.scale.setScalar(2.0);
      s.position.set(x, 0.7, 2.4);
      mesh.add(s);
      return s;
    });
    c.group.add(mesh);
    cars.push({ mesh, run, s: R() * (run.pts.length - 2), dir: R() < 0.5 ? 1 : -1, speed: 2.2 + R() * 1.6, lights }); // (speed in road points per second: 5 m apart)
  }
  c.updaters.push((t, dt, lampsOn) => {
    for (const car of cars) {
      const pts = car.run.pts, n = pts.length;
      car.s += car.dir * car.speed * dt;
      if (car.run.loop) car.s = ((car.s % (n - 1)) + (n - 1)) % (n - 1);
      else if (car.s < 0 || car.s > n - 2) (car.dir *= -1), (car.s = clamp(car.s, 0, n - 2));
      const i = Math.min(Math.floor(car.s), n - 2), u = car.s - i, p = pts[i], q2 = pts[i + 1];
      const d = Math.hypot(camPos.x - p.x, camPos.z - p.z);
      car.mesh.visible = d < 1000;
      if (!car.mesh.visible) continue;
      const lane = 1.7 * car.dir;
      car.mesh.position.set(lerp(p.x, q2.x, u) + p.rx * lane, lerp(p.y, q2.y, u) + 0.08, lerp(p.z, q2.z, u) + p.rz * lane);
      car.mesh.rotation.y = Math.atan2((q2.x - p.x) * car.dir, (q2.z - p.z) * car.dir);
      for (const l of car.lights) l.material.opacity = 0.9 * lampsOn;
    }
  });
}

function* extrasFarm(c) {
  const a = c.a;
  if (!a.farm) return;
  const R = mulberry(a.seed * 91 + 7);
  // the farmstead sits at the middle of the farmland
  const th0 = a.farmTh, rr0 = isleCoastR(a, th0) * 0.5;
  const fx = a.x + Math.cos(th0) * rr0, fz = a.z + Math.sin(th0) * rr0;
  const g = [], roofs = [], white = [];
  const ground = (x, z) => bedHeightJS(x, z);
  const yaw = th0 + 1.5708;
  const put = (lx, lz, w, d, h, wallC, roofC, tall) => {
    const x = fx + lx * Math.cos(yaw) + lz * Math.sin(yaw), z = fz - lx * Math.sin(yaw) + lz * Math.cos(yaw);
    const y0 = Math.min(ground(x, z), ground(x + w / 2, z + d / 2), ground(x - w / 2, z - d / 2)) - 0.6;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const rotY = yaw;
    const body = pBox(w, h + 0.6, d, wallC, 0, (h + 0.6) / 2, 0, 0, rotY, 0);
    body.g.translate(x, y0, z);
    g.push(body);
    // gable roof (ridge along local z)
    const ang = 0.5, run = w / 2 + 0.5, slope = Math.hypot(run, run * Math.tan(ang));
    for (const sd of [-1, 1]) {
      const r = pBox(slope, 0.18, d + 0.8, roofC, sd * run / 2, h + 0.6 + run * Math.tan(ang) / 2, 0, 0, 0, -sd * ang);
      r.g.applyMatrix4(new THREE.Matrix4().makeRotationY(rotY));
      r.g.translate(x, y0, z);
      roofs.push(r);
    }
    colliders.push({ x, z, hw: w / 2, hd: d / 2, rot: rotY, top: y0 + h + 4, chunk: a.id });
  };
  put(0, 0, 11, 17, 6.5, 0x9c2f26, 0x3a3836); // the barn
  put(-17, 6, 8, 10, 4.2, 0xe9e2d2, 0x8a3a2a); // the farmhouse
  // silo
  {
    const x = fx + 9 * Math.cos(yaw) + 3 * Math.sin(yaw), z = fz - 9 * Math.sin(yaw) + 3 * Math.cos(yaw), y0 = ground(x, z) - 0.5;
    const s1 = pCyl(2.3, 2.3, 13, 0xb8bcc0, x, y0 + 6.5, z, 14), s2 = part(new THREE.SphereGeometry(2.3, 14, 6, 0, 6.2832, 0, 1.5708), 0x7a8086, x, y0 + 13, z);
    white.push(s1, s2);
    colliders.push({ x, z, r: 2.6, chunk: a.id });
  }
  yield;
  c.group.add(new THREE.Mesh(mergeGeos(g), poiMats().plain), new THREE.Mesh(mergeGeos(roofs), poiMats().plain), new THREE.Mesh(mergeGeos(white), poiMats().plain));
  // hay bales out in the fields
  const bales = [];
  for (let tries = 0; tries < 160 && bales.length < 26; tries++) {
    const th = th0 + (R() - 0.5) * 1.4, rr = isleCoastR(a, th) * (0.4 + 0.3 * R());
    const x = a.x + Math.cos(th) * rr, z = a.z + Math.sin(th) * rr;
    if (farmMask(a, x, z) > 0.8) bales.push([x, z]);
  }
  if (bales.length) {
    const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 10).rotateZ(1.5708), curved(new THREE.MeshLambertMaterial({ color: 0xcdb15a })), bales.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    bales.forEach(([x, z], i) => { e.set(0, R() * 3.14, 0); q.setFromEuler(e); im.setMatrixAt(i, m4.compose(p.set(x, ground(x, z) + 0.9, z), q, sc)); });
    im.frustumCulled = false;
    c.group.add(im);
  }
  yield;
}

// ===== The airport island: a runway, a terminal, a tower and a hangar, with planes landing and taking off all day =====
const planeGeo = (() => {
  let geo = null;
  return (tailColor) => {
    const key = tailColor;
    planeGeo.cache ||= {};
    return (planeGeo.cache[key] ||= (() => {
      const fus = new THREE.CylinderGeometry(1.5, 1.5, 20, 10).rotateX(1.5708);
      const nose = new THREE.ConeGeometry(1.5, 4.5, 10).rotateX(1.5708).translate(0, 0, 12.2);
      const tail = new THREE.ConeGeometry(1.5, 6, 10).rotateX(-1.5708).translate(0, 0.5, -13);
      const wing = (sd) => { const g = new THREE.BoxGeometry(11, 0.3, 3.6); g.translate(sd * 5.6, 0, 0); g.applyMatrix4(new THREE.Matrix4().makeRotationY(-sd * 0.4)); g.translate(0, -0.5, 0); return g; };
      return mergeGeos([
        { g: fus, color: 0xeef0f2 }, { g: nose, color: 0xdfe3e6 }, { g: tail, color: 0xdfe3e6 },
        { g: wing(-1), color: 0xbfc6cc }, { g: wing(1), color: 0xbfc6cc },
        { g: new THREE.BoxGeometry(0.25, 4.6, 3.4).translate(0, 3.6, -11.5), color: tailColor },
        { g: new THREE.BoxGeometry(7, 0.22, 2.2).translate(0, 1.0, -12), color: 0xbfc6cc },
        { g: new THREE.CylinderGeometry(0.7, 0.7, 3, 8).rotateX(1.5708).translate(-3.8, -1.5, 0.5), color: 0x8a9096 },
        { g: new THREE.CylinderGeometry(0.7, 0.7, 3, 8).rotateX(1.5708).translate(3.8, -1.5, 0.5), color: 0x8a9096 },
        { g: new THREE.BoxGeometry(2.2, 0.6, 1.4).translate(0, 1.0, 9.5), color: 0x20303a },
        { g: new THREE.BoxGeometry(3.04, 0.35, 16).translate(0, 0.45, 0), color: tailColor },
      ]);
    })());
  };
})();
function* extrasAirport(c) {
  const a = c.a;
  const Hl = Math.min(0.55 * a.r, 190), ang = a.p1;
  const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux; // along the runway, and across it
  const W2 = (s, l) => [a.x + s * ux + l * vx, a.z + s * uz + l * vz];
  const gy = bedHeightJS(a.x, a.z);
  // runway and apron as textured slabs
  const rwTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = 1024; cv.height = 128;
    const g = cv.getContext("2d");
    g.fillStyle = "#35373a"; g.fillRect(0, 0, 1024, 128);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${80 + Math.random() * 60},${80 + Math.random() * 60},${85 + Math.random() * 60},0.15)`; g.fillRect(Math.random() * 1024, Math.random() * 128, 2, 2); }
    g.fillStyle = "#e9e9e4";
    for (let x = 90; x < 930; x += 70) g.fillRect(x, 62, 40, 5);
    g.fillRect(8, 6, 1008, 3); g.fillRect(8, 119, 1008, 3);
    for (let k = 0; k < 6; k++) { g.fillRect(24, 22 + k * 15, 40, 7); g.fillRect(960, 22 + k * 15, 40, 7); }
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t;
  })();
  const slab = (w, d, mat, s, l, y, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-1.5708), mat);
    const [x, z] = W2(s, l);
    m.position.set(x, y, z);
    m.rotation.y = -ang + (rot || 0);
    return m;
  };
  const rwMat = curved(new THREE.MeshStandardMaterial({ map: rwTex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  const concrete = curved(new THREE.MeshStandardMaterial({ color: 0x8e8f8c, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  c.group.add(slab(2 * Hl + 30, 38, rwMat, 0, 0, gy + 0.07), slab(150, 50, concrete, 40, 62, gy + 0.06), slab(14, 60, concrete, Hl - 25, 30, gy + 0.06), slab(2 * Hl + 30, 12, concrete, 0, 46, gy + 0.05));
  yield;
  // buildings
  const parts = [], glass = [], roofs = [];
  const bld = (s, l, w, d, h, color) => {
    const [x, z] = W2(s, l), y0 = gy - 0.2;
    parts.push(part(new THREE.BoxGeometry(w, h, d).applyMatrix4(new THREE.Matrix4().makeRotationY(-ang)), color, x, y0 + h / 2, z));
    colliders.push({ x, z, hw: w / 2, hd: d / 2, rot: -ang, top: y0 + h + 2, chunk: a.id });
    return [x, z];
  };
  bld(60, 100, 62, 18, 12, 0xcfd3d6);
  { const [x, z] = W2(60, 90.6); glass.push(part(new THREE.BoxGeometry(60, 5, 0.4).applyMatrix4(new THREE.Matrix4().makeRotationY(-ang)), 0xffffff, x, gy + 5, z)); }
  roofs.push(part(new THREE.BoxGeometry(66, 0.8, 22).applyMatrix4(new THREE.Matrix4().makeRotationY(-ang)), 0x6a7480, ...W2(60, 100).map((v, i) => (i ? 0 : v)).slice(0, 1), gy + 12.2, W2(60, 100)[1]));
  const hang = bld(-70, 108, 44, 30, 14, 0x8d98a2);
  bld(125, 82, 4, 4, 30, 0xd8dadc); // the tower shaft
  { const [x, z] = W2(125, 82); glass.push(part(new THREE.CylinderGeometry(5, 4, 5, 10), 0xffffff, x, gy + 31.5, z)); roofs.push(part(new THREE.CylinderGeometry(5.6, 5.6, 0.8, 10), 0x6a7480, x, gy + 34.4, z)); }
  for (let i = 0; i < 3; i++) { const [x, z] = W2(-20 + i * 14, 138); parts.push(pCyl(5, 5, 9, 0xc9ccce, x, gy + 4.3, z, 14)); }
  yield;
  c.group.add(new THREE.Mesh(mergeGeos(parts), poiMats().plain), new THREE.Mesh(mergeGeos(roofs), poiMats().plain));
  const glassMat = c.glass = curved(new THREE.MeshStandardMaterial({ color: 0x223040, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.2, metalness: 0.2 }));
  c.group.add(new THREE.Mesh(mergeGeos(glass), glassMat));
  // runway lights: white edges, green and red ends, strobes leading in; a windsock
  const lp = [], lc = [];
  for (let s = -Hl; s <= Hl; s += 18) for (const l of [-19.5, 19.5]) { const [x, z] = W2(s, l); lp.push(x, gy + 0.3, z); lc.push(1, 0.95, 0.8); }
  for (const l of [-17, -9, 0, 9, 17]) { const [x, z] = W2(-Hl - 12, l); lp.push(x, gy + 0.3, z); lc.push(0.2, 1, 0.3); const [x2, z2] = W2(Hl + 12, l); lp.push(x2, gy + 0.3, z2); lc.push(1, 0.2, 0.15); }
  const strobeStart = lp.length / 3;
  for (let s = -Hl - 30; s > -Hl - 330; s -= 30) { const [x, z] = W2(s, 0); lp.push(x, gy + 1.0, z); lc.push(1, 1, 1); }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
  lg.setAttribute("color", new THREE.Float32BufferAttribute(lc, 3));
  const lm = curved(new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const lights = new THREE.Points(lg, lm);
  lights.frustumCulled = false;
  c.group.add(lights);
  yield;
  // the planes
  const T = 120, Pk = 6;
  const spots = [[60, 62], [14, 62]];
  const cols = [0xc23a2a, 0x2f6fb0, 0x2a8a6a];
  const planes = [0, 30, 60].slice(0, 2).map((off, k) => {
    const mesh = new THREE.Mesh(planeGeo(cols[k]), poiMats().plain);
    const nav = [[-10.6, 0xff2a20], [10.6, 0x30ff60]].map(([x, col]) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture, color: col, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.scale.setScalar(1.8);
      sp.position.set(x * 0.9, -0.5, -2.2);
      mesh.add(sp);
      return sp;
    });
    c.group.add(mesh);
    return { mesh, off, spot: spots[k], nav };
  });
  const lerpPath = (path, u) => { // path: [[s,l],...], u in 0..1 by length
    let total = 0; const seg = [];
    for (let i = 0; i + 1 < path.length; i++) { const L = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]); seg.push(L); total += L; }
    let d = clamp(u, 0, 1) * total;
    for (let i = 0; i < seg.length; i++) { if (d <= seg[i] || i === seg.length - 1) { const f = seg[i] ? d / seg[i] : 0; return [lerp(path[i][0], path[i + 1][0], f), lerp(path[i][1], path[i + 1][1], f)]; } d -= seg[i]; }
  };
  // the plane's position in the runway frame (s along, l across, alt) over its 120 s cycle
  const state = (tm, spot) => {
    const sTD = -Hl + 25, sEnd = Hl - 40;
    if (tm < 17) { const f = tm / 17; return [lerp(-Hl - 1000, sTD, f), 0, 70 * (1 - f) * (1 - f * 0.1) + 0]; }
    if (tm < 26) { const f = (tm - 17) / 9; return [lerp(sTD, sEnd, 1 - (1 - f) * (1 - f)), 0, 0]; }
    if (tm < 38) { const p = lerpPath([[sEnd, 0], [sEnd - 10, 28], [spot[0] + 25, 50], spot], (tm - 26) / 12); return [p[0], p[1], 0]; }
    if (tm < 62) return [spot[0], spot[1], 0];
    if (tm < 76) { const p = lerpPath([spot, [spot[0] + 25, 50], [Hl - 20, 40], [Hl - 8, 0]], (tm - 62) / 14); return [p[0], p[1], 0]; }
    if (tm < 80) return [Hl - 8, 0, 0];
    if (tm < 92) { const t = tm - 80; return [Hl - 8 - 0.5 * 4 * t * t, 0, 0]; } // rolling: lifts off at ~40 m/s
    const t = tm - 92, s0 = Hl - 8 - 0.5 * 4 * 144;
    if (tm < 120) return [s0 - 46 * t - 2 * t * t, 0, Math.min(1400, 7 * t * t * 0.9 + 4 * t)];
    return [s0 - 46 * 28 - 1600, 0, 400];
  };
  const wp = new THREE.Vector3(), wp2 = new THREE.Vector3();
  c.updaters.push((t, dt, lampsOn) => {
    lm.opacity = 0.25 + 0.75 * lampsOn;
    // strobes chase toward the runway
    lights.material.size = 3 + 1.5 * (Math.floor(t * 2) % 2);
    glassMat.emissiveIntensity = 1.3 * lampsOn;
    for (const pl of planes) {
      const tm = (t + pl.off) % T;
      const A = state(tm, pl.spot), B = state(tm + 0.2, pl.spot);
      const [x, z] = W2(A[0], A[1]), [x2, z2] = W2(B[0], B[1]);
      const d = Math.hypot(camPos.x - x, camPos.z - z);
      pl.mesh.visible = d < 1700 && A[0] > -Hl - 1500;
      if (!pl.mesh.visible) continue;
      const moving = Math.hypot(x2 - x, z2 - z) > 0.005;
      const yawP = moving ? Math.atan2(x2 - x, z2 - z) : pl.mesh.rotation.y;
      const pitch = moving ? Math.atan2(B[2] - A[2], Math.hypot(x2 - x, z2 - z)) : 0;
      pl.mesh.position.set(x, gy + 1.9 + A[2], z);
      pl.mesh.rotation.set(-pitch * 0.9, yawP, 0, "YXZ");
      const blink = Math.sin(t * 6 + pl.off) > 0.6 ? 1 : 0.2;
      for (const n of pl.nav) n.material.opacity = (0.3 + 0.7 * lampsOn) * blink;
    }
  });
  yield;
}

