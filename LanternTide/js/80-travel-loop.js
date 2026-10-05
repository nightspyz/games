"use strict";
// ===== Crossing from one face of the planet to the next =====
// Past the edge of a face the planet carries on onto its neighbour, whose chart is turned a quarter (or two) relative to this one. We
// work out where on the sphere you are, which face that is, and how its axes sit against the old ones; then you, what you ride and
// your speed are carried across and turned to match. It happens in open sea (every face is ringed by a band with no land).
const _fp = new THREE.Vector3(), _fx = new THREE.Vector3(), _fz = new THREE.Vector3(), _gx = new THREE.Vector3(), _gz = new THREE.Vector3(), _gp = new THREE.Vector3(), _ft = new THREE.Vector3(), _fo = { f: 0, lx: 0, lz: 0 };
function updateFace() {
  const C = FACE_C[curFace], lx = player.x - C[0], lz = player.z - C[1], half = FACE_W / 2;
  if (Math.abs(lx) <= half && Math.abs(lz) <= half) return;
  const f = faceAt(player.x, player.z);
  const G = FACE_C[f];
  if (f !== curFace && Math.abs(player.x - G[0]) <= half && Math.abs(player.z - G[1]) <= half) { curFace = f; return; } // (a teleport into another face)
  // walked or flew over the edge
  faceFrame(curFace, lx, lz, _fp, _fx, _fz);
  dirFace(_fp, _fo);
  const nf = _fo.f;
  faceFrame(nf, _fo.lx, _fo.lz, _gp, _gx, _gz);
  const turn = (vx, vz, out) => { // a vector in the old chart, in the new
    _ft.copy(_fx).multiplyScalar(vx).addScaledVector(_fz, vz);
    out[0] = _ft.dot(_gx);
    out[1] = _ft.dot(_gz);
    return out;
  };
  const o = [0, 0];
  const ox = player.x, oz = player.z;
  const nx = FACE_C[nf][0] + _fo.lx, nz = FACE_C[nf][1] + _fo.lz;
  turn(-Math.sin(yaw), -Math.cos(yaw), o);
  yaw = Math.atan2(-o[0], -o[1]);
  if (player.fv) { turn(player.fv.x, player.fv.z, o); player.fv.x = o[0]; player.fv.z = o[1]; }
  if (player.sv) { turn(player.sv.x, player.sv.z, o); player.sv.x = o[0]; player.sv.z = o[1]; }
  if (boatDrive.on || moor.free) {
    turn(moor.x - ox, moor.z - oz, o);
    moor.x = nx + o[0]; moor.z = nz + o[1];
    turn(-Math.sin(moor.yaw), -Math.cos(moor.yaw), o);
    moor.yaw = Math.atan2(-o[0], -o[1]);
    moor.wx = moor.x; moor.wz = moor.z; moor.wyaw = moor.yaw;
  }
  player.x = nx;
  player.z = nz;
  curFace = nf;
  lastFoot = null;
  screenFade = Math.max(screenFade, 0.5);
}

// ===== Other worlds: flying between them, and walking on them =====
// In space you have a true position (in inertial space, with the home planet's centre at the origin) and fly at a speed that grows with your height
// above the nearest world, so a crossing takes seconds and an arrival is gentle. Come within a few km of the moon, the red world or the ice world
// and you land: that world's ground is built round you in tiles of four sizes (fine near, coarse far) from a height function of the place on the
// world, so the same spot is always the same land. The gas giant has no ground: you can circle it, and that is all.
const SPACE_SPEEDS = [[0.06, 4000], [0.2, 20000], [0.6, 60000], [1.5, 200000], [4, 600000]]; // per flight-speed setting: how fast it grows with height, and the top speed (m/s)
const SPACE_ENTER = 30000, SPACE_EXIT = 20000, LAND_ALT = 6000, BODY_EXIT = 25000;
let earthSave = null;
const _bp = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3(), _fw = new THREE.Vector3(), _want = new THREE.Vector3(), _right = new THREE.Vector3(), _qq = new THREE.Quaternion();
const lookDirScene = (out) => { const cp = Math.cos(pitch); return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp); };
const setLookFromScene = (v) => { yaw = Math.atan2(-v.x, -v.z); pitch = Math.asin(clamp(v.y, -1, 1)); };

// ----- the lands -----
function bfbm(x, y, z, o) { let v = 0, a = 0.5; for (let i = 0; i < o; i++) { v += a * cloudNoise3(x, y, z); x = x * 2.02 + 17.1; y = y * 2.02 + 9.2; z = z * 2.02 + 4.7; a *= 0.5; } return v; }
const _wp = new THREE.Vector3();
function ridged(x, y, z, o) { // sharp-crested noise: mountain ranges
  let v = 0, a = 0.5, w = 1;
  for (let i = 0; i < o; i++) { let n = 1 - Math.abs(2 * cloudNoise3(x, y, z) - 1); n *= n * w; w = clamp(n * 2, 0, 1); v += n * a; x = x * 2.1 + 17.1; y = y * 2.1 + 9.2; z = z * 2.1 + 4.7; a *= 0.5; }
  return v;
}
function warpP(P, f, amp) { // bend the place we look up, so features wander instead of lining up
  return _wp.set(P.x + (bfbm(P.x * f + 5.2, P.y * f, P.z * f, 2) - 0.5) * amp, P.y + (bfbm(P.x * f, P.y * f + 1.3, P.z * f + 7.7, 2) - 0.5) * amp, P.z + (bfbm(P.x * f + 3.1, P.y * f + 8.8, P.z * f, 2) - 0.5) * amp);
}
// a crater of radius r, seen at q = distance / r: a bowl (or a flat floor with a central peak and terraced wall when large), a raised rim, a blanket of ejecta
function craterH(q, r, depth) {
  if (q > 1.7) return 0;
  let h = 0;
  if (q < 1) {
    if (r > 450) { const wall = smooth(0.45, 1, q); h = -depth * r * (1 - wall) + 0.012 * r * Math.sin(q * 24) * wall * (1 - wall) * 4 + 0.09 * r * Math.exp(-(q * q) / 0.015); }
    else h = -depth * r * (1 - q * q);
  }
  const rq = (q - 1) / 0.13;
  h += 0.07 * r * Math.exp(-rq * rq);
  if (q > 1) h += 0.035 * r / (q * q * q) * (1 - smooth(1.3, 1.7, q));
  return h;
}
function craterField(P, sizes, probs, depth, K) {
  let h = 0;
  for (let k = 0; k < sizes.length; k++) {
    // one possible crater in each cube of the lattice, lying wholly inside it
    const S = sizes[k], ci = Math.floor(P.x / S), cj = Math.floor(P.y / S), ck = Math.floor(P.z / S), sd = ck + k * 977;
    if (hash3(ci, cj, sd) > probs[k] * K) continue;
    const f = 0.1 + 0.2 * hash3(ci, cj, sd + 1), r = S * f;
    const cx = (ci + f + (1 - 2 * f) * hash3(ci, cj, sd + 2)) * S, cy = (cj + f + (1 - 2 * f) * hash3(ci, cj, sd + 3)) * S, cz = (ck + f + (1 - 2 * f) * hash3(ci, cj, sd + 4)) * S;
    const dx = P.x - cx, dy = P.y - cy, dz = P.z - cz;
    h += craterH(Math.sqrt(dx * dx + dy * dy + dz * dz) / r, r, depth * (0.75 + 0.5 * hash3(ci, cj, sd + 5)));
  }
  return h;
}
const MOON_CR = [6400, 3000, 1400, 650, 300, 140, 64], MOON_P = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];
const MARS_CR = [14000, 5000, 1800, 700, 260], MARS_P = [0.3, 0.35, 0.45, 0.5, 0.55];
function moonH(P) {
  const cont = bfbm(P.x / 22000 + 3, P.y / 22000, P.z / 22000, 3);
  const mare = smooth(0.46, 0.53, cont); // dark, smooth plains between the cratered highlands
  const range = smooth(0.3, 0.6, bfbm(P.x / 16000 + 9, P.y / 16000, P.z / 16000, 3));
  let h = -mare * 240 + (1 - mare) * (ridged(P.x / 6000 + 2, P.y / 6000, P.z / 6000, 4) * 1100 * range) + (bfbm(P.x / 3000 + 3.1, P.y / 3000, P.z / 3000, 5) - 0.5) * 220 * (1 - 0.6 * mare);
  h += (bfbm(P.x / 300, P.y / 300 + 7, P.z / 300, 3) - 0.5) * 18 * (1 - 0.5 * mare) + (bfbm(P.x / 38, P.y / 38, P.z / 38, 2) - 0.5) * 3.2;
  return h + craterField(P, MOON_CR, MOON_P, 0.22, 1.25 - 0.55 * mare);
}
function marsH(P) {
  const Q = warpP(P, 1 / 12000, 2600), qx = Q.x, qy = Q.y, qz = Q.z;
  const lowland = 1 - smooth(0.42, 0.56, bfbm(qx / 26000 + 4, qy / 26000, qz / 26000, 3)); // a northern basin and southern highlands
  let h = (bfbm(qx / 26000 + 4, qy / 26000, qz / 26000, 3) - 0.5) * 1500 + (bfbm(qx / 7000, qy / 7000 + 2, qz / 7000, 5) - 0.5) * 320;
  const m = bfbm(qx / 5200 + 5, qy / 5200 + 2, qz / 5200, 3);
  h += 80 * smooth(0.45, 0.52, m) + 70 * smooth(0.6, 0.67, m) - 60 * lowland; // mesas rising in steps
  h += ridged(qx / 9000 + 31, qy / 9000, qz / 9000, 4) * 1500 * smooth(0.45, 0.7, bfbm(qx / 20000 + 1, qy / 20000, qz / 20000, 3)); // mountain ranges
  const band = Math.abs(bfbm(qx / 9000 + 9, qy / 9000, qz / 9000 + 1, 3) - 0.5);
  h -= 520 * (1 - smooth(0, 0.03, band)) * smooth(0.4, 0.55, bfbm(qx / 30000 + 8, qy / 30000, qz / 30000, 2)); // canyon systems, with steep walls
  // a great volcano in some of the big lattice cells
  { const S = 52000, ci = Math.floor(P.x / S), cj = Math.floor(P.y / S), ck = Math.floor(P.z / S);
    if (hash3(ci, cj, ck + 4001) < 0.28) {
      const Rv = 9000 + 5000 * hash3(ci, cj, ck + 4002);
      const cx = (ci + 0.3 + 0.4 * hash3(ci, cj, ck + 4003)) * S, cy = (cj + 0.3 + 0.4 * hash3(ci, cj, ck + 4004)) * S, cz = (ck + 0.3 + 0.4 * hash3(ci, cj, ck + 4005)) * S;
      const d = Math.sqrt((P.x - cx) ** 2 + (P.y - cy) ** 2 + (P.z - cz) ** 2) / Rv;
      if (d < 1) h += 3300 * Math.pow(1 - d, 1.1) * (1 - 0.1 * ridged(P.x / 400, P.y / 400, P.z / 400, 2)) - 340 * Math.exp(-(d * d) / 0.006);
    } }
  // sand: ripples and dunes laid down by the wind, thickest in the lowlands
  const t = (P.x * 0.8 + P.z * 0.6) / 95 + 4 * bfbm(P.x / 260, P.y / 260, P.z / 260, 2);
  const dune = Math.pow(0.5 + 0.5 * Math.sin(t * 6.2832), 2) * 9 * (0.25 + 0.75 * lowland) * smooth(0.35, 0.6, bfbm(P.x / 1800 + 6, P.y / 1800, P.z / 1800, 2));
  h += dune + craterField(P, MARS_CR, MARS_P, 0.14, 1) + (bfbm(P.x / 30, P.y / 30, P.z / 30, 2) - 0.5) * 3.5;
  return h;
}
function iceH(P) {
  const Q = warpP(P, 1 / 9000, 1800), qx = Q.x, qy = Q.y, qz = Q.z;
  let h = (bfbm(qx / 9000 + 21, qy / 9000, qz / 9000, 5) - 0.5) * 300;
  h += ridged(qx / 8000 + 7, qy / 8000, qz / 8000, 5) * 1900 * smooth(0.4, 0.65, bfbm(qx / 20000 + 2, qy / 20000, qz / 20000, 3)); // ice-clad ranges
  const flow = smooth(0.3, 0.6, bfbm(qx / 5000 + 5, qy / 5000, qz / 5000, 3));
  const c1 = Math.abs(bfbm(qx / 420 + 4, qy / 420, qz / 420, 2) - 0.5), c2 = Math.abs(bfbm(qx / 190 + 8, qy / 190, qz / 190 + 3, 2) - 0.5);
  h -= (14 * (1 - smooth(0, 0.022, c1)) + 7 * (1 - smooth(0, 0.03, c2))) * flow; // crevasse fields in the moving ice
  h += ridged(P.x / 140, P.y / 140, P.z / 140, 2) * 7 * flow; // pressure ridges
  const lake = smooth(0.68, 0.72, bfbm(P.x / 3500 + 12, P.y / 3500, P.z / 3500, 3));
  h = h * (1 - 0.92 * lake) - 22 * lake; // frozen lakes: dead flat
  const wind = (P.x * 0.6 + P.z * 0.8) / 38 + 3 * bfbm(P.x / 150, P.y / 150, P.z / 150, 2);
  return h + (1 - lake) * (Math.pow(0.5 + 0.5 * Math.sin(wind * 6.2832), 2) * 2.2) + (bfbm(P.x / 55, P.y / 55, P.z / 55, 2) - 0.5) * 4.5; // sastrugi: ridges carved by the wind
}
const bodyHeightP = (kind, P) => (kind === "moon" ? moonH(P) : kind === "mars" ? marsH(P) : iceH(P));
function bodyColor(kind, h, ny, P, conc, out) {
  const n = bfbm(P.x / 520 + 1, P.y / 520, P.z / 520, 4), n2 = cloudNoise3(P.x / 29, P.y / 29, P.z / 29), n3 = cloudNoise3(P.x / 6, P.y / 6, P.z / 6), sl = clamp((0.9 - ny) / 0.32, 0, 1);
  const ao = 1 - clamp(conc * 0.9, 0, 0.45);
  let r, g, b;
  if (kind === "moon") {
    const mare = smooth(0.46, 0.53, bfbm(P.x / 22000 + 3, P.y / 22000, P.z / 22000, 3));
    let v = lerp(0.46, 0.3, mare) + 0.2 * (n - 0.5) + 0.07 * (n2 - 0.5) + 0.04 * (n3 - 0.5) + clamp(h / 1800, -0.05, 0.12);
    v *= 1 - 0.4 * sl;
    r = v * 1.0; g = v * 0.985; b = v * 0.96 + 0.01 * mare;
  } else if (kind === "mars") {
    const lowland = 1 - smooth(0.42, 0.56, bfbm(P.x / 26000 + 4, P.y / 26000, P.z / 26000, 3));
    const dust = smooth(0.35, 0.65, n);
    r = lerp(0.4, 0.68, dust); g = lerp(0.23, 0.43, dust); b = lerp(0.16, 0.3, dust);
    const dark = lowland * smooth(0.45, 0.7, 1 - n2) * 0.7; // dark basalt sand in the basin
    r = lerp(r, 0.2, dark); g = lerp(g, 0.14, dark); b = lerp(b, 0.12, dark);
    const strata = 0.5 + 0.5 * Math.sin(h * 0.16 + 2 * n); // layered cliffs: bands of red and tan
    r = lerp(r, lerp(0.5, 0.72, strata), sl); g = lerp(g, lerp(0.3, 0.48, strata), sl); b = lerp(b, lerp(0.2, 0.34, strata), sl);
    const hi = smooth(1500, 3200, h); // pale frosted summits
    r = lerp(r, 0.88, hi * 0.5); g = lerp(g, 0.76, hi * 0.5); b = lerp(b, 0.66, hi * 0.5);
    const sp2 = 0.92 + 0.16 * (n2 - 0.5) + 0.06 * (n3 - 0.5); r *= sp2; g *= sp2; b *= sp2;
  } else {
    const snow = smooth(120, 600, h);
    const blue = smooth(0.35, 0.7, 1 - n2);
    r = lerp(lerp(0.74, 0.96, n), 0.6, blue * 0.5); g = lerp(lerp(0.85, 0.98, n), 0.76, blue * 0.5); b = lerp(lerp(0.95, 1.0, n), 0.95, blue * 0.5);
    const cre = smooth(-6, -16, h); r = lerp(r, 0.3, cre); g = lerp(g, 0.5, cre); b = lerp(b, 0.78, cre);
    const lake = smooth(-18, -22, h); r = lerp(r, 0.22, lake); g = lerp(g, 0.34, lake); b = lerp(b, 0.5, lake);
    r = lerp(r, 0.97, snow * (1 - sl)); g = lerp(g, 0.98, snow * (1 - sl)); b = lerp(b, 1, snow * (1 - sl));
    r = lerp(r, 0.42, sl * 0.9); g = lerp(g, 0.48, sl * 0.9); b = lerp(b, 0.56, sl * 0.9); // dark rock showing through the steep faces
    const sp2 = 0.95 + 0.1 * (n2 - 0.5); r *= sp2; g *= sp2; b *= sp2;
  }
  out[0] = r * ao; out[1] = g * ao; out[2] = b * ao;
}
function bodyDir(x, z, out) { // the unit vector, in the world's own frame, at a point of the chart
  return out.copy(bodyChart.p).multiplyScalar(curBody.R).addScaledVector(bodyChart.tx, x - BODY_OFFSET).addScaledVector(bodyChart.tz, z - BODY_OFFSET).normalize();
}
function bodyGroundY(x, z) { bodyDir(x, z, _bp).multiplyScalar(curBody.R); return bodyHeightP(curBody.kind, _bp); }

// ----- the ground tiles -----
const bodyGroup = new THREE.Group();
bodyGroup.visible = false;
scene.add(bodyGroup);
const BT = (() => {
  const N = 32, idx = new Uint16Array(N * N * 6);
  { let k = 0; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; } }
  const levels = [128, 512, 2048, 8192, 32768].map((size, li) => ({ size, tiles: new Map(), mat: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: li * 2, polygonOffsetUnits: li * 2 }) }));
  const H = new Float32Array((N + 3) * (N + 3)), P = new THREE.Vector3(), cc = [0, 0, 0];
  function build(L, ix, iz) {
    const lv = levels[L], step = lv.size / N, kind = curBody.kind, R = curBody.R;
    for (let j = -1; j <= N + 1; j++) for (let i = -1; i <= N + 1; i++) {
      bodyDir(BODY_OFFSET + ix * lv.size + i * step, BODY_OFFSET + iz * lv.size + j * step, P).multiplyScalar(R);
      H[(j + 1) * (N + 3) + i + 1] = bodyHeightP(kind, P);
    }
    const pos = new Float32Array((N + 1) * (N + 1) * 3), nor = new Float32Array((N + 1) * (N + 1) * 3), col = new Float32Array((N + 1) * (N + 1) * 3);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const hi = (j + 1) * (N + 3) + i + 1, h = H[hi];
      const dx = (H[hi + 1] - H[hi - 1]) / (2 * step), dz = (H[hi + N + 3] - H[hi - N - 3]) / (2 * step), l = Math.hypot(dx, 1, dz);
      const k = (j * (N + 1) + i) * 3;
      pos[k] = i * step; pos[k + 1] = h - (L > 0 ? step * 0.06 + L : 0); pos[k + 2] = j * step; // (coarser tiles sit a little lower, so the finer ones always show over them)
      nor[k] = -dx / l; nor[k + 1] = 1 / l; nor[k + 2] = -dz / l;
      bodyDir(BODY_OFFSET + ix * lv.size + i * step, BODY_OFFSET + iz * lv.size + j * step, P).multiplyScalar(R);
      const conc = ((H[hi - 1] + H[hi + 1] + H[hi - N - 3] + H[hi + N + 3]) * 0.25 - h) / step; // pits and hollows are darker
      bodyColor(kind, h, nor[k + 1], P, conc * 2.2, cc);
      col[k] = cc[0]; col[k + 1] = cc[1]; col[k + 2] = cc[2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.Mesh(g, lv.mat);
    m.frustumCulled = false;
    m.position.set(BODY_OFFSET + ix * lv.size, 0, BODY_OFFSET + iz * lv.size);
    bodyGroup.add(m);
    return m;
  }
  const drop = (m) => { bodyGroup.remove(m); m.geometry.dispose(); };
  return {
    update(maxBuilds) {
      const cx = player.x - BODY_OFFSET, cz = player.z - BODY_OFFSET;
      let builds = 0;
      levels.forEach((lv, L) => {
        const tx0 = Math.floor(cx / lv.size), tz0 = Math.floor(cz / lv.size), want = new Set();
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) want.add(tx0 + dx + "," + (tz0 + dz));
        for (const [k, m] of lv.tiles) if (!want.has(k)) (drop(m), lv.tiles.delete(k));
        for (const k of want) if (!lv.tiles.has(k) && builds < maxBuilds) { const [a, b] = k.split(",").map(Number); lv.tiles.set(k, build(L, a, b)); builds++; }
      });
      return builds;
    },
    clear() { for (const lv of levels) { for (const m of lv.tiles.values()) drop(m); lv.tiles.clear(); } },
  };
})();

// ----- boulders: scattered stones give the ground its scale -----
const ROCKS = (() => {
  const N = 1100, CELLR = 7, RAD = 180;
  const geo = new THREE.IcosahedronGeometry(1, 1);
  { const pa = geo.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), n = 0.74 + 0.5 * cloudNoise3(x * 1.7 + 3, y * 1.7, z * 1.7); pa.setXYZ(i, x * n, Math.max(y * n, -0.25 * n), z * n); } geo.computeVertexNormals(); }
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), N);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  bodyGroup.add(mesh);
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  let cx = 1e9, cz = 1e9;
  return {
    refresh(force) {
      if (!curBody || (!force && Math.hypot(player.x - cx, player.z - cz) < 35)) return;
      cx = player.x; cz = player.z;
      const kind = curBody.kind, dens = kind === "moon" ? 0.08 : kind === "mars" ? 0.1 : 0.022;
      const i0 = Math.floor((cx - RAD) / CELLR), i1 = Math.floor((cx + RAD) / CELLR), j0 = Math.floor((cz - RAD) / CELLR), j1 = Math.floor((cz + RAD) / CELLR);
      let n = 0;
      for (let j = j0; j <= j1 && n < N; j++) for (let i = i0; i <= i1 && n < N; i++) {
        if (hash3(i, j, 5151) > dens) continue;
        const k = hash3(i, j, 5152), sz = 0.22 + k * k * k * 2.8;
        const x = (i + hash3(i, j, 5153)) * CELLR, z = (j + hash3(i, j, 5154)) * CELLR;
        if (Math.hypot(x - cx, z - cz) > RAD) continue;
        const y = bodyGroundY(x, z);
        dummy.position.set(x, y + sz * 0.15, z);
        dummy.rotation.set(0.3 * (hash3(i, j, 5155) - 0.5), hash3(i, j, 5156) * 6.2832, 0.3 * (hash3(i, j, 5157) - 0.5));
        dummy.scale.set(sz * (0.8 + 0.5 * hash3(i, j, 5158)), sz * (0.5 + 0.4 * hash3(i, j, 5159)), sz * (0.8 + 0.5 * hash3(i, j, 5160)));
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        const v = 0.7 + 0.5 * hash3(i, j, 5161);
        if (kind === "moon") col.setRGB(0.36 * v, 0.355 * v, 0.35 * v);
        else if (kind === "mars") col.setRGB(0.36 * v, 0.2 * v, 0.14 * v);
        else col.setRGB(0.62 * v, 0.7 * v, 0.78 * v);
        mesh.setColorAt(n, col);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    },
  };
})();

// ----- flying in space -----
function nearestWorld(pos) { // [height above the nearest surface, which world (null: home)]
  let h = pos.length() - PLANET_R, nb = null;
  for (const b of BODY_LIST) { const a = _bp.copy(pos).sub(b.pos).length() - b.R; if (a < h) (h = a), (nb = b); }
  return [h, nb];
}
// turn the whole sky about you (the scene's axes in inertial space) while the way you are looking, and your velocity, stay fixed in space
function spRotate(q, keepLook = true) {
  const cp = Math.cos(pitch);
  _fw.set(0, 0, 0).addScaledVector(sp.ex, -Math.sin(yaw) * cp).addScaledVector(sp.ey, Math.sin(pitch)).addScaledVector(sp.ez, -Math.cos(yaw) * cp);
  _t2.set(0, 0, 0).addScaledVector(sp.ex, sp.vel.x).addScaledVector(sp.ey, sp.vel.y).addScaledVector(sp.ez, sp.vel.z);
  sp.ex.applyQuaternion(q); sp.ey.applyQuaternion(q); sp.ez.applyQuaternion(q);
  sp.vel.set(_t2.dot(sp.ex), _t2.dot(sp.ey), _t2.dot(sp.ez));
  if (keepLook) setLookFromScene(_t1.set(_fw.dot(sp.ex), _fw.dot(sp.ey), _fw.dot(sp.ez))); // (in a headset the head sets the look, so the sky turns round it instead)
  SQ.ex.copy(sp.ex); SQ.ey.copy(sp.ey); SQ.ez.copy(sp.ez);
}
function updateSpacePlayer(dt) {
  readControls(dt);
  camera.getWorldDirection(camDir3);
  const [h0, nb] = nearestWorld(sp.pos), h = Math.max(h0, 1);
  // slow near a world, fast in the empty between: the closer you are, the less of your height counts
  const pre = SPACE_SPEEDS[opts.flightSpd], speed = Math.min(pre[1], 30 + pre[0] * h * (0.06 + 0.94 * smooth(8000, 500000, h)));
  sp.vmax = speed; sp.near = nb; sp.h = h0;
  _want.set(0, 0, 0);
  const fd = flightDirection();
  if (fd) _want.copy(fd).multiplyScalar(speed);
  const mag = Math.hypot(input.x, input.z);
  if (mag > 0) {
    camera.getWorldQuaternion(_qq);
    _right.set(1, 0, 0).applyQuaternion(_qq);
    _want.addScaledVector(_right, input.x * speed * 0.5).addScaledVector(camDir3, -input.z * speed * 0.5);
  }
  sp.vel.lerp(_want, 1 - Math.exp(-dt * (fd || mag > 0 ? 2.5 : 4)));
  sp.pos.add(toInertial(_t1.copy(sp.vel).multiplyScalar(dt), _t2));
  if (nb && h < nb.R * 10) sp.pos.add(_t2.copy(nb.pos).sub(nb.prev)); // (stay with the world as it circles, so it does not slide away beneath you)
  // coming in to a world, the horizon slowly turns to lie level with it (the view itself does not turn: only which way is "up"), so landing is no flip
  if (!renderer.xr.isPresenting) {
    _t3.copy(sp.pos); if (nb) _t3.sub(nb.pos);
    const rr = _t3.length(), R0 = nb ? nb.R : PLANET_R, wgt = 1 - smooth(1.5, 6, rr / R0);
    if (wgt > 0.001 && rr > 1 && Math.abs(input.roll) < 0.1) {
      _t3.multiplyScalar(1 / rr);
      const ang = Math.acos(clamp(sp.ey.dot(_t3), -1, 1));
      _t1.crossVectors(sp.ey, _t3);
      if (ang > 1e-4 && _t1.lengthSq() > 1e-10) {
        _t1.normalize();
        _qq.setFromAxisAngle(_t1, ang * (1 - Math.exp(-dt * 1.2 * wgt)));
        spRotate(_qq);
      }
    }
  }
  if (Math.abs(input.roll) > 0.02) { // roll about the way you look
    const vr = renderer.xr.isPresenting;
    if (vr) { camera.getWorldDirection(_t3); _t1.set(0, 0, 0).addScaledVector(sp.ex, _t3.x).addScaledVector(sp.ey, _t3.y).addScaledVector(sp.ez, _t3.z); }
    else { const cp = Math.cos(pitch); _t1.set(0, 0, 0).addScaledVector(sp.ex, -Math.sin(yaw) * cp).addScaledVector(sp.ey, Math.sin(pitch)).addScaledVector(sp.ez, -Math.cos(yaw) * cp); }
    spRotate(_qq.setFromAxisAngle(_t1.normalize(), input.roll * dt * 1.2), !vr);
  }
  if (Math.abs(input.pitch) > 0.02) { // pitch: forward on the stick is nose down
    if (renderer.xr.isPresenting) { // (the sky turns about your head's right-hand side)
      camera.getWorldQuaternion(_qq);
      _t3.set(1, 0, 0).applyQuaternion(_qq);
      _t1.set(0, 0, 0).addScaledVector(sp.ex, _t3.x).addScaledVector(sp.ey, _t3.y).addScaledVector(sp.ez, _t3.z).normalize();
      spRotate(_qq.setFromAxisAngle(_t1, input.pitch * dt * 1.0), false);
    } else pitch = clamp(pitch + input.pitch * dt * 1.0, -1.5, 1.5);
  }
  rig.position.set(BODY_OFFSET, 0, BODY_OFFSET);
  rig.rotation.y = yaw;
  if (!renderer.xr.isPresenting) camera.rotation.set(pitch, 0, 0, "YXZ");
  vigWant = 0;
}

// ----- changing worlds -----
// While you are away the home world's things (the island, dock, boat, fish, ships...) are switched off, so the other worlds can sit round the
// origin of the coordinates, where the GPU's numbers are small and exact (the same idea as a "floating origin").
let earthHidden = null;
const isAwayThing = (c) => !(c === bodyGroup || c === spaceGroup || c === sky || c === planet || c === atmosphere || c === rig || c.isLight || !(c.isMesh || c.isGroup || c.isPoints || c.isLine || c.isSprite));
function setEarthHidden(on) {
  if (on && !earthHidden) {
    earthHidden = [];
    for (const c of scene.children) if (isAwayThing(c) && c.visible) { c.visible = false; earthHidden.push(c); }
  } else if (!on && earthHidden) {
    for (const c of earthHidden) c.visible = true;
    earthHidden = null;
  }
}
function enterSpace() {
  sp.ex.copy(SQ.ex); sp.ey.copy(SQ.ey); sp.ez.copy(SQ.ez);
  sp.pos.copy(pIn);
  sp.vel.copy(player.fv);
  earthSave = { x: player.x, z: player.z, face: curFace };
  sp.on = true;
  setEarthHidden(true);
  flashHint("Space. Hold the trigger (or Space) to fly where you look, and the stick (or WASD) to drift.");
}
function leaveSpaceToEarth() {
  lookDirScene(_t1); toInertial(_t1, _fw); // where you look, in inertial space
  toInertial(sp.vel, _t3); // and your velocity
  spinVec(_t1.copy(sp.pos), -game.spin, _t2).normalize();
  dirFace(_t2, _fo);
  curFace = _fo.f;
  player.x = FACE_C[curFace][0] + _fo.lx;
  player.z = FACE_C[curFace][1] + _fo.lz;
  player.y = Math.max(0, sp.pos.length() - PLANET_R);
  player.vy = 0; player.grounded = false; player.swim = false; player.under = false;
  faceFrame(curFace, _fo.lx, _fo.lz, PF.p, PF.tx, PF.tz);
  spinVec(PF.tx, game.spin, SQ.ex); spinVec(PF.p, game.spin, SQ.ey); spinVec(PF.tz, game.spin, SQ.ez);
  setLookFromScene(_t1.set(_fw.dot(SQ.ex), _fw.dot(SQ.ey), _fw.dot(SQ.ez)));
  player.fv.set(_t3.dot(SQ.ex), _t3.dot(SQ.ey), _t3.dot(SQ.ez));
  sp.on = false;
  setEarthHidden(false);
  screenFade = Math.max(screenFade, 0.5);
}
function landOn(b) {
  lookDirScene(_t1); toInertial(_t1, _fw);
  toInertial(sp.vel, _t3);
  _t1.copy(sp.pos).sub(b.pos);
  const alt = _t1.length() - b.R;
  spinVec(_t1.normalize(), -game.spin, bodyChart.p);
  bodyChart.tx.set(0, 1, 0).cross(bodyChart.p);
  if (bodyChart.tx.lengthSq() < 1e-4) bodyChart.tx.set(1, 0, 0);
  bodyChart.tx.normalize();
  bodyChart.tz.crossVectors(bodyChart.tx, bodyChart.p);
  curBody = b; sp.on = false; GRAV = b.g;
  player.x = BODY_OFFSET; player.z = BODY_OFFSET;
  player.y = alt; player.vy = 0; player.grounded = false; player.swim = false; player.under = false;
  spinVec(bodyChart.tx, game.spin, SQ.ex); spinVec(bodyChart.p, game.spin, SQ.ey); spinVec(bodyChart.tz, game.spin, SQ.ez);
  setLookFromScene(_t1.set(_fw.dot(SQ.ex), _fw.dot(SQ.ey), _fw.dot(SQ.ez)));
  player.fv.set(_t3.dot(SQ.ex), _t3.dot(SQ.ey), _t3.dot(SQ.ez));
  { const cap = 22 + 1.4 * Math.max(0, alt); if (player.fv.length() > cap) player.fv.setLength(cap); } // (arrive at a walking-pace-for-the-height, not at your space speed)
  bodyGroup.visible = true;
  setEarthHidden(true);
  BT.clear();
  BT.update(999);
  ROCKS.refresh(true);
  screenFade = Math.max(screenFade, 0.7);
  flashHint("Landing on " + b.name + (b.g < 3 ? " (low gravity: jump!)" : ""));
}
function takeOff() {
  sp.ex.copy(SQ.ex); sp.ey.copy(SQ.ey); sp.ez.copy(SQ.ez);
  sp.pos.copy(pIn);
  sp.vel.copy(player.fv);
  curBody = null; GRAV = 9.8; bodyGroup.visible = false; BT.clear();
  if (earthSave) { player.x = earthSave.x; player.z = earthSave.z; curFace = earthSave.face; }
  player.y = 0;
  sp.on = true;
  setEarthHidden(true);
  flashHint("Space. Hold the trigger (or Space) to fly where you look.");
}
function exitToEarth() { // back to the home world's own coordinates (the caller then puts you somewhere)
  if (curBody) { curBody = null; GRAV = 9.8; bodyGroup.visible = false; BT.clear(); }
  sp.on = false;
  setEarthHidden(false);
  if (earthSave) { player.x = earthSave.x; player.z = earthSave.z; curFace = earthSave.face; }
}
function updateBodyChart() { // far from where the chart was laid, lay it down again here
  const dx = player.x - BODY_OFFSET, dz = player.z - BODY_OFFSET, lim = curBody.R * 0.18;
  if (Math.abs(dx) < lim && Math.abs(dz) < lim) return;
  const hx = -Math.sin(yaw), hz = -Math.cos(yaw);
  _t1.copy(bodyChart.p).multiplyScalar(curBody.R).addScaledVector(bodyChart.tx, dx).addScaledVector(bodyChart.tz, dz).normalize(); // the new "up"
  _fw.copy(bodyChart.tx).multiplyScalar(hx).addScaledVector(bodyChart.tz, hz); // heading, in the world's frame
  _t3.set(player.fv.x, 0, player.fv.z); _t2.copy(bodyChart.tx).multiplyScalar(_t3.x).addScaledVector(bodyChart.tz, _t3.z);
  bodyChart.p.copy(_t1);
  bodyChart.tx.addScaledVector(_t1, -bodyChart.tx.dot(_t1)).normalize();
  bodyChart.tz.crossVectors(bodyChart.tx, bodyChart.p);
  yaw = Math.atan2(-_fw.dot(bodyChart.tx), -_fw.dot(bodyChart.tz));
  player.fv.x = _t2.dot(bodyChart.tx); player.fv.z = _t2.dot(bodyChart.tz);
  player.x = BODY_OFFSET; player.z = BODY_OFFSET;
  BT.clear();
  BT.update(999);
  ROCKS.refresh(true);
}
function travelTransitions() {
  if (!sp.on && !curBody) {
    if (player.y > SPACE_ENTER && !player.grounded) enterSpace();
    return;
  }
  if (sp.on) {
    if (sp.pos.length() - PLANET_R < SPACE_EXIT) return leaveSpaceToEarth();
    for (const b of BODY_LIST) {
      _bp.copy(sp.pos).sub(b.pos);
      const d = _bp.length();
      if (!b.landable) {
        if (d < b.R * 1.004) {
          // no ground to land on: hold at the cloud tops
          _bp.multiplyScalar(1 / d);
          sp.pos.copy(b.pos).addScaledVector(_bp, b.R * 1.004);
          toInertial(sp.vel, _t2);
          _t2.addScaledVector(_bp, -Math.min(0, _t2.dot(_bp)));
          sp.vel.set(_t2.dot(SQ.ex), _t2.dot(SQ.ey), _t2.dot(SQ.ez));
          if (!travelTransitions.warned || performance.now() - travelTransitions.warned > 8000) { travelTransitions.warned = performance.now(); flashHint("The gas giant has no ground: only cloud, all the way down."); }
        }
        continue;
      }
      if (d - b.R < LAND_ALT) return landOn(b);
    }
    return;
  }
  if (curBody && player.y > BODY_EXIT) takeOff();
}
// a quick way to be somewhere: in space, 40 km from a world, looking at it
function warpToBody(b) {
  if (curBody) takeOff();
  else if (!sp.on) { computeFrame(); enterSpace(); }
  const away = _t2.copy(SUN_POS).sub(b.pos).normalize().addScaledVector(b.pos.clone().negate().normalize(), 0.4).normalize(); // (the side the sun lights)
  sp.pos.copy(b.pos).addScaledVector(away, b.R + (b.landable ? 40000 : 90000));
  sp.vel.set(0, 0, 0);
  _fw.copy(b.pos).sub(sp.pos).normalize();
  setLookFromScene(_t1.set(_fw.dot(sp.ex), _fw.dot(sp.ey), _fw.dot(sp.ez)));
  pitch = clamp(pitch, -1.4, 1.4);
  screenFade = 1;
  toggleMenu(false);
}

// ===== Frame loop: a full day and night in eight minutes =====
const DAY_SECONDS = 480;
const game = { hours: rand(0, 24), speed: 1, spin: 0, t: 0 }; // a random time of day each visit; spin = how far the planet has turned, t = hours played
updatePlayerFrame();
game.spin = spinForHour(game.hours);
let prevHours = game.hours;
let dayIdx = 0;
let last = performance.now();
function frame(now) {
  samplePerf((now - last) / 1000);
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  shared.uTime.value += dt;
  const t = shared.uTime.value;
  {
    const dh = (dt * 24 * game.speed) / DAY_SECONDS;
    game.t += dh;
    game.spin += (dh / 24) * Math.PI * 2;
    updatePlayerFrame();
    computeFrame();
    if (!sp.on && !curBody) game.hours = hoursFromSpin(); // (the time where you are: it moves on as you travel east)
    const di = Math.floor(game.t / 24);
    if (di !== dayIdx) {
      dayIdx = di;
      if (!weather.locked) { weather.fogDay = Math.random() < 0.05; weather.fogTimer = 0; } // each new day may bring a fog day (rarely)
    }
    prevHours = game.hours;
  }

  updateWeather(dt);
  windU.uWind.value.set(Math.cos(weather.windAngle), Math.sin(weather.windAngle));
  windU.uWindStr.value += (clamp(weather.windSpeed / 24, 0, 1) - windU.uWindStr.value) * (1 - Math.exp(-dt));
  const env = applyEnvironment(game.hours);
  updateIslUniforms(camPos.x, camPos.z);
  checkBoatKey();
  updateBoatMoor(dt, t, env.lampsOn); // (before the player, so people aboard are carried with it)
  audio.engine(boatDrive.on ? clamp(Math.abs(moor.speed) / (BOAT_MAX0 * BOAT_SPEEDS[opts.boatSpd][1]) + 0.25 * Math.abs(boatDrive.throttle), 0, 1) : 0);
  if (sp.on) updateSpacePlayer(dt);
  else {
    updatePlayer(dt);
    if (curBody) { updateBodyChart(); BT.update(1); ROCKS.refresh(); } else updateFace();
  }
  travelTransitions();
  computeFrame(); // (again, now you have moved: the worlds in the sky are placed from where you are, not where you were a moment ago)
  rig.updateMatrixWorld(true);
  camera.getWorldPosition(camPos);
  {
    // under the water? (a little hysteresis so the surface doesn't flicker)
    const sh = waveHeight(camPos.x, camPos.z, t);
    const u = !sp.on && !curBody && camPos.y < sh + (player.under ? 0.03 : -0.03) && player.waterSm - groundY(player.x, player.z) > 0.4; // (only ever on the home world)
    if (u !== player.under) {
      player.under = u;
      audio.underwater(u);
      if (!u) splash(camPos.x, sh, camPos.z, 8, 1.6);
    }
    shared.uUnder.value = u ? 1 : 0;
    water.renderOrder = u ? -5 : 1; // from below the surface is drawn first, so it hides what is above it
    water.material.depthWrite = u;
    sky.visible = !u;
    farOcean.visible = !u && camPos.y <= 150; // (above that, the planet's own sea, traced in updateSpace, stands in for it)
    foamLayer.visible = !u;
    if (u) {
      shared.uUnderCol.value.setRGB(0.03, 0.3, 0.36).multiplyScalar(0.12 + 0.88 * clamp(shared.uLightLevel.value, 0, 1));
      scene.fog.color.copy(shared.uUnderCol.value);
      scene.fog.near = 0.5;
      scene.fog.far = 48;
      landUniforms.uFogN.value = 0.5;
      landUniforms.uFogF.value = 48;
      renderer.setClearColor(shared.uUnderCol.value);
    }
  }
  updateSpace(dt);
  updateNav();
  if (camPos.y < 2500) skyCache.update(camPos);
  updateWorld(dt, t, env.lampsOn);
  seaLife.update(t, dt, env.lampsOn, env.light);
  updateMinimap(dt);

  if (opts.festival) {
    updateSky(dt, t, env.lampsOn);
    updateLotus(dt, t, env.lampsOn);
  }
  updateReef();
  updateReefFish(dt, t);
  updateLeapFish(dt, t);
  updateSplashes(dt);
  if (opts.festival) garland.update(t, env.lampsOn);
  fire.update(dt, t);
  updateLamps(env.lampsOn);
  updateProps(dt);
  updateMenu(dt);
  updateFireworks(dt);
  updateDrone(dt, t);
  updateDroneView(dt);
  updateImprint(dt);
  updateLighthouse(dt, env.lampsOn);
  updateRain(dt, env.lightLevel);
  if (player.under) rain.visible = false;
  const sdAll = sp.on || curBody ? -1e4 : shoreDistAll(player.x, player.z); // (metres out to sea; negative on land)
  audio.update(weather.value, wx.rain, waveScale, curBody || sp.on ? 1e4 : Math.abs(sdAll), sp.on ? 0 : curBody ? (curBody.kind === "mars" ? 0.25 : curBody.kind === "ice" ? 0.15 : 0) : 1 - smooth(1500, 12000, spaceState.alt), !!(sp.on || curBody), sdAll > 0 || player.swim || player.under ? 1 : 1 - smooth(25, 140, -sdAll));

  // Everything big follows the camera, so the sea, sky and horizon are always centred on you
  water.position.set(Math.round(camPos.x / WATER_STEP) * WATER_STEP, 0, Math.round(camPos.z / WATER_STEP) * WATER_STEP);
  farOcean.position.set(camPos.x, 0, camPos.z);
  sky.position.copy(camPos);
  waterUniforms.uCamPos.value.copy(camPos);

  const vm = vignette.material;
  vm.opacity += (vigWant - vm.opacity) * (1 - Math.exp(-dt * 6));
  vignette.visible = vm.opacity > 0.02;
  screenFade = Math.max(0, screenFade - dt * 1.8);
  fadeQuad.material.opacity = screenFade;
  fadeQuad.visible = screenFade > 0.01;
  if (earthHidden) for (const c of scene.children) if (c.visible && isAwayThing(c) && c !== planet) { c.visible = false; earthHidden.push(c); } // (whatever the home world's code switched back on)
  curveCam.value.copy(camPos);
  renderer.render(scene, camera);
  drawPip();
}

// ===== Entering VR, sound, resize =====
const startAudio = () => audio.start();
addEventListener("pointerdown", startAudio, { once: true });
addEventListener("keydown", startAudio, { once: true });
setTimeout(() => ($("hint").style.opacity = 0), 16000);
if (!navigator.xr) {
  $("vr").textContent = window.isSecureContext ? "VR not available in this browser" : "VR needs https";
  $("vr").style.opacity = 0.6;
} else {
  navigator.xr.isSessionSupported("immersive-vr").then((ok) => {
    if (!ok) {
      $("vr").textContent = "No VR headset found";
      $("vr").style.opacity = 0.6;
    }
  }).catch(() => {});
}
$("vr").onclick = async () => {
  try {
    startAudio();
    const session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor"] });
    await renderer.xr.setSession(session);
    $("vr").hidden = true;
    $("hint").style.opacity = 0;
    session.addEventListener("end", () => {
      camera.position.set(0, 1.65, 0);
      camera.quaternion.identity();
      pitch = 0;
      $("vr").hidden = false;
    });
  } catch (e) {
    $("vr").textContent = "VR unavailable: " + e.message;
  }
};
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(frame);
// handy for testing in a desktop browser
window.__lt = { travel: { clearFade: () => { screenFade = 0; }, sunLight, hemiLight, scene, bodyGroup, sp, BODIES, warpToBody, landOn, takeOff, exitToEarth, bodyGroundY, BT, get curBody() { return curBody; }, get GRAV() { return GRAV; }, spaceState }, teleportTo, moonDir: () => shared.uMoonDir.value.toArray(), sunDirArr: () => shared.uSunDir.value.toArray(), setTime, faceInfo: () => ({ curFace, FACE_C, FACE_W, PLANET_R }), updateFace, nearestPOI, planetCells, cellsByDistance, setWeatherPreset, wx, mapBake, spaceState, planet, atmosphere, islandRoad, worldRoot, renderer, chunks, islandCell, nearestIsland, loadChunkNow, teleportToIsland, islandPOIs, poiSave, boatClearance, bedHeightJS, boatDrive, TELEPORTS, blocked, opts, applyOpts, rockSurfaces, rockSurfaceAt, surfaceAt, setImprintRes, camPos, perf, applyPerf, drawMenu, menuCanvas, hudCanvas, menu, props, drone, fireworks, rockets, controllerProp, dronePad, camera, water, lotuses, reefMeshes, kelp, boat, moor, dock, stick, stampSeg, stampFoot, look: (y, p) => ((yaw = y), (pitch = p)), weather, game, player, waveHeight };
