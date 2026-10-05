"use strict";
// ===== Sound (all synthesised) =====
const audio = (() => {
  let ctx = null, master, lowpass, engOsc, engGain, windGain, seaGain, seaAir, rainGain, noiseBuf;
  const a = {
    start() {
      if (ctx) return ctx.resume && ctx.resume();
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.7;
      lowpass = ctx.createBiquadFilter(); // swimming muffles everything
      lowpass.type = "lowpass";
      lowpass.frequency.value = 20000;
      master.connect(lowpass).connect(ctx.destination);
      const len = ctx.sampleRate * 3;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; // brown noise
        d[i] = last * 3.5;
      }
      const loop = (type, freq, q) => {
        const s = ctx.createBufferSource();
        s.buffer = noiseBuf;
        s.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = 0;
        s.connect(f).connect(g).connect(master);
        s.start();
        return g;
      };
      windGain = loop("bandpass", 500, 0.6);
      seaGain = loop("lowpass", 380, 0.5);
      seaAir = ctx.createGain(); // (after the swell's breathing, so the sea can be switched right off)
      seaGain.disconnect();
      seaGain.connect(seaAir).connect(master);
      rainGain = loop("highpass", 2500, 0.4);
      // the swell breathing in and out
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 1 / BREAK_T;
      lfoGain.gain.value = 0.12;
      lfo.connect(lfoGain).connect(seaGain.gain);
      lfo.start();
    },
    update(w, rainAmt, ws, shoreD, air = 1, away = false, wet = 1) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const surf = 1 - smooth(5, 220, shoreD); // the sea is loudest at the water's edge
      windGain.gain.setTargetAtTime((0.02 + 0.22 * w) * air, t, 0.3);
      seaGain.gain.setTargetAtTime(0.05 + (0.1 + 0.1 * ws * 0.5) * surf * 2, t, 0.3);
      seaAir.gain.setTargetAtTime(away ? 0 : air * wet, t, 0.4); // (silent unless you are in the water or close to it)
      rainGain.gain.setTargetAtTime(0.1 * rainAmt * air, t, 0.3);
    },
    fwLaunch() {
      if (!ctx) return;
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(700, t0);
      o.frequency.exponentialRampToValueAtTime(2400, t0 + 1.5);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + 1.7);
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 2600;
      f.Q.value = 1;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.08, t0);
      g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
      s.connect(f).connect(g2).connect(master);
      s.start(t0);
      s.stop(t0 + 0.5);
    },
    // a deep boom that arrives late (sound is slow), an echo, and for some shells a crackle
    fwBoom(dist, crackle) {
      if (!ctx) return;
      const t0 = ctx.currentTime + Math.min(dist / 340, 3);
      const gn = Math.max(0.2, 1 - dist / 700);
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(900, t0);
      f.frequency.exponentialRampToValueAtTime(80, t0 + 1.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.9 * gn, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 2.0);
      s.connect(f).connect(g).connect(master);
      s.start(t0);
      s.stop(t0 + 2.1);
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.frequency.setValueAtTime(85, t0);
      o.frequency.exponentialRampToValueAtTime(32, t0 + 1.0);
      og.gain.setValueAtTime(0.4 * gn, t0);
      og.gain.exponentialRampToValueAtTime(0.001, t0 + 1.1);
      o.connect(og).connect(master);
      o.start(t0);
      o.stop(t0 + 1.2);
      if (crackle)
        for (let i = 0; i < 18; i++) {
          const c = ctx.createBufferSource();
          c.buffer = noiseBuf;
          const cf = ctx.createBiquadFilter();
          cf.type = "highpass";
          cf.frequency.value = 2500 + Math.random() * 3500;
          const cg = ctx.createGain();
          const at = t0 + 0.5 + Math.random() * 1.6;
          cg.gain.setValueAtTime(0.06 * gn, at);
          cg.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
          c.connect(cf).connect(cg).connect(master);
          c.start(at);
          c.stop(at + 0.05);
        }
    },
    // the drone's whine: pitch rises with speed, volume with how close it is
    droneLevel(level, speed2) {
      if (!ctx) return;
      if (!a._drone) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = 140;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 900;
        const g = ctx.createGain();
        g.gain.value = 0;
        o.connect(f).connect(g).connect(master);
        o.start();
        a._drone = { o, g };
      }
      const t0 = ctx.currentTime;
      a._drone.g.gain.setTargetAtTime(0.06 * level, t0, 0.2);
      a._drone.o.frequency.setTargetAtTime(150 + Math.min(speed2, 200) * 0.5, t0, 0.2);
    },
    chime() {
      if (!ctx) return;
      const t0 = ctx.currentTime;
      for (const [f, d] of [[880, 0], [1320, 0.12], [1760, 0.26]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + d);
        g.gain.linearRampToValueAtTime(0.12, t0 + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + d + 1.6);
        o.connect(g).connect(master);
        o.start(t0 + d);
        o.stop(t0 + d + 1.7);
      }
    },
    engine(v) {
      if (!ctx) return;
      if (!engOsc) {
        engOsc = ctx.createOscillator();
        engOsc.type = "sawtooth";
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 260;
        engGain = ctx.createGain();
        engGain.gain.value = 0;
        engOsc.connect(f).connect(engGain).connect(master);
        engOsc.start();
      }
      engGain.gain.setTargetAtTime(v > 0.02 ? 0.05 + 0.1 * v : 0, ctx.currentTime, 0.15);
      engOsc.frequency.setTargetAtTime(38 + 60 * v, ctx.currentTime, 0.2);
    },
    underwater(on) {
      if (lowpass) lowpass.frequency.setTargetAtTime(on ? 380 : 20000, ctx.currentTime, 0.08);
    },
    thunder(dist) {
      if (!ctx) return;
      const delay = Math.min(dist / 343, 2.5);
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 220;
      const g = ctx.createGain();
      const t0 = ctx.currentTime + delay;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(1.2 * (1 - dist / 900), t0 + 0.2);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 3.5);
      s.connect(f).connect(g).connect(master);
      s.start(t0);
      s.stop(t0 + 4);
    },
  };
  return a;
})();

// ===== The player: walking on the island beach =====
const player = { x: ISL.x, z: ISL.z + ISL.r - 9, y: 0 };
player.y = groundY(player.x, player.z);
let yaw = Math.PI / 2 + 0.35; // facing west along the beach, toward the dock, the sea on your left
let pitch = 0;
const yawView = (d) => (yaw += d);
colliders.push({ x: lighthouse.group.position.x, z: lighthouse.group.position.z, r: 2.6 });

// ===== Hands: just a sphere on each =====
const hands = [0, 1].map((i) => {
  const grip = renderer.xr.getControllerGrip(i);
  const sph = new THREE.Mesh(new THREE.SphereGeometry(0.04, 20, 14), new THREE.MeshStandardMaterial({ color: 0xdfeeee, emissive: 0x3a5560, roughness: 0.4 }));
  grip.add(sph);
  rig.add(grip);
  const ray = renderer.xr.getController(i);
  rig.add(ray);
  const h = { grip, ray, side: null, gamepad: null, sph };
  ray.addEventListener("connected", (e) => {
    h.side = e.data.handedness;
    h.gamepad = e.data.gamepad || null;
  });
  ray.addEventListener("disconnected", () => {
    h.side = null;
    h.gamepad = null;
  });
  return h;
});
const handOf = (side) => hands.find((h) => h.side === side);

// ===== Under the water: seagrass, kelp, corals and schools of fish =====
// Makes a material look like it's under the water when below the surface: colours fade with the
// distance travelled through the water (red first), and it blends in less at grazing angles.
// wag > 0 also swishes the tail end of the mesh (for fish).
function applyUnderwater(material, wag = 0, minA = 0) {
  material.transparent = true;
  material.customProgramCacheKey = () => "underwater-" + wag + "-" + minA;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uLight = waterUniforms.uLight;
    shader.uniforms.uUnder = shared.uUnder;
    shader.uniforms.uUnderCol = shared.uUnderCol;
    shader.vertexShader =
      (wag ? "attribute float aPhase;\nuniform float uTime;\n" : "") +
      "varying vec3 vUW;\n" +
      shader.vertexShader
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          ${wag ? `transformed.x += sin(uTime * 14.0 + aPhase) * ${wag.toFixed(3)} * smoothstep(-0.05, 0.3, transformed.z);` : ""}`
        )
        .replace(
          "#include <fog_vertex>",
          `#include <fog_vertex>
          vec4 uwPos = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            uwPos = instanceMatrix * uwPos;
          #endif
          vUW = (modelMatrix * uwPos).xyz;`
        );
    shader.fragmentShader =
      "uniform float uLight;\nuniform float uTime;\nuniform float uUnder;\nuniform vec3 uUnderCol;\nvarying vec3 vUW;\n" +
      shader.fragmentShader.replace(
        "#include <fog_fragment>",
        `float below = -vUW.y;
        if (uUnder > 0.5) {
          // the camera is under the water: things fade into the murk by how far away they are
          vec3 absorbC = exp(-length(vUW - cameraPosition) * vec3(0.2, 0.07, 0.05));
          gl_FragColor.rgb = gl_FragColor.rgb * absorbC + uUnderCol * (1.0 - absorbC);
        } else if (below > 0.0) {
          vec3 rd = normalize(vUW - cameraPosition);
          float pathLen = below / max(-rd.y, 0.08);
          // Caustics: sunlight focused by the waves, dancing over surfaces that face up
          float facing = abs(normalize(cross(dFdx(vUW), dFdy(vUW)) + vec3(1e-6)).y); // how much the surface faces up
          float cw = sin(vUW.x * 1.7 + sin(vUW.z * 1.3 + uTime * 0.9) * 1.5 + uTime)
                   * sin(vUW.z * 1.9 + sin(vUW.x * 1.1 - uTime * 0.7) * 1.5 - uTime * 0.8);
          gl_FragColor.rgb *= 1.0 + 0.7 * pow(max(cw, 0.0), 3.0) * facing * exp(-below * 0.12) * uLight;
          // colour fades with depth, red first, into bright turquoise, so things match the floor they sit on
          vec3 absorb = exp(-below * vec3(0.32, 0.1, 0.07));
          vec3 inscatter = vec3(0.2, 0.85, 0.9) * uLight;
          gl_FragColor.rgb = gl_FragColor.rgb * absorb + inscatter * (1.0 - absorb);
          // Solid up close; only the surface reflection at a low angle, and distance, fade them out
          float fres = 0.02 + 0.98 * pow(1.0 - abs(rd.y), 5.0);
          gl_FragColor.a = max(gl_FragColor.a * (1.0 - fres) * (1.0 - smoothstep(25.0, 45.0, pathLen)), ${minA.toFixed(2)}); // (solid things keep most of their body: they blend by colour, not see-through)
        }
        #include <fog_fragment>`
      );
  };
  return material;
}

// ===== From Coastline: the reef, kelp forests, fish schools and the boat =====
// (ported from Coastline's reef.js, life.js and boat.js; here they grow around the island instead of the mainland coast)
const shapeModel = (name, res) => res; // (Coastline's model editor hook: nothing to edit here)
const glowTexture = dotTexture;
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
}

// Makes a material look like it's under the water (see applyUnderwater above)
// ===== A tiny mesh kit: smooth-shaded parts with a colour per vertex, merged into one geometry =====
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

function reefMesh() {
  const pos = [];
  const nor = [];
  const col = [];
  // A grid of vertices; f(i, j) gives { p: [x, y, z], c: [r, g, b] }. wrap joins the last column to the first.
  function grid(rows, cols, f, wrap = false) {
    const V = [];
    const C = [];
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const v = f(i, j);
        V.push(v.p);
        C.push(v.c);
      }
    const at = (i, j) => i * cols + (wrap ? j % cols : j);
    const tris = [];
    for (let i = 0; i < rows - 1; i++)
      for (let j = 0; j < (wrap ? cols : cols - 1); j++) {
        tris.push([at(i, j), at(i + 1, j), at(i, j + 1)], [at(i, j + 1), at(i + 1, j), at(i + 1, j + 1)]);
      }
    // Smooth normals (the materials are two-sided, so which way they face doesn't matter)
    const N = V.map(() => [0, 0, 0]);
    for (const [a, b, c] of tris) {
      const n = v3.cross(v3.sub(V[b], V[a]), v3.sub(V[c], V[a]));
      for (const k of [a, b, c]) for (let q = 0; q < 3; q++) N[k][q] += n[q];
    }
    const Nn = N.map(v3.norm);
    for (const t of tris)
      for (const k of t) {
        pos.push(...V[k]);
        nor.push(...Nn[k]);
        col.push(...C[k]);
      }
  }
  // An ellipsoid (or part of one, from latitude lat0 to lat1, 0 = top), dented by disp(dir) and coloured by color(dir)
  function blob(c, r, lat0, lat1, segLat, segLon, disp = () => 1, color = () => [1, 1, 1]) {
    grid(
      segLat + 1,
      segLon,
      (i, j) => {
        const th = lat0 + ((lat1 - lat0) * i) / segLat;
        const ph = (2 * Math.PI * j) / segLon;
        const d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        const k = disp(d);
        return { p: [c[0] + d[0] * r[0] * k, c[1] + d[1] * r[1] * k, c[2] + d[2] * r[2] * k], c: color(d) };
      },
      true
    );
  }
  // A tapered tube from a to b
  function tube(a, b, r0, r1, sides, c0, c1) {
    const axis = v3.norm(v3.sub(b, a));
    const helper = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = v3.norm(v3.cross(axis, helper));
    const w = v3.cross(axis, u);
    grid(
      2,
      sides,
      (i, j) => {
        const ang = (2 * Math.PI * j) / sides;
        const r = i ? r1 : r0;
        const ring = v3.add(v3.mul(u, Math.cos(ang) * r), v3.mul(w, Math.sin(ang) * r));
        return { p: v3.add(i ? b : a, ring), c: i ? c1 : c0 };
      },
      true
    );
  }
  // A flat strip from a to b, width w, lying in the plane with normal n
  function ribbon(a, b, w0, w1, n, c0, c1) {
    const side = v3.norm(v3.cross(v3.sub(b, a), n));
    grid(2, 2, (i, j) => {
      const half = (i ? w1 : w0) / 2;
      return { p: v3.add(i ? b : a, v3.mul(side, j ? half : -half)), c: i ? c1 : c0 };
    });
  }
  return {
    blob,
    tube,
    ribbon,
    data: () => ({ position: new Float32Array(pos), normal: new Float32Array(nor), color: new Float32Array(col) }),
  };
}

// Seeded random numbers, so every tile of reef grows the same way each time it's filled in
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const bumps = (d, f, seed) => noise2(d[0] * f + seed, d[2] * f + d[1] * f * 1.7 + seed * 0.37);

// ===== The shapes (about 1 m across; each placed copy is scaled and tinted) =====
// Table coral: a broad flat plate on a short stalk, paler at the growing rim; sometimes a second tier
function shapeTable(rng) {
  const m = reefMesh();
  m.tube([0, 0, 0], [0.05, 0.5, 0], 0.16, 0.1, 6, grey(0.45), grey(0.6));
  const plate = (c, r, seed) =>
    m.blob(
      c,
      [r, 0.08, r * 0.92],
      0,
      Math.PI,
      5,
      14,
      (d) => 1 + 0.08 * (bumps(d, 3, seed) - 0.5),
      // Radial ridges of growing branches, a pale growing rim, darker underneath
      (d) => {
        if (d[1] < -0.2) return grey(0.42);
        const radial = Math.abs(Math.sin(Math.atan2(d[2], d[0]) * 23 + bumps(d, 5, seed) * 4));
        return grey(0.62 + 0.18 * radial + 0.4 * Math.pow(1 - Math.abs(d[1]), 3) + 0.12 * (bumps(d, 9, seed) - 0.5));
      }
    );
  plate([0.05, 0.55, 0], 1, rng() * 50);
  if (rng() < 0.45) {
    m.tube([0.05, 0.3, 0], [0.45, 0.32, 0.2], 0.08, 0.06, 5, grey(0.45), grey(0.55));
    plate([0.55, 0.32, 0.25], 0.55, rng() * 50);
  }
  return m.data();
}
// Brain and boulder corals: lumpy domes with a meandering pattern
function shapeBoulder(rng) {
  const m = reefMesh();
  const seed = rng() * 50;
  const lumps = 1 + Math.floor(rng() * 3);
  for (let k = 0; k < lumps; k++) {
    const r = k ? rand(0.4, 0.65) : 1;
    const c = k ? [rand(-0.7, 0.7), -0.05, rand(-0.7, 0.7)] : [0, -0.05, 0];
    m.blob(
      c,
      [r, r * 0.72, r * 0.9],
      0,
      Math.PI / 2,
      5,
      13,
      (d) => 1 + 0.18 * (bumps(d, 2.5, seed + k) - 0.5),
      (d) => grey(0.55 + 0.45 * Math.abs(Math.sin(d[0] * 11 + Math.sin(d[2] * 9 + seed) * 2.2) * Math.sin(d[2] * 10 + d[1] * 5)))
    );
  }
  return m.data();
}
// Branching coral: antler-like branches with pale growing tips (staghorn), or a dome of short fingers
function shapeBranching(rng, fingers) {
  const m = reefMesh();
  if (fingers) {
    m.blob([0, -0.05, 0], [0.75, 0.35, 0.7], 0, Math.PI / 2, 4, 12, () => 1, () => grey(0.6));
    for (let k = 0; k < 22; k++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 0.62;
      const base = [Math.cos(a) * r, 0.3 * Math.sqrt(Math.max(0, 1 - (r / 0.75) ** 2)) - 0.03, Math.sin(a) * r];
      const tip = v3.add(base, [Math.cos(a) * r * 0.25, rand(0.2, 0.42), Math.sin(a) * r * 0.25]);
      m.tube(base, tip, 0.06, 0.04, 4, grey(0.62), grey(1.05));
    }
    return m.data();
  }
  const branch = (a, dir, len, r, depth) => {
    const b = v3.add(a, v3.mul(dir, len));
    m.tube(a, b, r, r * 0.75, 3, grey(0.55 + depth * 0.1), grey(depth === 3 ? 1.1 : 0.65 + depth * 0.1));
    if (depth === 3) return;
    for (let k = 0; k < 2; k++) {
      const nd = v3.norm(v3.add(dir, [rand(-0.7, 0.7), rand(0.1, 0.6), rand(-0.7, 0.7)]));
      branch(b, nd, len * 0.82, r * 0.72, depth + 1);
    }
  };
  const trunks = 3 + Math.floor(rng() * 2);
  for (let k = 0; k < trunks; k++) {
    const a = (k / trunks) * Math.PI * 2 + rng();
    branch([0, 0, 0], v3.norm([Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6]), 0.32, 0.06, 0);
  }
  return m.data();
}
// Soft coral: a bush of fleshy, cauliflower-like lobes on short stems, brightest on top
function shapeSoft(rng) {
  const m = reefMesh();
  const seed = rng() * 50;
  for (let k = 0; k < 7; k++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 0.42;
    const h = 0.35 + rng() * 0.35 - r * 0.3;
    const top = [Math.cos(a) * r, h, Math.sin(a) * r];
    m.tube([top[0] * 0.3, 0, top[2] * 0.3], top, 0.06, 0.05, 4, grey(0.75), grey(0.85));
    const s = rand(0.16, 0.26);
    m.blob(
      top,
      [s * 1.1, s * 0.9, s * 1.1],
      0,
      Math.PI,
      3,
      6,
      (d) => 1 + 0.25 * (bumps(d, 4, seed + k) - 0.5),
      (d) => grey(0.72 + 0.35 * Math.max(0, d[1]))
    );
  }
  return m.data();
}
// Sea fan (gorgonian): a flat, slightly curved lace of branches
function shapeFan(rng) {
  const m = reefMesh();
  const bend = (p) => [p[0], p[1], 0.18 * p[0] * p[0]];
  const branch = (a, ang, len, w, depth) => {
    const b = [a[0] + Math.sin(ang) * len, a[1] + Math.cos(ang) * len, 0];
    const tone = 0.55 + depth * 0.09;
    m.ribbon(bend(a), bend(b), w, w * 0.8, [0, 0, 1], grey(tone), grey(tone + 0.09));
    if (depth === 5) return;
    const spread = rand(0.25, 0.5);
    branch(b, ang - spread, len * 0.84, w * 0.78, depth + 1);
    branch(b, ang + spread, len * 0.84, w * 0.78, depth + 1);
  };
  branch([0, 0, 0], rand(-0.15, 0.15), 0.3, 0.05, 0);
  return m.data();
}
// Rock: a lumpy boulder, flat underneath, crusted with pink coralline algae and green turf on top
function shapeRock(rng) {
  const m = reefMesh();
  const seed = rng() * 50;
  m.blob(
    [0, 0.25, 0],
    [1, 0.6, 0.85],
    0,
    Math.PI,
    7,
    12,
    (d) => {
      const k = 1 + 0.32 * (bumps(d, 1.4, seed) - 0.5) + 0.14 * (bumps(d, 4, seed + 3) - 0.5);
      return d[1] * k < -0.4 ? -0.4 / d[1] : k; // flat base
    },
    (d) => {
      const base = [0.56, 0.52, 0.47].map((v) => v * (0.85 + 0.3 * bumps(d, 5, seed)));
      if (d[1] < 0.25) return base;
      const crust = bumps(d, 3, seed + 7);
      const on = Math.min(1, (d[1] - 0.25) * 3);
      const top = crust > 0.55 ? [0.78, 0.48, 0.58] : [0.45, 0.55, 0.3];
      return base.map((v, i) => v + (top[i] - v) * on * 0.8);
    }
  );
  return m.data();
}

// Each kind of reef object: its shapes, how tall it is (at scale 1), its size range and its colours
// (capacities and ranges trimmed a little for a headset)
const REEF_KINDS = [
  { id: "table", shapes: [shapeTable, shapeTable], height: 0.65, size: [0.5, 1.4], cap: 260, range: 95,
    colors: [[0.98, 0.72, 0.5], [0.95, 0.55, 0.48], [0.62, 0.72, 0.88], [1, 0.92, 0.76], [0.74, 0.74, 0.46]] },
  { id: "boulder", shapes: [shapeBoulder, shapeBoulder], height: 0.75, size: [0.5, 1.5], cap: 320, range: 95,
    colors: [[0.95, 0.78, 0.5], [0.66, 0.74, 0.4], [0.78, 0.52, 0.7], [1, 0.66, 0.4], [0.82, 0.84, 0.66]] },
  { id: "staghorn", shapes: [(r) => shapeBranching(r, false), (r) => shapeBranching(r, false)], height: 1.0, size: [0.7, 1.4], cap: 300, range: 70,
    colors: [[0.86, 0.6, 0.42], [0.78, 0.5, 0.8], [0.55, 0.68, 0.95], [1, 0.9, 0.7], [1, 0.62, 0.68]] },
  { id: "fingers", shapes: [(r) => shapeBranching(r, true)], height: 0.65, size: [0.6, 1.2], cap: 260, range: 70,
    colors: [[0.92, 0.7, 0.5], [0.75, 0.55, 0.88], [1, 0.82, 0.55], [0.66, 0.78, 0.5]] },
  { id: "soft", shapes: [shapeSoft, shapeSoft], height: 0.95, size: [0.45, 1.05], cap: 260, range: 70,
    colors: [[0.95, 0.3, 0.3], [0.97, 0.58, 0.64], [0.98, 0.52, 0.22], [0.5, 0.78, 0.25], [0.92, 0.78, 0.3]] },
  { id: "fan", shapes: [shapeFan, shapeFan], height: 1.6, size: [0.7, 1.6], cap: 200, range: 80,
    colors: [[0.92, 0.42, 0.22], [0.62, 0.32, 0.72], [0.86, 0.86, 0.82], [0.95, 0.78, 0.28]] },
  { id: "rock", shapes: [shapeRock, shapeRock, shapeRock], height: 0.85, size: [0.5, 2.4], cap: 380, range: 95,
    colors: [[1, 1, 1], [0.92, 0.9, 0.86], [0.85, 0.85, 0.82]] },
];
// Which corals grow at which depth (shallow: sturdy branching and table corals; deeper: soft corals and fans)
const REEF_KIND = Object.fromEntries(REEF_KINDS.map((K) => [K.id, K]));
const REEF_MIX_SHALLOW = { table: 0.13, boulder: 0.22, staghorn: 0.27, fingers: 0.18, soft: 0.12, fan: 0.08 };
const REEF_MIX_DEEP = { table: 0.1, boulder: 0.22, staghorn: 0.14, fingers: 0.1, soft: 0.24, fan: 0.2 };

// ===== Where the reef grows: a shelf of patches all round the island, and boulders along its rocky edge =====
const NO_REEF = { coral: 0, rock: 0 };
const reefNoise = (x, z) => noise2(x, z) * 0.6 + noise2(x * 2.1 + 5.3, z * 2.1 + 1.7) * 0.4;
function reefWeights(x, z) {
  const d = shoreDistAll(x, z); // metres out to sea (from the nearest island)
  if (d < 1) return NO_REEF;
  const shelf = smooth(10, 26, d) * (1 - smooth(120, 190, d));
  const rockZone = smooth(1, 6, d) * (1 - smooth(30, 60, d));
  if (shelf + rockZone < 0.01) return NO_REEF;
  const patch = shelf > 0 ? shelf * smooth(0.4, 0.55, reefNoise(x * 0.012, z * 0.012)) : 0;
  const coral = patch > 0 ? patch * smooth(0.34, 0.54, reefNoise(x * 0.07 + 3.1, z * 0.07 + 7.7)) : 0;
  const rock = rockZone > 0 ? rockZone * smooth(0.4, 0.6, reefNoise(x * 0.05 + 11, z * 0.05 + 5)) : 0;
  return { coral, rock };
}

// the island whose shore is nearest a point (the home island, or the one in this cell)
function curIsland(x, z) {
  const a = isleCellOf(x, z), dh = shoreDistJS(x, z);
  if (a.type && isleDist(a, x, z) < dh) return { x: a.x, z: a.z, r: a.r, a };
  return { x: ISL.x, z: ISL.z, r: ISL.r, a: null };
}
const REEF_TILE = 20;
const REEF_RADIUS = 100; // underwater things fade out before this
const reefTiles = new Map();

// Everything growing on one tile of sea floor: [{ kind, shape, x, y, z, yaw, tiltX, tiltZ, scale, color }]
function reefTile(tx, tz) {
  const key = tx + "," + tz;
  let items = reefTiles.get(key);
  if (items) return items;
  items = [];
  const rng = seededRandom(Math.imul(tx, 73856093) ^ Math.imul(tz, 19349663) ^ 0x5bd1e995);
  const add = (kind, x, z, bed, depth, scaleMul) => {
    if (depth < 1.0) return false; // not in the shallows (or on land)
    if (Math.hypot(x - HARBOR.x, z - HARBOR.z) < 24) return false; // keep the harbour basin clear
    const K = REEF_KIND[kind];
    // Never let it reach the surface
    let scale = (K.size[0] + (K.size[1] - K.size[0]) * rng() ** 1.5) * scaleMul;
    scale = Math.min(scale, (depth - 0.7) / K.height);
    if (scale < 0.3) return false;
    items.push({
      kind,
      shape: Math.floor(rng() * K.shapes.length),
      x,
      y: bed - 0.06 * scale,
      z,
      yaw: rng() * Math.PI * 2,
      tiltX: (rng() - 0.5) * 0.2,
      tiltZ: (rng() - 0.5) * 0.2,
      scale,
      color: K.colors[Math.floor(rng() * K.colors.length)].map((c) => c * (0.85 + 0.25 * rng())),
    });
    return true;
  };
  const pickCoral = (depth, roll) => {
    const mix = depth < 6 ? REEF_MIX_SHALLOW : REEF_MIX_DEEP;
    let acc = 0;
    for (const id in mix) {
      acc += mix[id];
      if (roll < acc) return id;
    }
    return "boulder";
  };
  for (let k = 0; k < 40; k++) {
    const x = (tx + rng()) * REEF_TILE;
    const z = (tz + rng()) * REEF_TILE;
    const roll = rng();
    const pickRoll = rng();
    const bed = bedHeightJS(x, z);
    const depth = -bed;
    if (depth < 1.0 || depth > 26) continue;
    const w = reefWeights(x, z);
    if (roll < w.rock * 0.25 || roll > 0.997) {
      add("rock", x, z, bed, depth, w.rock > 0.8 ? 1.6 : 1);
    } else if (roll < w.rock * 0.25 + w.coral * 0.9 * (1 - 0.6 * smooth(7, 18, depth))) {
      if (!add(pickCoral(depth, pickRoll), x, z, bed, depth, 1)) continue;
      // Corals grow in crowded heads: a few smaller neighbours around this one
      const friends = Math.floor(rng() * 7 * w.coral);
      for (let f = 0; f < friends; f++) {
        const a = rng() * Math.PI * 2;
        const r = 0.7 + rng() * 1.6;
        const fx = x + Math.cos(a) * r;
        const fz = z + Math.sin(a) * r;
        const fb = bedHeightJS(fx, fz);
        add(pickCoral(-fb, rng()), fx, fz, fb, -fb, 0.6 + 0.3 * rng());
      }
    }
  }
  reefTiles.set(key, items);
  return items;
}

// The tiles around (x, z), nearest first
function reefTilesAround(x, z) {
  const ctx = Math.floor(x / REEF_TILE);
  const ctz = Math.floor(z / REEF_TILE);
  const n = Math.ceil(REEF_RADIUS / REEF_TILE) + 1;
  const tiles = [];
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++) {
      const d = Math.hypot((ctx + i + 0.5) * REEF_TILE - x, (ctz + j + 0.5) * REEF_TILE - z);
      if (d < REEF_RADIUS + REEF_TILE) tiles.push({ tx: ctx + i, tz: ctz + j, d });
    }
  return tiles.sort((a, b) => a.d - b.d);
}

// ===== Drawing: one instanced mesh per shape =====
const reefMat = applyUnderwater(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }), 0, 0.88);
const reefMeshes = {}; // kind → [InstancedMesh per shape]
for (const K of REEF_KINDS) {
  reefMeshes[K.id] = K.shapes.map((build, i) => {
    const data = build(seededRandom(1000 + i * 77 + K.id.length * 13));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(data.position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(data.normal, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(data.color, 3));
    const cap = Math.ceil(K.cap / K.shapes.length);
    const mesh = new THREE.InstancedMesh(geo, reefMat, cap);
    // Every mesh gets its colours from the start. They all share one material, and three.js builds its shader
    // once: if some meshes had per-coral colours and others didn't, the others would draw black or untinted.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.count = 0;
    mesh.frustumCulled = false; // the copies are spread far beyond the shape's own bounds
    mesh.renderOrder = 1.5; // after the water, like the other underwater things
    scene.add(mesh);
    return mesh;
  });
}

const reefState = { tile: null, dirty: false };
const _rm = new THREE.Matrix4();
const _rq = new THREE.Quaternion();
const _re = new THREE.Euler();
const _rp = new THREE.Vector3();
const _rs = new THREE.Vector3();
const _rc = new THREE.Color();

// Refill the reef around the camera when it moves onto another tile. New tiles are grown a couple per
// frame, nearest first, so there's never a pause; the far ones (barely visible) fill in a moment later.
function updateReef() {
  const cx = camPos.x;
  const cz = camPos.z;
  const tile = Math.floor(cx / REEF_TILE) + "," + Math.floor(cz / REEF_TILE);
  if (tile !== reefState.tile) {
    reefState.tile = tile;
    reefState.dirty = true;
  }
  if (!reefState.dirty) return;
  const start = performance.now();
  let missing = false;
  for (const t of reefTilesAround(cx, cz)) {
    if (reefTiles.has(t.tx + "," + t.tz)) continue;
    if (performance.now() - start > 4) {
      missing = true; // the rest next frame
      break;
    }
    reefTile(t.tx, t.tz);
  }
  reefState.dirty = missing;
  for (const id in reefMeshes) for (const mesh of reefMeshes[id]) mesh.count = 0;
  const items = [];
  for (const t of reefTilesAround(cx, cz)) {
    const tileItems = reefTiles.get(t.tx + "," + t.tz);
    if (tileItems) for (const it of tileItems) if (Math.hypot(it.x - cx, it.z - cz) < REEF_KIND[it.kind].range) items.push(it);
  }
  for (const it of items) {
    const mesh = reefMeshes[it.kind][it.shape];
    if (mesh.count >= mesh.instanceMatrix.count) continue;
    _re.set(it.tiltX, it.yaw, it.tiltZ);
    _rm.compose(_rp.set(it.x, it.y, it.z), _rq.setFromEuler(_re), _rs.set(it.scale, it.scale, it.scale));
    mesh.setMatrixAt(mesh.count, _rm);
    mesh.setColorAt(mesh.count, _rc.setRGB(it.color[0], it.color[1], it.color[2]));
    mesh.count++;
  }
  for (const id in reefMeshes)
    for (const mesh of reefMeshes[id]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  // Forget tiles far behind, so the cache doesn't grow forever
  if (reefTiles.size > 2500) {
    for (const key of reefTiles.keys()) {
      const [tx, tz] = key.split(",").map(Number);
      if (Math.hypot((tx + 0.5) * REEF_TILE - cx, (tz + 0.5) * REEF_TILE - cz) > 600) reefTiles.delete(key);
    }
  }
}

// ===== Kelp forests: tall seaweed from the sea floor to just under the surface, all round the island =====
// Each plant is a few long ribbons; the waves' to-and-fro surge sways them, more towards the top, in
// rolling bands as each wave passes. One draw call; the swaying is done on the GPU.
const kelp = (() => {
  const K = { color: 0x9a8636, depth: [2.2, 14], count: 700 };
  // One plant: three ribbons twisted around a common root, each 1 unit tall, wavy-edged
  const pos = [];
  const col = [];
  const idx = [];
  const SEG = 11;
  for (let r = 0; r < 3; r++) {
    const a0 = (r / 3) * Math.PI * 2 + 0.4;
    const off = 0.12;
    const v0 = pos.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const a = a0 + t * 2.2; // the ribbon twists as it rises
      const w = (0.09 + 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.3))) * (1 + 0.25 * Math.sin(t * 31 + r)); // wavy edge
      const cx = Math.cos(a0) * off * (1 + t * 2.5);
      const cz = Math.sin(a0) * off * (1 + t * 2.5);
      const ex = Math.cos(a + Math.PI / 2) * w;
      const ez = Math.sin(a + Math.PI / 2) * w;
      pos.push(cx - ex, t, cz - ez, cx + ex, t, cz + ez);
      const shade = 0.45 + 0.55 * t; // darker down in the gloom
      col.push(shade, shade, shade, shade, shade, shade);
      if (s) idx.push(v0 + (s - 1) * 2, v0 + s * 2, v0 + (s - 1) * 2 + 1, v0 + (s - 1) * 2 + 1, v0 + s * 2, v0 + s * 2 + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // Where they grow: forests in patches on the shelf, between the two depths, thinning out with depth
  const spots = [];
  const pickDepth = () => K.depth[0] + (K.depth[1] - K.depth[0]) * Math.pow(Math.random(), 1.6);
  for (let k = 0, tries = 0; k < K.count && tries < K.count * 6; tries++) {
    const a = rand(0, Math.PI * 2);
    const want = pickDepth();
    for (let r = ISL.r + 4; r < ISL.r + 280; r += 2) {
      const x = ISL.x + Math.cos(a) * r;
      const z = ISL.z + Math.sin(a) * r;
      const y = bedHeightJS(x, z);
      if (y > -want) continue;
      if (jfbm(x * 0.03 + 4, z * 0.03, 7.7, 3) > 0.42 && Math.hypot(x - HARBOR.x, z - HARBOR.z) > 26) {
        spots.push({ x, z, y, len: -y + rand(-0.6, 2.6) }); // up to the surface; the longest spread out along it
        k++;
      }
      break;
    }
  }

  const mat = applyUnderwater(new THREE.MeshStandardMaterial({ color: K.color, vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }));
  const underwater = mat.onBeforeCompile;
  // The surge under each passing wave: the water moves to and fro along the wave's direction, so the
  // kelp leans one way then the other, the top swinging furthest
  const swayGLSL = WAVES.slice(0, 3)
    .map((w) => `s += vec2(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)}) * ${(w.a * 1.6).toFixed(4)} * cos(${w.k.toFixed(5)} * (${w.dx.toFixed(4)} * wp.x + ${w.dz.toFixed(4)} * wp.z - ${w.c.toFixed(4)} * uTime));`)
    .join("\n            ");
  mat.onBeforeCompile = (shader) => {
    underwater(shader);
    shader.uniforms.uWaveScale = waterUniforms.uWaveScale;
    shader.vertexShader =
      "uniform float uWaveScale;\nuniform float uTime;\n" +
      shader.vertexShader.replace(
        "#include <project_vertex>",
        `vec4 wp = instanceMatrix * vec4(transformed, 1.0);
          float h = position.y;
          float len = length(instanceMatrix[1].xyz);
          vec2 s = vec2(0.0);
          ${swayGLSL}
          // a slower, gentler drift of the whole forest, and each plant's own flutter
          s += vec2(0.35, 0.2) * sin(uTime * 0.45 + wp.x * 0.05 + wp.z * 0.04);
          s += vec2(sin(uTime * 1.7 + wp.x * 3.1), cos(uTime * 1.3 + wp.z * 2.7)) * 0.12;
          wp.xz += s * uWaveScale * h * h * (0.6 + len * 0.18);
          wp.y -= length(s) * uWaveScale * h * h * 0.15 * len; // leaning over, it dips a little
          // what reaches the surface floats: it lies along the top, trailing the way the water pushes it
          float over = max(wp.y + 0.12, 0.0);
          wp.y -= over;
          wp.xz += normalize(s + vec2(0.3, 0.25)) * over;
          { vec2 dk = wp.xz - cameraPosition.xz; wp.y -= dot(dk, dk) * uCurve; }
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;`
      );
  };
  mat.customProgramCacheKey = () => "kelp";

  const build = (spots, parent) => {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  spots.forEach((p, i) => {
    const wide = rand(0.9, 1.6);
    mesh.setMatrixAt(i, m.compose(v.set(p.x, p.y - 0.2, p.z), q.setFromEuler(e.set(0, rand(0, Math.PI * 2), 0)), sc.set(wide, p.len, wide)));
    mesh.setColorAt(i, c.setHSL(rand(0.09, 0.2), rand(0.3, 0.55), rand(0.75, 0.95))); // olive, golden or greener plants
  });
  mesh.count = spots.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1.5;
  parent.add(mesh);
  return mesh;
  };
  const mesh = build(spots, scene);
  return { mesh, spots, build, pickDepth };
})();

// ===== Splashes (shared by the leaping fish) =====
const SPLASH_COUNT = 400;
const splashPos = new Float32Array(SPLASH_COUNT * 3).fill(-1000);
const splashVel = new Float32Array(SPLASH_COUNT * 3);
const splashLife = new Float32Array(SPLASH_COUNT);
let splashNext = 0;
const splashGeo = new THREE.BufferGeometry();
splashGeo.setAttribute("position", new THREE.BufferAttribute(splashPos, 3));
const splashMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, transparent: true, opacity: 0.85, depthWrite: false });
const splashPoints = new THREE.Points(splashGeo, splashMat);
splashPoints.frustumCulled = false;
splashPoints.renderOrder = 2; // after the foam on the water
scene.add(splashPoints);
function splash(x, y, z, count, power) {
  for (let n = 0; n < count; n++) {
    const i = splashNext;
    splashNext = (splashNext + 1) % SPLASH_COUNT;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * power * 0.5;
    splashPos[i * 3] = x + Math.cos(a) * 0.3;
    splashPos[i * 3 + 1] = y;
    splashPos[i * 3 + 2] = z + Math.sin(a) * 0.3;
    splashVel[i * 3] = Math.cos(a) * r;
    splashVel[i * 3 + 1] = rand(0.5, 1) * power;
    splashVel[i * 3 + 2] = Math.sin(a) * r;
    splashLife[i] = rand(0.5, 1.1);
  }
}
function updateSplashes(dt) {
  for (let i = 0; i < SPLASH_COUNT; i++) {
    if (splashLife[i] <= 0) continue;
    splashLife[i] -= dt;
    splashVel[i * 3 + 1] -= 9.8 * dt;
    splashPos[i * 3] += splashVel[i * 3] * dt;
    splashPos[i * 3 + 1] += splashVel[i * 3 + 1] * dt;
    splashPos[i * 3 + 2] += splashVel[i * 3 + 2] * dt;
    if (splashLife[i] <= 0) splashPos[i * 3 + 1] = -1000;
  }
  splashGeo.attributes.position.needsUpdate = true;
}

// ===== Fish that leap out of the water and glide above the waves =====
const fishMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0xb8c4cc, metalness: 0.6, roughness: 0.3 }));
function buildFish() {
  const g = new THREE.Group();
  g.rotation.order = "YXZ";
  const bodyGeo = new THREE.SphereGeometry(1, 8, 6);
  bodyGeo.scale(0.09, 0.14, 0.35);
  g.add(new THREE.Mesh(bodyGeo, fishMat));
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.12), fishMat);
  tail.position.z = 0.38;
  g.add(tail);
  return shapeModel("fish", g);
}
const fishes = [];
for (let i = 0; i < 8; i++) {
  const mesh = buildFish();
  mesh.visible = false;
  scene.add(mesh);
  fishes.push({ mesh, active: false, x: 0, z: 0, yaw: 0, t: 0, dur: 1, height: 1, speed: 5 });
}
let fishTimer = 1;
const boil = { x: 0, z: 0, timer: 0 }; // a shoal feeding near the surface out at sea, where fish leap
function moveBoil() {
  const I = curIsland(camPos.x, camPos.z);
  const home = Math.atan2(camPos.z - I.z, camPos.x - I.x);
  for (let k = 0; k < 40; k++) {
    const a = I.a ? home + rand(-1.4, 1.4) : Math.PI / 2 + rand(-1.4, 1.4);
    const r = (I.a ? isleCoastR(I.a, a) : I.r) + rand(60, 200);
    const x = I.x + Math.cos(a) * r, z = I.z + Math.sin(a) * r;
    if (bedHeightJS(x, z) < -3) {
      boil.x = x;
      boil.z = z;
      break;
    }
  }
  boil.timer = rand(90, 180);
}
function updateLeapFish(dt, t) {
  boil.timer -= dt;
  if (boil.timer <= 0 || Math.hypot(boil.x - camPos.x, boil.z - camPos.z) > 450) moveBoil();
  fishTimer -= dt;
  if (fishTimer <= 0) {
    fishTimer = rand(0.5, 2.2);
    const f = fishes.find((fish) => !fish.active);
    if (f) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(0, 22);
      f.active = true;
      f.x = boil.x + Math.cos(a) * r;
      f.z = boil.z + Math.sin(a) * r;
      f.yaw = Math.random() * Math.PI * 2;
      f.t = 0;
      f.dur = rand(2.2, 3.4);
      f.height = rand(0.6, 1.1);
      f.speed = rand(7, 10);
      f.mesh.visible = true;
      splash(f.x, waveHeight(f.x, f.z, t), f.z, 8, 1.5);
    }
  }
  for (const f of fishes) {
    if (!f.active) continue;
    f.t += dt;
    const u = f.t / f.dur;
    if (u >= 1) {
      f.active = false;
      f.mesh.visible = false;
      splash(f.x, waveHeight(f.x, f.z, t), f.z, 8, 1.5);
      continue;
    }
    f.x -= Math.sin(f.yaw) * f.speed * dt;
    f.z -= Math.cos(f.yaw) * f.speed * dt;
    // Up out of the water, a long glide just above the waves, then back in
    const lift = Math.min(1, Math.sin(Math.PI * u) * 3);
    const rel = -0.2 + (f.height + 0.2) * lift;
    const vy = u < 0.12 ? 3 : u > 0.88 ? -3 : 0;
    f.mesh.position.set(f.x, waveHeight(f.x, f.z, t) + rel, f.z);
    f.mesh.rotation.set(Math.atan2(vy, f.speed), f.yaw, Math.sin(f.t * 30) * 0.2);
  }
}

// ===== Reef fish schools (orange anthias swimming over the reef near the shore) =====
const SCHOOL_COUNT = 3;
const FISH_PER_SCHOOL = 90;
function buildReefFishGeometries() {
  // Body: a lathed, laterally flattened teardrop, nose toward -Z
  const profile = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    profile.push(new THREE.Vector2(Math.max(0.001, 0.11 * Math.sin(Math.PI * Math.pow(t, 0.8))), -0.2 + t * 0.4));
  }
  const body = new THREE.LatheGeometry(profile, 10);
  body.rotateX(Math.PI / 2);
  body.scale(0.45, 1, 1);
  // Forked tail fin behind the body
  const tail = new THREE.BufferGeometry();
  tail.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.17, 0, 0.12, 0.36, 0, 0.02, 0.29, 0, 0, 0.17, 0, -0.02, 0.29, 0, -0.12, 0.36], 3));
  tail.computeVertexNormals();
  return { body, tail };
}
const reefFishGeo = buildReefFishGeometries();
const reefBodyMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }), 0.03);
const reefTailMat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, side: THREE.DoubleSide }), 0.09);
const TOTAL_REEF_FISH = SCHOOL_COUNT * FISH_PER_SCHOOL;
const fishPhases = new Float32Array(TOTAL_REEF_FISH).map(() => rand(0, Math.PI * 2));
reefFishGeo.body.setAttribute("aPhase", new THREE.InstancedBufferAttribute(fishPhases, 1));
reefFishGeo.tail.setAttribute("aPhase", new THREE.InstancedBufferAttribute(fishPhases, 1));
const reefBodies = new THREE.InstancedMesh(reefFishGeo.body, reefBodyMat, TOTAL_REEF_FISH);
const reefTails = new THREE.InstancedMesh(reefFishGeo.tail, reefTailMat, TOTAL_REEF_FISH);
reefBodies.frustumCulled = false;
reefTails.frustumCulled = false;
reefBodies.renderOrder = reefTails.renderOrder = 1.5;
{
  const col = new THREE.Color();
  for (let i = 0; i < TOTAL_REEF_FISH; i++) {
    const r = Math.random();
    if (r < 0.85) col.setHSL(rand(0.03, 0.08), 0.95, rand(0.5, 0.6)); // orange
    else if (r < 0.93) col.setHSL(rand(0.12, 0.15), 0.95, 0.55); // yellow
    else col.setHSL(rand(0.75, 0.82), 0.6, 0.55); // purple
    reefBodies.setColorAt(i, col);
    reefTails.setColorAt(i, col);
  }
}
scene.add(reefBodies, reefTails);

// Each school hangs around a spot out from wherever you are on the shore, kept over water at least a few
// metres deep, and wanders slowly.
const schools = [
  { offT: -16, offR: 0 },
  { offT: 18, offR: 14 },
  { offT: 2, offR: 30 },
].map((s, i) => ({
  ...s,
  x: 0,
  z: -200,
  y: -3,
  heading: 0,
  placed: false,
  seed: i * 13.7,
  vx: 0,
  vz: 0,
  // Every fish swims on its own: it keeps its own position, speed and heading, and follows its place in
  // the school with its own reaction time, so a turn ripples through the school instead of all at once
  fish: Array.from({ length: FISH_PER_SCHOOL }, () => ({
    ox: rand(-1, 1) * 4,
    oy: rand(-1, 1) * 0.8,
    oz: rand(-1, 1) * 6,
    phase: rand(0, Math.PI * 2),
    scale: rand(0.8, 1.2),
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    heading: 0,
    slotHeading: 0, // the school's heading as this fish has noticed it
    react: rand(0.6, 2.2), // how quickly it notices the school turning (rad/s)
    turn: rand(2.2, 4), // how fast it can turn (rad/s)
    maxSpeed: rand(4.6, 6.2), // always faster than the school (up to 4 m/s), so nobody gets left behind
  })),
}));
const fishMatrix = new THREE.Matrix4();
const fishQuat = new THREE.Quaternion();
const fishEuler = new THREE.Euler(0, 0, 0, "YXZ");
const fishPos = new THREE.Vector3();
const fishScale = new THREE.Vector3();
function updateReefFish(dt, t) {
  const I = curIsland(camPos.x, camPos.z);
  const pdx = camPos.x - I.x, pdz = camPos.z - I.z;
  const pl = Math.hypot(pdx, pdz) || 1;
  const Rc = I.a ? isleCoastR(I.a, Math.atan2(pdz, pdx)) : I.r;
  const nearShore = !sp.on && !curBody && pl - Rc > -40 && pl - Rc < 170; // (the reef is the home world's: never out in space)
  reefBodies.visible = reefTails.visible = nearShore;
  if (!nearShore) {
    for (const s of schools) s.placed = false;
    return;
  }
  const ux = pdx / pl, uz = pdz / pl; // out from the island, toward you
  const tx = -uz, tz = ux;
  let idx = 0;
  schools.forEach((s, si) => {
    // Target: out from your stretch of shore, wandering, pushed out to water at least 3 m deep
    const R0 = Math.max(Rc + 26, pl) + s.offR + Math.sin(t * 0.1 + s.seed) * 10;
    const lat = s.offT + Math.cos(t * 0.13 + s.seed) * 14;
    let gx = I.x + ux * R0 + tx * lat;
    let gz = I.z + uz * R0 + tz * lat;
    for (let k = 0; k < 30 && bedHeightJS(gx, gz) > -3; k++) {
      gx += ux * 4;
      gz += uz * 4;
    }
    const fresh = !s.placed;
    if (fresh) {
      s.x = gx;
      s.z = gz;
      s.placed = true;
    }
    const dx = gx - s.x;
    const dz = gz - s.z;
    const dist = Math.hypot(dx, dz);
    const speed = Math.min(dist * 0.5, 4);
    s.vx = dist > 0.01 ? (dx / dist) * speed : 0;
    s.vz = dist > 0.01 ? (dz / dist) * speed : 0;
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    // Face the way the school moves; drift around slowly when it's idle
    const desired = speed > 0.3 ? Math.atan2(-dx, -dz) : s.heading + dt * 0.3;
    s.heading += clamp(wrapAngle(desired - s.heading), -dt * 1.2, dt * 1.2);
    const bed = bedHeightJS(s.x, s.z);
    const targetY = clamp(bed + 2.5, -6, -1.2);
    s.y += (targetY - s.y) * (1 - Math.exp(-dt));

    const follow = 1 - Math.exp(-dt * 2.5);
    s.fish.forEach((f, fi) => {
      // The fish's place in the school, turned by the school's heading as this fish has noticed it
      f.slotHeading += clamp(wrapAngle(s.heading - f.slotHeading), -f.react * dt, f.react * dt);
      const ch = Math.cos(f.slotHeading);
      const sh = Math.sin(f.slotHeading);
      const lx = f.ox + Math.sin(t * 0.8 + f.phase) * 0.6;
      const lz = f.oz + Math.cos(t * 0.6 + f.phase) * 0.8;
      const px = s.x + lx * ch + lz * sh;
      const py = s.y + f.oy + Math.sin(t * 1.3 + f.phase) * 0.2;
      const pz = s.z - lx * sh + lz * ch;
      if (fresh) Object.assign(f, { x: px, y: py, z: pz, vx: 0, vy: 0, vz: 0, heading: s.heading, slotHeading: s.heading });
      // Swim toward that place, going with the school's flow, never faster than this fish can
      let wx = (px - f.x) * 1.2 + s.vx;
      let wy = (py - f.y) * 1.2;
      let wz = (pz - f.z) * 1.2 + s.vz;
      // Keep a little space from a neighbour
      const n = s.fish[(fi + 1) % s.fish.length];
      const sx = f.x - n.x, sy = f.y - n.y, sz = f.z - n.z;
      const sd = Math.hypot(sx, sy, sz);
      if (sd < 0.6 && sd > 1e-4) {
        wx += (sx / sd) * (0.6 - sd) * 4;
        wy += (sy / sd) * (0.6 - sd) * 4;
        wz += (sz / sd) * (0.6 - sd) * 4;
      }
      const ws = Math.hypot(wx, wy, wz);
      if (ws > f.maxSpeed) {
        wx *= f.maxSpeed / ws;
        wy *= f.maxSpeed / ws;
        wz *= f.maxSpeed / ws;
      }
      f.vx += (wx - f.vx) * follow;
      f.vy += (wy - f.vy) * follow;
      f.vz += (wz - f.vz) * follow;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      // Turn to face where it's swimming, at its own pace; when idling, drift toward the school's heading
      const hs = Math.hypot(f.vx, f.vz);
      const want = hs > 0.25 ? Math.atan2(-f.vx, -f.vz) : f.slotHeading;
      f.heading += clamp(wrapAngle(want - f.heading), -f.turn * dt, f.turn * dt);
      const pitch = clamp(Math.atan2(f.vy, Math.max(hs, 0.3)), -0.5, 0.5);
      fishPos.set(f.x, f.y, f.z);
      fishEuler.set(pitch + Math.sin(t * 0.9 + f.phase) * 0.05, f.heading, 0);
      fishQuat.setFromEuler(fishEuler);
      fishScale.setScalar(f.scale);
      fishMatrix.compose(fishPos, fishQuat, fishScale);
      reefBodies.setMatrixAt(idx, fishMatrix);
      reefTails.setMatrixAt(idx, fishMatrix);
      idx++;
    });
  });
  reefBodies.instanceMatrix.needsUpdate = true;
  reefTails.instanceMatrix.needsUpdate = true;
}

// ===== The boat (Coastline's 8.6 m cabin cruiser), moored at a small dock =====
const BOAT_LEN = { stern: 4.0, bow: -4.6 };
const boatT = (z) => (z - BOAT_LEN.stern) / (BOAT_LEN.bow - BOAT_LEN.stern); // 0 at the stern, 1 at the bow
const boatHalfBeam = (z) => {
  const t = boatT(z);
  return 1.45 * (t < 0.5 ? 1 - 0.06 * t : Math.pow(Math.max(Math.cos(((t - 0.5) / 0.5) * Math.PI * 0.5), 0), 0.75));
};
const boatSheer = (z) => 1.15 + 0.5 * Math.pow(boatT(z), 2.2); // the deck edge rises toward the bow
const boatDeck = (z) => boatSheer(z) - 0.24; // the deck sits a little below the edge, inside a low bulwark

// Teak planking for the deck, drawn once onto a small canvas
function teakTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (!g || !g.fillRect) return null;
  for (let i = 0; i < 16; i++) {
    const tone = 150 + Math.floor(Math.random() * 30);
    g.fillStyle = `rgb(${tone}, ${Math.floor(tone * 0.68)}, ${Math.floor(tone * 0.42)})`;
    g.fillRect(i * 16, 0, 16, 256);
    g.fillStyle = "rgba(40, 28, 18, 0.9)"; // caulked seam
    g.fillRect(i * 16, 0, 2, 256);
    const joint = Math.floor(Math.random() * 256);
    g.fillRect(i * 16, joint, 16, 2); // butt joint
    for (let k = 0; k < 6; k++) {
      g.fillStyle = `rgba(90, 60, 35, ${0.1 + Math.random() * 0.15})`; // grain
      g.fillRect(i * 16 + 3 + Math.random() * 11, 0, 1, 256);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildBoat() {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  const STATIONS = 26;
  const zAt = (i) => BOAT_LEN.stern + ((BOAT_LEN.bow - BOAT_LEN.stern) * i) / (STATIONS - 1);

  // --- Hull: cross-sections from the stern to the bow, lofted into one surface ---
  const section = (z) => {
    const t = boatT(z);
    const w = Math.max(boatHalfBeam(z), 0.02);
    const s = boatSheer(z);
    const keel = lerp(-0.78, -0.05, smooth(0.62, 1, t)); // the forefoot sweeps up into the stem
    const chine = lerp(-0.05, 0.35, smooth(0.5, 1, t));
    // keel → chine → flared topsides → sheer (one side)
    return [
      [0, keel],
      [0.5 * w, lerp(keel, chine, 0.6)],
      [0.92 * w, chine],
      [1.0 * w, chine + 0.28],
      [1.04 * w, (chine + 0.28 + s) / 2],
      [1.07 * w, s],
    ];
  };
  const hullPos = [];
  const hullCol = [];
  const white = [0.95, 0.95, 0.93];
  const navy = [0.1, 0.17, 0.3];
  const bottom = [0.55, 0.16, 0.14];
  const colorAt = (y) => (y < -0.06 ? bottom : y < 0.22 ? navy : white);
  const ring = []; // per station: points from the port sheer, round the keel, to the starboard sheer
  for (let i = 0; i < STATIONS; i++) {
    const z = zAt(i);
    const half = section(z);
    const pts = [...half.slice().reverse().map(([x, y]) => [-x, y]), ...half.slice(1)];
    ring.push(pts.map(([x, y]) => [x, y, z]));
  }
  const P = ring[0].length;
  const idx = [];
  ring.forEach((pts) => pts.forEach(([x, y, z]) => (hullPos.push(x, y, z), hullCol.push(...colorAt(y)))));
  for (let i = 0; i < STATIONS - 1; i++)
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j;
      idx.push(a, a + P, a + 1, a + 1, a + P, a + P + 1);
    }
  // Transom: close off the stern
  const tc = hullPos.length / 3;
  hullPos.push(0, (ring[0][0][1] + ring[0][P >> 1][1]) / 2, BOAT_LEN.stern);
  hullCol.push(...white);
  for (let j = 0; j < P - 1; j++) idx.push(tc, j + 1, j);
  idx.push(tc, 0, P - 1); // the top of the transom, between the two gunwales
  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute("position", new THREE.Float32BufferAttribute(hullPos, 3));
  hullGeo.setAttribute("color", new THREE.Float32BufferAttribute(hullCol, 3));
  hullGeo.setIndex(idx);
  hullGeo.computeVertexNormals();
  const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide });
  tilt.add(new THREE.Mesh(hullGeo, hullMat));

  // --- Deck: teak, gently crowned, inside the bulwark ---
  const deckPos = [];
  const deckUv = [];
  const deckIdx = [];
  for (let i = 0; i < STATIONS; i++) {
    const z = zAt(i);
    const w = Math.max(boatHalfBeam(z) * 1.02 - 0.05, 0.01);
    const y = boatDeck(z);
    for (const [x, dy] of [[-w, 0], [0, 0.05], [w, 0]]) {
      deckPos.push(x, y + dy, z);
      deckUv.push(x / 2.2, z / 2.2);
    }
  }
  for (let i = 0; i < STATIONS - 1; i++)
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      deckIdx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
    }
  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute("position", new THREE.Float32BufferAttribute(deckPos, 3));
  deckGeo.setAttribute("uv", new THREE.Float32BufferAttribute(deckUv, 2));
  deckGeo.setIndex(deckIdx);
  deckGeo.computeVertexNormals();
  const teak = teakTexture();
  const deckMat = new THREE.MeshStandardMaterial({ color: teak ? 0xffffff : 0xa47449, map: teak, roughness: 0.75, side: THREE.DoubleSide });
  tilt.add(new THREE.Mesh(deckGeo, deckMat));

  // --- Gunwale rub rails along the sheer ---
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.18, metalness: 0.9 });
  const rubMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5 });
  for (const side of [-1, 1]) {
    const pts = [];
    for (let i = 0; i < STATIONS; i++) {
      const z = zAt(i);
      pts.push(new THREE.Vector3(side * Math.max(boatHalfBeam(z), 0.02) * 1.07, boatSheer(z), z));
    }
    tilt.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.06, 6, false), rubMat));
  }

  // --- Bow railings: top and middle rails, stanchions, and the pulpit at the bow ---
  const railFrom = -0.4;
  const railTo = BOAT_LEN.bow + 0.35;
  const railPoint = (side, z, h) => {
    const w = Math.max(boatHalfBeam(z) * 1.0 - 0.1, 0.05);
    return new THREE.Vector3(side * w, boatSheer(z) + h, z);
  };
  for (const h of [0.68, 0.36]) {
    const pts = [];
    for (let k = 0; k <= 20; k++) pts.push(railPoint(-1, lerp(railFrom, railTo, k / 20), h));
    for (let k = 20; k >= 0; k--) pts.push(railPoint(1, lerp(railFrom, railTo, k / 20), h));
    tilt.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.025, 6, false), steel));
  }
  for (let z = railFrom; z > railTo; z -= 0.9) {
    for (const side of [-1, 1]) {
      const top = railPoint(side, z, 0.68);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.68 + 0.22, 6), steel);
      post.position.set(top.x, top.y - (0.68 + 0.22) / 2, top.z);
      tilt.add(post);
    }
  }

  // --- Foredeck fittings: anchor locker hatch, anchor on the bow roller, cleats ---
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.4 });
  const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 0.6), new THREE.MeshStandardMaterial({ color: 0xe9e8e2, roughness: 0.4 }));
  hatch.position.set(0, boatDeck(-3.3) + 0.07, -3.3);
  tilt.add(hatch);
  const roller = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.7), steel);
  roller.position.set(0, boatSheer(-4.3) + 0.04, -4.35);
  tilt.add(roller);
  const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.32), darkMat);
  anchor.position.set(0, boatSheer(-4.55) - 0.05, -4.62);
  tilt.add(anchor);
  for (const [x, z] of [[-0.75, -1.2], [0.75, -1.2], [-0.35, -3.95], [0.35, -3.95], [-1.25, 3.3], [1.25, 3.3]]) {
    const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.26), steel);
    cleat.position.set(x * Math.min(1, boatHalfBeam(z) / 1.45 + 0.1), boatDeck(z) + 0.06, z);
    tilt.add(cleat);
  }

  // --- Cabin: raked windshield, side windows, a roof that overhangs a little ---
  const cabinW = 2.1;
  const deckY = boatDeck(0.4);
  const prof = new THREE.Shape();
  prof.moveTo(-0.55, 0);
  prof.lineTo(-0.55, 0.55);
  prof.lineTo(0.05, 1.42);
  prof.lineTo(1.75, 1.42);
  prof.lineTo(1.75, 0);
  prof.closePath();
  const cabinGeo = new THREE.ExtrudeGeometry(prof, { depth: cabinW, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
  cabinGeo.rotateY(-Math.PI / 2);
  cabinGeo.translate(cabinW / 2, deckY, 0);
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0xf0efe9, roughness: 0.35 });
  tilt.add(new THREE.Mesh(cabinGeo, cabinMat));
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x18242e, roughness: 0.08, metalness: 0.3, emissive: 0xffc070, emissiveIntensity: 0 });
  // Windshield: along the raked front face
  const wsLen = Math.hypot(0.6, 0.87);
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(cabinW - 0.3, wsLen * 0.72), windowMat);
  windshield.position.set(0, deckY + 0.98, -0.25 - 0.06);
  windshield.rotation.x = -Math.atan2(0.6, 0.87);
  windshield.rotation.y = Math.PI;
  tilt.add(windshield);
  for (const side of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.42), windowMat);
    win.position.set(side * (cabinW / 2 + 0.056), deckY + 1.0, 0.85);
    win.rotation.y = side * Math.PI * 0.5;
    tilt.add(win);
  }
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xe4e2db, roughness: 0.4 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(cabinW + 0.25, 0.08, 2.0), roofMat);
  roof.position.set(0, deckY + 1.5, 0.82);
  tilt.add(roof);
  // Grab rails on the roof
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 1.6), steel);
    rail.position.set(side * 0.85, deckY + 1.6, 0.9);
    tilt.add(rail);
  }

  // --- Radar arch over the cockpit, with a radome, antennas and the masthead light ---
  const archZ = 1.9;
  const archPts = [];
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI;
    archPts.push(new THREE.Vector3(Math.cos(a) * 1.12, boatSheer(archZ) + Math.sin(a) * 1.9 * (0.85 + 0.15 * Math.sin(a)), archZ));
  }
  tilt.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPts), 40, 0.07, 8, false), cabinMat));
  const archTop = boatSheer(archZ) + 1.9;
  const radome = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 18), new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.3 }));
  radome.position.set(0, archTop + 0.12, archZ);
  tilt.add(radome);
  for (const x of [-0.6, 0.6]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }));
    ant.position.set(x, archTop + 0.6, archZ);
    tilt.add(ant);
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe0a0, emissiveIntensity: 0 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), lampMat);
  lamp.position.set(0, archTop + 0.45, archZ);
  tilt.add(lamp);
  const lampLight = new THREE.PointLight(0xffd9a0, 0, 30, 2);
  lampLight.position.copy(lamp.position);
  tilt.add(lampLight);

  // --- Cockpit: bench seat, helm seat backs, swim platform and twin outboards ---
  const cushion = new THREE.MeshStandardMaterial({ color: 0xd9d2c3, roughness: 0.8 });
  const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.42, 0.55), cushion);
  bench.position.set(0, boatDeck(3.4) + 0.21, 3.45);
  tilt.add(bench);
  for (const x of [-0.5, 0.5]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.5), cushion);
    seat.position.set(x, boatDeck(2.1) + 0.42, 2.2);
    tilt.add(seat);
  }
  const platform = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.55), deckMat);
  platform.position.set(0, 0.32, BOAT_LEN.stern + 0.3);
  tilt.add(platform);
  const cowlMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.3, metalness: 0.2 });
  for (const x of [-0.55, 0.55]) {
    const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.6), cowlMat);
    cowl.position.set(x, 0.95, BOAT_LEN.stern + 0.42);
    tilt.add(cowl);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.0, 0.22), cowlMat);
    shaft.position.set(x, 0.1, BOAT_LEN.stern + 0.45);
    tilt.add(shaft);
  }

  // --- Life ring on the cabin side, fenders along the cockpit ---
  const ring0 = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 8, 20), new THREE.MeshStandardMaterial({ color: 0xff6a1f, roughness: 0.6 }));
  ring0.position.set(cabinW / 2 + 0.09, deckY + 0.55, 1.3);
  ring0.rotation.y = Math.PI / 2;
  tilt.add(ring0);
  for (const side of [-1, 1]) {
    const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 }));
    fender.position.set(side * (boatHalfBeam(2.8) * 1.07 + 0.1), boatSheer(2.8) - 0.4, 2.8);
    tilt.add(fender);
  }

  // Navigation lights (brightness is set at dusk, in updateBoatMoor)
  const navLights = [];
  function addNavLight(color, x, y, z) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 0 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mat);
    bulb.position.set(x, y, z);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(1.0, 1.0, 1);
    glow.position.copy(bulb.position);
    tilt.add(bulb, glow);
    navLights.push({ bulb, mat, glow, color: new THREE.Color(color) });
  }
  addNavLight(0xff2a2a, -(cabinW / 2 + 0.07), deckY + 0.35, -0.3); // port (red)
  addNavLight(0x2aff5a, cabinW / 2 + 0.07, deckY + 0.35, -0.3); // starboard (green)
  addNavLight(0xffffff, 0, archTop + 0.05, archZ + 0.15); // stern (white)

  // --- Water mask: an invisible lid at gunwale height. It only writes depth, after the deck is drawn and
  // before the sea, so waves that reach above the deck never show up inside the boat ---
  const maskPos = [];
  const maskIdx = [];
  for (let i = 0; i < STATIONS; i++) {
    const z = zAt(i);
    const w = Math.max(boatHalfBeam(z) - 0.04, 0);
    const y = boatSheer(z) - 0.03;
    maskPos.push(-w, y, z, w, y, z);
    if (i) maskIdx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  }
  const maskGeo = new THREE.BufferGeometry();
  maskGeo.setAttribute("position", new THREE.Float32BufferAttribute(maskPos, 3));
  maskGeo.setIndex(maskIdx);
  const waterMask = new THREE.Mesh(maskGeo, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
  waterMask.renderOrder = 0.4; // after the boat and the land (0), before the far ocean (0.5) and the water (1)
  tilt.add(waterMask);

  return shapeModel("boat", { root, tilt, windowMat, lamp, lampMat, lampLight, navLights });
}
const boat = buildBoat();
scene.add(boat.root);

// ===== The dock: a small timber pier from the dunes out over the dredged basin, with the breakwater beyond =====
const dock = (() => {
  const g = new THREE.Group();
  scene.add(g);
  const { nx, nz } = DOCK;
  const tx = -nz, tz = nx; // across the dock
  const yawD = Math.atan2(nx, nz);
  const at = (s, l) => new THREE.Vector3(ISL.x + nx * s + tx * l, 0, ISL.z + nz * s + tz * l);
  const plankTex = pixTex(128, 128, (u, v) => {
    const board = Math.floor(v * 6);
    const seam = Math.abs((v * 6) % 1) < 0.05 ? 0.45 : 1;
    const grain = jnoise(u * 3 + board * 7, v * 40, 2);
    const k = (0.7 + 0.5 * grain) * seam * (0.85 + 0.25 * jhash(board, 1, 2));
    return [0.46 * k, 0.4 * k, 0.34 * k];
  });
  plankTex.repeat.set(1, 28);
  const length = DOCK.r1 - DOCK.r0;
  const wood = new THREE.MeshStandardMaterial({ map: plankTex, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4b3b2d, roughness: 0.95 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, length), wood);
  const mid = at((DOCK.r0 + DOCK.r1) / 2, 0);
  deck.position.set(mid.x, DOCK.y - 0.05, mid.z);
  deck.rotation.y = yawD;
  g.add(deck);
  // Piles down to the sea floor, every few metres on both sides, a few standing proud as mooring posts
  const pileMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.95 });
  for (let s = DOCK.r0 + 1; s <= DOCK.r1; s += 3.6)
    for (const l of [-1.0, 1.0]) {
      const p = at(s, l);
      const bed = bedHeightJS(p.x, p.z);
      const top = DOCK.y + (l > 0 && (Math.round((s - DOCK.r0) / 3.6) % 2 === 0) ? 0.55 : 0.05);
      const h = top - bed + 0.4;
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, h, 8), pileMat);
      pile.position.set(p.x, bed - 0.4 + h / 2, p.z);
      g.add(pile);
      // beam across under the deck
      if (l < 0) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 0.18), dark);
        beam.position.set(p.x + tx, DOCK.y - 0.17, p.z + tz);
        beam.rotation.y = yawD;
        g.add(beam);
      }
    }
  // Rope rail along the shore side of the dock, and a ladder at the end
  const rope = new THREE.MeshStandardMaterial({ color: 0xcdb98a, roughness: 0.9 });
  for (let s = DOCK.r0 + 2; s < DOCK.r1 - 4; s += 3.6) {
    const p = at(s, -1.05);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.9, 6), dark);
    post.position.set(p.x, DOCK.y + 0.45, p.z);
    g.add(post);
    const q = at(s + 3.6, -1.05);
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, len, 5), rope);
    r.position.set((p.x + q.x) / 2, DOCK.y + 0.8 - 0.05, (p.z + q.z) / 2);
    r.rotation.set(Math.PI / 2, 0, 0);
    r.rotation.order = "YXZ";
    r.rotation.y = yawD;
    g.add(r);
  }
  // Lantern posts for the evening
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffb050, emissiveIntensity: 0 });
  const lamps = [];
  for (const s of [DOCK.r0 + 9, DOCK.r0 + 22, DOCK.r1 - 1]) {
    const p = at(s, -1.05);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.1, 6), dark);
    post.position.set(p.x, DOCK.y + 1.0, p.z);
    g.add(post);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), bulbMat);
    bulb.position.set(p.x, DOCK.y + 2.15, p.z);
    g.add(bulb);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture, color: 0xffa860, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.position.copy(bulb.position);
    g.add(glow);
    lamps.push({ bulb, glow });
  }
  const dockLight = new THREE.PointLight(0xffb060, 0, 16, 2);
  dockLight.position.copy(at(DOCK.r1 - 6, -1.05)).setY(DOCK.y + 2.1);
  g.add(dockLight);
  // The breakwater: a mound of big rocks on the seaward side of the basin, tall enough to stand above the swell
  const rockMat = rockMaterial();
  for (let i = 0; i < 30; i++) {
    const ang = DOCK_ANG + (i - 14.5) * 0.0125;
    const rr = ISL.r + 54 + rand(-2, 2);
    const x = ISL.x + Math.cos(ang) * rr, z = ISL.z + Math.sin(ang) * rr;
    const s = rand(2.2, 3.1);
    const rock = new THREE.Mesh(makeRock(3, Math.random() * 80, 0.5), rockMat);
    rock.scale.set(s * 1.1, s, s * 1.1);
    rock.position.set(x, bedHeightJS(x, z) + s * 0.75, z);
    rock.rotation.y = rand(0, 6.28);
    g.add(rock);
    registerRock(rock);
    seaRocks.push(rock);
  }
  return { g, lamps, bulbMat, dockLight };
})();

// The boat sits alongside the dock, bow out to sea, riding the (sheltered) swell
const moor = (() => {
  const s = DOCK.r0 + (DOCK.r1 - DOCK.r0) * 0.72;
  const l = 2.75; // far enough from the dock for the fenders
  const x = ISL.x + DOCK.nx * s - DOCK.nz * l, z = ISL.z + DOCK.nz * s + DOCK.nx * l;
  return { x, z, yaw: Math.atan2(-DOCK.nx, -DOCK.nz), y: 0, pitch: 0, roll: 0, wx: x, wz: z, wyaw: 0, speed: 0, free: false, ready: false, home: { x, z, yaw: Math.atan2(-DOCK.nx, -DOCK.nz) } };
})();
// (the cleat ropes)
{
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xcdb98a, roughness: 0.9 });
  moor.ropes = [-2.4, 2.8].map((lz) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 5), ropeMat);
    scene.add(m);
    return { m, lz };
  });
}
const _mb = new THREE.Vector3(), _md = new THREE.Vector3();
// ===== Driving the boat (ported from Coastline's boat.js): throttle and steering, with the hull kept in deep water =====
// Press Y (or the Y key) near the boat to take the helm, again to step away from it, anywhere at sea. While driving, the left stick
// is the throttle (forward / back) and the rudder (left / right); on a screen, W S A D.
const boatDrive = { on: false, throttle: 0, turn: 0 };
const BOAT_ACCEL0 = 9, BOAT_DRAG = 0.35, BOAT_MAX0 = 18, BOAT_REV0 = -5, BOAT_TURN = 0.9, HELM_LZ = -2.3;
let boatObstacles = null;
function boatClearance(x, z) {
  let c = -bedHeightJS(x, z) - 1.6; // the hull needs water a little over a metre and a half deep
  const dx = x - ISL.x, dz = z - ISL.z;
  const s = dx * DOCK.nx + dz * DOCK.nz, l = -dx * DOCK.nz + dz * DOCK.nx;
  c = Math.min(c, worldBoundsEdge(x, z) - 60);
  c = Math.min(c, Math.max(DOCK.r0 - 1.5 - s, s - (DOCK.r1 + 2), Math.abs(l - 0.175) - 2.4)); // the pier
  if (!boatObstacles) boatObstacles = seaRocks.map((r) => ({ p: r.getWorldPosition(new THREE.Vector3()), r: Math.max(r.scale.x, r.scale.z) * 1.05 + 1.2 }));
  for (const o of boatObstacles) c = Math.min(c, Math.hypot(x - o.p.x, z - o.p.z) - o.r);
  for (const o of seaObstacles) c = Math.min(c, Math.hypot(x - o.p.x, z - o.p.z) - o.r - 3);
  return c;
}
const bcv = { x: 0, z: 1, mag: 0 };
function boatClearDir(x, z) {
  const gx = boatClearance(x + 1, z) - boatClearance(x - 1, z), gz = boatClearance(x, z + 1) - boatClearance(x, z - 1);
  const len = Math.hypot(gx, gz);
  bcv.mag = len / 2;
  if (len < 1e-6) (bcv.x = 0), (bcv.z = 1);
  else (bcv.x = gx / len), (bcv.z = gz / len);
  return bcv;
}
function driveBoat(dt) {
  const th = boatDrive.on ? boatDrive.throttle : 0, tn = boatDrive.on ? boatDrive.turn : 0;
  const bm = BOAT_SPEEDS[opts.boatSpd][1], BOAT_MAX = BOAT_MAX0 * bm, BOAT_ACCEL = BOAT_ACCEL0 * bm, BOAT_REV = BOAT_REV0 * bm;
  moor.speed += th * BOAT_ACCEL * dt;
  moor.speed -= moor.speed * (th === 0 ? 1.4 : BOAT_DRAG) * dt;
  if (th === 0 && Math.abs(moor.speed) < 1.5) moor.speed *= Math.exp(-3 * dt);
  moor.speed = clamp(moor.speed, BOAT_REV, BOAT_MAX);
  const steer = clamp(moor.speed / 6, -1, 1);
  const pivot = Math.abs(steer) < 0.35 ? (moor.speed < 0 ? -0.35 : 0.35) : steer; // it can always pivot a little, to turn away from a wall
  moor.yaw += tn * BOAT_TURN * pivot * dt;
  const fx = -Math.sin(moor.yaw), fz = -Math.cos(moor.yaw);
  const mx = fx * moor.speed * dt + Math.cos(weather.windAngle) * weather.windSpeed * 0.05 * dt;
  const mz = fz * moor.speed * dt + Math.sin(weather.windAngle) * weather.windSpeed * 0.05 * dt;
  if (boatClearance(moor.x + mx, moor.z + mz) >= 0) {
    moor.x += mx;
    moor.z += mz;
  } else {
    // slide along shallows, rocks and the pier instead of stopping dead
    const g = boatClearDir(moor.x + mx, moor.z + mz);
    const into = mx * g.x + mz * g.z;
    const nx = moor.x + (into < 0 ? mx - g.x * into : mx), nz = moor.z + (into < 0 ? mz - g.z * into : mz);
    if (boatClearance(nx, nz) >= -0.01) {
      moor.x = nx;
      moor.z = nz;
      moor.speed *= 1 - 1.5 * dt;
    } else moor.speed *= 1 - 4 * dt;
  }
  if (boatClearance(moor.x, moor.z) < 0) {
    const g = boatClearDir(moor.x, moor.z);
    moor.x += g.x * 4 * dt;
    moor.z += g.z * 4 * dt;
  }
}
let yWas = false, yTap = false;
let hintTimer = 0;
const hintDefault = $("hint").textContent;
function flashHint(msg) {
  $("hint").textContent = msg;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => ($("hint").textContent = hintDefault), 3500);
}
function boardBoat() {
  if (Math.hypot(player.x - moor.wx, player.z - moor.wz) > 12) return flashHint("Get closer to the boat (within a few metres), then press Y to climb aboard");
  moor.free = true;
  boatDrive.on = true;
  player.swim = false;
  player.grounded = true;
  player.vy = 0;
  player.fv.set(0, 0, 0);
  player.sv.set(0, 0, 0);
  for (const r of moor.ropes) r.m.visible = false;
  flashHint("At the helm: left stick forward / back = throttle, left / right = steer. Y to step away");
}
// put the boat back alongside the dock, tied up, and bring you with it if you were aboard
function resetBoat() {
  const wasAboard = boatDrive.on || player.onBoat;
  boatDrive.on = false;
  boatDrive.throttle = boatDrive.turn = 0;
  moor.free = false;
  moor.speed = 0;
  moor.x = moor.home.x;
  moor.z = moor.home.z;
  moor.yaw = moor.home.yaw;
  moor.ready = false; // (so nobody is carried by the jump)
  for (const r of moor.ropes) r.m.visible = true;
  if (wasAboard) teleportTo(DOCK_BOARD.x, DOCK_BOARD.z, ISL.x + DOCK.nx * 30, ISL.z + DOCK.nz * 30);
  flashHint("The boat is back at the dock");
}
function leaveBoat() {
  boatDrive.on = false;
  boatDrive.throttle = boatDrive.turn = 0;
}
function checkBoatKey() {
  const Lh = handOf("left");
  const yDown = !!(Lh && Lh.gamepad && Lh.gamepad.buttons[5] && Lh.gamepad.buttons[5].pressed);
  const tap = (yDown && !yWas) || yTap;
  yWas = yDown;
  yTap = false;
  if (!tap || menu.open) return;
  if (boatDrive.on) leaveBoat();
  else boardBoat();
}
addEventListener("keydown", (e) => {
  if (e.code === "KeyY" && !e.repeat) yTap = true;
});
function updateBoatMoor(dt, t, lampsOn) {
  const sw = moor.free ? 0 : Math.sin(t * 0.37) * 0.1;
  if (moor.free) driveBoat(dt);
  const yaw = moor.free ? moor.yaw : moor.yaw + Math.sin(t * 0.23) * 0.012;
  const pbx = moor.wx, pbz = moor.wz, pyaw = moor.wyaw, py = moor.y;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const bx = moor.x + fx * sw, bz = moor.z + fz * sw;
  const hBow = waveHeight(bx + fx * 3.5, bz + fz * 3.5, t);
  const hStern = waveHeight(bx - fx * 3.5, bz - fz * 3.5, t);
  const hRight = waveHeight(bx + rx * 1.4, bz + rz * 1.4, t);
  const hLeft = waveHeight(bx - rx * 1.4, bz - rz * 1.4, t);
  const k = 1 - Math.exp(-dt * 4);
  moor.y += ((hBow + hStern + hRight + hLeft) / 4 - moor.y) * k;
  moor.pitch += (Math.atan2(hBow - hStern, 7) - moor.pitch) * k;
  moor.roll += (Math.atan2(hRight - hLeft, 2.8) * 0.7 - moor.roll) * k;
  moor.wx = bx;
  moor.wz = bz;
  moor.wyaw = yaw;
  {
    // the people aboard travel with it: at the helm you are held there, otherwise you are carried along the deck
    const c1 = Math.cos(yaw), s1 = Math.sin(yaw);
    if (boatDrive.on) {
      player.x = bx + HELM_LZ * s1;
      player.z = bz + HELM_LZ * c1;
      player.y = moor.y + boatDeck(HELM_LZ) + 0.05;
      yawView(yaw - pyaw);
    } else if (player.onBoat && moor.ready && player.grounded) {
      const c0 = Math.cos(pyaw), s0 = Math.sin(pyaw);
      const ddx = player.x - pbx, ddz = player.z - pbz;
      const lx = ddx * c0 - ddz * s0, lz = ddx * s0 + ddz * c0;
      player.x = bx + lx * c1 + lz * s1;
      player.z = bz - lx * s1 + lz * c1;
      player.y += moor.y - py;
      yawView(yaw - pyaw);
    }
    moor.ready = true;
  }
  boat.root.position.set(bx, moor.y, bz);
  boat.root.rotation.y = yaw;
  boat.tilt.rotation.set(moor.pitch, 0, moor.roll);
  // lights come on at dusk and in dark weather
  boat.lampLight.intensity = 1.5 * lampsOn;
  boat.lampMat.emissiveIntensity = 2 * lampsOn;
  boat.windowMat.emissiveIntensity = 0.8 * lampsOn;
  for (const nav of boat.navLights) {
    nav.mat.emissiveIntensity = 2 * lampsOn;
    nav.glow.material.opacity = lampsOn;
  }
  dock.bulbMat.emissiveIntensity = 2.2 * lampsOn;
  dock.dockLight.intensity = 1.4 * lampsOn;
  for (const l of dock.lamps) l.glow.material.opacity = lampsOn * 0.9, l.glow.scale.setScalar(0.5 + 1.6 * lampsOn);
  // ropes from the boat's cleats to the dock's piles
  boat.root.updateMatrixWorld(true);
  for (const r of moor.free ? [] : moor.ropes) {
    _mb.set(-boatHalfBeam(r.lz) * 0.85, boatDeck(r.lz) + 0.06, r.lz);
    boat.tilt.localToWorld(_mb);
    const s = DOCK.r0 + (DOCK.r1 - DOCK.r0) * 0.72 + (r.lz < 0 ? -r.lz * 0.5 : -r.lz * 0.9);
    _md.set(ISL.x + DOCK.nx * s + DOCK.nz * 1.0, DOCK.y + 0.1, ISL.z + DOCK.nz * s - DOCK.nx * 1.0);
    const len = _mb.distanceTo(_md);
    r.m.position.copy(_mb).add(_md).multiplyScalar(0.5);
    r.m.scale.set(1, len, 1);
    r.m.quaternion.setFromUnitVectors(_pa.set(0, 1, 0), _pn.copy(_md).sub(_mb).normalize());
  }
}
// Where you can stand: the dock, and the boat's open deck (the cabin is solid)
function dockHeightAt(x, z) {
  const dx = x - ISL.x, dz = z - ISL.z;
  const s = dx * DOCK.nx + dz * DOCK.nz;
  const l = -dx * DOCK.nz + dz * DOCK.nx;
  return s > DOCK.r0 && s < DOCK.r1 && l > -1.1 && l < 1.45 ? DOCK.y : null; // (the strip beside it is the gap to the boat)
}
function boatDeckAt(x, z) {
  const dx = x - moor.wx, dz = z - moor.wz;
  const c = Math.cos(moor.wyaw), sn = Math.sin(moor.wyaw);
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
  if (lz < BOAT_LEN.bow + 0.5 || lz > BOAT_LEN.stern - 0.3) return null;
  if (Math.abs(lx) > boatHalfBeam(lz) - 0.2) return null;
  if (lz > -0.75 && lz < 1.95 && Math.abs(lx) < 1.2) return "cabin";
  return moor.y + boatDeck(lz) + 0.05;
}

