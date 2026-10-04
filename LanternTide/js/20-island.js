"use strict";
// ===== The island =====
const colliders = []; // circles the player can't walk through
// Marks in the sand live in a texture that wraps around the player (48 m across): footprints and drawn lines are
// stamped in, and the sea, rain and time slowly smooth them away.
const IMP_S = 48;
let IMP_N = 1536;
const makeImpRT = (n) => new THREE.WebGLRenderTarget(n, n, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false });
let impRT = makeImpRT(IMP_N);
const landUniforms = Object.assign({}, shared, {
  uImprint: { value: impRT.texture },
  uImpN: { value: IMP_N },
  uImpPlayer: { value: new THREE.Vector2() },
  uWet: { value: 0 },
  uCamPos: waterUniforms.uCamPos,
  uFogN: { value: 120 },
  uFogF: { value: 900 },
  uLampPos: waterUniforms.uLampPos,
  uLampColor: waterUniforms.uLampColor,
});

// The ground. Sand is shaded procedurally: wind ripples and grains with a bump-mapped relief, quartz and mineral
// specks, shells and kelp left along the high-tide line, damp dark sand that the swash keeps soaking and
// shining, and dune grass taking over higher up. The same bedHeight drives the water, so they always meet.
const land = new THREE.Mesh(
  (() => {
    const RIN = ISL.r + 30, RINGS_IN = 150, RINGS_OUT = 24, ROUT = ISL.r + 130; // (the outer rings are the sea floor you can swim over)
    const RINGS = RINGS_IN + RINGS_OUT;
    const SEGS = 240;
    const pos = [], idx = [];
    for (let i = 0; i <= RINGS; i++) {
      const r = i <= RINGS_IN ? (i / RINGS_IN) * RIN : RIN + Math.pow((i - RINGS_IN) / RINGS_OUT, 1.4) * (ROUT - RIN);
      for (let j = 0; j <= SEGS; j++) {
        const a = (j / SEGS) * Math.PI * 2;
        const x = ISL.x + Math.cos(a) * r, z = ISL.z + Math.sin(a) * r;
        pos.push(x, bedHeightJS(x, z), z);
      }
    }
    for (let i = 0; i < RINGS; i++)
      for (let j = 0; j < SEGS; j++) {
        const a = i * (SEGS + 1) + j, b = a + SEGS + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b); // wound to face up
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  })(),
  new THREE.ShaderMaterial({
    uniforms: landUniforms,
    vertexShader: /* glsl */ `
      uniform float uCurve;
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vN = normal;
        vec2 cdl = wp.xz - cameraPosition.xz;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp.x, wp.y - dot(cdl, cdl) * uCurve, wp.z, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      ${NOISE_GLSL}
      ${CLOUD_GLSL}
      ${SHORE_GLSL}
      const float IMP_S = ${IMP_S.toFixed(1)};
      uniform float uImpN;
      #define IMP_N uImpN
      uniform sampler2D uImprint;
      uniform vec2 uImpPlayer;
      uniform float uWet;
      uniform vec3 uCamPos;
      uniform float uFogN;
      uniform float uFogF;
      uniform vec3 uLampPos[${MAX_LAMPS}];
      uniform vec3 uLampColor[${MAX_LAMPS}];
      varying vec3 vWorld;
      varying vec3 vN;

      // Fine relief of the sand: wind ripples (bent by noise), lumps and grains
      float sandRelief(vec2 p) {
        vec2 w = vec2(vnoise(p * 0.35), vnoise(p * 0.35 + 7.0)) * 3.0;
        float rip = sin((p.y + w.y) * 5.0 + vnoise(p * 0.9) * 6.0) * 0.5 + 0.5;
        rip *= rip;
        float grain = vnoise(p * 55.0) * 0.6 + vnoise(p * 130.0) * 0.4;
        return rip * 0.02 + grain * 0.004 + vnoise(p * 1.6) * 0.035;
      }
      // Scattered small things on a jittered grid (shells, pebbles, kelp): mask, and a random "kind"
      float scatter(vec2 p, float scale, float prob, float size, out float kind) {
        vec2 cp = p * scale;
        vec2 ci = floor(cp);
        vec2 cf = fract(cp);
        vec2 c = 0.5 + (vec2(hash(ci), hash(ci + 17.3)) - 0.5) * 0.6;
        float sz = size * (0.5 + hash(ci + 41.7));
        kind = hash(ci + 5.1);
        float present = step(1.0 - prob, hash(ci + 3.7));
        return (1.0 - smoothstep(sz * 0.55, sz, length(cf - c))) * present;
      }

      void main() {
        vec3 toCam = uCamPos - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        if (uUnder < 0.5 && vWorld.y < -2.5) discard; // the deep sea floor is hidden by the water: don't shade it
        vec2 p = vWorld.xz;
        float y = vWorld.y;
        float near = 1.0 - smoothstep(12.0, 70.0, dist);

        // How far up the beach the swash keeps the sand wet, and where the dune grass takes over
        float tide = swashLevel(p, uTime);
        float wetTop = 0.4 + tide * 1.4 + (vnoise(p * 0.6) - 0.5) * 0.2;
        float gt = smoothstep(1.2, 2.3, y + (fbm(p * 0.1) - 0.5) * 1.7 + (vnoise(p * 2.5) - 0.5) * 0.5);
        gt = smoothstep(0.3, 0.7, gt);
        float wet = (1.0 - smoothstep(wetTop - 0.4, wetTop, y)) * (1.0 - gt);
        wet = max(wet, uWet * 0.55 * (1.0 - gt));
        float shine = (1.0 - smoothstep(tide - 0.02, tide + 0.05, y)) * (1.0 - gt); // sheet of water just left behind

        // Surface normal: the ground's own, plus ripples (fading with distance so far sand doesn't shimmer)
        vec3 N = normalize(vN);
        float e = 0.03;
        float h0 = sandRelief(p);
        vec2 g = vec2(sandRelief(p + vec2(e, 0.0)) - h0, sandRelief(p + vec2(0.0, e)) - h0) / e;
        // marks left in the sand: footprints and drawn lines
        vec2 iuv = p / IMP_S;
        vec2 dw = abs(p - uImpPlayer);
        float inWin = 1.0 - smoothstep(IMP_S * 0.5 - 4.5, IMP_S * 0.5 - 3.0, max(dw.x, dw.y));
        float ipx = 1.0 / IMP_N;
        float I0 = texture2D(uImprint, iuv).r;
        float Ix = texture2D(uImprint, iuv + vec2(ipx, 0.0)).r - texture2D(uImprint, iuv - vec2(ipx, 0.0)).r;
        float Iz = texture2D(uImprint, iuv + vec2(0.0, ipx)).r - texture2D(uImprint, iuv - vec2(0.0, ipx)).r;
        float sandOnly = (1.0 - gt) * inWin * (1.0 - smoothstep(25.0, 40.0, dist));
        I0 *= sandOnly;
        Ix *= sandOnly;
        Iz *= sandOnly;
        g *= mix(1.0, 0.3, wet) * near * (1.0 - gt) * (1.0 - I0);
        g += (vec2(vnoise(p * 14.0), vnoise(p * 14.0 + 5.0)) - 0.5) * 1.6 * gt * near; // grass blades
        // (a mark is a hollow: the surface falls into it, so its slope is the mark's gradient, not the opposite)
        N = normalize(N + vec3(-g.x, 0.0, -g.y) * 1.3 + vec3(Ix, 0.0, Iz) * (0.045 * IMP_N / IMP_S));

        // Sand colour: warm, patchy, with grains, quartz sparkles and dark mineral flecks
        float patchN = vnoise(p * 0.3) * 0.6 + vnoise(p * 1.7) * 0.4;
        vec3 sand = mix(vec3(0.82, 0.70, 0.50), vec3(0.94, 0.86, 0.68), patchN);
        sand *= 0.9 + 0.2 * vnoise(p * 7.0);
        float grainH = hash(floor(p * 160.0));
        sand *= 0.92 + 0.16 * grainH * near + 0.08 * (1.0 - near);
        sand = mix(sand, vec3(0.98, 0.95, 0.88), step(0.987, grainH) * 0.8 * near);
        sand = mix(sand, vec3(0.38, 0.32, 0.26), step(grainH, 0.01) * 0.8 * near);
        float ripCol = sandRelief(p);
        sand *= 0.93 + 3.5 * (ripCol - 0.03) * (1.0 - wet);

        // The high-tide line: shells, pebbles and dark kelp
        float band = smoothstep(0.3, 0.55, y) * (1.0 - smoothstep(0.85, 1.25, y));
        float kind;
        float s1 = scatter(p, 3.0, 0.14, 0.055, kind) * band * near;
        sand = mix(sand, kind < 0.55 ? vec3(0.95, 0.9, 0.84) : vec3(0.3, 0.24, 0.14), s1 * 0.85);
        float s2 = scatter(p + 9.0, 5.5, 0.12, 0.07, kind) * (1.0 - gt) * near;
        sand = mix(sand, mix(vec3(0.5, 0.46, 0.42), vec3(0.72, 0.66, 0.58), kind), s2 * 0.9);

        // Damp sand: darker and richer
        sand = mix(sand, sand * vec3(0.55, 0.5, 0.45), wet);

        // Dune grass: green with dry yellow patches, streaked like blades; a few tufts seeding into the sand
        float blades = vnoise(p * vec2(26.0, 26.0)) * 0.5 + vnoise(p * 60.0) * 0.5;
        vec3 green = mix(vec3(0.22, 0.38, 0.12), vec3(0.45, 0.52, 0.2), vnoise(p * 0.5));
        green = mix(green, vec3(0.62, 0.56, 0.28), smoothstep(0.5, 0.8, fbm(p * 0.07 + 3.0)) * 0.7);
        green *= 0.65 + 0.7 * blades;
        float seed = scatter(p + 21.0, 2.2, 0.35, 0.16, kind) * (1.0 - gt) * smoothstep(0.7, 1.5, y);
        vec3 albedo = mix(sand, vec3(0.3, 0.42, 0.16), seed * 0.85);
        albedo = mix(albedo, green, gt);
        albedo *= mix(1.0, 0.75, uWet * gt);
        albedo *= 1.0 - 0.3 * I0;
        albedo = mix(albedo, albedo * vec3(0.78, 0.7, 0.62), smoothstep(0.1, 0.9, I0)); // damp, packed sand at the bottom of a groove
        // large, slow patches of lighter and darker, warmer and cooler ground, on a turned grid so no pattern repeats along the axes
        {
          vec2 pr = mat2(0.8, -0.6, 0.6, 0.8) * p;
          albedo *= 0.86 + 0.28 * fbm(pr * 0.013 + 5.0);
          albedo = mix(albedo, albedo * vec3(1.08, 1.02, 0.88), smoothstep(0.55, 0.78, vnoise(pr * 0.045 + 2.0)) * 0.7);
          albedo = mix(albedo, albedo * vec3(0.9, 1.0, 1.06), smoothstep(0.6, 0.8, vnoise(pr * 0.09 - 7.0)) * 0.5);
          // the sea floor in the shallows: cooler and greener, with the dancing net of caustics
          float shal = (1.0 - smoothstep(-0.5, 0.15, y)) * smoothstep(-7.0, -0.8, y);
          float cwv = sin(p.x * 1.7 + sin(p.y * 1.3 + uTime * 0.9) * 1.5 + uTime) * sin(p.y * 1.9 + sin(p.x * 1.1 - uTime * 0.7) * 1.5 - uTime * 0.8);
          albedo = mix(albedo, albedo * vec3(0.7, 1.0, 0.96), shal * 0.45);
          albedo *= 1.0 + 0.55 * pow(max(cwv, 0.0), 3.0) * shal * uSunVis;
        }

        // Light: sun (dimmed by cloud shadows), sky, moon, and nearby lamps
        float cSh = mix(1.0, cloudShadow(vWorld, uSunDir), uSunVis);
        float diff = max(dot(N, uSunDir), 0.0) * uSunVis * cSh;
        vec3 skyA = mix(uHorizon, uTop, 0.4);
        vec3 amb = mix(vec3(dot(skyA, vec3(0.333))), skyA, 0.55) * 0.85 + vec3(0.03, 0.04, 0.075);
        amb *= 0.6 + 0.4 * (N.y * 0.5 + 0.5);
        vec3 moon = vec3(0.3, 0.38, 0.6) * max(dot(N, uMoonDir), 0.0) * uStars * 0.35 * uMoonI * (0.1 + 0.9 * uMoonPhase);
        vec3 col = albedo * (uSunColor * diff * 0.95 + amb * 0.9 + moon);
        for (int i = 0; i < ${MAX_LAMPS}; i++) {
          vec3 L = uLampPos[i] - vWorld;
          float ld = length(L);
          L /= ld;
          float att = 1.0 - smoothstep(0.0, 11.0, ld);
          att *= att;
          col += albedo * uLampColor[i] * att * (0.35 + 0.65 * max(dot(N, L), 0.0));
        }

        // Wet sand shines: sun glints and a reflection of the sky
        vec3 Hh = normalize(V + uSunDir);
        float spec = pow(max(dot(N, Hh), 0.0), 70.0) * uSunVis * cSh;
        float fr = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 rr = reflect(-V, N);
        rr.y = abs(rr.y);
        float gloss = max(wet * 0.55, shine) * (1.0 - gt);
        col += uSunColor * spec * gloss * 1.4;
        col = mix(col, skyColor(rr) * 0.9, gloss * (0.1 + fr * 0.6));

        col = 1.0 - exp(-col * 1.35); // soft highlights, so bright sun doesn't clip the sand to white
        col *= mix(vec3(1.0), vec3(0.55, 0.85, 0.9), uUnder);
        col = mix(col, mix(uHorizon, uUnderCol, uUnder), smoothstep(uFogN, uFogF, dist));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
);
land.frustumCulled = false;
scene.add(land);
const groundY = (x, z) => (curBody ? bodyGroundY(x, z) : bedHeightJS(x, z));

// ----- Palms: a curved trunk and pinnate fronds (a rib with leaflets down both sides) -----
function buildPalm(m, x, z, h, leanAmt, leanDir) {
  const y0 = groundY(x, z) - 0.1;
  const base = new THREE.Vector3(x, y0, z);
  const phase = Math.random() * 6.28;
  plantKind = 0;
  const tmpC = new THREE.Color();
  // Trunk: rings along a bent curve, with darker growth rings
  const SEG = 12, SIDES = 7;
  const pts = [], rad = [];
  for (let i = 0; i <= SEG; i++) {
    const u = i / SEG;
    const off = leanAmt * u * u * h;
    pts.push(new THREE.Vector3(x + Math.cos(leanDir) * off, y0 + u * h, z + Math.sin(leanDir) * off));
    rad.push(lerp(0.2, 0.1, u) + 0.12 * Math.max(0, 1 - u * 9));
  }
  const rings = pts.map((c, i) => {
    const t = new THREE.Vector3().subVectors(pts[Math.min(i + 1, SEG)], pts[Math.max(i - 1, 0)]).normalize();
    const a = new THREE.Vector3().crossVectors(t, new THREE.Vector3(0, 0, 1)).normalize();
    if (a.lengthSq() < 0.5) a.set(1, 0, 0);
    const b = new THREE.Vector3().crossVectors(t, a).normalize();
    return Array.from({ length: SIDES }, (_, s) => {
      const ang = (s / SIDES) * Math.PI * 2;
      const n = a.clone().multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang));
      return { p: c.clone().addScaledVector(n, rad[i]), n };
    });
  });
  for (let i = 0; i < SEG; i++) {
    const shade = i % 2 ? 0.78 : 1.0;
    const c0 = new THREE.Color(0x7d6445).multiplyScalar(shade * (0.8 + 0.3 * (i / SEG)));
    const c1 = new THREE.Color(0x7d6445).multiplyScalar((i + 1) % 2 ? 0.78 : 1.0).multiplyScalar(0.8 + 0.3 * ((i + 1) / SEG));
    for (let s = 0; s < SIDES; s++) {
      const s2 = (s + 1) % SIDES;
      const A = rings[i][s], B = rings[i][s2], C = rings[i + 1][s], D = rings[i + 1][s2];
      for (const [P, Q, R, cA, cB, cC] of [[A, B, C, c0, c0, c1], [B, D, C, c0, c1, c1]]) {
        plantVert(m, P.p, P.n, cA, base, h, 0, phase);
        plantVert(m, Q.p, Q.n, cB, base, h, 0, phase);
        plantVert(m, R.p, R.n, cC, base, h, 0, phase);
      }
    }
  }
  plantKind = 1; // Fronds
  const crown = pts[SEG].clone().add(new THREE.Vector3(0, 0.1, 0));
  const nF = 10 + Math.floor(rand(0, 3));
  const UP = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < nF; k++) {
    const yaw = (k / nF) * Math.PI * 2 + rand(-0.25, 0.25);
    const el = k % 3 === 0 ? rand(0.85, 1.2) : k % 3 === 1 ? rand(-0.1, 0.45) : rand(0.3, 0.75);
    const L = rand(2.5, 3.4);
    const d0 = new THREE.Vector3(Math.cos(el) * Math.cos(yaw), Math.sin(el), Math.cos(el) * Math.sin(yaw));
    const droop = rand(0.9, 1.7) * (1.25 - el * 0.55);
    const N = 13;
    const rib = [];
    for (let j = 0; j <= N; j++) {
      const s = j / N;
      rib.push(crown.clone().addScaledVector(d0, L * s).addScaledVector(UP, -droop * s * s));
    }
    const ph = phase + k * 0.9;
    for (let j = 1; j <= N; j++) {
      const s = j / N;
      const P = rib[j];
      const T = new THREE.Vector3().subVectors(rib[Math.min(j + 1, N)], rib[j - 1]).normalize();
      const S = new THREE.Vector3().crossVectors(T, UP).normalize();
      if (S.lengthSq() < 0.5) S.set(1, 0, 0);
      // the rib itself
      const Pm = rib[j - 1];
      const rc = tmpC.set(0x5b6a35).clone();
      plantTri(m, Pm.clone().addScaledVector(S, -0.025), Pm.clone().addScaledVector(S, 0.025), P.clone().addScaledVector(S, -0.02), rc, rc, rc, base, h, (j - 1) / N * 0.6, (j - 1) / N * 0.6, s * 0.6, ph);
      plantTri(m, Pm.clone().addScaledVector(S, 0.025), P.clone().addScaledVector(S, 0.02), P.clone().addScaledVector(S, -0.02), rc, rc, rc, base, h, (j - 1) / N * 0.6, s * 0.6, s * 0.6, ph);
      // leaflets down both sides, longest in the middle, drooping and swept toward the tip
      for (const sign of [-1, 1]) {
        const dir = S.clone().multiplyScalar(sign * 0.85).addScaledVector(T, 0.5).addScaledVector(UP, -(0.45 + 0.5 * s)).normalize();
        const len = (0.45 + 0.9 * Math.sin(Math.PI * Math.min(1, s * 0.85 + 0.1))) * rand(0.9, 1.15);
        const w = 0.2;
        const p0 = P.clone().addScaledVector(T, -w * 0.5);
        const p1 = P.clone().addScaledVector(T, w * 0.5);
        const p2 = P.clone().addScaledVector(dir, len).addScaledVector(T, w * 0.3);
        const v = rand(0.85, 1.12);
        const cb = new THREE.Color(0x1d4a1a).lerp(new THREE.Color(0x3d7a24), s * 0.7).multiplyScalar(v);
        const ct = new THREE.Color(0x3f7424).lerp(new THREE.Color(0x8aa63a), Math.random() * 0.4 + s * 0.2).multiplyScalar(v);
        plantTri(m, p0, p1, p2, cb, cb, ct, base, h, 0.2 + s * 0.5, 0.2 + s * 0.5, 0.5 + s * 0.8, ph);
      }
    }
  }
  colliders.push({ x, z, r: 0.35 });
}

const palmMesh = (() => {
  const m = plantNew();
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 22; tries++) {
    const a = rand(0, Math.PI * 2), r = rand(ISL.r * 0.1, ISL.r - 14);
    const x = ISL.x + Math.cos(a) * r, z = ISL.z + Math.sin(a) * r;
    const y = groundY(x, z);
    if (y < 1.1) continue;
    // keep the starting stretch of beach open
    if (Math.hypot(x - ISL.x, z - (ISL.z + ISL.r - 9)) < 16) continue;
    buildPalm(m, x, z, rand(5.5, 8.5), rand(0.1, 0.32), rand(0, Math.PI * 2));
    placed++;
  }
  const mesh = new THREE.Mesh(plantGeometry(m), windMaterial());
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
})();

// ----- Dune grass: tufts of blades that lean and ripple in the wind -----
const grassMesh = (() => {
  const m = plantNew();
  plantKind = 2;
  const up = new THREE.Vector3(0, 1, 0);
  let tufts = 0;
  for (let tries = 0; tries < 6000 && tufts < 1100; tries++) {
    const a = rand(0, Math.PI * 2), r = rand(ISL.r * 0.05, ISL.r - 3);
    const x = ISL.x + Math.cos(a) * r, z = ISL.z + Math.sin(a) * r;
    const y = groundY(x, z);
    if (y < 1.1 + Math.sin(x * 0.3) * 0.3) continue;
    tufts++;
    const nB = 6;
    for (let b = 0; b < nB; b++) {
      const bx = x + rand(-0.25, 0.25), bz = z + rand(-0.25, 0.25);
      const base = new THREE.Vector3(bx, groundY(bx, bz) - 0.03, bz);
      const hgt = rand(0.35, 0.95);
      const ang = rand(0, Math.PI * 2);
      const lean = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)).multiplyScalar(rand(0.05, 0.4) * hgt);
      const side = new THREE.Vector3(-Math.sin(ang + 1.2), 0, Math.cos(ang + 1.2)).multiplyScalar(0.022);
      const mid = base.clone().addScaledVector(up, hgt * 0.55).addScaledVector(lean, 0.35);
      const tip = base.clone().addScaledVector(up, hgt).add(lean);
      const v = rand(0.8, 1.15);
      const cb = new THREE.Color(0x24400f).multiplyScalar(v);
      const cm = new THREE.Color(0x4a6a1c).multiplyScalar(v);
      const ct = new THREE.Color(0x9aa84a).lerp(new THREE.Color(0x6a8a2a), Math.random()).multiplyScalar(v);
      const ph = Math.random() * 6.28;
      const b0 = base.clone().sub(side), b1 = base.clone().add(side);
      const m0 = mid.clone().addScaledVector(side, -0.7), m1 = mid.clone().addScaledVector(side, 0.7);
      plantTri(m, b0, b1, m0, cb, cb, cm, base, hgt, 0, 0, 0.35, ph);
      plantTri(m, b1, m1, m0, cb, cm, cm, base, hgt, 0, 0.35, 0.35, ph);
      plantTri(m, m0, m1, tip, cm, cm, ct, base, hgt, 0.35, 0.35, 0.8, ph);
    }
  }
  const mesh = new THREE.Mesh(plantGeometry(m), windMaterial());
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
})();

// ----- Rocks and driftwood along the beach -----
{
  const rockMat = rockMaterial();
  const addRock = (x, z, s, detail, sink) => {
    const wet = shoreDistJS(x, z) < 14 ? 0.25 : -9; // rocks near the water are dark, wet and barnacled low down
    const rock = new THREE.Mesh(makeRock(detail, Math.random() * 50, wet), rockMat);
    rock.scale.set(s * rand(0.9, 1.5), s, s * rand(0.9, 1.5));
    rock.position.set(x, groundY(x, z) + s * (0.15 - sink), z);
    rock.rotation.y = rand(0, 6.28);
    scene.add(rock);
    registerRock(rock);
    return rock;
  };
  for (let i = 0; i < 18; i++) {
    const a = rand(0, Math.PI * 2), r = ISL.r + rand(-14, 4);
    const x = ISL.x + Math.cos(a) * r, z = ISL.z + Math.sin(a) * r;
    if (Math.hypot(x - ISL.x, z - (ISL.z + ISL.r - 9)) < 7) continue;
    const s = rand(0.35, 1.4);
    addRock(x, z, s, 4, 0);
  }
  // a tumble of boulders around the lighthouse's foot
  for (let i = 0; i < 7; i++) {
    const a = rand(0, 6.28), r = rand(2.6, 4.2);
    const x = ISL.x + 4 + Math.cos(a) * r, z = ISL.z - 6 + Math.sin(a) * r;
    const s = rand(0.5, 1.1);
    addRock(x, z, s, 3, 0.1);
  }
  // Driftwood: bleached, cracked, knotted, with stubs of branches
  const woodMat = new THREE.MeshStandardMaterial({ map: driftTex, roughness: 0.95 });
  for (let i = 0; i < 9; i++) {
    const a = Math.PI / 2 + rand(-1.1, 1.1), r = ISL.r - rand(5, 12);
    const x = ISL.x + Math.cos(a) * r, z = ISL.z + Math.sin(a) * r;
    const len = rand(1.5, 4.5), rd = rand(0.06, 0.14);
    const seed = Math.random() * 30;
    const trunk = new THREE.CylinderGeometry(rd * 0.7, rd, len, 10, 14);
    const tp = trunk.attributes.position;
    for (let k = 0; k < tp.count; k++) {
      const y = tp.getY(k);
      const f = 1 + 0.35 * (jnoise(tp.getX(k) * 5 + seed, y * 2.5, tp.getZ(k) * 5) - 0.5) + 0.25 * Math.max(0, 1 - Math.abs(y - len * 0.2) * 3) * jnoise(seed, y * 8, 1);
      tp.setXYZ(k, tp.getX(k) * f + Math.sin(y * 1.1 + seed) * 0.06, y, tp.getZ(k) * f + Math.cos(y * 0.8 + seed) * 0.05);
    }
    trunk.computeVertexNormals();
    const parts = [{ g: trunk }];
    for (let b = 0; b < 2; b++) {
      const stub = new THREE.CylinderGeometry(rd * 0.18, rd * 0.35, rd * rand(3, 7), 6).translate(0, rd * 2, 0).rotateZ(rand(0.6, 1.2) * (b ? 1 : -1)).translate(0, rand(-len * 0.3, len * 0.3), 0);
      parts.push({ g: stub });
    }
    const log = new THREE.Mesh(mergeGeos(parts), woodMat);
    log.rotation.z = Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(log);
    holder.position.set(x, groundY(x, z) + rd * 0.5, z);
    holder.rotation.y = rand(0, 6.28);
    scene.add(holder);
  }
}

// ===== Lighthouse on the dunes =====
const lighthouse = (() => {
  const x = ISL.x + 4, z = ISL.z - 6;
  const y = bedHeightJS(x, z);
  const group = new THREE.Group();
  group.position.set(x, y - 0.3, z);
  const H = 15;

  // The tower's skin, painted per pixel: a dressed-stone foot, whitewashed plaster with rain streaks and grime,
  // red bands with chipped paint, small arched windows (lit at night) and a heavy door facing the sea.
  const TW = 512, TH = 704;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = TW;
    c.height = TH;
    const ctx = c.getContext("2d");
    return { c, ctx, img: ctx.createImageData(TW, TH) };
  };
  const cMap = mk(), cBump = mk(), cEmit = mk();
  const WINDOWS = [[0.12, 0.3], [0.62, 0.3], [0.37, 0.52], [0.87, 0.52], [0.12, 0.74], [0.62, 0.74]];
  const BASE = 0.07;
  for (let py = 0; py < TH; py++)
    for (let px = 0; px < TW; px++) {
      const u = px / TW, v = 1 - py / TH;
      const ang = u * 6.283;
      const cx = Math.cos(ang) * 4, cz = Math.sin(ang) * 4; // wraps around the tower seamlessly
      const n = jfbm(cx + 3, cz + 3, v * 38, 3);
      const streak = jnoise(cx * 3, cz * 3, v * 3);
      let r, g, b, bump = 0.5 + 0.12 * n, em = 0;
      if (v < BASE) {
        // stone blocks, staggered rows
        const row = Math.floor(v / 0.0175);
        const col = (u * 22 + (row % 2) * 0.5) % 1;
        const rowF = (v / 0.0175) % 1;
        const mortar = col < 0.05 || rowF < 0.09;
        const k = 0.55 + 0.5 * n + 0.15 * jnoise(Math.floor(u * 22 + (row % 2) * 0.5) * 3.7, row * 5.1, 1);
        r = 0.5 * k; g = 0.47 * k; b = 0.43 * k;
        if (mortar) { r *= 0.55; g *= 0.55; b *= 0.55; bump = 0.18; }
        else bump = 0.55 + 0.2 * n;
        // green slime near the ground and salt stains
        const slime = smooth(0.03, 0.0, v) * jnoise(cx * 2, cz * 2, 5);
        r = lerp(r, 0.18, slime * 0.5); g = lerp(g, 0.3, slime * 0.5); b = lerp(b, 0.14, slime * 0.5);
      } else {
        const band = Math.floor((v - BASE) / ((1 - BASE) / 5));
        const red = band % 2 === 1;
        let k = 0.88 + 0.18 * n;
        // dirt and rain-streaks running down, heavier toward the bottom
        const dirt = (0.04 + 0.2 * smooth(0.45, 0.0, v)) * smooth(0.4, 0.8, streak);
        if (red) {
          r = 0.74 * k; g = 0.12 * k; b = 0.1 * k;
          const chip = jnoise(cx * 7 + 9, cz * 7, v * 70);
          if (chip > 0.87) { r = 0.78; g = 0.75; b = 0.7; bump = 0.3; } // paint flaking off to the plaster
          const edge = (v - BASE) / ((1 - BASE) / 5) % 1;
          if (edge < 0.025 || edge > 0.975) { r = 0.55; g = 0.08; b = 0.07; } // painted line between bands
        } else {
          r = 0.94 * k; g = 0.93 * k; b = 0.88 * k;
        }
        r *= 1 - dirt; g *= 1 - dirt; b *= 1 - dirt * 0.9;
        // windows
        for (const [wu, wv] of WINDOWS) {
          const du = Math.abs(u - wu) * 11.3, dv = (v - wv) * 15;
          const inShape = (e) => (dv <= 0.5 ? du < 0.4 + e && dv > -0.7 - e : (du / (0.4 + e)) ** 2 + ((dv - 0.5) / (0.4 + e)) ** 2 < 1);
          const inRect = inShape(0), inFrame = inShape(0.15);
          if (inRect) { r = 0.05; g = 0.07; b = 0.09; bump = 0.25; em = 0.9 + 0.1 * n; }
          else if (inFrame) { r = 0.82; g = 0.8; b = 0.74; bump = 0.8; }
        }
      }
      // the door, facing south (u wraps around 0)
      const du = Math.min(u, 1 - u) * 11.3, dv = v * 15;
      if (v < 0.17 && du < 0.78 + 0.07 && (dv < 2.2 - 0.1 || du * du / 0.55 + (dv - 1.55) * (dv - 1.55) / 0.55 < 1.05)) {
        const inDoor = du < 0.64 && (dv < 1.6 || du * du / 0.41 + (dv - 1.6) * (dv - 1.6) / 0.5 < 1);
        if (inDoor) {
          const plank = Math.abs(Math.sin(du * 14)) < 0.06;
          const kk = (0.55 + 0.4 * jnoise(du * 9, dv * 2, 7)) * (plank ? 0.5 : 1);
          r = 0.3 * kk; g = 0.17 * kk; b = 0.08 * kk; bump = plank ? 0.2 : 0.55;
          if (Math.abs(dv - 0.6) < 0.05 || Math.abs(dv - 1.4) < 0.05) { r = 0.1; g = 0.1; b = 0.11; bump = 0.75; } // iron straps
        } else { r = 0.78; g = 0.75; b = 0.7; bump = 0.8; }
      }
      const i = (py * TW + px) * 4;
      cMap.img.data[i] = clamp(r, 0, 1) * 255; cMap.img.data[i + 1] = clamp(g, 0, 1) * 255; cMap.img.data[i + 2] = clamp(b, 0, 1) * 255; cMap.img.data[i + 3] = 255;
      const bv = clamp(bump, 0, 1) * 255;
      cBump.img.data[i] = cBump.img.data[i + 1] = cBump.img.data[i + 2] = bv; cBump.img.data[i + 3] = 255;
      cEmit.img.data[i] = em * 255; cEmit.img.data[i + 1] = em * 190; cEmit.img.data[i + 2] = em * 90; cEmit.img.data[i + 3] = 255;
    }
  const tex = (m) => {
    m.ctx.putImageData(m.img, 0, 0);
    const t = new THREE.CanvasTexture(m.c);
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  const towerMat = new THREE.MeshStandardMaterial({ map: tex(cMap), bumpMap: tex(cBump), bumpScale: 2.2, emissiveMap: tex(cEmit), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.82, metalness: 0 });
  const prof = [];
  for (let i = 0; i <= 28; i++) {
    const v = i / 28;
    prof.push(new THREE.Vector2(lerp(2.35, 1.35, v) + 0.25 * Math.max(0, 1 - v / 0.05), v * H));
  }
  group.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 56), towerMat));

  // Gallery: iron deck with a railing, then the lantern room with glazing bars and a copper dome
  const iron = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.5, metalness: 0.7 });
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 1.7, 0.3, 40), iron);
  deck.position.y = H + 0.05;
  group.add(deck);
  const rail = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * 6.283;
    rail.push({ g: new THREE.CylinderGeometry(0.018, 0.018, 1.0, 5).translate(Math.cos(a) * 2.0, H + 0.7, Math.sin(a) * 2.0) });
  }
  rail.push({ g: new THREE.TorusGeometry(2.0, 0.03, 6, 40).rotateX(Math.PI / 2).translate(0, H + 1.2, 0) });
  rail.push({ g: new THREE.TorusGeometry(2.0, 0.02, 6, 40).rotateX(Math.PI / 2).translate(0, H + 0.8, 0) });
  group.add(new THREE.Mesh(mergeGeos(rail), iron));
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd070, emissiveIntensity: 0.3, transparent: true, opacity: 0.88, roughness: 0.15 });
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.5, 24), lanternMat);
  lamp.position.y = H + 1.0;
  group.add(lamp);
  const bars = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 6.283;
    bars.push({ g: new THREE.BoxGeometry(0.05, 1.55, 0.05).translate(Math.cos(a) * 0.96, H + 1.0, Math.sin(a) * 0.96) });
  }
  bars.push({ g: new THREE.TorusGeometry(0.96, 0.04, 6, 24).rotateX(Math.PI / 2).translate(0, H + 1.78, 0) });
  bars.push({ g: new THREE.TorusGeometry(0.96, 0.04, 6, 24).rotateX(Math.PI / 2).translate(0, H + 0.24, 0) });
  group.add(new THREE.Mesh(mergeGeos(bars), iron));
  const copper = new THREE.MeshStandardMaterial({ map: copperTex, roughness: 0.55, metalness: 0.5 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.2, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), copper);
  dome.position.y = H + 1.78;
  group.add(dome);
  const fin = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), copper);
  fin.position.y = H + 3.0;
  group.add(fin);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.9, 6), iron);
  rod.position.y = H + 3.45;
  group.add(rod);

  // Two beams that sweep around the horizon: open-ended cones that start at the lamp, widen as they travel,
  // fade out along their length and at their edges, and glow most when they point toward you
  const BEAM_L = 280;
  const beamUniforms = { uCam: { value: new THREE.Vector3() }, uLamp: { value: new THREE.Vector3() }, uOpacity: { value: 0 }, uTime: shared.uTime, uLen: { value: BEAM_L } };
  const beamMat = new THREE.ShaderMaterial({
    uniforms: beamUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uLen;
      varying float vAlong;
      varying vec3 vWorld;
      varying vec3 vNW;
      varying vec3 vAxis;
      void main() {
        vAlong = clamp(position.x / uLen, 0.0, 1.0);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNW = normalize(mat3(modelMatrix) * normal);
        vAxis = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCam;
      uniform vec3 uLamp;
      uniform float uOpacity;
      uniform float uTime;
      varying float vAlong;
      varying vec3 vWorld;
      varying vec3 vNW;
      varying vec3 vAxis;
      void main() {
        vec3 V = normalize(uCam - vWorld);
        float rim = pow(abs(dot(normalize(vNW), V)), 1.4);                    // soft edges: thickest through the middle
        float len = pow(1.0 - vAlong, 1.8) * smoothstep(0.0, 0.025, vAlong); // bright at the lamp, gone by the open end
        float toward = max(dot(vAxis, normalize(uCam - uLamp)), 0.0);
        float fwd = 0.35 + 1.8 * pow(toward, 3.0);                            // light scatters forward, toward the viewer
        float dust = 0.9 + 0.1 * sin(vAlong * 60.0 - uTime * 2.0);
        gl_FragColor = vec4(1.0, 0.94, 0.8, uOpacity * len * rim * fwd * dust);
      }
    `,
  });
  const beams = new THREE.Group();
  beams.position.y = H + 1.0;
  for (const rot of [0, Math.PI]) {
    const geo = new THREE.CylinderGeometry(0, 18, BEAM_L, 32, 12, true);
    geo.translate(0, -BEAM_L / 2, 0); // apex on the lamp
    geo.rotateZ(Math.PI / 2);         // lay it along +x
    const m = new THREE.Mesh(geo, beamMat);
    m.rotation.y = rot;
    m.frustumCulled = false;
    beams.add(m);
  }
  group.add(beams);
  // The lamp's flare, which swells as a beam sweeps toward you
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffe2a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.position.y = H + 1.0;
  group.add(glow);
  scene.add(group);
  return { group, beams, beamUniforms, towerMat, lanternMat, glow, lampY: H + 1.0 };
})();

// ===== Round soft-glow texture, for lights and sprites =====
const dotTexture = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.2, "rgba(255,255,255,0.7)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.18)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
lighthouse.glow.material.map = dotTexture;

// ===== Weather =====
// Coastline's weather: a forecast that moves between clear, cloud, rain and storm, plus separate "fog days" that
// thicken and thin. Each visit starts at a random point in it.
const WEATHER_TARGETS = [0.1, 0.1, 0.35, 0.6, 0.95];
const _fogDay = Math.random() < 0.05; // (rare: a fog day buries the whole world in grey)
const _w0 = _fogDay ? 0.1 : WEATHER_TARGETS[Math.floor(Math.random() * WEATHER_TARGETS.length)];
const weather = { fogDay: _fogDay, timer: rand(20, 50), fogTimer: rand(60, 120), fog: _fogDay ? 0.45 : 0, fogTarget: _fogDay ? 0.45 : 0, value: _w0, target: _w0, windAngle: -Math.PI / 2, windSpeed: 6, flash: 0, secondFlash: -1, strikeTimer: 6, cloudOffset: new THREE.Vector2(), auto: true, autoTimer: 70 };
const wx = { cover: 0, overcast: 0, rain: 0, storm: 0, fog: 0 };

// ----- Rain -----
const RAIN_COUNT = 3000, RAIN_BOX = 60, RAIN_HEIGHT = 36;
const rainDrops = new Float32Array(RAIN_COUNT * 3);
for (let i = 0; i < RAIN_COUNT; i++) {
  rainDrops[i * 3] = rand(-RAIN_BOX / 2, RAIN_BOX / 2);
  rainDrops[i * 3 + 1] = rand(-5, RAIN_HEIGHT - 5);
  rainDrops[i * 3 + 2] = rand(-RAIN_BOX / 2, RAIN_BOX / 2);
}
const rainPos = new Float32Array(RAIN_COUNT * 6);
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.4, fog: false, depthWrite: false });
const rain = new THREE.LineSegments(rainGeo, rainMat);
rain.frustumCulled = false;
rain.renderOrder = 2;
scene.add(rain);
const wrapTo = (v, center, size) => (v < center - size / 2 ? v + size : v > center + size / 2 ? v - size : v);
const camPos = new THREE.Vector3();
function updateRain(dt, lightLevel) {
  const active = Math.floor(RAIN_COUNT * wx.rain);
  rain.visible = active > 0;
  if (!rain.visible) return;
  const vx = Math.cos(weather.windAngle) * weather.windSpeed * 0.5;
  const vz = Math.sin(weather.windAngle) * weather.windSpeed * 0.5;
  const vy = -22;
  for (let i = 0; i < active; i++) {
    let x = rainDrops[i * 3] + vx * dt;
    let y = rainDrops[i * 3 + 1] + vy * dt;
    let z = rainDrops[i * 3 + 2] + vz * dt;
    x = wrapTo(x, camPos.x, RAIN_BOX);
    z = wrapTo(z, camPos.z, RAIN_BOX);
    const rainFloor = Math.max(camPos.y - 10, 0.3);
    if (y < rainFloor) y += RAIN_HEIGHT;
    if (y > rainFloor + RAIN_HEIGHT) y -= RAIN_HEIGHT;
    rainDrops[i * 3] = x;
    rainDrops[i * 3 + 1] = y;
    rainDrops[i * 3 + 2] = z;
    const j = i * 6;
    rainPos[j] = x;
    rainPos[j + 1] = y;
    rainPos[j + 2] = z;
    rainPos[j + 3] = x - vx * 0.04;
    rainPos[j + 4] = y - vy * 0.04;
    rainPos[j + 5] = z - vz * 0.04;
  }
  rainGeo.setDrawRange(0, active * 2);
  rainGeo.attributes.position.needsUpdate = true;
  rainMat.opacity = 0.25 + 0.25 * wx.storm;
  rainMat.color.setRGB(0.67, 0.71, 0.75).multiplyScalar(Math.max(lightLevel, 0.25) + weather.flash);
}

// ----- Lightning -----
const BOLT_POINTS = 24;
const boltGeo = new THREE.BufferGeometry();
boltGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BOLT_POINTS * 3), 3));
const boltMat = new THREE.LineBasicMaterial({ color: 0xe8f0ff, transparent: true, fog: false });
const bolt = new THREE.Line(boltGeo, boltMat);
bolt.frustumCulled = false;
bolt.visible = false;
scene.add(bolt);
function strike() {
  const a = Math.random() * Math.PI * 2;
  const dist = rand(250, 700);
  let x = camPos.x + Math.cos(a) * dist;
  let z = camPos.z + Math.sin(a) * dist;
  const pos = boltGeo.attributes.position;
  for (let i = 0; i < BOLT_POINTS; i++) {
    pos.setXYZ(i, x, 300 - (302 * i) / (BOLT_POINTS - 1), z);
    x += rand(-12, 12);
    z += rand(-12, 12);
  }
  pos.needsUpdate = true;
  weather.flash = 1;
  audio.thunder(dist);
  weather.secondFlash = Math.random() < 0.6 ? rand(0.1, 0.25) : -1;
}

function updateWeather(dt) {
  if (weather.locked) weather.timer = weather.fogTimer = 30; // (a weather you picked from the menu stays put)
  weather.timer -= dt;
  if (weather.timer <= 0) {
    // Fog days stay calm (fog and wind don't go together)
    const targets = weather.fogDay ? [0.1, 0.1, 0.35] : WEATHER_TARGETS;
    weather.target = targets[Math.floor(Math.random() * targets.length)];
    weather.timer = rand(45, 95);
  }
  // On a fog day the fog bank thickens and thins; now and then it lifts enough to see a little farther
  weather.fogTimer -= dt;
  if (weather.fogTimer <= 0) {
    weather.fogTarget = weather.fogDay ? (Math.random() < 0.5 ? 0.6 : 0.3) : 0;
    weather.fogTimer = rand(60, 120);
  }
  const fogStep = (weather.locked ? 0.04 : 0.01) * dt;
  weather.fog += clamp(weather.fogTarget - weather.fog, -fogStep, fogStep);
  const valStep = (weather.locked ? 0.05 : 0.015) * dt;
  weather.value += clamp(weather.target - weather.value, -valStep, valStep);
  weather.windAngle += rand(-0.5, 0.5) * 0.05 * dt;
  weather.windAngle = clamp(weather.windAngle, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); // always blowing toward the island, more or less
  const w = weather.value;
  wx.cover = 0.32 + 0.68 * smooth(0.0, 0.7, w);
  wx.overcast = smooth(0.25, 0.85, w);
  wx.rain = smooth(0.4, 0.65, w);
  wx.storm = smooth(0.75, 0.95, w);
  wx.fog = weather.fog;
  // Wind drives the waves and the clouds
  weather.windSpeed = 3 + 21 * w;
  waveScale = (0.55 + 1.45 * w) * waveMul;
  weather.cloudOffset.x += Math.cos(weather.windAngle) * weather.windSpeed * 1.5 * dt;
  weather.cloudOffset.y += Math.sin(weather.windAngle) * weather.windSpeed * 1.5 * dt;
  if (wx.storm > 0.2) {
    weather.strikeTimer -= dt;
    if (weather.strikeTimer <= 0) {
      strike();
      weather.strikeTimer = 3 + Math.random() * 10 * (1.2 - wx.storm);
    }
  }
  weather.flash = Math.max(0, weather.flash - dt * 5);
  if (weather.secondFlash > 0) {
    weather.secondFlash -= dt;
    if (weather.secondFlash <= 0) weather.flash = 0.8;
  }
  bolt.visible = weather.flash > 0.25;
  boltMat.opacity = weather.flash;
}

// ----- Time of day + weather lighting -----
const PALETTE = {
  nightTop: new THREE.Color(0x02050f),
  nightHorizon: new THREE.Color(0x0b1630),
  duskTop: new THREE.Color(0x35508e),
  duskHorizon: new THREE.Color(0xff9444),
  dayTop: new THREE.Color(0x2f6fd0),
  dayHorizon: new THREE.Color(0xb8dcf3),
  overcastTop: new THREE.Color(0x4f5761),
  overcastHorizon: new THREE.Color(0x7d858e),
  flash: new THREE.Color(0xc8d4ff),
  fog: new THREE.Color(0xc3cacf),
  sunLow: new THREE.Color(0xff8a32),
  sunHigh: new THREE.Color(0xfff3dd),
  deepWater: new THREE.Color(0x0b3553),
  shallowWater: new THREE.Color(0x1f7a8c),
  stormDeep: new THREE.Color(0x1a2a2e),
  stormShallow: new THREE.Color(0x3c5a5a),
};
const tmpColor = new THREE.Color();
// ===== The sun, the moon and the spinning planet =====
// The sun sits still in space. The planet turns once a day under it (game.spin is how far), and you ride on it: your sky is the sun's
// fixed direction seen from wherever you stand on the turning planet. The moon circles the planet slowly (about every eight and a half
// days), lit by that same sun, so its phases are simply where it is in relation to the sun. Directions below are first worked out in
// "inertial" space (the stars), then turned into your local frame (east, up, south) from your place on the planet.
const PF = { p: new THREE.Vector3(0, 1, 0), tx: new THREE.Vector3(1, 0, 0), tz: new THREE.Vector3(0, 0, 1) }; // your local frame on the home planet, in planet space
// The sun and the planets: a small solar system. Every planet circles the sun in one flat plane (the ecliptic, tilted a little against the home planet's
// equator, which is what gives it seasons), the nearer ones faster, as Kepler said. Positions are measured from the home planet's centre, so the sun is the
// point the home planet circles; SUN_W is the direction of the sun from the home planet and moves slowly through the year.
const ECL_TILT = 0.25;
const ECL_E1 = new THREE.Vector3(1, 0, 0), ECL_E2 = new THREE.Vector3(0, -Math.sin(ECL_TILT), -Math.cos(ECL_TILT));
const SUN_W = new THREE.Vector3(0, Math.sin(ECL_TILT), Math.cos(ECL_TILT)); // from the home planet to the sun (a unit vector)
const SUN_POS = new THREE.Vector3().copy(SUN_W).multiplyScalar(6e6); // and where the sun is
const SUN_R = 130000; // the sun's radius, m
const ORBITS = { // radius of the orbit round the sun (m), its period (days), where it starts (rad)
  earth: { a: 6.0e6, T: 40, ph: Math.PI / 2 },
  mars: { a: 9.0e6, T: 73.5, ph: 0.4 },
  ice: { a: 13.2e6, T: 130, ph: 2.6 },
  giant: { a: 21.0e6, T: 262, ph: 4.4 },
};
const _eo = new THREE.Vector3(), _po = new THREE.Vector3();
function orbitPos(o, tDays, out) { const th = o.ph + (Math.PI * 2 * tDays) / o.T; return out.copy(ECL_E1).multiplyScalar(Math.cos(th) * o.a).addScaledVector(ECL_E2, Math.sin(th) * o.a); }
const MOON_PERIOD_H = 24 * 8.5, MOON_INCL = 0.09, MOON_DIST = 300000;
const _mi = new THREE.Vector3(), _ml = new THREE.Vector3();
// The scene's own axes (east, up, south for where you stand), written in inertial space; and where you are in inertial space (the home planet's
// centre is the origin). Everything far away (the sun, the moon, the other planets) is worked out in inertial space and then turned into the scene.
const SQ = { ex: new THREE.Vector3(1, 0, 0), ey: new THREE.Vector3(0, 1, 0), ez: new THREE.Vector3(0, 0, 1) };
const pIn = new THREE.Vector3(0, PLANET_R, 0);
const toScene = (v, out) => out.set(v.dot(SQ.ex), v.dot(SQ.ey), v.dot(SQ.ez));
const toInertial = (v, out) => out.set(0, 0, 0).addScaledVector(SQ.ex, v.x).addScaledVector(SQ.ey, v.y).addScaledVector(SQ.ez, v.z);
function spinVec(v, ang, out) { const c = Math.cos(ang), sn = Math.sin(ang); const x = v.x * c + v.z * sn, z = -v.x * sn + v.z * c; return out.set(x, v.y, z); } // planet-fixed -> inertial for a turn of ang
// the other worlds (the home planet is the origin; the moon circles it; the rest keep their places)
const BODIES = {
  moon: { id: "moon", name: "the Moon", kind: "moon", R: 11000, g: 1.62, landable: true, skyDark: 1, color: 0xb0aca4, pos: new THREE.Vector3(), prev: new THREE.Vector3() },
  mars: { id: "mars", name: "the red world", kind: "mars", R: 22000, g: 3.7, landable: true, skyDark: 0.1, color: 0xc2552f, orbit: ORBITS.mars, pos: new THREE.Vector3(), prev: new THREE.Vector3() },
  giant: { id: "giant", name: "the gas giant", kind: "giant", R: 100000, g: 0, landable: false, skyDark: 0, color: 0xe0c9a0, orbit: ORBITS.giant, pos: new THREE.Vector3(), prev: new THREE.Vector3() },
  ice: { id: "ice", name: "the ice world", kind: "ice", R: 18000, g: 2.6, landable: true, skyDark: 0.06, color: 0x9fc8e8, orbit: ORBITS.ice, pos: new THREE.Vector3(), prev: new THREE.Vector3() },
};
const BODY_LIST = [BODIES.moon, BODIES.mars, BODIES.giant, BODIES.ice];
// move the sun and the planets on to the time (in hours played)
function updateSolarSystem(tHours) {
  const d = tHours / 24;
  orbitPos(ORBITS.earth, d, _eo); // the home planet's place round the sun
  SUN_POS.copy(_eo).negate();
  SUN_W.copy(SUN_POS).normalize();
  for (const b of BODY_LIST) {
    if (!b.orbit) continue;
    b.prev.copy(b.pos);
    b.pos.copy(orbitPos(b.orbit, d, _po)).sub(_eo);
    if (b.prev.lengthSq() === 0) b.prev.copy(b.pos);
  }
}
updateSolarSystem(0);
const sp = { on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), ex: new THREE.Vector3(1, 0, 0), ey: new THREE.Vector3(0, 1, 0), ez: new THREE.Vector3(0, 0, 1) };
const bodyChart = { p: new THREE.Vector3(0, 1, 0), tx: new THREE.Vector3(1, 0, 0), tz: new THREE.Vector3(0, 0, 1) }; // the flat chart of the world you stand on
const _cf = new THREE.Vector3(), _cf2 = new THREE.Vector3();
function updatePlayerFrame() { if (!sp.on && !curBody) faceFrame(curFace, player.x - FACE_C[curFace][0], player.z - FACE_C[curFace][1], PF.p, PF.tx, PF.tz); }
// where the scene's axes and you are in inertial space, for this frame
function computeFrame() {
  if (sp.on) { SQ.ex.copy(sp.ex); SQ.ey.copy(sp.ey); SQ.ez.copy(sp.ez); pIn.copy(sp.pos); return; }
  if (curBody) {
    spinVec(bodyChart.tx, game.spin, SQ.ex); spinVec(bodyChart.p, game.spin, SQ.ey); spinVec(bodyChart.tz, game.spin, SQ.ez);
    _cf.copy(bodyChart.p).multiplyScalar(curBody.R + player.y).addScaledVector(bodyChart.tx, player.x - BODY_OFFSET).addScaledVector(bodyChart.tz, player.z - BODY_OFFSET);
    spinVec(_cf, game.spin, _cf2);
    pIn.copy(curBody.pos).add(_cf2);
    return;
  }
  spinVec(PF.tx, game.spin, SQ.ex); spinVec(PF.p, game.spin, SQ.ey); spinVec(PF.tz, game.spin, SQ.ez);
  pIn.copy(SQ.ey).multiplyScalar(PLANET_R + player.y);
}
function inertialToLocal(v, out) { return toScene(v, out); }
function playerLon() { return Math.atan2(PF.p.x, PF.p.z); }
const sunLon = () => Math.atan2(SUN_W.x, SUN_W.z);
const hoursFromSpin = () => ((((12 + ((playerLon() + game.spin - sunLon()) * 24) / (Math.PI * 2)) % 24) + 24) % 24); // local solar time where you stand
const spinForHour = (h) => ((h - 12) / 24) * Math.PI * 2 + sunLon() - playerLon();
function sunDirection(hours, out) { // the sun as seen where you are: from the home planet, or from the world you are standing on
  if (curBody) return toScene(_ml.copy(SUN_POS).sub(curBody.pos), out).normalize();
  return toScene(SUN_W, out).normalize();
}
const lastEnv = { light: 1, lightLevel: 1, lampsOn: 0 };
function applyEnvironment(hours) {
  updateSolarSystem(game.t);
  if (curBody || sp.on) wx.cover = wx.overcast = wx.rain = wx.storm = wx.fog = 0; // (no weather out there)
  const sunDir = sunDirection(hours, shared.uSunDir.value);
  {
    const mu = 1.2 + (game.t / MOON_PERIOD_H) * Math.PI * 2;
    _mi.set(Math.sin(mu) * Math.cos(MOON_INCL), Math.sin(mu) * Math.sin(MOON_INCL), Math.cos(mu));
    BODIES.moon.prev.copy(BODIES.moon.pos);
    BODIES.moon.pos.copy(_mi).multiplyScalar(MOON_DIST);
    toScene(_ml.copy(BODIES.moon.pos).sub(pIn), shared.uMoonDir.value).normalize(); // (the moon's direction from where you are)
    shared.uMoonPhase.value = 0.5 * (1 - _mi.dot(SUN_W)); // the lit fraction of the moon: 0 new, 1 full
  }
  const e = sunDir.y;
  const day = smooth(0.0, 0.35, e);
  const night = 1 - smooth(-0.28, -0.02, e);
  const light = smooth(-0.2, 0.3, e);
  const lightLevel = 0.06 + 0.94 * light;
  const flash = weather.flash;

  const top = shared.uTop.value, horizon = shared.uHorizon.value;
  top.copy(PALETTE.duskTop).lerp(PALETTE.nightTop, night).lerp(PALETTE.dayTop, day);
  horizon.copy(PALETTE.duskHorizon).lerp(PALETTE.nightHorizon, night).lerp(PALETTE.dayHorizon, day);
  top.lerp(tmpColor.copy(PALETTE.overcastTop).multiplyScalar(lightLevel), wx.overcast * 0.85);
  horizon.lerp(tmpColor.copy(PALETTE.overcastHorizon).multiplyScalar(lightLevel), wx.overcast * 0.85);
  if (wx.fog > 0) {
    // fog: everything fades into a soft grey-white
    tmpColor.copy(PALETTE.fog).multiplyScalar(lightLevel);
    top.lerp(tmpColor, wx.fog * 0.5);
    horizon.lerp(tmpColor, wx.fog * 0.65);
  }
  if (flash > 0) {
    top.lerp(PALETTE.flash, flash * 0.6);
    horizon.lerp(PALETTE.flash, flash * 0.5);
  }

  if (curBody) {
    // the sky of another world
    const k = curBody.kind, L = lightLevel;
    if (k === "mars") { top.setRGB(0.4 * L + 0.02, 0.26 * L + 0.015, 0.21 * L + 0.015); horizon.setRGB(0.82 * L + 0.02, 0.56 * L + 0.015, 0.4 * L + 0.015); }
    else if (k === "ice") { top.setRGB(0.5 * L + 0.02, 0.66 * L + 0.02, 0.84 * L + 0.03); horizon.setRGB(0.82 * L + 0.02, 0.9 * L + 0.02, 0.97 * L + 0.03); }
    else { top.setRGB(0, 0, 0); horizon.setRGB(0, 0, 0); }
  }
  {
    // high up the sky thins to black
    const sd = spaceState.dark;
    if (sd > 0) {
      top.lerp(tmpColor.setRGB(0, 0, 0), sd);
      horizon.lerp(tmpColor.setRGB(0, 0, 0), Math.pow(sd, 0.8));
    }
  }
  shared.uSunColor.value.copy(PALETTE.sunLow).lerp(PALETTE.sunHigh, day);
  shared.uSunset.value = (1 - smooth(0.0, 0.55, e > 0 ? e : -e * 2.2)) * (1 - 0.8 * wx.overcast); // a long, colourful sunset and twilight
  shared.uSunVis.value = smooth(-0.04, 0.02, e) * (1 - 0.9 * wx.overcast) * (1 - 0.75 * wx.fog);
  shared.uFog.value = wx.fog;
  shared.uStars.value = Math.max(night * (1 - wx.overcast) * (1 - wx.fog), smooth(0.3, 0.85, spaceState.dark));
  shared.uAurora.value = (curBody ? 0 : 1) * (1 - smooth(150, 1800, spaceState.alt)) * opts.aurora * night * (1 - wx.cover) * (1 - wx.fog) * (0.75 + 0.25 * Math.sin(shared.uTime.value * 0.03));
  shared.uCloudCover.value = wx.cover * (1 - spaceState.cloudFade);
  // god rays are strongest with a low sun partly hidden by broken cloud
  shared.uRays.value = (1 - spaceState.cloudFade) * smooth(-0.12, 0.06, e) * (1 - 0.55 * smooth(0.3, 0.9, e)) * (0.3 + 0.7 * wx.cover) * (1 - 0.75 * smooth(0.55, 0.95, wx.overcast)) * (1 - wx.fog);
  shared.uCloudDark.value = smooth(0.35, 0.95, weather.value);
  shared.uCloudOffset.value.copy(weather.cloudOffset);
  shared.uLightLevel.value = Math.max(lightLevel, 0.08) + flash * 0.8;

  waterUniforms.uLight.value = lightLevel * (1 - 0.3 * wx.overcast) + flash * 0.3;
  waterUniforms.uWaveScale.value = waveScale;
  waterUniforms.uFoam.value = 0.35 + 0.4 * wx.storm;
  waterUniforms.uDeep.value.copy(PALETTE.deepWater).lerp(PALETTE.stormDeep, wx.overcast);
  waterUniforms.uShallow.value.copy(PALETTE.shallowWater).lerp(PALETTE.stormShallow, wx.overcast);

  // Rain cuts visibility
  waterUniforms.uFogNear.value = lerp(FOG_NEAR * (1 - 0.6 * wx.rain), 25, wx.fog) + spaceState.alt * 0.5;
  waterUniforms.uFogFar.value = lerp(FOG_FAR - 90 * wx.rain, 420, wx.fog) + spaceState.alt * 6;
  scene.fog.near = lerp(lerp(120, 40, wx.rain), 25, wx.fog);
  scene.fog.far = lerp(lerp(1500, 450, wx.rain), 420, wx.fog) + spaceState.alt * 8;
  landUniforms.uFogN.value = scene.fog.near;
  landUniforms.uFogF.value = scene.fog.far;
  landUniforms.uWet.value = wx.rain;
  scene.fog.color.copy(horizon);
  renderer.setClearColor(horizon);
  if (curBody) {
    const fk = curBody.kind;
    scene.fog.near = 400;
    scene.fog.far = fk === "moon" ? 1e7 : fk === "mars" ? 30000 : 20000;
    landUniforms.uFogN.value = scene.fog.near;
    landUniforms.uFogF.value = scene.fog.far;
  }

  sunLight.color.copy(shared.uSunColor.value);
  sunLight.intensity = 1.1 * smooth(-0.02, 0.2, e) * (1 - 0.75 * wx.overcast);
  sunLight.intensity *= cloudShadowJS(player.x, 0, player.z, sunDir, wx.cover, weather.cloudOffset) * opts.sunI;
  shared.uSunColor.value.multiplyScalar(opts.sunI);
  shared.uMoonI.value = curBody || sp.on ? 0 : opts.moonI;
  sunLight.position.copy(sunDir).multiplyScalar(100);
  moonLight.position.copy(shared.uMoonDir.value).multiplyScalar(100);
  moonLight.intensity = 0.3 * night * (1 - wx.overcast) * opts.moonI * (0.1 + 0.9 * shared.uMoonPhase.value);
  hemiLight.color.copy(horizon).lerp(top, 0.5);
  hemiLight.groundColor.copy(waterUniforms.uDeep.value).multiplyScalar(lightLevel);
  hemiLight.intensity = (0.25 + 0.45 * light) * (1 - 0.35 * wx.overcast) + flash * 1.5;
  if (curBody) {
    // little air to scatter light into the shadows: a faint fill, tinted by the sky
    hemiLight.color.copy(curBody.kind === "moon" ? tmpColor.setRGB(0.5, 0.52, 0.58) : horizon).lerp(top, 0.3);
    hemiLight.groundColor.setRGB(0.12, 0.1, 0.1);
    hemiLight.intensity = curBody.kind === "moon" ? 0.32 : 0.5;
    moonLight.intensity = 0;
  }

  // Lamps come on at dusk and in dark weather
  const lampsOn = Math.max(1 - smooth(-0.05, 0.1, e), wx.overcast * 0.8 * (1 - day * 0.5));
  lighthouse.lanternMat.emissiveIntensity = 0.3 + 2 * lampsOn;
  lastEnv.light = light;
  lastEnv.lightLevel = lightLevel;
  lastEnv.lampsOn = lampsOn;
  return lastEnv;
}

function updateLighthouse(dt, lampsOn) {
  lighthouse.beams.rotation.y += dt * 0.9;
  lighthouse.beams.visible = lampsOn > 0.02 && Math.hypot(camPos.x - lighthouse.group.position.x, camPos.z - lighthouse.group.position.z) < 6000;
  lighthouse.towerMat.emissiveIntensity = 1.2 * lampsOn;
  lighthouse.beams.getWorldPosition(lighthouse.beamUniforms.uLamp.value);
  lighthouse.beamUniforms.uCam.value.copy(camPos);
  lighthouse.beamUniforms.uOpacity.value = 0.5 * lampsOn * (0.6 + 2.0 * wx.rain);
  // The lamp flares when a beam sweeps toward the camera
  const toCamX = camPos.x - lighthouse.group.position.x;
  const toCamZ = camPos.z - lighthouse.group.position.z;
  const len = Math.hypot(toCamX, toCamZ) || 1;
  const rot = lighthouse.beams.rotation.y;
  const facing = Math.abs(Math.cos(rot) * (toCamX / len) - Math.sin(rot) * (toCamZ / len));
  const flare = Math.pow(facing, 40);
  lighthouse.glow.visible = lampsOn > 0.02;
  lighthouse.glow.material.opacity = lampsOn;
  const size = 8 + 90 * flare;
  lighthouse.glow.scale.set(size, size, 1);
}

let islKey = "";
function updateIslUniforms(x, z) {
  const j0 = Math.floor((z - GRID_OZ) / CELL) - 1;
  const ib = [0, 1, 2].map((r) => Math.floor((x - GRID_OX - rowOff(j0 + r)) / CELL) - 1);
  const key = j0 + "|" + ib.join(",");
  if (key === islKey) return;
  islKey = key;
  shared.uIslBase.value.set(0, j0);
  shared.uIslRowI.value.set(ib[0], ib[1], ib[2]);
  shared.uIslRowO.value.set(rowOff(j0), rowOff(j0 + 1), rowOff(j0 + 2));
  for (let k = 0; k < 9; k++) {
    const a = islandCell(ib[Math.floor(k / 3)] + (k % 3), j0 + Math.floor(k / 3));
    shared.uIslA.value[k].set(a.x, a.z, a.r, a.type + a.lobF * 0.5);
    shared.uIslB.value[k].set(a.p1, a.p2, a.p3, a.h);
    shared.uIslC.value[k].set(a.cliffH, a.cliffP, a.lakeR, 0);
  }
}
updateIslUniforms(ISL.x, ISL.z + ISL.r);

