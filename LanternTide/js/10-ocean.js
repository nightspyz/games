"use strict";
// ===== Ocean surface (waves, breakers, foam, caustics) =====
const WATER_SIZE = 520;
const WATER_STEP = 2; // the grid moves with the camera in steps of this size, so its vertices stay put in the world
const FOG_NEAR = 100;
const FOG_FAR = 250;

// A grid that is finer near the camera (1 m out to 48 m, then 2 m), so breaking waves can have steep faces
const waterGeo = (() => {
  const axis = [];
  for (let x = -WATER_SIZE / 2; x <= WATER_SIZE / 2; x += Math.abs(x) < 48 ? 1 : 2) axis.push(x);
  const n = axis.length;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.set([axis[i], 0, axis[j]], (j * n + i) * 3);
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      idx.set([a, a + n, a + 1, a + n, a + n + 1, a + 1], k); // wound to face up
      k += 6;
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
})();

// The water doesn't write depth (so things under it can be seen through it), which means it can't hide its
// own far side. So draw its triangles from the farthest to the nearest: the grid is always centred on the
// camera, so nearer waves are then always drawn last, on top of the distant ones.
function sortWaterFarToNear(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index.array;
  const triCount = idx.length / 3;
  const order = new Array(triCount);
  const dist = new Float32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    let cx = 0, cz = 0;
    for (let k = 0; k < 3; k++) {
      cx += pos.getX(idx[t * 3 + k]);
      cz += pos.getZ(idx[t * 3 + k]);
    }
    dist[t] = cx * cx + cz * cz;
    order[t] = t;
  }
  order.sort((a, b) => dist[b] - dist[a]);
  const sorted = new idx.constructor(idx.length);
  order.forEach((t, i) => {
    sorted[i * 3] = idx[t * 3];
    sorted[i * 3 + 1] = idx[t * 3 + 1];
    sorted[i * 3 + 2] = idx[t * 3 + 2];
  });
  geo.setIndex(new THREE.BufferAttribute(sorted, 1));
}
sortWaterFarToNear(waterGeo);

const MAX_LAMPS = 12; // the raft's lamp and the lanterns, which light the water around them
const waterUniforms = Object.assign({}, shared, {
  uWaves: { value: WAVES.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.steep)) },
  uWaveScale: { value: 1 },
  uFoam: { value: 0.35 },
  uCamPos: { value: new THREE.Vector3() },
  uDeep: { value: new THREE.Color(0x0b3553) },
  uShallow: { value: new THREE.Color(0x1f7a8c) },
  uLight: { value: 1 },
  uFogNear: { value: FOG_NEAR },
  uFogFar: { value: FOG_FAR },
  uLampPos: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3(0, -100, 0)) },
  uLampColor: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()) },
});

// Foam on the water: whitecaps, breakers and the swash, as one lacy pattern. Shared by the water (whose
// caustics use the same cells) and by the foam layer, which draws it on top of everything under the water.
const FOAM_GLSL = /* glsl */ `
  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  // Distance to the nearest wall between animated cells
  float cellEdge(vec2 p, float t) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float f1 = 8.0;
    float f2 = 8.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = 0.5 + 0.4 * sin(t + 6.2831 * hash22(i + g));
        float d = length(g + o - f);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
      }
    }
    return f2 - f1;
  }
  // A lacy white network around dark holes, like real sea foam.
  // density 0..1: 1 = solid white water; as it falls the holes open up until only thin threads are left
  float foamLace(vec2 p, float density) {
    if (density < 0.01) return 0.0;
    vec2 q = p + vec2(vnoise(p * 0.18), vnoise(p * 0.18 + 5.7)) * 6.0; // bend the cells into organic blobs
    float big = cellEdge(q * 0.45, 0.0);        // holes a couple of metres across
    float small = cellEdge(q * 1.7 + 3.1, 0.0); // smaller holes and fine threads within the bands
    float lace = exp(-big * 3.0) * 0.75 + exp(-small * 5.0) * 0.35 + (vnoise(q * 3.0) - 0.5) * 0.15;
    float th = mix(1.05, -0.1, density);
    return smoothstep(th, th + 0.08, lace);
  }
  // How much foam covers this point of the surface (w: the surface point, height: its wave height,
  // bed: sea floor height below it, dist: distance from the camera, t: time, ws: wave scale, caps: whitecaps)
  float foamAmount(vec3 w, float height, float bed, float dist, float t, float ws, float caps) {
    float far = smoothstep(80.0, 300.0, dist);
    float crest = clamp(height / (1.8 * max(ws, 0.3)) * 0.5 + 0.5, 0.0, 1.0);
    float bedDepth = -bed;
    float depthW = max(w.y - bed, 0.0);
    float stage = breakStage(bedDepth);
    float bu = breakU(w.xz, t);
    float bd = bu < 0.5 ? bu : bu - 1.0; // distance from the breaker's crest in wavelengths (negative = shore side)
    float foamNoise = fbm(w.xz * 0.35 + vec2(t * 0.02, t * 0.12));
    // Whitecaps on the open sea, in patches
    float capDensity = smoothstep(0.8, 0.98, crest + (foamNoise - 0.5) * 0.3) * caps * 1.4;
    // Breakers: solid white where the lip pours over and the white water tumbles in, ageing into lace behind,
    // and a thin veil of old foam over the whole surf zone. It keeps going right up the beach.
    float foamSize = clamp(0.4 + ws * 0.6, 0.0, 1.0) * (1.0 - smoothstep(2.5, 8.0, bedDepth)) * harborCalm(w.xz);
    float curl = clamp(stage - 0.6, 0.0, 1.0);
    float lipFoam = exp(-(((bd + 0.01) / 0.02) * ((bd + 0.01) / 0.02))) * smoothstep(0.7, 1.1, stage);
    float trail = bd >= 0.0 ? exp(-bd * mix(9.0, 4.5, clamp(stage - 1.0, 0.0, 1.0))) * curl : 0.0;
    float surfDensity = max(max(lipFoam, trail), 0.45 * smoothstep(1.2, 1.8, stage) * (0.6 + 0.8 * foamNoise)) * foamSize;
    // The swash: a bright foam line along its edge, lace scattered over the thin water behind it
    float edgeLine = smoothstep(0.0, 0.012, depthW) * exp(-depthW / 0.035);
    float swashLace = (1.0 - smoothstep(0.05, 0.6, depthW)) * 0.35 * clamp(0.4 + ws * 0.6, 0.0, 1.0) * smoothstep(-0.02, 0.02, w.y - bed);
    float density = clamp(max(max(capDensity, surfDensity), max(edgeLine, swashLace)), 0.0, 1.0);
    vec2 drift = vec2(0.0, t * 0.15); // the foam drifts slowly toward the shore
    return mix(foamLace(w.xz + drift, density), density * 0.7, far); // smooth it far away
  }
`;

// The water surface's vertex shader: waves, breakers and swash (shared by the water and its foam layer)
const WATER_VERTEX = /* glsl */ `
  ${SHORE_GLSL}
  uniform float uTime;
  uniform float uWaveScale;
  uniform float uCurve;
  uniform vec4 uWaves[4];
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vHeight;
  varying float vBed;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    vec3 disp = vec3(0.0);

    // Waves shrink in shallow water
    float bed = bedHeight(wp.xz);
    float depth = -bed;
    float damp = mix(0.12, 1.0, smoothstep(0.5, 8.0, depth));
    // Calm the waves near the edge of the grid so its border never wobbles into view
    float edge = 1.0 - smoothstep(${(WATER_SIZE * 0.39).toFixed(1)}, ${(WATER_SIZE * 0.485).toFixed(1)}, max(abs(position.x), abs(position.z)));
    damp *= edge * harborCalm(wp.xz);

    // Gerstner waves. The sideways (horizontal) push is capped so crests can never fold over
    // into loops, and each wave fades out with distance before the grid gets too coarse to draw it.
    float steepSum = 0.0;
    for (int i = 0; i < 4; i++) steepSum += uWaves[i].w;
    float sideways = min(1.0, 0.6 / max(steepSum * uWaveScale * damp, 1e-4));
    float camDist = length(wp.xz - cameraPosition.xz);
    for (int i = 0; i < 4; i++) {
      vec4 w = uWaves[i];
      vec2 d = w.xy;
      float k = w.z;
      float len = 6.2832 / k;
      float fade = 1.0 - smoothstep(len * 9.0, len * 22.0, camDist);
      float s = w.w * uWaveScale * damp * fade;
      float c = sqrt(9.8 / k);
      float f = k * (dot(d, wp.xz) - c * uTime);
      float a = s / k;
      float q = s * sideways; // horizontal steepness
      float cf = cos(f);
      float sf = sin(f);
      disp += vec3(d.x * (q / k) * cf, a * sf, d.y * (q / k) * cf);
      tangent += vec3(-d.x * d.x * q * sf, d.x * s * cf, -d.x * d.y * q * sf);
      binormal += vec3(-d.x * d.y * q * sf, d.y * s * cf, -d.y * d.y * q * sf);
    }

    vHeight = disp.y;

    // Breaking waves in the shallows: their height, and a lean toward the shore as the lip curls over.
    // Their slope is added to the surface normal. The lean is capped so the surface never folds over itself.
    float bA = depth < 8.0 ? (0.3 + 0.4 * uWaveScale) * breakAmp(depth) * edge * harborCalm(wp.xz) : 0.0;
    if (bA > 0.0) {
      float stage = breakStage(depth);
      float lean = min(bA, 1.0);
      float e = 0.5;
      vec2 px = wp.xz + vec2(e, 0.0);
      vec2 pz = wp.xz + vec2(0.0, e);
      float s0 = shoreCoord(wp.xz);
      float sx = shoreCoord(px);
      float sz = shoreCoord(pz);
      vec2 toShore = normalize(vec2(sx - s0, sz - s0) + vec2(1e-6));
      vec2 b0 = breakShape(breakUAt(s0, wp.xz, uTime), stage);
      vec2 bx = breakShape(breakUAt(sx, px, uTime), stage);
      vec2 bz = breakShape(breakUAt(sz, pz, uTime), stage);
      disp += vec3(toShore.x * b0.y * lean, b0.x * bA, toShore.y * b0.y * lean);
      tangent += vec3(toShore.x * (bx.y - b0.y) * lean, (bx.x - b0.x) * bA, toShore.y * (bx.y - b0.y) * lean) / e;
      binormal += vec3(toShore.x * (bz.y - b0.y) * lean, (bz.x - b0.x) * bA, toShore.y * (bz.y - b0.y) * lean) / e;
    }

    vec3 p = wp.xyz + disp;
    // The swash: each spent wave running up the beach and sliding back (only right at the waterline)
    p.y += (1.0 - smoothstep(0.0, 1.2, depth)) * swashLevel(wp.xz, uTime);

    vNormal = normalize(cross(binormal, tangent));
    vWorld = p;
    vBed = bed;
    vec2 cdw = p.xz - cameraPosition.xz;
    gl_Position = projectionMatrix * viewMatrix * vec4(p.x, p.y - dot(cdw, cdw) * uCurve, p.z, 1.0);
  }
`;

const water = new THREE.Mesh(
  waterGeo,
  new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: WATER_VERTEX,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      ${NOISE_GLSL}
      ${CLOUD_GLSL}
      ${SHORE_GLSL}
      uniform float uAurora;
      uniform vec3 uCamPos;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform float uLight;
      uniform float uWaveScale;
      uniform float uFoam;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform float uSeaFade;
      uniform vec3 uLampPos[${MAX_LAMPS}];
      uniform vec3 uLampColor[${MAX_LAMPS}];
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vHeight;
      varying float vBed;

      // Small wind ripples on top of the big waves: a handful of short waves running in different
      // directions, plus a little noise on a rotated grid (plain value noise shows a checkerboard in the glints)
      float ripple(vec2 p, float t) {
        float h = sin(dot(p, vec2(0.96, 0.28)) * 3.1 + t * 2.3) * 0.18
                + sin(dot(p, vec2(-0.42, 0.91)) * 3.7 + t * 2.6) * 0.15
                + sin(dot(p, vec2(0.71, -0.70)) * 4.6 + t * 2.9) * 0.11
                + sin(dot(p, vec2(-0.88, -0.47)) * 5.3 + t * 3.2) * 0.1
                + sin(dot(p, vec2(0.17, 0.98)) * 6.9 + t * 3.6) * 0.07
                + sin(dot(p, vec2(0.55, 0.83)) * 8.1 + t * 4.0) * 0.06;
        vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p;
        return 0.5 + h * 0.5 + (vnoise(q * 1.3 + t * vec2(0.1, 0.3)) - 0.5) * 0.25;
      }

      // ---- Caustics: sunlight focused by the moving surface into a bright, wobbling net ----
      ${FOAM_GLSL}
      float causticLayer(vec2 p, float t) {
        // Warp so the cell walls bend and drift like light through moving waves
        p += vec2(vnoise(p * 0.7 + t * 0.3), vnoise(p * 0.7 - t * 0.25 + 4.0)) * 0.9;
        return exp(-cellEdge(p, t) * 9.0);
      }
      float causticNet(vec2 p, float t) {
        float c = (causticLayer(p, t) + causticLayer(p * 0.73 + 5.2, t * 1.3)) * 0.5;
        return pow(c, 1.8) * 2.2;
      }
      // Slight colour split at the edges, like real refracted sunlight
      vec3 caustics(vec2 p, float t) {
        vec2 off = vec2(0.035, 0.02);
        return vec3(causticNet(p + off, t), causticNet(p, t), causticNet(p - off, t));
      }

      // ---- Sea floor: pale sand, with patches of coral rubble on the reef shelf around the island ----
      float coralTex(vec2 p) {
        vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p;
        return vnoise(q * 1.1) * 0.6 + vnoise(q * 2.7 + 7.0) * 0.4;
      }
      vec3 seabed(vec2 p, float dOut, out float bump) {
        vec3 sand = vec3(0.88, 0.84, 0.74) * (0.88 + 0.24 * vnoise(p * 0.6)); // pale, as sand looks under water
        float reefZone = smoothstep(25.0, 55.0, dOut) * (1.0 - smoothstep(90.0, 140.0, dOut));
        float patchN = fbm(p * 0.07) + (vnoise(p * 0.5) - 0.5) * 0.15;
        float coral = smoothstep(0.42, 0.56, patchN) * reefZone;
        float tex = coralTex(p);
        float kind = fbm(p * 0.05 + 11.0);
        vec3 cc = mix(vec3(0.74, 0.68, 0.58), vec3(0.74, 0.62, 0.62), smoothstep(0.4, 0.62, kind));
        cc = mix(cc, vec3(0.6, 0.64, 0.5), smoothstep(0.5, 0.72, vnoise(p * 0.21 + 3.0)) * 0.5);
        cc *= 0.8 + 0.3 * tex;
        bump = coral * (0.2 + 0.4 * tex);
        return mix(sand, cc, coral * 0.7);
      }

      void main() {
        vec3 toCam = uCamPos - vWorld;
        float dist = length(toCam);
        vec3 v = toCam / dist;
        float far = smoothstep(80.0, 300.0, dist);

        // Seen from below (swimming): the surface is a silvery ceiling. Straight up you see a bright window onto the sky;
        // at a shallower angle the water reflects the dim depths back at you.
        if (uUnder > 0.5) {
          float up = max(-v.y, 0.0);
          float win = smoothstep(0.6, 0.78, up);
          vec3 sk = skyColor(normalize(vec3(0.0, 0.9, 0.3))) * vec3(0.7, 0.95, 1.0);
          vec3 c = mix(uUnderCol * 1.1, mix(uUnderCol * 1.5, sk, 0.75), win);
          c += vec3(0.5, 0.8, 0.85) * pow(win, 2.0) * (0.5 + 0.5 * sin(vWorld.x * 2.1 + vWorld.z * 1.7 + uTime * 2.0)) * 0.12;
          c = mix(c, uUnderCol, smoothstep(8.0, 48.0, dist));
          gl_FragColor = vec4(c, 1.0);
          return;
        }

        // Normal: big waves + fine ripples up close, flattened far away to avoid shimmer
        vec3 n = normalize(vNormal);
        float detail = (1.0 - smoothstep(25.0, 160.0, dist)) * (0.35 + 0.25 * uWaveScale);
        if (detail > 0.0) {
          vec2 rp = vWorld.xz * 0.7;
          float e = 0.08;
          float h0 = ripple(rp, uTime);
          float hx = ripple(rp + vec2(e, 0.0), uTime);
          float hz = ripple(rp + vec2(0.0, e), uTime);
          n = normalize(n + vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * 0.12 * detail);
        }
        n = normalize(mix(n, vec3(0.0, 1.0, 0.0), far));

        // Reflection of the sky (Fresnel: more reflective at grazing angles)
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 r = reflect(-v, n);
        r.y = abs(r.y);
        float cShadow = mix(1.0, cloudShadow(vWorld, uSunDir), uSunVis);
        vec3 refl = skyColor(r) * mix(0.8, 1.0, cShadow);

        // Deep water colour
        float diff = max(dot(n, uSunDir), 0.0) * uSunVis * cShadow;
        float crest = clamp(vHeight / (1.8 * max(uWaveScale, 0.3)) * 0.5 + 0.5, 0.0, 1.0);
        vec3 body = mix(uDeep, uShallow, crest * 0.8);
        body *= uLight * (0.6 + 0.4 * diff) * mix(0.75, 1.0, cShadow);

        // Subsurface glow: sunlight shining through thin wave crests
        float sss = pow(clamp(dot(v, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0) * smoothstep(0.45, 0.9, crest);
        body += vec3(0.05, 0.4, 0.33) * sss * uSunVis * cShadow * uLight;

        // Where we are in the life of a breaker (see breakShape)
        float bedDepth = -vBed;
        float stage = breakStage(bedDepth);
        float bu = breakU(vWorld.xz, uTime);
        float bd = bu < 0.5 ? bu : bu - 1.0; // distance from the crest in wavelengths (negative = shore side)
        float surfSize = clamp(0.4 + uWaveScale * 0.6, 0.0, 1.0) * smoothstep(0.1, 0.9, bedDepth) * (1.0 - smoothstep(2.5, 8.0, bedDepth));

        // Clear water: the sea floor shows through even when deep, red fading first
        float dOut = shoreDist(vWorld.xz);
        float depthW = max(vWorld.y - vBed, 0.0);
        vec3 water = body;
        if (depthW < 30.0) {
          vec2 sunShift = uSunDir.xz / max(uSunDir.y, 0.25);
          vec2 bedP = vWorld.xz - n.xz * depthW * 0.6 - sunShift * depthW * 0.3; // refraction
          float bump;
          vec3 bedCol = seabed(bedP, dOut, bump);
          float dBed = max(depthW - bump, 0.05);
          float lit = uSunVis * cShadow;
          vec3 caust = vec3(0.0);
          if (dist < 140.0) caust = caustics(bedP * 0.9, uTime) * (1.0 - smoothstep(40.0, 140.0, dist));
          bedCol = bedCol * uLight * (0.45 + 0.55 * lit) + bedCol * uSunColor * caust * 0.65 * lit * exp(-dBed * 0.12);
          vec3 absorb = exp(-dBed * vec3(0.45, 0.12, 0.08));
          vec3 turquoise = vec3(0.2, 0.85, 0.9) * uLight * mix(0.75, 1.0, cShadow); // bright aqua over sand
          vec3 inscatter = mix(turquoise, body, smoothstep(10.0, 28.0, depthW));
          vec3 shallowCol = bedCol * absorb + inscatter * (1.0 - absorb);
          water = mix(shallowCol, body, smoothstep(20.0, 30.0, depthW));
        }
        // Light shining through the thin face of a curling wave: glassy turquoise, brightest against the sun
        float face = (bd < 0.0 ? smoothstep(-0.07, -0.005, bd) : 1.0 - smoothstep(0.0, 0.03, bd)) * clamp(1.0 - abs(stage - 1.0), 0.0, 1.0) * surfSize;
        float backlit = pow(clamp(dot(v, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 2.0) * uSunVis * cShadow;
        water = mix(water, vec3(0.08, 0.72, 0.62) * uLight * (0.5 + 0.7 * backlit), face * 0.75);
        vec3 col = mix(water, refl, fres);

        // Sun glitter: a sharp core plus a broad sheen, and the moon's path at night
        float sd = max(dot(r, uSunDir), 0.0);
        col += uSunColor * (pow(sd, 900.0) * 8.0 + pow(sd, 90.0) * 0.35) * uSunVis * cShadow;
        col += vec3(0.7, 0.8, 1.0) * pow(max(dot(r, uMoonDir), 0.0), 300.0) * 1.2 * uStars * uMoonI * (0.1 + 0.9 * uMoonPhase);

        // The night sky mirrored in the sea: stars glitter on the moving waves, the aurora lays
        // long wavering streaks of green toward you.
        if ((uStars > 0.01 || uAurora > 0.01) && dist < 900.0) {
          vec3 rr = normalize(vec3(r.x, max(r.y, 0.015), r.z));
          float mirror = (0.35 + 0.65 * fres) * (1.0 - smoothstep(500.0, 900.0, dist));
          vec3 cell = floor(rr * 260.0);
          float sn = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float tw = 0.55 + 0.45 * sin(uTime * 3.0 + fract(sn * 977.0) * 6.2832);
          col += vec3(0.85, 0.9, 1.0) * step(0.997 - 0.001 * clamp(uStarGain - 1.0, 0.0, 2.0), sn) * tw * uStars * uStarGain * (0.1 + 0.9 * fres) * smoothstep(0.0, 0.05, rr.y);
          col += vec3(0.05, 0.07, 0.12) * uStars * mirror;
          if (uAurora > 0.001) {
            float az = atan(rr.x, -rr.z);
            float north = 1.0 - smoothstep(0.4, 1.7, abs(az));
            float edge = 0.06 + 0.05 * sin(az * 3.0 + uTime * 0.07);
            float h = rr.y;
            float vert = smoothstep(edge * 0.5, edge + 0.03, h) * (1.0 - smoothstep(edge + 0.04, edge + 0.45, h));
            float curtain = smoothstep(0.35, 0.75, fbm(vec2(az * 4.0 + sin(az * 7.0 + uTime * 0.15) * 0.4, uTime * 0.05)));
            vec3 ac = mix(vec3(0.15, 1.0, 0.55), vec3(0.65, 0.25, 0.95), smoothstep(edge + 0.08, edge + 0.35, h));
            col += ac * curtain * vert * north * uAurora * 0.45 * mirror;
          }
        }

        // (Foam is drawn by its own layer, on top of whatever floats on the water)

        // The raft's lamp and the lanterns shining on the water: a soft pool plus glints on the waves
        for (int i = 0; i < ${MAX_LAMPS}; i++) {
          vec3 L = uLampPos[i] - vWorld;
          float ld = length(L);
          L /= ld;
          float att = 1.0 - smoothstep(0.0, 14.0, ld);
          att *= att;
          float diffL = max(dot(n, L), 0.0);
          float specL = pow(max(dot(r, L), 0.0), 40.0);
          col += uLampColor[i] * att * (diffL * 0.5 + specL * 1.5);
        }

        // Fade into the horizon so the edge of the water meets the sky
        vec3 fogCol = skyColor(normalize(vec3(-v.x + 1e-4, 0.0, -v.z)));
        col = mix(col, fogCol, smoothstep(uFogNear, uFogFar, dist));

        float sqd = max(abs(vWorld.x - cameraPosition.x), abs(vWorld.z - cameraPosition.z));
        float alpha = smoothstep(0.0, 0.07, depthW) * (1.0 - uSeaFade) * (1.0 - smoothstep(${(WATER_SIZE * 0.3).toFixed(1)}, ${(WATER_SIZE * 0.455).toFixed(1)}, sqd)); // (the detailed square of sea melts into the far sea at its edge)
        gl_FragColor = vec4(col, alpha);
      }
    `,
    // Blended (for the see-through waterline) but kept in the solid pass
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  })
);
water.material.side = THREE.DoubleSide;
water.renderOrder = 1;
water.material.depthWrite = false;
water.frustumCulled = false;
scene.add(water);

// The foam, as its own layer on the same surface, drawn after everything floating on the water
const foamLayer = new THREE.Mesh(
  waterGeo,
  new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: WATER_VERTEX,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${SHORE_GLSL}
      ${FOAM_GLSL}
      uniform float uTime;
      uniform float uWaveScale;
      uniform float uFoam;
      uniform float uLight;
      uniform float uSeaFade;
      uniform vec3 uSunDir;
      uniform float uSunVis;
      uniform vec3 uCamPos;
      uniform float uFogNear;
      uniform float uFogFar;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vHeight;
      varying float vBed;
      void main() {
        float dist = length(uCamPos - vWorld);
        float foam = foamAmount(vWorld, vHeight, vBed, dist, uTime, uWaveScale, uFoam);
        if (foam < 0.004) discard;
        float diff = max(dot(normalize(vNormal), uSunDir), 0.0) * uSunVis;
        vec3 col = vec3(0.97, 0.98, 1.0) * uLight * (0.82 + 0.18 * diff);
        gl_FragColor = vec4(col, foam * (1.0 - smoothstep(uFogNear, uFogFar, dist)) * (1.0 - uSeaFade));
      }
    `,
    transparent: true,
    depthWrite: false,
  })
);
foamLayer.renderOrder = 1.8;
foamLayer.frustumCulled = false;
water.add(foamLayer); // moves with the water grid

// Far ocean: a flat ring from the edge of the detailed water out to the horizon, in the haze colour the
// water fades into. Drawn before the detailed water so near wave crests paint over it.
const farOceanGeo = new THREE.RingGeometry(WATER_SIZE / 2 - 10, 9000, 96, 1);
farOceanGeo.rotateX(-Math.PI / 2);
const farOcean = new THREE.Mesh(
  farOceanGeo,
  new THREE.ShaderMaterial({
    uniforms: shared,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uCurve;
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec2 cdf = wp.xz - cameraPosition.xz;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp.x, wp.y - dot(cdf, cdf) * uCurve, wp.z, 1.0);
      }
    `,
    blending: THREE.CustomBlending, // (kept in the solid pass, like the water, but able to fade out)
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform float uSeaFade;
      varying vec3 vWorld;
      void main() {
        vec3 v = normalize(cameraPosition - vWorld);
        gl_FragColor = vec4(skyColor(normalize(vec3(-v.x + 1e-4, 0.0, -v.z))), 1.0 - uSeaFade);
      }
    `,
  })
);
farOcean.renderOrder = 0.5;
farOcean.frustumCulled = false;
scene.add(farOcean);

// ===== Lights =====
const sunLight = new THREE.DirectionalLight(0xffffff, 1);
const moonLight = new THREE.DirectionalLight(0x8899cc, 0);
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x223344, 0.5);
scene.add(sunLight, sunLight.target, moonLight, moonLight.target, hemiLight);

// ===== Procedural noise and textures (JS side), for bark, plaster, stone and so on =====
function jhash(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}
function jnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const a = lerp(jhash(ix, iy, iz), jhash(ix + 1, iy, iz), ux);
  const b = lerp(jhash(ix, iy + 1, iz), jhash(ix + 1, iy + 1, iz), ux);
  const c = lerp(jhash(ix, iy, iz + 1), jhash(ix + 1, iy, iz + 1), ux);
  const d = lerp(jhash(ix, iy + 1, iz + 1), jhash(ix + 1, iy + 1, iz + 1), ux);
  return lerp(lerp(a, b, uy), lerp(c, d, uy), uz);
}
function jfbm(x, y, z, oct = 3) {
  let v = 0, a = 0.5;
  for (let i = 0; i < oct; i++) {
    v += a * jnoise(x, y, z);
    x = x * 2.03 + 11.1;
    y = y * 2.03 + 5.3;
    z = z * 2.03 + 7.7;
    a *= 0.5;
  }
  return v;
}
const canvasTex = (w, h, draw) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
};
// A texture from a per-pixel function (u, v in 0..1, v up) returning [r, g, b] in 0..1
function pixTex(w, h, fn) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x / w, 1 - y / h);
      const i = (y * w + x) * 4;
      img.data[i] = clamp(r, 0, 1) * 255;
      img.data[i + 1] = clamp(g, 0, 1) * 255;
      img.data[i + 2] = clamp(b, 0, 1) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
const grey = (v) => [v, v, v];
// Bark / weathered wood grain, tileable along both axes
const barkTex = pixTex(128, 256, (u, v) => {
  const fibre = jnoise(Math.cos(u * 6.283) * 5, Math.sin(u * 6.283) * 5 + v * 0.4, v * 28);
  const crack = jnoise(Math.cos(u * 6.283) * 3, Math.sin(u * 6.283) * 3, v * 5);
  let k = 0.55 + 0.55 * fibre;
  if (crack > 0.7) k *= 0.45;
  return [0.42 * k, 0.31 * k, 0.21 * k];
});
const driftTex = pixTex(128, 256, (u, v) => {
  const g = jnoise(Math.cos(u * 6.283) * 6, Math.sin(u * 6.283) * 6, v * 40);
  const crack = jnoise(Math.cos(u * 6.283) * 3, Math.sin(u * 6.283) * 3, v * 6) > 0.74 ? 0.5 : 1;
  const k = (0.65 + 0.5 * g) * crack;
  return [0.66 * k, 0.61 * k, 0.55 * k];
});
const bambooTex = pixTex(32, 128, (u, v) => {
  const f = (v * 2) % 1; // two nodes per repeat
  const node = Math.exp(-Math.pow((f - 0.5) / 0.025, 2));
  const n = jnoise(u * 12, v * 60, 3);
  const k = (0.85 + 0.3 * n) * (1 - 0.45 * node);
  return [0.62 * k + 0.1 * node, 0.66 * k, 0.26 * k];
});
const charTex = pixTex(64, 128, (u, v) => {
  const n = jnoise(u * 9, v * 14, 1) + 0.5 * jnoise(u * 20, v * 30, 2);
  const ember = n > 1.05 ? 1 : 0;
  const k = 0.1 + 0.08 * n;
  return [k + ember * 0.8, k * 0.9 + ember * 0.25, k * 0.8];
});
const copperTex = pixTex(128, 128, (u, v) => {
  const n = jfbm(u * 8, v * 8, 2, 3);
  const seam = Math.abs(Math.sin(u * 6.283 * 12)) < 0.04 ? 0.7 : 1;
  const verdi = smooth(0.35, 0.6, n + 0.2 * (1 - v));
  const k = seam * (0.85 + 0.3 * jnoise(u * 60, v * 60, 1));
  return [lerp(0.7, 0.3, verdi) * k, lerp(0.38, 0.62, verdi) * k, lerp(0.24, 0.52, verdi) * k];
});

// ===== A rock: a displaced sphere with stone layers, lichen and moss on top, wet and barnacled near the water =====
function makeRock(detail, seed, wetBelow) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = jfbm(x * 1.5 + seed, y * 1.5, z * 1.5 + seed, 4);
    const ridge = 1 - Math.abs(jnoise(x * 3.4 + seed, y * 3.4, z * 3.4) * 2 - 1);
    const r = 0.72 + 0.55 * n + 0.14 * ridge + 0.03 * jnoise(x * 14, y * 14, z * 14 + seed);
    p.setXYZ(i, x * r, y * r * 0.72, z * r);
  }
  // a few flat cuts, like fracture faces: they give the rock edges and flat tops to stand on
  const cuts = 3 + Math.floor(jnoise(seed, 1.5, 2.5) * 3);
  for (let k = 0; k < cuts; k++) {
    const a = jnoise(seed * 1.3 + k * 7.1, 3.3, k) * 6.283 * 2, e = k === 0 ? 1.15 : 0.1 + jnoise(seed + k, 9.1, 4.4) * 0.9;
    const nx = Math.cos(a) * Math.cos(e), ny = Math.sin(e), nz = Math.sin(a) * Math.cos(e);
    const d = (k === 0 ? 0.5 : 0.62) + 0.18 * jnoise(seed + k * 3.7, 1.1, 8.8);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const dot = x * nx + y * ny + z * nz - d * (k === 0 ? 0.72 : 1);
      if (dot > 0) p.setXYZ(i, x - nx * dot, y - ny * dot, z - nz * dot);
    }
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = nrm.getY(i);
    const grain = jnoise(x * 6 + seed, y * 6, z * 6);
    c.setRGB(0.52, 0.5, 0.47).lerp(new THREE.Color(0.36, 0.34, 0.34), grain);
    c.multiplyScalar((0.92 + 0.12 * Math.sin(y * 16 + jnoise(x * 2, y * 2, z * 2) * 5)) * (0.85 + 0.3 * jnoise(x * 20, y * 20, z * 20)));
    const up = smooth(0.35, 0.85, ny);
    const lich = jnoise(x * 8 + seed, y * 8, z * 8) * up;
    if (lich > 0.42) c.lerp(new THREE.Color(0.78, 0.6, 0.22), 0.55); // orange lichen
    else if (lich > 0.3) c.lerp(new THREE.Color(0.62, 0.66, 0.4), 0.5); // pale green lichen
    const moss = smooth(0.55, 0.95, ny) * smooth(0.35, 0.6, jnoise(x * 3 + 9, y * 3, z * 3 + seed));
    c.lerp(new THREE.Color(0.2, 0.3, 0.12), moss * 0.85);
    if (y < wetBelow) {
      c.multiplyScalar(0.62); // dark and wet near the water
      if (jnoise(x * 38, y * 38, z * 38) > 0.8) c.lerp(new THREE.Color(0.86, 0.85, 0.8), 0.8); // barnacles
      else if (jnoise(x * 5 + 3, y * 5, z * 5) > 0.6) c.lerp(new THREE.Color(0.12, 0.25, 0.1), 0.5); // algae
    }
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

// ===== Rock material: granite and sandstone with strata, cracks, mica flecks and real surface relief =====
// The colour (lichen, moss, wet and barnacled bases) comes from the vertex colours; this adds fine grain, layers and cracks on top
// from noise in world space, and bumps the lighting with the same noise so the surface is rough rather than smooth.
const ROCK_GLSL = /* glsl */ `
  float rhash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float rn3(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(rhash(i), rhash(i + vec3(1,0,0)), u.x), mix(rhash(i + vec3(0,1,0)), rhash(i + vec3(1,1,0)), u.x), u.y),
               mix(mix(rhash(i + vec3(0,0,1)), rhash(i + vec3(1,0,1)), u.x), mix(rhash(i + vec3(0,1,1)), rhash(i + vec3(1,1,1)), u.x), u.y), u.z);
  }
  // surface height: big ridged lumps, medium pitting, fine grain
  float rockH(vec3 p) {
    float ridge = 1.0 - abs(2.0 * rn3(p * 3.0) - 1.0);
    return 0.5 * ridge + 0.3 * rn3(p * 11.0) + 0.2 * rn3(p * 40.0);
  }
`;
function rockMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader =
      "varying vec3 vRW;\n" +
      sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  vRW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader =
      ROCK_GLSL +
      "varying vec3 vRW;\n" +
      sh.fragmentShader
        .replace(
          "#include <color_fragment>",
          /* glsl */ `#include <color_fragment>
          {
            float r1 = rn3(vRW * 2.3);
            float r2 = rn3(vRW * 9.0);
            float r3 = rn3(vRW * 38.0);
            float strata = sin(vRW.y * 9.0 + r1 * 5.0) * 0.5 + 0.5;               // layers that follow the rock's height, bent by noise
            float crack = (1.0 - smoothstep(0.0, 0.025, abs(rn3(vRW * 3.1 + 4.0) - 0.5))) * smoothstep(0.45, 0.6, rn3(vRW * 1.1 + 9.0)); // thin dark cracks, only in some places
            vec3 c = diffuseColor.rgb;
            c *= 0.76 + 0.38 * r2 + 0.14 * strata;
            c = mix(c, c * 0.3, crack * 0.85);
            c += vec3(0.2) * step(0.82, r3) * (0.5 + 0.5 * r2);                  // bright mica / quartz flecks
            c -= vec3(0.1) * step(r3, 0.14);                                     // and dark ones
            diffuseColor.rgb = c;
          }`
        )
        .replace(
          "#include <normal_fragment_maps>",
          /* glsl */ `#include <normal_fragment_maps>
          {
            // bump the normal with the height field (screen-space derivatives, as three.js does for bump maps)
            float hh = rockH(vRW);
            vec3 sp = -vViewPosition;
            vec3 dpx = dFdx(sp), dpy = dFdy(sp);
            float dHx = dFdx(hh), dHy = dFdy(hh);
            vec3 R1 = cross(dpy, normal), R2 = cross(normal, dpx);
            float det = dot(dpx, R1);
            vec3 grad = sign(det) * (dHx * R1 + dHy * R2);
            normal = normalize(abs(det) * normal - 0.05 * grad);
          }`
        );
  };
  m.customProgramCacheKey = () => "rock-material";
  return m;
}


const seaRocks = []; // the breakwater rocks out in the water
// Rocks you can stand on: the height of the top of a rock at (x, z), found by casting a ray down onto the mesh
const rockSurfaces = [];
const rockRay = new THREE.Raycaster();
const rockDown = new THREE.Vector3(0, -1, 0);
const rockOrigin = new THREE.Vector3();
function registerRock(mesh) {
  mesh.updateMatrixWorld(true);
  mesh.geometry.computeBoundingSphere();
  const sc = mesh.getWorldScale(new THREE.Vector3());
  const c = mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld);
  rockSurfaces.push({ mesh, x: c.x, z: c.z, r: mesh.geometry.boundingSphere.radius * Math.max(sc.x, sc.z), top: c.y + mesh.geometry.boundingSphere.radius * sc.y });
}
function rockSurfaceAt(x, z) {
  let best = -Infinity;
  for (const r of rockSurfaces) {
    if (Math.abs(x - r.x) > r.r || Math.abs(z - r.z) > r.r) continue;
    rockOrigin.set(x, r.top + 0.5, z);
    rockRay.set(rockOrigin, rockDown);
    const hit = rockRay.intersectObject(r.mesh, false)[0];
    if (hit && hit.point.y > best) best = hit.point.y;
  }
  return best;
}

// ===== Wind, shared by the trees and the grass =====
const windU = { uWind: { value: new THREE.Vector2(0, -1) }, uWindStr: { value: 0.2 } };

// ===== Small helpers for building merged geometry =====
function mergeGeos(list) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  let off = 0;
  for (const { g, color } of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    const c = color ? new THREE.Color(color) : new THREE.Color(1, 1, 1);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      col.push(c.r, c.g, c.b);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

// Plant geometry (palms and grass) is built in world space as plain triangles, each vertex carrying where its
// plant is rooted and how it should move, so one wind shader can bend the whole trunk and flutter the leaves.
let plantKind = 0; // 0 trunk, 1 frond, 2 grass
const plantNew = () => ({ pos: [], nor: [], col: [], base: [], sway: [], kind: [] });
const _pn = new THREE.Vector3(), _pa = new THREE.Vector3();
function plantVert(m, p, n, c, base, H, fl, ph) {
  m.pos.push(p.x, p.y, p.z);
  m.nor.push(n.x, n.y, n.z);
  m.col.push(c.r, c.g, c.b);
  m.base.push(base.x, base.y, base.z);
  m.sway.push(H, fl, ph);
  m.kind.push(plantKind);
}
function plantTri(m, p0, p1, p2, c0, c1, c2, base, H, f0, f1, f2, ph) {
  _pn.subVectors(p1, p0).cross(_pa.subVectors(p2, p0)).normalize();
  if (_pn.y < 0) _pn.negate(); // face up: lit like the top of a leaf from either side
  plantVert(m, p0, _pn, c0, base, H, f0, ph);
  plantVert(m, p1, _pn, c1, base, H, f1, ph);
  plantVert(m, p2, _pn, c2, base, H, f2, ph);
}
function plantGeometry(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(m.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(m.nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(m.col, 3));
  g.setAttribute("aBase", new THREE.Float32BufferAttribute(m.base, 3));
  g.setAttribute("aSway", new THREE.Float32BufferAttribute(m.sway, 3));
  g.setAttribute("aKind", new THREE.Float32BufferAttribute(m.kind, 1));
  return g;
}

// A material whose vertices bend in the wind: the trunk leans downwind in slow gusts that travel across the
// island, swaying back and forth, and the fronds stream downwind and flutter faster toward their tips.
function windMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uWind = windU.uWind;
    sh.uniforms.uWindStr = windU.uWindStr;
    sh.uniforms.uSunDir = shared.uSunDir;
    sh.uniforms.uSunColor = shared.uSunColor;
    sh.uniforms.uSunVis = shared.uSunVis;
    sh.vertexShader =
      "attribute vec3 aBase;\nattribute vec3 aSway;\nattribute float aKind;\nuniform float uTime;\nuniform vec2 uWind;\nuniform float uWindStr;\nvarying float vKind;\nvarying vec3 vW;\nvarying float vHn;\nvarying float vPh;\n" +
      sh.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        {
          vec2 wd = normalize(uWind + vec2(1e-5));
          float H = max(aSway.x, 0.1);
          float hn = clamp((position.y - aBase.y) / H, 0.0, 1.6);
          vKind = aKind;
          vW = position;
          vHn = hn;
          vPh = aSway.z;
          float bendK = hn * hn;                        // stiff at the root, free at the top
          float gp = dot(aBase.xz, wd) * 0.045 - uTime * (0.55 + 0.8 * uWindStr);
          float gust = 0.5 + 0.5 * sin(gp) * (0.65 + 0.35 * sin(gp * 0.37 + 1.3)); // gusts travelling downwind
          float lean = 0.02 + 0.2 * uWindStr * (0.45 + gust);
          float osc = 0.6 * sin(uTime * (0.8 + 0.9 * uWindStr) + aSway.z) + 0.4 * sin(uTime * 1.7 + aSway.z * 2.3);
          vec2 push = wd * (lean + 0.05 * uWindStr * osc) * H * bendK * 0.55
                    + vec2(-wd.y, wd.x) * osc * 0.035 * (0.4 + uWindStr) * H * bendK * 0.55;
          transformed.xz += push;
          transformed.y -= dot(push, push) * 0.4 / H;   // bending along an arc: the top comes down a little
          float fl = aSway.y;                           // leaves: stream downwind and flutter
          transformed.xz += wd * fl * (0.06 + 0.5 * uWindStr) * (0.55 + 0.45 * gust);
          float ft = uTime * (2.6 + 5.0 * uWindStr);
          transformed += fl * (0.015 + 0.13 * uWindStr) * vec3(
            sin(ft + position.x * 3.1 + aSway.z),
            0.6 * sin(ft * 1.3 + position.z * 2.7 + aSway.z * 1.9),
            sin(ft * 0.9 + position.y * 3.3 + aSway.z * 0.7));
        }`
      );
    sh.fragmentShader =
      /* glsl */ `uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunVis;
      varying float vKind;
      varying vec3 vW;
      varying float vHn;
      varying float vPh;
      float whash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      float wnoise(vec3 p) {
        vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(whash(i), whash(i + vec3(1,0,0)), u.x), mix(whash(i + vec3(0,1,0)), whash(i + vec3(1,1,0)), u.x), u.y),
                   mix(mix(whash(i + vec3(0,0,1)), whash(i + vec3(1,0,1)), u.x), mix(whash(i + vec3(0,1,1)), whash(i + vec3(1,1,1)), u.x), u.y), u.z);
      }
      ` +
      sh.fragmentShader
        .replace(
          "#include <color_fragment>",
          /* glsl */ `#include <color_fragment>
          {
            vec3 q = vW;
            float n1 = wnoise(q * 6.0);
            float n2 = wnoise(q * 23.0);
            if (vKind < 0.5) {
              // palm bark: fibrous, with raised growth scars every few centimetres, and damp moss at the foot
              float fibre = wnoise(vec3(q.x * 22.0, q.y * 2.4, q.z * 22.0));
              float ring = smoothstep(0.6, 0.96, abs(sin(q.y * 12.0 + n1 * 2.5)));
              vec3 bark = diffuseColor.rgb * (0.6 + 0.8 * fibre);
              bark = mix(bark, bark * 0.4, ring * 0.85);
              bark = mix(bark, vec3(0.15, 0.2, 0.09), (1.0 - smoothstep(0.02, 0.16, vHn)) * 0.55 * smoothstep(0.3, 0.7, n1));
              diffuseColor.rgb = bark;
            } else if (vKind < 1.5) {
              // fronds: mottled, with sun-scorched tips on some leaves and a little yellowing
              float dry = step(0.78, fract(vPh * 7.31)) * smoothstep(0.5, 1.2, vHn);
              diffuseColor.rgb *= 0.8 + 0.4 * n2;
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.4, 0.15), dry * 0.45 * smoothstep(0.3, 0.8, n1));
            } else {
              // grass: fine streaks along each blade, a few dry yellow blades
              float streak = wnoise(vec3(q.x * 48.0, q.y * 4.0, q.z * 48.0));
              diffuseColor.rgb *= 0.75 + 0.5 * streak;
              diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.35, 1.1, 0.5), step(0.82, whash(floor(q * 9.0))));
            }
          }`
        )
        .replace(
          "#include <fog_fragment>",
          /* glsl */ `{
            // leaves and grass let sunlight through when you look toward the sun
            vec3 vd = normalize(cameraPosition - vW);
            float tr = pow(max(dot(vd, -uSunDir), 0.0), 2.0) * uSunVis * step(0.5, vKind);
            gl_FragColor.rgb += diffuseColor.rgb * uSunColor * tr * 0.5;
          }
          #include <fog_fragment>`
        );
  };
  m.customProgramCacheKey = () => "wind-plants-2";
  return m;
}

