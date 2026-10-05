"use strict";
// ===== Out at sea (from Coastline): ships, an oil rig, wind farms, and the birds and aeroplanes overhead =====
const _sm = {};
const shipMat = (color, extra = {}) => {
  const key = color + JSON.stringify(extra);
  return (_sm[key] ||= curved(new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra })));
};
function hullGeometry(len, beam, height, draft) {
  const s = new THREE.Shape();
  const hl = len / 2, hb = beam / 2;
  s.moveTo(-hb * 0.85, -hl);
  s.lineTo(hb * 0.85, -hl);
  s.lineTo(hb, hl * 0.35);
  s.quadraticCurveTo(hb * 0.9, hl * 0.85, 0, hl);
  s.quadraticCurveTo(-hb * 0.9, hl * 0.85, -hb, hl * 0.35);
  s.lineTo(-hb * 0.85, -hl);
  const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(-Math.PI / 2); // bow toward -Z
  g.translate(0, -draft, 0);
  return g;
}
const sbox = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
const shipGlow = (color) => { const m = curved(new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 0 })); m.userData.shared = false; return m; };
function mastLight(parent, x, y, z) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([x, y, z], 3));
  const mat = curved(new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, color: 0xfff4dd, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  mat.userData.shared = false;
  parent.add(new THREE.Points(geo, mat));
  return mat;
}
const SHIPS = {
  sailboat() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(hullGeometry(9, 2.8, 1.4, 0.6), shipMat(0xf4f4f0)));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 12, 6), shipMat(0xcccccc));
    mast.position.set(0, 6.8, -0.8);
    g.add(mast);
    const sailMat = shipMat(0xfbfaf4, { side: THREE.DoubleSide });
    const tri = (pts) => { const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)); geo.computeVertexNormals(); return new THREE.Mesh(geo, sailMat); };
    g.add(tri([0, 1.4, -0.7, 0, 12.4, -0.7, 0, 1.6, 3.4]), tri([0, 1.4, -1.0, 0, 11.5, -0.9, 0, 1.2, -4.3]));
    return { group: g, light: mastLight(g, 0, 12.9, -0.8), speed: 4, heel: 0.18 };
  },
  tourboat() {
    const g = new THREE.Group(), hull = shipMat(0xf2f2ee);
    for (const side of [-1, 1]) { const p = new THREE.Mesh(hullGeometry(15, 1.6, 1.6, 0.8), hull); p.position.x = side * 2.6; g.add(p); }
    g.add(sbox(6.8, 0.4, 13, shipMat(0x9c7a55), 0, 1.0, 0.3));
    for (const [x, z] of [[-3, -4], [3, -4], [-3, 5], [3, 5]]) g.add(sbox(0.12, 2.4, 0.12, hull, x, 2.4, z));
    g.add(sbox(7, 0.2, 11, shipMat(0x2fb39a), 0, 3.6, 0.5));
    return { group: g, light: mastLight(g, 0, 4.2, -3), speed: 5 };
  },
  ferry() {
    const g = new THREE.Group(), white = shipMat(0xf4f4f0), windows = shipGlow(0xffd9a0);
    g.add(new THREE.Mesh(hullGeometry(70, 14, 7, 3), shipMat(0x1f3f6e)), sbox(13.5, 0.9, 62, white, 0, 4.4, 2), sbox(12, 4, 44, white, 0, 6.8, 6), sbox(10, 3.5, 30, white, 0, 10.5, 8), sbox(12.2, 1, 42, windows, 0, 7.2, 6), sbox(10.2, 1, 28, windows, 0, 10.9, 8));
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 5, 12), white);
    funnel.position.set(0, 14.5, 18);
    g.add(funnel, sbox(3.4, 1.4, 3.4, shipMat(0xc0392b), 0, 16.8, 18));
    return { group: g, light: mastLight(g, 0, 17, -8), windows, speed: 9 };
  },
  tanker() {
    const g = new THREE.Group(), windows = shipGlow(0xffe0b0);
    g.add(new THREE.Mesh(hullGeometry(180, 30, 10, 7), shipMat(0x7a2a22)), sbox(29, 3, 172, shipMat(0x1c1c1c), 0, 1.6, -2), sbox(27, 0.4, 160, shipMat(0x566457), 0, 3.3, -6));
    for (let k = 0; k < 8; k++) g.add(sbox(2, 1.2, 150, shipMat(0x9aa39a), -8 + (k % 4) * 5, 4, -8));
    g.add(sbox(24, 14, 14, shipMat(0xf1eee6), 0, 10, 70), sbox(24.2, 1.2, 14.2, windows, 0, 14.5, 70));
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3, 8, 12), shipMat(0x1c1c1c));
    funnel.position.set(0, 21, 76);
    g.add(funnel);
    return { group: g, light: mastLight(g, 0, 22, 62), windows, speed: 7 };
  },
  cruise() {
    const g = new THREE.Group(), white = shipMat(0xf6f5f0), windows = shipGlow(0xffe3b0);
    g.add(new THREE.Mesh(hullGeometry(150, 26, 10, 6), shipMat(0x1d2f52)), sbox(25.5, 3, 140, white, 0, 5.5, 2));
    for (const [w, h, d, y] of [[24, 4, 118, 9], [22, 4, 108, 13], [20, 4, 96, 17], [17, 3.5, 70, 20.75]]) g.add(sbox(w, h, d, white, 0, y, 6), sbox(w + 0.2, 1, d - 2, windows, 0, y + 0.3, 6));
    g.add(sbox(25.7, 0.8, 136, windows, 0, 5.5, 2), sbox(14, 3, 12, shipMat(0x2b4a7a), 0, 24.5, -36), sbox(9, 0.4, 16, shipMat(0x3fb7d9), 0, 22.7, 22), sbox(7, 9, 12, shipMat(0xc0392b), 0, 28, 40), sbox(7.2, 2, 12.2, shipMat(0x1d2f52), 0, 33.4, 40));
    return { group: g, light: mastLight(g, 0, 31, -36), windows, speed: 8 };
  },
  cargo() {
    const g = new THREE.Group(), windows = shipGlow(0xffe0b0);
    g.add(new THREE.Mesh(hullGeometry(170, 28, 11, 8), shipMat(0x8a2a24)), sbox(27.5, 3, 160, shipMat(0x1d2a3a), 0, 2.2, 0));
    const colors = [0xb83a2e, 0x2f6aa8, 0x3f8f4a, 0xe08a2c, 0x8e9499, 0xe6c64a, 0x6b3e8a, 0xf2f2ee], slots = [];
    for (let bay = 0; bay < 11; bay++) for (let col = 0; col < 9; col++) { const tiers = 2 + Math.floor(Math.random() * 4); for (let t = 0; t < tiers; t++) slots.push([-10 + col * 2.5, 5.1 + t * 2.6, -68 + bay * 12.8]); }
    const cont = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 2.5, 12.2), shipMat(0xffffff), slots.length), m = new THREE.Matrix4(), c = new THREE.Color();
    slots.forEach(([x, y, z], i) => { cont.setMatrixAt(i, m.makeTranslation(x, y, z)); cont.setColorAt(i, c.setHex(colors[Math.floor(Math.random() * colors.length)]).multiplyScalar(0.85 + Math.random() * 0.25)); });
    cont.frustumCulled = false;
    g.add(cont, sbox(26, 16, 12, shipMat(0xf1eee6), 0, 11, 75), sbox(26.2, 1.2, 12.2, windows, 0, 16.5, 75));
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 9, 12), shipMat(0x1d2a3a));
    funnel.position.set(0, 23, 80);
    g.add(funnel);
    return { group: g, light: mastLight(g, 0, 24, 68), windows, speed: 8 };
  },
  coastguard() {
    const g = new THREE.Group(), blue = shipGlow(0x3b8bff), red = shipGlow(0xff3b3b);
    g.add(new THREE.Mesh(hullGeometry(16, 4.4, 2.4, 0.9), shipMat(0xf4f4f0)), sbox(3.4, 2.2, 5, shipMat(0x9aa3ab), 0, 2.6, 1.5), sbox(0.8, 0.3, 0.4, blue, -0.5, 3.9, 1), sbox(0.8, 0.3, 0.4, red, 0.5, 3.9, 1));
    return { group: g, light: mastLight(g, 0, 5, 1.5), blue, red, speed: 10 };
  },
};
function shipRunner(group, model, pathFn, offset) {
  model.group.rotation.order = "YXZ";
  group.add(model.group);
  let s = offset;
  return (t, dt, lampsOn) => {
    s += model.speed * dt;
    const p = pathFn(s), q = pathFn(s + 2);
    const x = p[0], z = p[1];
    const d = Math.hypot(camPos.x - x, camPos.z - z);
    model.group.visible = d < 2400;
    if (!model.group.visible) return;
    model.group.position.set(x, waveHeight(x, z, t) * 0.9, z);
    model.group.rotation.set(Math.sin(t * 0.7 + s) * 0.035, Math.atan2(-(q[0] - x), -(q[1] - z)), (model.heel || 0) + Math.sin(t * 0.9 + s) * 0.04);
    if (model.light) model.light.opacity = lampsOn * (1 - 0.85 * wx.fog);
    if (model.windows) model.windows.emissiveIntensity = 1.4 * lampsOn;
    if (model.blue) { const f = Math.floor(t * 3) % 2; model.blue.emissiveIntensity = f ? 3 : 0.2; model.red.emissiveIntensity = f ? 0.2 : 3; }
  };
}
// a closed loop round an island's coast, or an ellipse in open water
const islandLoop = (a, off) => { const Ra = a.r + off; return (s) => { const th = s / Ra; const r = isleCoastR(a, th) + off; return [a.x + Math.cos(th) * r, a.z + Math.sin(th) * r]; }; };
const ellipseLoop = (cx, cz, rx, rz, dir = 1) => (s) => { const ang = (dir * s) / ((rx + rz) / 2); return [cx + Math.cos(ang) * rx, cz + Math.sin(ang) * rz]; };

// ----- oil rig -----
const seaObstacles = [];
function* extrasRig(c) {
  const a = c.a;
  const legs = [], steel = [], white = [], red = [], blue = [], dark = [], gold = [];
  const Y = 0xd9b23a;
  for (const [lx, lz] of [[-18, -14], [18, -14], [-18, 14], [18, 14]]) { gold.push(pCyl(2.4, 2.8, 48, Y, lx, -8, lz, 14)); dark.push(pCyl(3.4, 3.4, 2.5, 0x2b3034, lx, 0.5, lz, 14)); }
  for (const y of [4, 11]) {
    steel.push(pCyl(0.6, 0.6, 36, 0x8d949b, 0, y, -14, 8, 0, 0, 1.5708), pCyl(0.6, 0.6, 36, 0x8d949b, 0, y, 14, 8, 0, 0, 1.5708), pCyl(0.6, 0.6, 28, 0x8d949b, -18, y, 0, 8, 1.5708), pCyl(0.6, 0.6, 28, 0x8d949b, 18, y, 0, 8, 1.5708));
  }
  steel.push(pBox(46, 3, 38, 0x8d949b, 0, 17, 0)); dark.push(pBox(42, 3, 32, 0x2b3034, 0, 23, 0));
  white.push(pBox(14, 8, 10, 0xe8e6df, -12, 28.5, -8), pBox(8, 10, 8, 0xe8e6df, -14, 29.5, 10), pBox(3.4, 0.2, 1, 0xe8e6df, -26, 33.4, 0));
  blue.push(pBox(10, 6, 12, 0x2e5c8a, 6, 27.5, -9)); red.push(pBox(12, 5, 8, 0xb5382c, 10, 27, 9));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) gold.push(pCyl(0.25, 0.25, 46, Y, 4 + sx * 3.2, 47, 4 + sz * 3.2, 6, -sz * 0.1, 0, sx * 0.1));
  for (let k = 0; k < 7; k++) { const y = 28 + k * 6, w = 7.6 - k * 0.85; gold.push(pBox(w, 0.25, 0.25, Y, 4, y, 4 - w / 2), pBox(w, 0.25, 0.25, Y, 4, y, 4 + w / 2), pBox(0.25, 0.25, w, Y, 4 - w / 2, y, 4), pBox(0.25, 0.25, w, Y, 4 + w / 2, y, 4)); }
  gold.push(pCyl(1, 1.2, 6, Y, 16, 28, -4, 10), pCyl(0.35, 0.5, 30, Y, 26, 36, -4, 6, 0, 0, -1.1));
  steel.push(pCyl(0.5, 0.7, 34, 0x8d949b, 24, 34, 22, 6, 0.75, 0, -0.75));
  white.push(pCyl(10, 10, 0.6, 0x2d5a3a, -26, 33, 0, 24));
  const root = new THREE.Group();
  for (const [list, col] of [[gold, 0], [steel, 0], [white, 0], [red, 0], [blue, 0], [dark, 0]]) if (list.length) root.add(new THREE.Mesh(mergeGeos(list), poiMats().plain));
  root.position.set(a.x, 0, a.z);
  root.rotation.y = 0.3;
  c.group.add(root);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(1.6, 6, 10), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  flame.position.set(36, 46.2, 31);
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture, color: 0xff9a40, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  fg.position.copy(flame.position);
  root.add(flame, fg);
  const lp = [], R = mulberry(a.seed * 5);
  for (let i = 0; i < 60; i++) lp.push(-22 + R() * 44, 18 + R() * 16, -17 + R() * 34);
  for (let k = 0; k < 8; k++) lp.push(4, 30 + k * 6, 4);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
  const lm = curved(new THREE.PointsMaterial({ color: 0xffe2a0, size: 3, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  root.add(new THREE.Points(lg, lm));
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a20, fog: false }));
  top.position.set(4, 70.5, 4);
  root.add(top);
  // the deck is somewhere to stand
  const s = { cx: a.x, cz: a.z, yaw: -0.3, hw: 21, hl: 18, y: 24.6 };
  poiSurfaces.push(s);
  c.surf = (c.surf || []).concat(s);
  const ob = { p: new THREE.Vector3(a.x, 0, a.z), r: 34 };
  seaObstacles.push(ob);
  c.obstacles = (c.obstacles || []).concat(ob);
  c.updaters.push((t, dt, lampsOn) => {
    const f = 0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3);
    flame.scale.set(f, 0.8 + 0.4 * f * Math.random(), f);
    fg.material.opacity = 0.35 + 0.65 * lampsOn;
    fg.scale.setScalar(18 + 22 * lampsOn);
    lm.opacity = lampsOn * (1 - 0.7 * wx.fog);
    top.visible = lampsOn < 0.3 || (t % 1.5) < 0.75;
  });
  yield;
}

// ----- wind turbines, at sea or on high ground -----
let _turb = null;
function turbGeos() {
  if (!_turb) {
    const white = 0xf2f2ef;
    const blade = (() => { const s = new THREE.Shape(); s.moveTo(-0.5, 1); s.lineTo(1.3, 3); s.lineTo(0.3, 38); s.lineTo(-0.1, 38); s.lineTo(-0.6, 3); return new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false }); })();
    _turb = {
      tower: new THREE.CylinderGeometry(1.3, 2.3, 80, 12).translate(0, 40, 0),
      head: mergeGeos([{ g: new THREE.BoxGeometry(3, 3.2, 9).translate(0, 0, -1), color: new THREE.Color(white) }, { g: new THREE.SphereGeometry(1.5, 10, 8).scale(1, 1, 1.4).translate(0, 0, 4.4), color: new THREE.Color(white) }]),
      blade, base: mergeGeos([{ g: new THREE.CylinderGeometry(2.6, 2.6, 16, 14).translate(0, -2, 0), color: new THREE.Color(0xe8c02a) }, { g: new THREE.CylinderGeometry(4, 4, 0.6, 14).translate(0, 6, 0), color: new THREE.Color(0xe8c02a) }]),
      mat: curved(new THREE.MeshStandardMaterial({ color: white, roughness: 0.45 })), matV: curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })),
    };
  }
  return _turb;
}
function addTurbines(c, list) {
  const G = turbGeos(), n = list.length;
  if (!n) return;
  const towers = new THREE.InstancedMesh(G.tower, G.mat, n), heads = new THREE.InstancedMesh(G.head, G.matV, n), blades = new THREE.InstancedMesh(G.blade, G.mat, n * 3);
  const bases = list.filter((t) => t.offshore).length ? new THREE.InstancedMesh(G.base, G.matV, list.filter((t) => t.offshore).length) : null;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), qr = new THREE.Quaternion(), mr = new THREE.Matrix4();
  let bi = 0;
  list.forEach((tb, i) => {
    tb.top = tb.offshore ? 6 : tb.ground;
    towers.setMatrixAt(i, m4.makeTranslation(tb.x, tb.top, tb.z));
    if (tb.offshore) { bases.setMatrixAt(bi++, m4.makeTranslation(tb.x, 0, tb.z)); const ob = { p: new THREE.Vector3(tb.x, 0, tb.z), r: 5 }; seaObstacles.push(ob); (c.obstacles ||= []).push(ob); }
    tb.ph = Math.random(); tb.rot = Math.random() * 6; tb.yaw = 0;
  });
  [towers, heads, blades, bases].forEach((m) => m && ((m.frustumCulled = false), c.group.add(m)));
  const lampG = new THREE.BufferGeometry();
  lampG.setAttribute("position", new THREE.Float32BufferAttribute(list.flatMap((t) => [t.x, t.top + 83.5, t.z]), 3));
  const lampM = curved(new THREE.PointsMaterial({ color: 0xff2a20, size: 4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  const lamps = new THREE.Points(lampG, lampM);
  lamps.frustumCulled = false;
  c.group.add(lamps);
  c.updaters.push((t, dt, lampsOn) => {
    const yaw = Math.atan2(-Math.cos(weather.windAngle), -Math.sin(weather.windAngle));
    const spin = (0.35 + weather.windSpeed * 0.07) * (1 - 0.8 * (wx.storm > 0.9 ? 1 : 0));
    list.forEach((tb, i) => {
      tb.yaw += wrapAngle(yaw - tb.yaw) * Math.min(1, dt * 0.2);
      tb.rot -= spin * dt;
      q.setFromAxisAngle(p.set(0, 1, 0), tb.yaw);
      heads.setMatrixAt(i, m4.compose(p.set(tb.x, tb.top + 81.5, tb.z), q, one));
      for (let k = 0; k < 3; k++) {
        // a blade: turn about the hub's axis, then follow the head's yaw, out at the hub
        e.set(0, tb.yaw, 0);
        qr.setFromEuler(e);
        const spinQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tb.rot + (k * Math.PI * 2) / 3);
        qr.multiply(spinQ);
        const hub = new THREE.Vector3(0, 0, 4.6).applyQuaternion(q);
        blades.setMatrixAt(i * 3 + k, m4.compose(p.set(tb.x + hub.x, tb.top + 81.5 + hub.y, tb.z + hub.z), qr, one));
      }
    });
    heads.instanceMatrix.needsUpdate = blades.instanceMatrix.needsUpdate = true;
    lampM.opacity = (lampsOn < 0.3 || (t % 2) < 1 ? 1 : 0) * 0.9;
  });
}
function* extrasWind(c) {
  const a = c.a, R = mulberry(a.seed * 23 + 1), list = [];
  const cols = 3 + Math.floor(R() * 2), rows = 2 + Math.floor(R() * 2), sp = 150;
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) list.push({ x: a.x + (k - (cols - 1) / 2) * sp + (r % 2) * 55, z: a.z + (r - (rows - 1) / 2) * 190, offshore: true, ground: 0 });
  addTurbines(c, list);
  c.deck = { x: list[0].x, z: list[0].z };
  const s = { cx: list[0].x, cz: list[0].z, yaw: 0, hw: 3, hl: 3, y: 6.5 };
  poiSurfaces.push(s);
  c.surf = (c.surf || []).concat(s);
  yield;
}
function* extrasHillTurbines(c) {
  const a = c.a;
  if (a.type !== 1 || a.r < 150) return;
  if (islandPOIs(a).some((p) => p.def.id === "forestShrine")) return; // a shrine island is left quiet
  const R = mulberry(a.seed * 29 + 3), spots = [];
  for (let k = 0; k < 200; k++) {
    const th = R() * 6.2832, rr = R() * isleCoastR(a, th) * 0.7, x = a.x + Math.cos(th) * rr, z = a.z + Math.sin(th) * rr, h = bedHeightJS(x, z);
    if (h < 7 || (a.farm && farmMask(a, x, z) > 0.05) || nearRoad(a, x, z, 12) || poiKeepClear(a, x, z, 14)) continue;
    spots.push({ x, z, ground: h, offshore: false, h });
  }
  spots.sort((p, q) => q.h - p.h);
  const picks = [];
  for (const s of spots) if (picks.length < 3 && picks.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > 70)) picks.push(s);
  addTurbines(c, picks);
  yield;
}
function* extrasShips(c) {
  const a = c.a, R = mulberry(a.seed * 61 + 5);
  const kinds = ["tanker", "cruise", "cargo", "ferry", "tourboat", "sailboat"];
  const n = 1 + Math.floor(R() * 2);
  for (let k = 0; k < n; k++) {
    const kind = kinds[Math.floor(R() * kinds.length)], model = SHIPS[kind]();
    const rx = 300 + R() * 150, rz = 240 + R() * 120;
    c.updaters.push(shipRunner(c.group, model, ellipseLoop(a.x, a.z, rx, rz, k ? -1 : 1), R() * 3000));
    yield;
  }
}
// small boats round an island's coast
function* extrasIslandBoats(c) {
  const a = c.a;
  if (hash3(a.i, a.j, 40) > 0.6) return;
  const R = mulberry(a.seed * 83 + 9), kinds = ["sailboat", "sailboat", "tourboat", "coastguard"];
  const model = SHIPS[kinds[Math.floor(R() * kinds.length)]]();
  c.updaters.push(shipRunner(c.group, model, islandLoop(a, 130 + R() * 90), R() * 2000));
  yield;
}

// ----- the home island's own boats, the birds, and the aeroplanes -----
const seaLife = (() => {
  const group = new THREE.Group();
  scene.add(group);
  const runners = [];
  runners.push(shipRunner(group, SHIPS.sailboat(), ellipseLoop(ISL.x, ISL.z, ISL.r + 280, ISL.r + 250), 0));
  runners.push(shipRunner(group, SHIPS.coastguard(), ellipseLoop(ISL.x, ISL.z, ISL.r + 340, ISL.r + 300, -1), 400));
  // gulls (Coastline's flock): they circle where the fish are leaping, and now and then one dives
  const birdMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide });
  const body = new THREE.SphereGeometry(0.12, 8, 6); body.scale(1, 0.8, 3);
  const wing = (side) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(side < 0 ? [0, 0, -0.18, 0, 0, 0.14, -0.95, 0, 0.06] : [0, 0, 0.14, 0, 0, -0.18, 0.95, 0, 0.06], 3)); g.computeVertexNormals(); return g; };
  const wL = wing(-1), wR = wing(1);
  const birds = [], flock = { x: ISL.x, z: ISL.z + ISL.r + 90 };
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    g.rotation.order = "YXZ";
    g.add(new THREE.Mesh(body, birdMat));
    const L = new THREE.Mesh(wL, birdMat), Rw = new THREE.Mesh(wR, birdMat);
    L.position.x = -0.06; Rw.position.x = 0.06;
    g.add(L, Rw);
    group.add(g);
    birds.push({ g, L, R: Rw, radius: rand(18, 48), angle: rand(0, 6.28), angSpeed: rand(0.25, 0.5) * (Math.random() < 0.3 ? -1 : 1), alt: rand(14, 30), phase: rand(0, 10), dive: -1 });
  }
  // aeroplanes: a sightseeing plane circling the island you are at, and airliners crossing the sky
  const small = (() => {
    const g = new THREE.Group(), white = shipMat(0xf4f4f0);
    const bodyM = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.35, 8, 10), white);
    bodyM.rotation.x = Math.PI / 2;
    const prop = sbox(0.1, 2, 0.12, shipMat(0x333333), 0, 0, -4.1);
    g.add(bodyM, sbox(11, 0.2, 1.6, shipMat(0xd9342b), 0, 0.5, -0.8), sbox(3.6, 0.15, 1, white, 0, 0.2, 3.6), sbox(0.15, 1.4, 1, white, 0, 0.8, 3.7), prop);
    group.add(g);
    return { g, prop, cx: ISL.x, cz: ISL.z, a: 0 };
  })();
  const liners = [0, 1].map((k) => { const mesh = new THREE.Mesh(planeGeo(k ? 0x2f6fb0 : 0xc23a2a), poiMats().plain); mesh.scale.setScalar(1.6); group.add(mesh); return { mesh, k }; });
  return {
    update(t, dt, lampsOn, light) {
      for (const r of runners) r(t, dt, lampsOn);
      // gulls
      const visible = light > 0.25 && wx.storm < 0.5;
      const toX = boil.x - flock.x, toZ = boil.z - flock.z, away = Math.hypot(toX, toZ), step = Math.min(away, 12 * dt);
      if (away > 0.01) { flock.x += (toX / away) * step; flock.z += (toZ / away) * step; }
      const feeding = away < 40;
      for (const b of birds) {
        b.g.visible = visible && Math.hypot(camPos.x - flock.x, camPos.z - flock.z) < 700;
        if (!b.g.visible) continue;
        b.angle += b.angSpeed * dt;
        const dir = Math.sign(b.angSpeed), x = flock.x + Math.cos(b.angle) * b.radius, z = flock.z + Math.sin(b.angle) * b.radius;
        let y = b.alt + Math.sin(t * 0.5 + b.phase) * 2;
        if (b.dive < 0 && feeding && Math.random() < dt * 0.06) b.dive = 0;
        if (b.dive >= 0) {
          const before = b.dive;
          b.dive += dt / 2.2;
          if (before < 0.5 && b.dive >= 0.5) splash(x, waveHeight(x, z, t), z, 8, 1.6);
          if (b.dive >= 1) b.dive = -1;
          else y = lerp(y, 0.3, Math.sin(Math.PI * b.dive));
        }
        b.g.position.set(x, y, z);
        b.g.rotation.set(0, Math.atan2(Math.sin(b.angle) * dir, -Math.cos(b.angle) * dir), -0.35 * dir);
        const flap = Math.sin(t * 0.7 + b.phase) > 0.2 ? 1 : 0.15, w = Math.sin(t * 9 + b.phase) * 0.6 * flap + 0.1;
        b.L.rotation.z = -w; b.R.rotation.z = w;
      }
      // the sightseeing plane circles whichever island is nearest you
      const I = curIsland(camPos.x, camPos.z);
      small.cx += (I.x - small.cx) * Math.min(1, dt * 0.2);
      small.cz += (I.z - small.cz) * Math.min(1, dt * 0.2);
      const rad = I.r + 260;
      small.a += (30 / rad) * dt;
      small.g.position.set(small.cx + Math.cos(small.a) * rad, 130, small.cz + Math.sin(small.a) * rad);
      small.g.rotation.set(0, Math.atan2(Math.sin(small.a), -Math.cos(small.a)), -0.25);
      small.prop.rotation.z += dt * 40;
      small.g.visible = light > 0.3 && wx.storm < 0.5 && wx.fog < 0.3;
      // airliners crossing the world on long straight legs, high up
      for (const l of liners) {
        const len = 9000, u = ((t * 70 + l.k * 4500) % len) / len, dirn = l.k ? -1 : 1;
        const x = lerp(-4500, 4500, dirn > 0 ? u : 1 - u), z = l.k ? 1400 : -1900;
        l.mesh.position.set(x, 520 + l.k * 90, z + Math.sin(u * 6) * 300);
        l.mesh.rotation.y = Math.atan2(dirn, 0.05);
        l.mesh.visible = wx.fog < 0.7;
      }
    },
  };
})();

// ===== The planet: climb high enough and the world is a small round planet with a thin atmosphere, a sun, a moon and the stars =====
// As you rise, uCurve grows from a gentle bend (sea level) to the planet's true curvature, so the flat world wraps round a sphere.
// The sea and the far side of the world are painted on a real sphere (a map baked from the same height function the water and land use),
// lit by the real sun and moon, with clouds, city lights on the night side, and an atmosphere you see edge-on at the limb.
const ATMO_H = 1300; // (a thin atmosphere hugging the ground)
const spaceState = { alt: 0, dark: 0, fade: 0, vis: 0, cloudFade: 0 };

// ----- the map of the world, baked in the background -----
const MF = 640; // map pixels along one face (65 m each)
const MAP_W = MF * 3, MAP_H = MF * 2; // the six faces side by side
const mapData = new Uint8Array(MAP_W * MAP_H * 4), lightData = new Uint8Array(MAP_W * MAP_H * 4);
const mkTex = (data) => {
  const t = new THREE.DataTexture(data, MAP_W, MAP_H, THREE.RGBAFormat);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
};
const worldMapTex = mkTex(mapData), worldLightTex = mkTex(lightData);
const mapBake = { ready: 1, gen: null, done: 0 };
// the planet seen from far away: every face is drawn once, from the same functions the streamed islands use, nearest face first
function* bakeWorldMap() {
  const H = new Float32Array(MF * MF);
  const dx = FACE_W / MF;
  const order = [0, 1, 2, 3, 4, 5].sort((p, q) => Math.hypot(FACE_C[p][0] - player.x, FACE_C[p][1] - player.z) - Math.hypot(FACE_C[q][0] - player.x, FACE_C[q][1] - player.z));
  for (const f of order) {
    const col0 = (f % 3) * MF, row0 = Math.floor(f / 3) * MF, X0 = FACE_C[f][0] - FACE_W / 2, Z0 = FACE_C[f][1] - FACE_W / 2;
    for (let j = 0; j < MF; j++) {
      for (let i = 0; i < MF; i++) H[j * MF + i] = bedHeightJS(X0 + (i + 0.5) * dx, Z0 + (j + 0.5) * dx);
      if (j % 2 === 1) yield;
    }
    for (let j = 0; j < MF; j++) {
      for (let i = 0; i < MF; i++) {
        const k = (row0 + j) * MAP_W + col0 + i, x = X0 + (i + 0.5) * dx, z = Z0 + (j + 0.5) * dx, h = H[j * MF + i];
        let r = 0, g = 0, b = 0, a = 0, lr = 0, lg = 0;
        if (h < 0) {
          a = Math.round(255 * 0.9 * (1 - smooth(1, 6.5, -h)));
        } else {
          a = 255;
        const isl = isleCellOf(x, z), ty = isl.type;
        const hl = H[j * MF + Math.max(0, i - 1)], hr = H[j * MF + Math.min(MF - 1, i + 1)], hu = H[Math.max(0, j - 1) * MF + i], hd = H[Math.min(MF - 1, j + 1) * MF + i];
        const slope = Math.hypot(hr - hl, hd - hu) / (2 * dx);
        const n = vnz(x / 40, z / 40, 51);
        if (h < 1.3) [r, g, b] = [0.86, 0.78, 0.58];
        else if (ty === 2) {
          const q = Math.hypot(x - isl.x, z - isl.z) / isleCoastR(isl, Math.atan2(z - isl.z, x - isl.x));
          if (q < 0.085) (r = 1), (g = 0.36), (b = 0.08), (lg = 255);
          else if (h > isl.h * 0.55) [r, g, b] = [0.3, 0.27, 0.25];
          else if (h > 5) [r, g, b] = [0.13 + 0.05 * n, 0.12 + 0.05 * n, 0.11];
          else [r, g, b] = [0.2, 0.36, 0.14];
        } else if (ty === 3) [r, g, b] = h > 2.5 ? [0.66 - 0.1 * n, 0.58 - 0.1 * n, 0.4] : [0.3, 0.45, 0.18];
        else if (ty === 4) [r, g, b] = [0.2 + 0.05 * n, 0.27 + 0.05 * n, 0.12];
        else if (ty === 5) {
          const gx = (((x - isl.x) % 30) + 30) % 30, gz = (((z - isl.z) % 30) + 30) % 30;
          [r, g, b] = gx < 7 || gz < 7 ? [0.32, 0.32, 0.34] : [0.55 + 0.1 * n, 0.55 + 0.1 * n, 0.57];
          if (h > 1.5 && hash3(Math.floor(x / 12), Math.floor(z / 12), 60) < 0.5) lr = 255;
        } else if (ty === 6) {
          [r, g, b] = [0.62, 0.64, 0.66];
          const ux = Math.cos(isl.p1), uz = Math.sin(isl.p1), s = (x - isl.x) * ux + (z - isl.z) * uz, l = -(x - isl.x) * uz + (z - isl.z) * ux;
          if (Math.abs(l) < 18 && Math.abs(s) < Math.min(0.55 * isl.r, 190)) { [r, g, b] = [0.2, 0.2, 0.22]; if (Math.abs(Math.abs(l) - 19) < 5 && ((s + 400) % 36) < 12) lr = 255; }
        } else if (slope > 0.4) [r, g, b] = [0.46, 0.4, 0.35];
        else {
          [r, g, b] = [0.15 + 0.1 * n, 0.34 + 0.1 * n, 0.12];
          if (isl.farm && farmMask(isl, x, z) > 0.4) { const k2 = hash3(Math.floor(x / 50), Math.floor(z / 60), 61); [r, g, b] = k2 < 0.33 ? [0.78, 0.66, 0.3] : k2 < 0.66 ? [0.4, 0.62, 0.2] : [0.34, 0.24, 0.16]; }
        }
        const shade = 0.9 + clamp((hl - hr + hu - hd) * 0.05, -0.25, 0.25);
        r *= shade; g *= shade; b *= shade;
        }
        mapData[k * 4] = clamp(r * 255, 0, 255);
        mapData[k * 4 + 1] = clamp(g * 255, 0, 255);
        mapData[k * 4 + 2] = clamp(b * 255, 0, 255);
        mapData[k * 4 + 3] = a;
        lightData[k * 4] = lr;
        lightData[k * 4 + 1] = lg;
      }
      if (j % 2 === 1) yield;
    }
    worldMapTex.needsUpdate = true;
    worldLightTex.needsUpdate = true;
    mapBake.done++;
  }
}
mapBake.gen = bakeWorldMap();

// ----- the planet, its atmosphere, the sun, the moon, the stars and a few neighbours -----
// All of these are drawn as a background (before the world, with no depth test), so the real world always stands in front of them.
// The planet is a sphere traced exactly in the shader, with the same curvature as the world's droop (radius 1 / (2 uCurve)), so at sea
// level it is just the far sea, fading into the haze, and as you climb it shrinks to the little planet it really is.
const spaceGroup = new THREE.Group();
spaceGroup.visible = false;
scene.add(spaceGroup);
const earthSun = { value: new THREE.Vector3(0, 1, 0) }; // the sun's direction from the home planet, in the scene's axes
const planetU = Object.assign({}, shared, {
  uC: { value: new THREE.Vector3() }, uRs: { value: 150000 }, uSun: earthSun, uMoonP: { value: new THREE.Vector3() },
  uTX: { value: new THREE.Vector3(1, 0, 0) }, uTP: { value: new THREE.Vector3(0, 1, 0) }, uTZ: { value: new THREE.Vector3(0, 0, 1) }, // the local frame (east, up, south) in planet space
  uMap: { value: worldMapTex }, uLights: { value: worldLightTex }, uTime: shared.uTime, uCover: shared.uCloudCover, uCloudOff: shared.uCloudOffset,
  uMapReady: { value: 0 }, uHorizon: shared.uHorizon, uFogNear: waterUniforms.uFogNear, uFogFar: waterUniforms.uFogFar, uSpaceCover: { value: 0.5 },
});
const bgShellVert = "varying vec3 vW;\nvoid main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }";
const planet = new THREE.Mesh(
  new THREE.SphereGeometry(9000, 40, 20),
  new THREE.ShaderMaterial({
    uniforms: planetU,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    vertexShader: bgShellVert,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      ${NOISE_GLSL}
      ${CLOUD_GLSL}
      uniform vec3 uC; uniform float uRs; uniform vec3 uSun; uniform vec3 uMoonP; uniform vec3 uTX; uniform vec3 uTP; uniform vec3 uTZ;
      uniform sampler2D uMap; uniform sampler2D uLights; uniform float uCover; uniform vec2 uCloudOff; uniform float uMapReady;
      uniform float uFogNear; uniform float uFogFar; uniform float uSpaceCover;
      varying vec3 vW;
      // clouds drift over the whole globe: 3D noise on the direction, so there are no seams or poles
      float cloudAt(vec3 d) {
        vec3 q = d * 9.0 + vec3(uCloudOff.x, 0.0, uCloudOff.y) * 0.0000012 + vec3(uTime * 0.00012, 0.0, 0.0);
        float f = fbm3(q) * 0.9 + 0.18 * noise3(q * 5.0);
        return smoothstep(0.78 - 0.5 * uSpaceCover, 1.02 - 0.3 * uSpaceCover, f);
      }
      // where a direction falls in the map: the six faces side by side (the same cube-sphere the world is laid out on)
      vec2 mapUV(vec3 d) {
        vec3 q = abs(d);
        float f, ra, rb;
        if (q.z >= q.x && q.z >= q.y) {
          if (d.z > 0.0) { f = 0.0; ra = d.x / d.z; rb = -d.y / d.z; }
          else { f = 2.0; ra = d.x / d.z; rb = d.y / d.z; }
        } else if (q.x >= q.y) {
          if (d.x > 0.0) { f = 1.0; ra = -d.z / d.x; rb = -d.y / d.x; }
          else { f = 3.0; ra = d.z / -d.x; rb = d.y / d.x; }
        } else {
          if (d.y > 0.0) { f = 4.0; ra = d.x / d.y; rb = d.z / d.y; }
          else { f = 5.0; ra = d.x / -d.y; rb = d.z / d.y; }
        }
        vec2 uv = vec2(atan(ra), atan(rb)) / 1.5707963 + 0.5;
        uv = clamp(uv, vec2(0.5 / ${MF.toFixed(1)}), vec2(1.0 - 0.5 / ${MF.toFixed(1)}));
        float col = mod(f, 3.0), row = floor(f / 3.0);
        return (vec2(col, row) + uv) / vec2(3.0, 2.0);
      }
      void main() {
        vec3 ro = cameraPosition - uC;
        vec3 rd = normalize(vW - cameraPosition);
        float b = dot(ro, rd);
        float disc = b * b - (dot(ro, ro) - uRs * uRs);
        if (!(disc > 0.0)) discard;
        float t = -b - sqrt(disc);
        if (!(t > 0.0)) discard;
        vec3 P = ro + rd * t;
        vec3 n = P / uRs;
        float dist = t;
        float fog = smoothstep(uFogNear, uFogFar, dist);
        vec3 haze = skyColor(normalize(vec3(rd.x + 1e-4, 0.0, rd.z))); // the same haze the far sea always faded into
        if (fog > 0.999) { gl_FragColor = vec4(haze, 1.0); return; }
        vec3 V = -rd;
        vec3 dW = normalize(uTX * n.x + uTP * n.y + uTZ * n.z); // this point of the sea, in planet space
        vec3 sunW = uTX * uSun.x + uTP * uSun.y + uTZ * uSun.z;
        vec2 uv = mapUV(dW);
        float inside = uMapReady;
        vec4 m = texture2D(uMap, uv);
        float land = step(0.99, m.a) * inside;
        vec3 deep = vec3(0.012, 0.08, 0.2);
        vec3 ocean = mix(deep, vec3(0.1, 0.58, 0.6), pow(clamp(m.a / 0.9, 0.0, 1.0), 1.6) * inside);
        vec3 albedo = mix(ocean, m.rgb, land);
        float mu = dot(n, uSun);
        float day = smoothstep(-0.08, 0.18, mu);
        float diff = max(mu, 0.0);
        float cl = cloudAt(dW) * (0.35 + 0.65 * day) * smoothstep(200.0, 1000.0, cameraPosition.y);
        float csh = cloudAt(normalize(dW + sunW * 0.02));
        vec3 sunC = vec3(1.0, 0.95, 0.86);
        vec3 lit = albedo * (sunC * diff * (1.0 - 0.45 * csh) + vec3(0.03, 0.05, 0.09));
        vec3 R = reflect(rd, n);
        lit += sunC * pow(max(dot(R, uSun), 0.0), 220.0) * (1.0 - land) * 2.2 * (1.0 - cl);
        float F = pow(1.0 - max(dot(n, V), 0.0), 5.0);
        lit = mix(lit, haze * (0.5 + 0.5 * day), F * 0.55 * (1.0 - land));
        vec3 cc = mix(vec3(0.12, 0.13, 0.17), vec3(1.0), clamp(diff * 0.95 + 0.12, 0.0, 1.0)) * (0.12 + 0.88 * day);
        lit = mix(lit, cc, cl * 0.92);
        vec4 Lt = texture2D(uLights, uv);
        float nightK = 1.0 - day;
        lit += (vec3(1.0, 0.76, 0.42) * Lt.r * 1.7 + vec3(1.0, 0.33, 0.07) * Lt.g * 1.5) * inside * (nightK * 0.95 + 0.05) * (1.0 - cl * 0.85);
        lit += vec3(0.05, 0.07, 0.12) * max(dot(n, normalize(uMoonP - uC)), 0.0) * nightK * 0.5;
        lit = 1.0 - exp(-lit * 1.35);
        gl_FragColor = vec4(mix(lit, haze, fog), 1.0);
      }
    `,
  })
);
planet.frustumCulled = false;
planet.renderOrder = -0.9;
scene.add(planet);
const atmoU = { uC: planetU.uC, uSun: earthSun, uRp: { value: PLANET_R }, uRa: { value: PLANET_R + ATMO_H }, uOpacity: { value: 1 } };
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(1, 128, 80),
  new THREE.ShaderMaterial({
    uniforms: atmoU,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: bgShellVert,
    fragmentShader: /* glsl */ `
      uniform vec3 uC; uniform vec3 uSun; uniform float uRp; uniform float uRa; uniform float uOpacity;
      varying vec3 vW;
      void main() {
        vec3 ro = cameraPosition - uC;
        vec3 rd = normalize(vW - cameraPosition);
        float b = dot(ro, rd);
        float disc = b * b - (dot(ro, ro) - uRa * uRa);
        if (disc < 0.0) discard;
        float sq = sqrt(disc);
        float t0 = max(-b - sq, 0.0), t1 = -b + sq;
        float d2 = b * b - (dot(ro, ro) - uRp * uRp);
        if (d2 > 0.0) { float tp = -b - sqrt(d2); if (tp > 0.0) t1 = min(t1, tp); }
        float len = t1 - t0;
        vec3 col = vec3(0.0);
        float od = 0.0;
        for (int i = 0; i < 10; i++) {
          float tt = t0 + len * (float(i) + 0.5) / 10.0;
          vec3 s = ro + rd * tt;
          float dens = exp(-(length(s) - uRp) / 230.0);
          float mu = dot(normalize(s), uSun);
          float lightf = smoothstep(-0.28, 0.3, mu);
          float twi = smoothstep(-0.3, -0.02, mu) * (1.0 - smoothstep(0.0, 0.4, mu));
          vec3 sc = mix(vec3(0.2, 0.45, 1.0), vec3(1.0, 0.48, 0.2), twi);
          float fwd = 0.8 + 0.5 * pow(max(dot(rd, uSun), 0.0), 3.0);
          col += sc * lightf * dens * (len / 10.0) * fwd;
          od += dens * len / 10.0;
        }
        col *= 0.00075;
        float a = (1.0 - exp(-od * 0.0012)) * uOpacity;
        gl_FragColor = vec4(col * uOpacity, a);
      }
    `,
  })
);
atmosphere.frustumCulled = false;
atmosphere.visible = false;
atmosphere.renderOrder = 5;
scene.add(atmosphere);

// stars (and a milky-way band), fixed in the sky, glued to the camera; additive and in the solid pass so the world hides them
const bgBlend = { blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: false, fog: false };
const starField = (() => {
  const R = mulberry(0.4242), N = 6500, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    let x, y, z;
    if (i < 1700) { // the galactic band: points near a tilted great circle
      const a = R() * 6.2832, off = (R() + R() + R() - 1.5) * 0.28;
      x = Math.cos(a); y = Math.sin(off); z = Math.sin(a);
      const ty = y * 0.82 + z * 0.55, tz = z * 0.82 - y * 0.55;
      y = ty; z = tz;
    } else { x = R() * 2 - 1; y = R() * 2 - 1; z = R() * 2 - 1; }
    const l = Math.hypot(x, y, z) || 1;
    pos[i * 3] = (x / l) * 500000; pos[i * 3 + 1] = (y / l) * 500000; pos[i * 3 + 2] = (z / l) * 500000;
    const b = i < 1700 ? 0.3 + 0.5 * R() : 0.5 + 0.5 * Math.pow(R(), 1.6), tint = R();
    col[i * 3] = b * (0.8 + 0.2 * tint); col[i * 3 + 1] = b * (0.85 + 0.1 * tint); col[i * 3 + 2] = b * (1.0 - 0.15 * tint);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  // (a hand-written point shader: no bending by the world's curve, which would drop stars 500 km away right out of the sky)
  const p = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uK: { value: 0 }, uSize: { value: 3.2 } },
    vertexShader: "attribute vec3 color; varying vec3 vC; uniform float uSize;\nvoid main() { vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }",
    fragmentShader: "varying vec3 vC; uniform float uK;\nvoid main() { vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(q)); gl_FragColor = vec4(vC * uK * a, 1.0); }",
    ...bgBlend,
  }));
  p.frustumCulled = false;
  p.renderOrder = -0.99;
  spaceGroup.add(p);
  return p;
})();
const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture, color: 0x000000, ...bgBlend }));
const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture, color: 0x000000, ...bgBlend }));
sunCore.scale.setScalar(26000);
sunGlow.scale.setScalar(150000);
sunCore.renderOrder = -0.95;
sunGlow.renderOrder = -0.951;
spaceGroup.add(sunCore, sunGlow);
// lit spheres for the moon and the neighbouring planets
function bodyMaterial(base, bands) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uBase: { value: new THREE.Color(base) }, uBands: { value: bands }, uOpacity: { value: 0 } },
    ...bgBlend, blending: THREE.NoBlending, // (a world hides the stars and the worlds behind it)
    vertexShader: "varying vec3 vN; varying vec3 vO;\nvoid main() { vN = normalize(mat3(modelMatrix) * normal); vO = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform vec3 uSun; uniform vec3 uBase; uniform float uBands; uniform float uOpacity;
      varying vec3 vN; varying vec3 vO;
      void main() {
        float f = fbm(vO.xy * 3.0 + vO.z * 2.0 + 4.0) * 0.8 + 0.2 * vnoise(vO.xz * 14.0);
        float crater = smoothstep(0.55, 0.62, vnoise(vO.xy * 9.0 + vO.z * 7.0)) * 0.25;
        vec3 alb = uBase * (0.65 + 0.5 * f) * (1.0 - crater);
        if (uBands > 0.5) alb = mix(uBase, uBase * vec3(1.0, 0.8, 0.6), 0.5 + 0.5 * sin(vO.y * uBands + f * 3.0));
        float d = max(dot(normalize(vN), uSun), 0.0);
        vec3 c = alb * (d * vec3(1.0, 0.97, 0.9) + 0.05);
        gl_FragColor = vec4((1.0 - exp(-c * 1.4)) * uOpacity, 1.0);
      }
    `,
  });
}
const moonMat = bodyMaterial(0xb0aca4, 0), moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 52), moonMat);
moonMesh.renderOrder = -0.94;
spaceGroup.add(moonMesh);
// the other worlds, drawn at their true places and sizes (pulled in along the same line, and shrunk to match, if they lie beyond the camera's reach)
const neighbours = [
  { mat: bodyMaterial(0xc2552f, 0), body: BODIES.mars },
  { mat: bodyMaterial(0xe0c9a0, 18), body: BODIES.giant },
  { mat: bodyMaterial(0x9fc8e8, 0), body: BODIES.ice },
].map((n) => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 52), n.mat);
  mesh.userData.body = n.body;
  mesh.renderOrder = -0.96;
  spaceGroup.add(mesh);
  return mesh;
});
{
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.45, 2.3, 96), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, ...bgBlend }));
  ring.material.onBeforeCompile = (sh) => { sh.uniforms.uCurve = { value: 0 }; };
  ring.rotation.x = 1.25;
  ring.renderOrder = -0.955;
  neighbours[1].add(ring);
  neighbours[1].userData.ring = ring;
}
let _camFar = 12000, _camNear = 0.05;
const _sc = new THREE.Vector3(), _sc2 = new THREE.Vector3();
// put a far world where it really is, as seen from the camera: or, if it lies beyond the camera's reach, further in along the same line and smaller to match
const bgOrder = (d) => -0.96 + 0.05 * (1 - Math.min(1, d / 3e7)); // far things first, near things over them
function bgPlace(mesh, pt, R, F, minAng = 0) {
  toScene(_sc2.copy(pt).sub(pIn), _sc);
  const d = Math.max(_sc.length(), 1), k = d > F ? F / d : 1;
  mesh.position.copy(camPos).addScaledVector(_sc, k);
  mesh.scale.setScalar(Math.max(R * k, d * k * minAng)); // (a far world is never smaller than a dot you can see)
  mesh.renderOrder = bgOrder(d);
  return d;
}
function homeAltitude() {
  if (!sp.on && !curBody) return Math.max(0, camPos.y);
  return Math.max(0, pIn.length() - PLANET_R);
}
function updateSpace(dt) {
  const onEarth = !sp.on && !curBody;
  const alt = homeAltitude();
  spaceState.alt = alt;
  spaceState.dark = onEarth ? smooth(120, 1600, alt) : sp.on ? 1 : curBody.skyDark; // the sky goes from blue to black slowly, and is black in space
  spaceState.cloudFade = onEarth ? smooth(250, 800, alt) : 1; // the clouds lie low: climb through them and they are beneath you
  spaceState.fade = 0;
  spaceState.vis = onEarth ? smooth(600, 1600, alt) : 1;
  shared.uSpace.value = spaceState.dark;
  shared.uCloudWorld.value = onEarth ? 1 : 0;
  shared.uSeaFade.value = onEarth ? smooth(60, 700, alt) : 1; // the near sea (a square of detailed water) gives way to the planet's own sea as you climb
  worldRoot.visible = onEarth && alt < 8000; // (high above, the baked planet map stands in for the islands)
  water.visible = shared.uSeaFade.value < 0.995;
  // how far we can see: far in space, a few tens of km on a world's surface
  let far, near;
  if (sp.on) { far = 1e7; near = 0.05; } // (near stays close so your menu and hands, a metre away, are never cut off; nothing out here relies on depth)
  else if (curBody) { far = 80000; near = 0.05; }
  else { far = alt > 1500 ? 900000 : 12000; near = 0.05; }
  if (far !== _camFar || near !== _camNear) { _camFar = far; _camNear = near; camera.far = far; camera.near = near; camera.updateProjectionMatrix(); }
  if (onEarth) sky.visible = sky.visible && alt < 3000;
  else { sky.visible = !!curBody; farOcean.visible = false; foamLayer.visible = false; }
  // bake the map a little each frame until it is done
  if (mapBake.gen) {
    const t0 = performance.now();
    const budget = alt > 150 ? 10 : 3.5; // (quicker once you are up where the planet is what you see)
    while (performance.now() - t0 < budget) if (mapBake.gen.next().done) { mapBake.gen = null; break; }
  }
  planetU.uMapReady.value = mapBake.ready;
  // the home planet as a sphere traced in the shader: centred under you, a little below the sea (so it never touches the water), and turning with its own spin
  const Rs = PLANET_R;
  const C = planetU.uC.value;
  if (onEarth) C.set(camPos.x, -Rs - 3, camPos.z);
  else C.copy(camPos).sub(toScene(pIn, _sc));
  planetU.uRs.value = Rs;
  spinVec(SQ.ex, -game.spin, planetU.uTX.value); spinVec(SQ.ey, -game.spin, planetU.uTP.value); spinVec(SQ.ez, -game.spin, planetU.uTZ.value);
  planetU.uSpaceCover.value = clamp(wx.cover + 0.2, 0, 1);
  planet.position.copy(camPos);
  planet.visible = !onEarth || camPos.y > 150; // (from the air, or from another world)
  planet.renderOrder = bgOrder(onEarth ? 0 : pIn.length()) + 0.0002;
  const Ra = Rs + ATMO_H;
  atmosphere.visible = alt > 500 && !curBody;
  atmosphere.position.copy(C);
  atmosphere.scale.setScalar(Ra);
  atmoU.uRp.value = Rs;
  atmoU.uRa.value = Ra;
  atmoU.uOpacity.value = smooth(300, 1400, alt);
  spaceGroup.visible = spaceState.vis > 0.001;
  if (spaceGroup.visible) {
    const v = spaceState.vis, S = shared.uSunDir.value, F = _camFar * 0.8;
    // stars: bright in the dark, faint against a bright sky
    const starK = curBody && curBody.kind !== "moon" ? 0.2 + 0.8 * shared.uStars.value : 1;
    starField.position.copy(camPos);
    starField.scale.setScalar(Math.min(1, F / 500000));
    starField.material.uniforms.uK.value = v * starK;
    toScene(SUN_W, earthSun.value).normalize();
    const dsun = bgPlace(sunCore, SUN_POS, SUN_R * 1.5, F), kS = sunCore.scale.x / (SUN_R * 1.5); // (the sun's disc, with a halo a little wider than it)
    sunCore.scale.setScalar(sunCore.scale.x * 2);
    sunGlow.position.copy(sunCore.position);
    sunGlow.scale.setScalar(SUN_R * 9 * kS);
    sunGlow.renderOrder = sunCore.renderOrder - 0.0001;
    sunCore.material.color.setRGB(v, 0.96 * v, 0.82 * v);
    sunGlow.material.color.setRGB(0.55 * v, 0.38 * v, 0.2 * v);
    // the other worlds
    const mb = BODIES.moon;
    const dm = bgPlace(moonMesh, mb.pos, mb.R, F, 0.004);
    moonMesh.visible = !(curBody === mb && dm - mb.R < 20000);
    planetU.uMoonP.value.copy(moonMesh.position);
    moonMat.uniforms.uOpacity.value = v;
    toScene(_sc2.copy(SUN_POS).sub(mb.pos), moonMat.uniforms.uSun.value).normalize();
    for (const n of neighbours) {
      const b = n.userData.body;
      const d = bgPlace(n, b.pos, b.R, F, 0.004);
      if (n.userData.ring) n.userData.ring.renderOrder = n.renderOrder + 0.0005;
      n.visible = !(curBody === b && d - b.R < 20000);
      n.material.uniforms.uOpacity.value = v;
      toScene(_sc2.copy(SUN_POS).sub(b.pos), n.material.uniforms.uSun.value).normalize();
      if (n.userData.ring) n.userData.ring.material.color.setRGB(0.85 * v * 0.6, 0.78 * v * 0.6, 0.62 * v * 0.6);
    }
  }
}

// ===== Navigation in space: a speed readout, the names of the worlds and the sun, and a compass for the orbital plane =====
// A transparent panel in front of the eyes (a screen overlay on a monitor, a panel in the headset): names are drawn where each world lies, or on the
// edge of the view pointing toward it. The compass shows the plane all the planets circle in, and which way is "up" out of it (the green arrow).
const NAV_NAMES = { home: "Home", moon: "Moon", mars: "Red World", giant: "Gas Giant", ice: "Ice World" };
const NAV_COL = { home: "#7fd0ff", moon: "#d8d8d0", mars: "#ff8a5a", giant: "#f0d9a8", ice: "#bfe6ff", sun: "#ffd470" };
const navCanvas = document.createElement("canvas");
navCanvas.width = 1024; navCanvas.height = 640;
const navCtx = navCanvas.getContext("2d");
const navTex = new THREE.CanvasTexture(navCanvas);
navTex.minFilter = THREE.LinearFilter;
const navPanel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: navTex, transparent: true, toneMapped: false, depthTest: false, depthWrite: false, fog: false }));
navPanel.renderOrder = 45;
navPanel.visible = false;
navPanel.frustumCulled = false;
camera.add(navPanel);
const NAV_D = 8; // (beyond the camera's near plane of 5 m in space; sized by angle)
const ECL_N = new THREE.Vector3().crossVectors(ECL_E1, ECL_E2).normalize(); // out of the orbital plane, "up"
const _nq = new THREE.Quaternion(), _nv = new THREE.Vector3(), _nw = new THREE.Vector3();
let navFrame = 0, navAspect = 1.6;
const fmtDist = (m) => m < 1000 ? Math.round(m) + " m" : m < 1e6 ? (m / 1000).toFixed(m < 1e4 ? 1 : 0) + " km" : Math.round(m / 1000).toLocaleString("en") + " km";
const fmtSpeed = (v) => v < 1000 ? v.toFixed(v < 100 ? 1 : 0) + " m/s" : (v / 1000).toFixed(v < 1e4 ? 2 : 1) + " km/s";
function updateNav() {
  navPanel.visible = sp.on;
  if (!sp.on) return;
  const vr = renderer.xr.isPresenting;
  const asp = vr ? 1.3 : clamp(camera.aspect, 0.8, 2.6);
  const ph = vr ? NAV_D * 1.1 : 2 * NAV_D * Math.tan((camera.fov * Math.PI) / 360), pw = ph * asp;
  navPanel.position.set(0, 0, -NAV_D);
  navPanel.scale.set(pw, ph, 1);
  if (Math.abs(asp - navAspect) > 0.02) { navAspect = asp; navCanvas.width = Math.round(640 * asp); }
  if (navFrame++ & 1) return; // (every other frame)
  const W = navCanvas.width, H = navCanvas.height, c = navCtx;
  c.clearRect(0, 0, W, H);
  camera.getWorldQuaternion(_nq).invert();
  const toCam = (inertial, out) => out.copy(toScene(inertial, out)).applyQuaternion(_nq); // inertial direction -> the camera's own axes
  const ppm = W / pw; // pixels per metre on the panel
  c.textBaseline = "middle";
  const targets = [{ id: "home", p: _nw.set(0, 0, 0), R: PLANET_R }, ...BODY_LIST.map((b) => ({ id: b.id, p: b.pos, R: b.R })), { id: "sun", p: SUN_POS, R: SUN_R }];
  const cx0 = W / 2, cy0 = H / 2, mx = 70, myT = 60, myB = 130, placed = [];
  for (const t of targets) {
    _nv.copy(t.p).sub(pIn);
    const dist = _nv.length(), alt = Math.max(0, dist - t.R);
    toCam(_nv, _nv).normalize();
    const col = NAV_COL[t.id], name = t.id === "sun" ? "Sun" : NAV_NAMES[t.id];
    let x, y, edge = false;
    if (_nv.z < -0.05) { x = cx0 + (_nv.x / -_nv.z) * NAV_D * ppm; y = cy0 - (_nv.y / -_nv.z) * NAV_D * ppm; }
    else { x = cx0 + _nv.x * 1e5; y = cy0 - _nv.y * 1e5; }
    if (_nv.z >= -0.05 || x < mx || x > W - mx || y < myT || y > H - myB) {
      edge = true;
      let dx = x - cx0, dy = y - cy0;
      if (_nv.z >= -0.05) { dx = _nv.x; dy = -_nv.y; if (Math.hypot(dx, dy) < 1e-4) dx = 1; }
      const hy = dy > 0 ? H - myB - cy0 : cy0 - myT, k = Math.min((W / 2 - mx) / Math.max(Math.abs(dx), 1e-6), hy / Math.max(Math.abs(dy), 1e-6));
      x = cx0 + dx * k; y = cy0 + dy * k;
      const ang = Math.atan2(dy, dx);
      c.save(); c.translate(x, y); c.rotate(ang); c.fillStyle = col; c.globalAlpha = 0.9;
      c.beginPath(); c.moveTo(16, 0); c.lineTo(-8, -9); c.lineTo(-8, 9); c.closePath(); c.fill(); c.restore();
    }
    const disc = Math.tan(Math.asin(Math.min(1, t.R / Math.max(dist, t.R * 1.0001)))) * NAV_D * ppm; // radius of the world on the panel, px
    c.globalAlpha = 0.95;
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2.5;
    let lx = x, ly = y;
    if (!edge) {
      if (disc < 22) { c.beginPath(); c.arc(x, y, 14, 0, 6.2832); c.stroke(); lx = x + 22; ly = y - 6; }
      else { lx = x - 60; ly = Math.min(H - myB - 20, y + disc + 26); }
    } else { lx = x + (x > cx0 ? -150 : 24); ly = y - 8; }
    for (let n = 0; n < 6 && placed.some((q) => Math.abs(q[1] - ly) < 46 && Math.abs(q[0] - lx) < 170); n++) ly += ly > cy0 ? -46 : 46; // (keep the names from piling up)
    placed.push([lx, ly]);
    c.font = "bold 22px system-ui, sans-serif";
    c.textAlign = !edge && disc >= 22 ? "left" : edge && x > cx0 ? "right" : "left";
    if (edge && x > cx0) lx = x - 24;
    c.shadowColor = "rgba(0,0,0,0.85)"; c.shadowBlur = 5;
    c.fillText(name, lx, ly);
    c.font = "17px system-ui, sans-serif"; c.globalAlpha = 0.8;
    c.fillText(t.id === "sun" ? fmtDist(dist) : fmtDist(alt), lx, ly + 22);
    c.shadowBlur = 0; c.globalAlpha = 1;
  }
  // speed, bottom centre
  const v = sp.vel.length(), vmax = Math.max(sp.vmax || 1, 1);
  c.textAlign = "center"; c.shadowColor = "rgba(0,0,0,0.85)"; c.shadowBlur = 5;
  c.fillStyle = "#ffffff"; c.font = "bold 34px system-ui, sans-serif";
  c.fillText(fmtSpeed(v), cx0, H - 66);
  c.fillStyle = "rgba(255,255,255,0.18)"; c.fillRect(cx0 - 130, H - 40, 260, 8);
  c.fillStyle = "#7fe3ff"; c.fillRect(cx0 - 130, H - 40, 260 * clamp(v / vmax, 0, 1), 8);
  c.shadowBlur = 0;
  c.fillStyle = "rgba(255,255,255,0.75)"; c.font = "16px system-ui, sans-serif";
  const nb = sp.near;
  c.fillText((nb ? NAV_NAMES[nb.id] : "Home") + ": " + fmtDist(Math.max(0, sp.h || 0)) + " up   |   top speed here " + fmtSpeed(vmax), cx0, H - 18);
  // the compass of the orbital plane, bottom left
  const gr = Math.min(84, H * 0.15), gx = gr + 36, gy = H - gr - 56;
  c.fillStyle = "rgba(6,14,28,0.5)"; c.beginPath(); c.arc(gx, gy, gr + 10, 0, 6.2832); c.fill();
  c.lineWidth = 2;
  let pxp = 0, pyp = 0;
  for (let i = 0; i <= 48; i++) { // the plane, as a ring
    const th = (i / 48) * 6.2832;
    _nv.copy(ECL_E1).multiplyScalar(Math.cos(th)).addScaledVector(ECL_E2, Math.sin(th));
    toCam(_nv, _nv);
    const px = gx + _nv.x * gr, py = gy - _nv.y * gr;
    if (i) { c.strokeStyle = _nv.z < 0 ? "rgba(140,210,255,0.9)" : "rgba(140,210,255,0.28)"; c.beginPath(); c.moveTo(pxp, pyp); c.lineTo(px, py); c.stroke(); }
    pxp = px; pyp = py;
  }
  toCam(ECL_N, _nv); // up out of the plane
  const nz = _nv.z < 0;
  c.strokeStyle = nz ? "#6dff9a" : "rgba(109,255,154,0.45)"; c.lineWidth = 4;
  c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + _nv.x * gr, gy - _nv.y * gr); c.stroke();
  c.fillStyle = c.strokeStyle; c.beginPath(); c.arc(gx + _nv.x * gr, gy - _nv.y * gr, 7, 0, 6.2832); c.fill();
  c.font = "bold 15px system-ui, sans-serif"; c.textAlign = "center"; c.fillStyle = "#06150c";
  c.fillText("UP", gx + _nv.x * gr, gy - _nv.y * gr + 1);
  c.strokeStyle = "rgba(255,120,120,0.55)"; c.lineWidth = 2;
  c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx - _nv.x * gr * 0.8, gy + _nv.y * gr * 0.8); c.stroke(); // (down)
  _nv.copy(SUN_POS).sub(pIn); toCam(_nv, _nv).normalize();
  c.fillStyle = "#ffd470"; c.beginPath(); c.arc(gx + _nv.x * gr, gy - _nv.y * gr, 6, 0, 6.2832); c.fill();
  const above = _nw.copy(pIn).sub(SUN_POS).dot(ECL_N);
  c.fillStyle = "rgba(255,255,255,0.85)"; c.font = "15px system-ui, sans-serif"; c.textAlign = "left";
  c.fillText("Orbital plane: " + fmtDist(Math.abs(above)) + (above >= 0 ? " above" : " below"), gx - gr, gy + gr + 26);
  navTex.needsUpdate = true;
}

// ===== Minimap (after Coastline's): north-up, centred on you, with the islands, places you have found, and your boat =====
// On a screen it sits in the corner (M changes the zoom); in VR it is a small panel on top of your left controller.
const mapCanvas = document.createElement("canvas");
mapCanvas.width = mapCanvas.height = 256;
const mapDom = $("minimap");
const mmx = mapCanvas.getContext("2d");
const ISLE_COLORS = ["", "#d8c48c", "#6b5046", "#c6b48a", "#74803f", "#9a9a9e", "#b7c3cf"];
const POI_COLORS = { fishingCabin: "#ffb45a", abandonedCamp: "#8ed06a", forestShrine: "#ff6a5a", lighthouse: "#ffffff", shipwreck: "#c9a36a", observatory: "#b79cff", ruins: "#7ad8ff" };
const mapTex = new THREE.CanvasTexture(mapCanvas);
const mapPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), new THREE.MeshBasicMaterial({ map: mapTex, transparent: true, toneMapped: false, depthTest: false }));
camera.add(mapPanel); // in your view, up in the left corner, wherever you look or move
mapPanel.position.set(-0.19, 0.11, -0.65);
mapPanel.renderOrder = 40;
mapPanel.visible = false;
function worldBoundsEdge(x, z) {
  return 1e9; // (the world has no edge: it wraps all the way round)
}
let mapTimer = 0, mapNear = null;
function drawMinimap() {
  const range = MAP_RANGES[opts.map][1];
  const W = mapCanvas.width, c = W / 2, Rr = c - 6, s = Rr / range;
  const cx = player.x, cz = player.z;
  const toMap = (x, z) => [c + (x - cx) * s, c + (z - cz) * s];
  mmx.clearRect(0, 0, W, W);
  mmx.save();
  mmx.beginPath();
  mmx.arc(c, c, Rr, 0, 6.2832);
  mmx.clip();
  mmx.fillStyle = "rgba(14, 62, 86, 0.86)";
  mmx.fillRect(0, 0, W, W);
  // islands
  const span = Math.ceil(range / CELL) + 1;
  let near = null, nd = 1e12;
  const drawIsland = (a, color, isHome) => {
    const [px, py] = toMap(a.x, a.z);
    mmx.fillStyle = color;
    mmx.beginPath();
    if (isHome) mmx.arc(px, py, Math.max(2.5, ISL.r * s), 0, 6.2832);
    else for (let k = 0; k <= 40; k++) {
      const th = (k / 40) * 6.2832, r = isleCoastR(a, th) * s;
      const x = px + Math.cos(th) * Math.max(r, 2.5), y = py + Math.sin(th) * Math.max(r, 2.5);
      k ? mmx.lineTo(x, y) : mmx.moveTo(x, y);
    }
    mmx.fill();
    if (!isHome && a.type === 2) { mmx.fillStyle = "#ff7a2a"; mmx.beginPath(); mmx.arc(px, py, Math.max(2, a.r * s * 0.12), 0, 6.2832); mmx.fill(); }
  };
  drawIsland({ x: ISL.x, z: ISL.z }, "#e6d3a0", true);
  for (const a of cellsAround(cx, cz, span)) {
      if (!a.type) {
        if (a.feature === "rig" || a.feature === "wind") {
          const [px, py] = toMap(a.x, a.z);
          mmx.fillStyle = a.feature === "rig" ? "#e8962a" : "#ffffff";
          mmx.beginPath();
          if (a.feature === "rig") mmx.rect(px - 4, py - 4, 8, 8);
          else mmx.arc(px, py, 3.5, 0, 6.2832);
          mmx.fill();
          mmx.strokeStyle = "#08202c";
          mmx.lineWidth = 1.5;
          mmx.stroke();
        }
        continue;
      }
      drawIsland(a, ISLE_COLORS[a.type], false);
      const d = Math.hypot(a.x - cx, a.z - cz);
      if (d < nd && d > a.r + 60) (nd = d), (near = a);
      for (const p of a.pois || []) if (poiSave[p.id] && poiSave[p.id].found) {
        const [qx, qy] = toMap(p.x, p.z);
        mmx.fillStyle = POI_COLORS[p.def.id] || "#fff";
        mmx.beginPath();
        mmx.arc(qx, qy, 4, 0, 6.2832);
        mmx.fill();
        mmx.strokeStyle = "#08202c";
        mmx.lineWidth = 1.5;
        mmx.stroke();
      }
    }
  mapNear = near;
  // pins on the rim for the home island and the nearest island, when off the map
  const pin = (x, z, label, color) => {
    let [px, py] = toMap(x, z);
    const dx = px - c, dy = py - c, d = Math.hypot(dx, dy), edge = Rr - 13;
    if (d > edge) { px = c + (dx / d) * edge; py = c + (dy / d) * edge; }
    mmx.fillStyle = color;
    mmx.beginPath();
    mmx.arc(px, py, 11, 0, 6.2832);
    mmx.fill();
    mmx.fillStyle = "#08202c";
    mmx.font = "bold 14px system-ui, sans-serif";
    mmx.textAlign = "center";
    mmx.textBaseline = "middle";
    mmx.fillText(label, px, py + 1);
  };
  pin(ISL.x, ISL.z + ISL.r, "H", "#7fd1b9");
  if (near) pin(near.x, near.z, ["", "T", "V", "R", "S", "C", "A"][near.type], "#f2c14e");
  // the boat
  if (moor.ready) {
    const [px, py] = toMap(moor.wx, moor.wz);
    mmx.save();
    mmx.translate(px, py);
    mmx.rotate(-moor.wyaw);
    mmx.fillStyle = boatDrive.on ? "#ffffff" : "#bfe6ff";
    mmx.beginPath();
    mmx.moveTo(0, -7); mmx.lineTo(4.5, 6); mmx.lineTo(-4.5, 6);
    mmx.closePath();
    mmx.fill();
    mmx.restore();
  }
  // you: a bright arrow with a dark halo, pointing the way you face
  mmx.save();
  mmx.translate(c, c);
  mmx.fillStyle = "rgba(4,16,24,0.55)";
  mmx.beginPath();
  mmx.arc(0, 0, 17, 0, 6.2832);
  mmx.fill();
  mmx.rotate(Math.atan2(camFwd.x, -camFwd.z));
  mmx.fillStyle = "#ff5a3c";
  mmx.strokeStyle = "#ffffff";
  mmx.lineJoin = "round";
  mmx.lineWidth = 3;
  mmx.beginPath();
  mmx.moveTo(0, -15); mmx.lineTo(10.5, 12); mmx.lineTo(0, 6.5); mmx.lineTo(-10.5, 12);
  mmx.closePath();
  mmx.stroke();
  mmx.fill();
  mmx.restore();
  mmx.restore();
  mmx.strokeStyle = "rgba(255,255,255,0.7)";
  mmx.lineWidth = 3;
  mmx.beginPath();
  mmx.arc(c, c, Rr, 0, 6.2832);
  mmx.stroke();
  const pill = (txt, y, color, size) => {
    mmx.font = `bold ${size}px system-ui, sans-serif`;
    mmx.textAlign = "center";
    mmx.textBaseline = "middle";
    const w = mmx.measureText(txt).width + 16, h = size + 9;
    mmx.fillStyle = "rgba(4,16,24,0.82)";
    mmx.beginPath();
    mmx.roundRect ? mmx.roundRect(c - w / 2, y - h / 2, w, h, h / 2) : mmx.rect(c - w / 2, y - h / 2, w, h);
    mmx.fill();
    mmx.fillStyle = color;
    mmx.fillText(txt, c, y + 1);
  };
  pill("N", 17, "#ffffff", 15);
  if (near) {
    const d = Math.round(Math.hypot(near.x - cx, near.z - cz) - near.r);
    const dirs = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
    const dir = dirs[(Math.round(Math.atan2(near.z - cz, near.x - cx) / 0.7854) + 8) % 8];
    pill(`${ISLE_NAMES[near.type]} · ${d > 999 ? (d / 1000).toFixed(1) + " km" : d + " m"} ${dir}`, c + Rr * 0.6, "#ffd98a", 14);
  }
  pill(range >= 1000 ? (range / 1000).toFixed(1) + " km" : range + " m", c + Rr * 0.8, "#cfe6ea", 12);
  mapTex.needsUpdate = true;
}
function updateMinimap(dt) {
  mapTimer -= dt;
  const range = MAP_RANGES[opts.map][1];
  const homeWorld = !sp.on && !curBody;
  mapDom.style.display = range && !renderer.xr.isPresenting && homeWorld ? "block" : "none";
  mapPanel.visible = !!range && renderer.xr.isPresenting && !menu.open && homeWorld;
  if (!homeWorld) return;
  if (!range || mapTimer > 0) return;
  mapTimer = renderer.xr.isPresenting ? 0.25 : 0.12;
  drawMinimap();
  if (!renderer.xr.isPresenting) {
    const g = mapDom.getContext("2d");
    g.clearRect(0, 0, mapDom.width, mapDom.height);
    g.drawImage(mapCanvas, 0, 0, mapDom.width, mapDom.height);
  }
}
addEventListener("keydown", (e) => {
  if (e.code === "KeyM" && !e.repeat) {
    opts.map = (opts.map + 1) % MAP_RANGES.length;
    applyOpts();
    flashHint("Map: " + MAP_RANGES[opts.map][0]);
  }
});

