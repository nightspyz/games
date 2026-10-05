"use strict";
// Lantern Tide v7.7: a quiet WebXR walk along an island beach on the Coastline ocean (Gerstner swell, breaking waves and
// swash, foam, caustics, volumetric sky, rain and lightning) through a full day and night, with Chinese festival
// lanterns on the water and in the air. The wave maths is mirrored in JS so floating things ride the real surface.
const $ = (id) => document.getElementById(id);

// ===== The world is a sphere: everything bends away below the horizon =====
// A point at horizontal distance d from the camera drops by d*d*uCurve. That is done once, in the shared "project_vertex" chunk (and the
// sprite shader), so every ordinary material follows it; the few hand-written shaders (the sea, the land) do the same by hand. uCurve is
// very gentle at sea level and rises toward the planet's true curvature as you climb (see updateSpace).
THREE.ShaderChunk.common += "\nuniform float uCurve;\nuniform vec3 uCurveCam;\nuniform mat4 uViewM;\n"; // (the camera, for the curve: three.js only keeps its own cameraPosition up to date for some material types)
THREE.ShaderChunk.project_vertex = `
  vec4 mvPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  #ifdef LT_OWNVIEW
    { vec4 wpc = modelMatrix * mvPosition; vec2 cdc = wpc.xz - uCurveCam.xz; wpc.y -= dot(cdc, cdc) * uCurve; mvPosition = uViewM * wpc; }
  #else
    { vec4 wpc = modelMatrix * mvPosition; vec2 cdc = wpc.xz - uCurveCam.xz; wpc.y -= dot(cdc, cdc) * uCurve; mvPosition = viewMatrix * wpc; }
  #endif
  gl_Position = projectionMatrix * mvPosition;
`;
// (sprites are left as three.js makes them: bending their vertex shader whited the picture out on NVIDIA cards under Direct3D 11)
// every material gets the shared uCurve uniform, whatever else its own onBeforeCompile does
{
  Object.defineProperty(THREE.Material.prototype, "onBeforeCompile", {
    configurable: true,
    get() {
      const f = this._obc;
      return (sh, r) => {
        if (f) f.call(this, sh, r);
        if (!sh.uniforms.uCurve) sh.uniforms.uCurve = sharedCurve;
        if (!sh.uniforms.uCurveCam) sh.uniforms.uCurveCam = curveCam;
        if (!sh.uniforms.uViewM) sh.uniforms.uViewM = viewM;
        // (three.js only uploads its own viewMatrix for mesh materials: points and lines get the camera's matrix from us, set per eye before each draw)
        if (this.isPointsMaterial || this.isLineBasicMaterial || this.isLineDashedMaterial) sh.vertexShader = "#define LT_OWNVIEW\n" + sh.vertexShader;
      };
    },
    set(f) { this._obc = f; },
  });
  // (the program cache is keyed on the material's own patch, not on the wrapper above, which reads the same for every material)
  THREE.Material.prototype.customProgramCacheKey = function () { return this._obc ? this._obc.toString() : ""; };
}
// The planet: a cube-sphere. Six square faces (FACE_CELLS x FACE_CELLS cells each) cover it; each face is a flat chart in metres
// (an equal-angle one: chart x = PLANET_R * a, chart z = PLANET_R * b, with a, b the angles across the face), so the game's flat
// local world keeps working on each face while the planet itself is a true sphere of radius PLANET_R.
const FACE_CELLS = 32, CELL_M = 1300;
const FACE_W = FACE_CELLS * CELL_M; // one face is 41.6 km across ...
const PLANET_R = FACE_W / (Math.PI / 2); // ... a quarter of the way round, so the planet is about 26.5 km in radius (166 km round)
const curveCam = { value: new THREE.Vector3() };
const viewM = { value: new THREE.Matrix4() };
THREE.Points.prototype.onBeforeRender = THREE.Line.prototype.onBeforeRender = function (r, sc, cam) { viewM.value.copy(cam.matrixWorldInverse); };
const sharedCurve = { value: 1 / (2 * PLANET_R) }; // things drop by distance squared over twice the radius: the sphere's own curve

// ===== Helpers =====
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function vnz(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash3(xi, zi, s), hash3(xi + 1, zi, s), u), lerp(hash3(xi, zi + 1, s), hash3(xi + 1, zi + 1, s), u), v);
}

// ===== Renderer, scene, rig =====
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
if (renderer.xr.setFramebufferScaleFactor) renderer.xr.setFramebufferScaleFactor(0.9);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb8dcf3, 120, 900);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 12000);
const rig = new THREE.Group(); // everything that is "you": the headset's camera and both hands
scene.add(rig);
rig.add(camera);
camera.position.set(0, 1.65, 0);

// ===== Sky, clouds and time-of-day uniforms (shared by sky and water) =====
const shared = {
  uTop: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color() },
  uSunset: { value: 0 },
  uSunVis: { value: 1 },
  uStars: { value: 0 },
  uStarGain: { value: 1 },
  uUnder: { value: 0 },
  uCurve: sharedCurve, // the world's curve: things drop by distance squared times this
  uSeaFade: { value: 0 }, // the near sea fades out as the planet below takes over
  uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uMoonI: { value: 1 }, // the player's moon brightness setting
  uMoonPhase: { value: 0.5 }, // how much of the moon is lit
  uCloudWorld: { value: 1 }, // 0 on the other worlds: no cloud in their skies
  uSpace: { value: 0 }, // how thin the air is (0 at sea level, 1 in space)
  uIslA: { value: Array.from({ length: 9 }, () => new THREE.Vector4()) },
  uIslB: { value: Array.from({ length: 9 }, () => new THREE.Vector4()) },
  uIslC: { value: Array.from({ length: 9 }, () => new THREE.Vector4()) },
  uIslBase: { value: new THREE.Vector2(1e5, 1e5) },
  uIslRowI: { value: new THREE.Vector3(1e5, 1e5, 1e5) },
  uIslRowO: { value: new THREE.Vector3() },
  uUnderCol: { value: new THREE.Color(0.03, 0.3, 0.36) },
  uTime: { value: 0 },
  uCloudCover: { value: 0.2 },
  uCloudDark: { value: 0 },
  uCloudOffset: { value: new THREE.Vector2() },
  uLightLevel: { value: 1 },
  uAurora: { value: 0 },
  uFog: { value: 0 },
  uRays: { value: 0 },
  // performance settings (menu): how many steps the cloud march takes, whether it uses the extra detail and second light sample,
  // how many samples the god rays take, and whether clouds cast shadows on the sea and sand
  uCloudSteps: { value: 6 },
  uCloudLight: { value: 1 },
  uCloudDetail: { value: 0 },
  uRaySteps: { value: 6 },
  uCloudShadows: { value: 0 },
  uCloudTex: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1) },
  uRayTex: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1) },
  uCloudRes: { value: new THREE.Vector2(512, 128) },
  uRayRes: { value: new THREE.Vector2(256, 64) },
  uCloudOn: { value: 1 },
  uRayOn: { value: 1 },
};

const SKY_GLSL = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunset;
  uniform float uSunVis;
  uniform float uStars;
  uniform float uStarGain;
  uniform vec3 uMoonDir;
  uniform float uMoonI;
  uniform float uMoonPhase;
  uniform float uCloudWorld;
  uniform float uSpace;
  uniform float uUnder;
  uniform vec3 uUnderCol;
  uniform float uTime;

  vec3 skyColor(vec3 d) {
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.45));
    vec2 dh = normalize(d.xz + vec2(1e-4));
    vec2 sh = normalize(uSunDir.xz + vec2(1e-4));
    float az = max(dot(dh, sh), 0.0); // 1 toward the sun
    float glow = pow(az, 6.0) * pow(1.0 - h, 5.0);
    col += uSunColor * glow * uSunset * 0.7;
    // Sunset bands: gold on the horizon, then red, magenta and violet climbing the sky, strongest toward the sun
    vec3 band = mix(vec3(1.0, 0.66, 0.24), vec3(1.0, 0.52, 0.2), smoothstep(0.01, 0.08, h));
    band = mix(band, vec3(0.93, 0.6, 0.45), smoothstep(0.08, 0.24, h));
    band = mix(band, vec3(0.55, 0.55, 0.7), smoothstep(0.22, 0.5, h));
    float reach = 1.0 - smoothstep(0.25, 0.7, h);
    col = mix(col, band, clamp(uSunset * reach * (0.25 + 0.6 * pow(az, 1.4)), 0.0, 0.68));
    // the pink and purple "belt of Venus" opposite the sun
    float anti = pow(max(-dot(dh, sh), 0.0), 2.0);
    vec3 belt = mix(vec3(0.85, 0.62, 0.58), vec3(0.42, 0.48, 0.64), smoothstep(0.02, 0.22, h));
    col = mix(col, belt, uSunset * anti * 0.3 * (1.0 - smoothstep(0.0, 0.3, h)));
    return col;
  }
`;

const NOISE_GLSL = /* glsl */ `
  // A hash without sin(): sin() of large world coordinates loses precision on GPUs
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p = p * 2.03 + vec2(17.1, 9.2);
      a *= 0.5;
    }
    return v;
  }
`;

const CLOUD_BOTTOM = 450;
const CLOUD_TOP = 1150;
const CLOUD_SHADOW_HEIGHT = 650;

const CLOUD_GLSL = /* glsl */ `
  uniform float uCloudCover;
  uniform float uCloudDetail;
  uniform float uCloudShadows;
  uniform vec2 uCloudOffset;
  const float CLOUD_BOTTOM = ${CLOUD_BOTTOM.toFixed(1)};
  const float CLOUD_TOP = ${CLOUD_TOP.toFixed(1)};

  float hash3(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float a = mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), u.x);
    float b = mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x);
    float c = mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x);
    float d = mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x);
    return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
  }
  float fbm3(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise3(p);
      p = p * 2.02 + vec3(17.1, 9.2, 4.7);
      a *= 0.5;
    }
    return v;
  }
  float cloudDensity(vec3 p) {
    float h = (p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM);
    if (h < 0.0 || h > 1.0) return 0.0;
    vec2 xz = p.xz - uCloudOffset;
    // a weather map: clouds gather into banks with clear gaps between them
    float bank = noise3(vec3(xz * 0.00032, 3.0)) * 0.7 + noise3(vec3(xz * 0.0009 + 11.0, 7.0)) * 0.3;
    float cov = clamp(uCloudCover + (bank - 0.5) * 0.9, 0.0, 1.0);
    // billowy cumulus: a low-frequency base shape, with fine detail eating into its edges
    vec3 q = vec3(xz.x * 0.0017, p.y * 0.0026, xz.y * 0.0021);
    float base = fbm3(q);
    float detail = uCloudDetail > 0.5 ? fbm3(q * 3.3 + vec3(13.0, 2.0, 5.0)) : 0.55; // (the fine edge detail is the costly half)
    // flat bottoms; tops climb higher in the thick banks and round off
    float top = mix(0.4, 1.0, cov);
    float hm = smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(top - 0.4, top, h));
    float thr = mix(0.6, 0.3, cov) + (1.0 - hm) * 0.25;
    float s = base - thr - (1.0 - detail) * 0.1 * (0.3 + 0.7 * h);
    return max(s * 5.5, 0.0);
  }
  // 1 = full sun, lower = under a cloud
  float cloudShadow(vec3 wp, vec3 sunDir) {
    if (uCloudShadows < 0.5) return 1.0;
    float s = max(sunDir.y, 0.08);
    vec3 p = wp + sunDir / s * (${CLOUD_SHADOW_HEIGHT.toFixed(1)} - wp.y);
    return exp(-cloudDensity(vec3(p.x, ${CLOUD_SHADOW_HEIGHT.toFixed(1)}, p.z)) * 1.5);
  }
`;

// JavaScript copy of cloudDensity, used to shade the raft and the lighthouse
const fract = (x) => x - Math.floor(x);
function cloudHash3(x, y, z) {
  x = fract(x * 0.1031);
  y = fract(y * 0.1031);
  z = fract(z * 0.1031);
  const d = x * (z + 31.32) + y * (y + 31.32) + z * (x + 31.32);
  x += d;
  y += d;
  z += d;
  return fract((x + y) * z);
}
function cloudNoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const a = lerp(cloudHash3(ix, iy, iz), cloudHash3(ix + 1, iy, iz), ux);
  const b = lerp(cloudHash3(ix, iy + 1, iz), cloudHash3(ix + 1, iy + 1, iz), ux);
  const c = lerp(cloudHash3(ix, iy, iz + 1), cloudHash3(ix + 1, iy, iz + 1), ux);
  const d = lerp(cloudHash3(ix, iy + 1, iz + 1), cloudHash3(ix + 1, iy + 1, iz + 1), ux);
  return lerp(lerp(a, b, uy), lerp(c, d, uy), uz);
}
function cloudFbm3(x, y, z) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 4; i++) {
    v += a * cloudNoise3(x, y, z);
    x = x * 2.02 + 17.1;
    y = y * 2.02 + 9.2;
    z = z * 2.02 + 4.7;
    a *= 0.5;
  }
  return v;
}
function cloudDensityJS(x, y, z, cover, offset) {
  const h = (y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM);
  if (h < 0 || h > 1) return 0;
  const px = x - offset.x, pz = z - offset.y;
  const bank = cloudNoise3(px * 0.00032, 0, pz * 0.00032 + 0) * 0.7 + cloudNoise3(px * 0.0009 + 11, 7, pz * 0.0009 + 11) * 0.3;
  const cov = clamp(cover + (bank - 0.5) * 0.9, 0, 1);
  const base = cloudFbm3(px * 0.0017, y * 0.0026, pz * 0.0021);
  const top = lerp(0.4, 1.0, cov);
  const hm = smooth(0, 0.1, h) * (1 - smooth(top - 0.4, top, h));
  const thr = lerp(0.6, 0.3, cov) + (1 - hm) * 0.25;
  return Math.max((base - thr - 0.05 * (0.3 + 0.7 * h)) * 5.5, 0);
}
function cloudShadowJS(x, y, z, sunDir, cover, offset) {
  const s = Math.max(sunDir.y, 0.08);
  const px = x + (sunDir.x / s) * (CLOUD_SHADOW_HEIGHT - y);
  const pz = z + (sunDir.z / s) * (CLOUD_SHADOW_HEIGHT - y);
  return Math.exp(-cloudDensityJS(px, CLOUD_SHADOW_HEIGHT, pz, cover, offset) * 1.5);
}

// ----- Sky dome (follows the camera) -----
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1000, 48, 24),
  new THREE.ShaderMaterial({
    uniforms: shared,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFog;
      ${SKY_GLSL}
      ${NOISE_GLSL}
      ${CLOUD_GLSL}
      uniform float uCloudDark;
      uniform float uLightLevel;
      uniform float uAurora;
      uniform float uRays;
      uniform sampler2D uCloudTex;
      uniform sampler2D uRayTex;
      uniform vec2 uCloudRes;
      uniform vec2 uRayRes;
      uniform float uCloudOn;
      uniform float uRayOn;
      varying vec3 vDir;

      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyColor(vec3(d.x, max(d.y, 0.0), d.z));
        col *= 1.0 - uSpace * (1.0 - smoothstep(-0.25, 0.0, d.y)); // high up, below the horizon is the dark of space, not haze

        // Twinkling stars
        vec3 cell = floor(d * 400.0);
        float n = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + n * 60.0);
        col += vec3(step(0.9985 - 0.0012 * clamp(uStarGain - 1.0, 0.0, 2.0), n) * twinkle * uStars * uStarGain * smoothstep(0.0, 0.15, d.y));

        // Aurora curtains in the northern sky (-Z)
        if (uAurora > 0.001 && d.y > 0.0) {
          float az = atan(d.x, -d.z);
          float north = 1.0 - smoothstep(0.4, 1.7, abs(az));
          float edge = 0.06 + 0.05 * sin(az * 3.0 + uTime * 0.07);
          float h = d.y;
          float vert = smoothstep(edge, edge + 0.03, h) * (1.0 - smoothstep(edge + 0.04, edge + 0.4, h));
          float curtain = fbm(vec2(az * 4.0 + sin(az * 7.0 + uTime * 0.15) * 0.4, uTime * 0.05));
          curtain = smoothstep(0.35, 0.75, curtain);
          float rays = 0.55 + 0.45 * vnoise(vec2(az * 90.0, uTime * 0.4));
          vec3 ac = mix(vec3(0.15, 1.0, 0.55), vec3(0.65, 0.25, 0.95), smoothstep(edge + 0.08, edge + 0.35, h));
          col += ac * curtain * rays * vert * north * uAurora * 0.9;
        }

        // Moon, opposite the sun
        float md = dot(d, uMoonDir);
        float moonVis = max(uStars, 0.35) * uMoonI * (1.0 - 0.7 * uFog);
        if (md > 0.9985) {
          // the moon as a lit ball: its phase is the sun's light on a sphere
          vec3 off = (d - uMoonDir * md) / 0.0245;
          float q = length(off);
          if (q < 1.0) {
            vec3 nm = normalize(off + uMoonDir * sqrt(1.0 - q * q));
            float lit = smoothstep(-0.04, 0.12, dot(nm, uSunDir));
            float maria = 0.8 + 0.2 * fbm(nm.xy * 5.0 + nm.z * 3.0);
            col += vec3(0.88, 0.92, 1.0) * (0.03 + 0.97 * lit) * maria * (1.0 - smoothstep(0.93, 1.0, q)) * moonVis;
          }
        }
        col += vec3(0.5, 0.6, 0.8) * pow(max(md, 0.0), 60.0) * 0.15 * (0.1 + 0.9 * uMoonPhase) * moonVis;

        // Sun disc and halo
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(sd, 9000.0) * 2.5 + pow(sd, 70.0) * 0.1 + pow(sd, 7.0) * 0.03) * uSunVis;

        // Cirrus: thin streaks of ice cloud high above the rest
        if (d.y > 0.03) {
          vec2 cp = d.xz / (d.y + 0.15);
          vec2 shp = vec2(cp.x * 0.6, cp.y * 2.6) + uCloudOffset * 0.00004;
          float cir = fbm(shp * 1.6 + fbm(shp * 0.8) * 1.5);
          float cirrus = smoothstep(0.52, 0.8, cir) * smoothstep(0.03, 0.3, d.y) * (1.0 - 0.7 * uCloudCover);
          vec3 cc = mix(vec3(1.0), uSunColor * vec3(1.0, 0.82, 0.68), uSunset) * (0.12 + 0.88 * uLightLevel) * (1.0 - 0.5 * uCloudDark);
          col = mix(col, cc, cirrus * 0.4 * (1.0 - uFog) * (1.0 - smoothstep(0.05, 0.4, uSpace)) * uCloudWorld);
        }
        float cloudAlpha = 0.0;
        // Clouds and god rays are drawn into small sky maps, a strip at a time (see skyCache), and read back here with a
        // soft blur: no per-pixel noise, and the costly marching is done once for the whole sky instead of for every pixel
        vec2 suv = vec2(atan(d.x, -d.z) / 6.2831853 + 0.5, sqrt(clamp(asin(clamp(d.y, 0.0, 1.0)) / 1.5707963, 0.0, 1.0)));
        if (uCloudOn > 0.5 && d.y > 0.004) {
          vec2 px = 1.0 / uCloudRes;
          float thin = (1.0 - smoothstep(0.05, 0.4, uSpace)) * uCloudWorld;
          vec4 c = (texture2D(uCloudTex, suv) * 0.36
                 + (texture2D(uCloudTex, suv + px * vec2(1.4, 1.4)) + texture2D(uCloudTex, suv + px * vec2(-1.4, 1.4))
                  + texture2D(uCloudTex, suv + px * vec2(1.4, -1.4)) + texture2D(uCloudTex, suv + px * vec2(-1.4, -1.4))) * 0.16) * thin;
          cloudAlpha = c.a;
          col = col * (1.0 - c.a) + c.rgb; // (the map holds the cloud colour already multiplied by its coverage)
        }
        if (uRayOn > 0.5 && uRays > 0.001) {
          vec2 px = 1.0 / uRayRes;
          float sh = texture2D(uRayTex, suv).r * 0.36
                   + (texture2D(uRayTex, suv + px * vec2(1.1, 1.1)).r + texture2D(uRayTex, suv + px * vec2(-1.1, 1.1)).r
                    + texture2D(uRayTex, suv + px * vec2(1.1, -1.1)).r + texture2D(uRayTex, suv + px * vec2(-1.1, -1.1)).r) * 0.16;
          col += uSunColor * sh * uRays * 1.7 * (1.0 - 0.5 * cloudAlpha);
        }

        col = mix(col, uHorizon, uFog * 0.95);
        // below the horizon is the deep sea's own solid colour, so the moon, stars and clouds never show through the water
        float belowH = (1.0 - smoothstep(-0.06, -0.005, d.y)) * (1.0 - uSpace);
        col = mix(col, vec3(0.025, 0.17, 0.22) * (0.1 + 0.9 * clamp(uLightLevel, 0.0, 1.0)), belowH);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
);
sky.renderOrder = -1;
sky.frustumCulled = false;
scene.add(sky);

// ===== The sky maps: clouds and god rays drawn once for the whole sky, a strip at a time =====
// The sky is the same whichever way you look, and it changes slowly, so instead of ray-marching the clouds for every pixel of
// every frame (twice, in a headset) they are marched into a small map of the whole sky: azimuth across, elevation up (with more
// rows near the horizon, where clouds bunch up). Each frame redraws one quarter of it, so the whole map refreshes about 18 times a
// second, and the cost no longer depends on the screen. The sky shader reads the map back with a soft blur, which also removes the
// grain a per-pixel random start would leave.
const skyCache = (() => {
  const STRIPS = 4;
  const passU = Object.assign({}, shared, { uCamSky: { value: new THREE.Vector3() } });
  const vert = "varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
  const DIR = `
      float az = (vUv.x - 0.5) * 6.2831853;
      float el = vUv.y * vUv.y * 1.5707963;
      vec3 d = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
      float sd = max(dot(d, uSunDir), 0.0);`;
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: passU,
    vertexShader: vert,
    depthTest: false,
    depthWrite: false,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      ${NOISE_GLSL}
      ${CLOUD_GLSL}
      uniform vec3 uCamSky;
      uniform float uCloudDark;
      uniform float uLightLevel;
      uniform float uCloudSteps;
      uniform float uCloudLight;
      varying vec2 vUv;
      void main() {
        ${DIR}
        vec4 outc = vec4(0.0);
        if (d.y > 0.01) {
          vec3 ro = uCamSky;
          float t0 = (CLOUD_BOTTOM - ro.y) / d.y;
          float t1 = (CLOUD_TOP - ro.y) / d.y;
          float fade = (1.0 - smoothstep(5000.0, 12000.0, t0)) * smoothstep(0.01, 0.06, d.y);
          if (fade > 0.0) {
            float stepLen = (t1 - t0) / uCloudSteps;
            float t = t0 + stepLen * (0.5 + 0.4 * (hash(gl_FragCoord.xy) - 0.5)); // (a small start offset hides the step layers without leaving grain)
            float trans = 1.0;
            vec3 acc = vec3(0.0);
            vec3 sunLit = mix(vec3(0.95), uSunColor * vec3(1.0, 0.84, 0.7), 0.9 * uSunset) * uLightLevel * (1.0 - 0.7 * uCloudDark);
            vec3 ambient = (mix(uHorizon, uTop, 0.5) * 0.75 + vec3(0.04) * uLightLevel + vec3(0.2, 0.12, 0.1) * uSunset * 0.3) * (1.0 - 0.5 * uCloudDark);
            float phase = 1.0 + 0.8 * pow(sd, 10.0) * uSunVis; // silver edges toward the sun
            for (int i = 0; i < 28; i++) {
              if (float(i) >= uCloudSteps) break;
              vec3 p = ro + d * t;
              float dens = cloudDensity(p);
              if (dens > 0.001) {
                float ld = cloudDensity(p + uSunDir * 60.0);
                if (uCloudLight > 1.5) ld += cloudDensity(p + uSunDir * 160.0);
                float powder = 1.0 - exp(-dens * stepLen * 0.014); // thin edges catch less light than the dense middle
                vec3 lit = sunLit * exp(-ld * 0.7) * phase * (0.6 + 0.4 * powder) + ambient;
                lit = lit / (1.0 + 0.3 * lit);                    // soft highlights, so sunlit cloud tops don't clip to white
                float a = 1.0 - exp(-dens * stepLen * 0.006);
                acc += trans * a * lit;
                trans *= 1.0 - a;
                if (trans < 0.02) break;
              }
              t += stepLen;
            }
            outc = vec4(acc * fade, (1.0 - trans) * fade);
          }
        }
        gl_FragColor = outc;
      }
    `,
  });
  const rayMat = new THREE.ShaderMaterial({
    uniforms: passU,
    vertexShader: vert,
    depthTest: false,
    depthWrite: false,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      ${NOISE_GLSL}
      ${CLOUD_GLSL}
      uniform vec3 uCamSky;
      uniform float uRaySteps;
      varying vec2 vUv;
      void main() {
        ${DIR}
        float shafts = 0.0;
        // God rays: shafts of sunlight streaming through gaps in the clouds. From each point of the sky, walk toward the sun
        // and see how much of that path is open; where it is part open and part cloud, shafts show.
        vec3 tgt = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.03), uSunDir.z));
        float cosA = clamp(dot(d, tgt), -1.0, 1.0);
        if (cosA > 0.25) {
          float decay = pow(0.93, 18.0 / uRaySteps);
          float jit = hash(gl_FragCoord.xy + 3.1);
          float acc2 = 0.0;
          float wsum = 0.0;
          float w = 1.0;
          for (int i = 0; i < 24; i++) {
            if (float(i) >= uRaySteps) break;
            float k = (float(i) + jit) / uRaySteps;
            vec3 dk = normalize(mix(d, tgt, k));
            dk.y = max(dk.y, 0.03);
            float tm = (0.5 * (CLOUD_BOTTOM + CLOUD_TOP) - uCamSky.y) / dk.y;
            acc2 += w * exp(-cloudDensity(uCamSky + dk * tm) * 3.0);
            wsum += w;
            w *= decay;
          }
          acc2 /= wsum;
          shafts = 4.0 * acc2 * (1.0 - acc2) * exp(-acos(cosA) * 1.5);
        }
        gl_FragColor = vec4(shafts, 0.0, 0.0, 1.0);
      }
    `,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), cloudMat);
  quad.frustumCulled = false;
  const pass = new THREE.Scene();
  pass.add(quad);
  const pcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const makeRT = (w, h) => new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false });
  let cloudRT = null, rayRT = null, strip = 0, needAll = true;
  function draw(rt, mat, i) {
    quad.material = mat;
    rt.scissorTest = true;
    const sw = Math.ceil(rt.width / STRIPS);
    rt.scissor.set(i * sw, 0, sw, rt.height);
    renderer.setRenderTarget(rt);
    renderer.render(pass, pcam);
  }
  return {
    // w x h: size of the cloud map (0 = no clouds); the ray map is half that size; rays = whether the god rays are drawn at all
    setQuality(w, h, rays) {
      if (w && (!cloudRT || cloudRT.width !== w)) {
        if (cloudRT) cloudRT.dispose();
        if (rayRT) rayRT.dispose();
        cloudRT = makeRT(w, h);
        rayRT = makeRT(Math.max(w >> 1, 128), Math.max(h >> 1, 32));
        shared.uCloudTex.value = cloudRT.texture;
        shared.uRayTex.value = rayRT.texture;
        shared.uCloudRes.value.set(w, h);
        shared.uRayRes.value.set(rayRT.width, rayRT.height);
      }
      shared.uCloudOn.value = w ? 1 : 0;
      shared.uRayOn.value = w && rays ? 1 : 0;
      this.rays = !!rays;
      this.clouds = !!w;
      needAll = true;
    },
    update(camPos) {
      if (!cloudRT || !this.clouds) return;
      passU.uCamSky.value.copy(camPos);
      const xr = renderer.xr.enabled, ac = renderer.autoClear;
      renderer.xr.enabled = false;
      renderer.autoClear = false;
      try {
        const n = needAll ? STRIPS : 1; // after a change (or at the start) redraw the whole sky at once
        for (let k = 0; k < n; k++) {
          draw(cloudRT, cloudMat, strip);
          if (this.rays) draw(rayRT, rayMat, strip);
          strip = (strip + 1) % STRIPS;
        }
        needAll = false;
      } finally {
        renderer.setRenderTarget(null);
        renderer.autoClear = ac;
        renderer.xr.enabled = xr;
      }
    },
    rays: true,
    clouds: true,
  };
})();

// ===== The waves (Gerstner swell) =====
// Four swells heading toward the island, which lies to the north (-Z)
const WAVE_DEFS = [
  { ang: 0.0, len: 92, steep: 0.07 },
  { ang: 0.35, len: 54, steep: 0.063 },
  { ang: -0.45, len: 33, steep: 0.049 },
  { ang: 0.9, len: 18, steep: 0.035 },
];
const WAVES = WAVE_DEFS.map((w) => ({ dx: Math.sin(w.ang), dz: -Math.cos(w.ang), k: (Math.PI * 2) / w.len, steep: w.steep, a: w.steep / ((Math.PI * 2) / w.len), c: Math.sqrt(9.8 / ((Math.PI * 2) / w.len)) }));
let waveScale = 1;
let waveMul = 1;

// ===== The island, its beach and the breaking waves: one description, in GLSL and in JS =====
const ISL = { x: 0, z: -190, r: 90 };
// The dock: a timber pier from the dunes out to sea, on the west side of the start. The water around it is sheltered
// (a breakwater and a dredged basin) so the boat can lie quietly alongside.
const DOCK_ANG = Math.PI / 2 + 0.2;
const DOCK = { nx: Math.cos(DOCK_ANG), nz: Math.sin(DOCK_ANG), r0: ISL.r - 10, r1: ISL.r + 30, y: 0.85 };
const HARBOR = { x: ISL.x + DOCK.nx * (ISL.r + 22), z: ISL.z + DOCK.nz * (ISL.r + 22), r: 34 };
const harborCalmJS = (x, z) => 1 - 0.85 * Math.exp(-((x - HARBOR.x) ** 2 + (z - HARBOR.z) ** 2) / (HARBOR.r * HARBOR.r));
const harborDredgeJS = (x, z) => 1.7 * Math.exp(-((x - HARBOR.x) ** 2 + (z - HARBOR.z) ** 2) / 196);
const BREAK_L = 24; // wavelength of a breaker, metres
const BREAK_T = 6.5; // its period, seconds

// ===== The wider world: a grid of 1.2 km cells, most holding an island of some kind =====
// An island is described by a few numbers worked out from its cell (so it is always the same island), and its height is a plain
// formula, the same in JS (for walking and for building the land) and in GLSL (for the water: depth, breakers, foam). The cells
// round you are handed to the shaders as uniforms; each island lies wholly inside its own cell.
const CELL = 1300, GRID_OX = -650, GRID_OZ = -840; // (the home island sits in the middle of cell 0,0)
const rowOff = (j) => (j === 0 ? 0 : hash3(7, j, 70) * CELL);
// ----- the faces of the planet, laid out side by side on the game's flat coordinates (an "atlas"), with open sea between them -----
// Every face has its own flat chart. Walking off the edge of one face carries you onto the next (see updateFace): the chart changes,
// and the things you carry with you are turned to match. Cells near a face's edge hold nothing but sea, so the join is never in view of land.
const FACES = [
  { n: [0, 0, 1], r: [1, 0, 0] },
  { n: [1, 0, 0], r: [0, 0, -1] },
  { n: [0, 0, -1], r: [-1, 0, 0] },
  { n: [-1, 0, 0], r: [0, 0, 1] },
  { n: [0, 1, 0], r: [1, 0, 0] },
  { n: [0, -1, 0], r: [1, 0, 0] },
];
for (const F of FACES) F.u = [F.r[1] * F.n[2] - F.r[2] * F.n[1], F.r[2] * F.n[0] - F.r[0] * F.n[2], F.r[0] * F.n[1] - F.r[1] * F.n[0]]; // u = r x n: chart z runs this way ("south")
const FACE_PITCH = FACE_W + 6 * CELL;
const FACE_C = [[0, 0], [1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1]].map(([sx, sz]) => [GRID_OX + sx * FACE_PITCH, GRID_OZ + sz * FACE_PITCH]); // face 0 is home
const FACE_LIM = FACE_W / 2 - 1.5 * CELL; // a cell must lie wholly inside this, so a band of open sea runs along every edge
function cellFace(cx, cz) {
  for (let f = 0; f < 6; f++) if (Math.abs(cx - FACE_C[f][0]) <= FACE_LIM && Math.abs(cz - FACE_C[f][1]) <= FACE_LIM) return f;
  return -1;
}
let curFace = 0; // the face you are on
let curBody = null; // the other world you are standing on (null: home)
let GRAV = 9.8;
const BODY_OFFSET = 0; // the other worlds' charts are laid at the origin (the camera stays near zero, so the GPU keeps its precision); the home world's things are hidden while you are away
function faceAt(x, z) { // the face whose chart this point belongs to
  let best = 0, bd = 1e12;
  for (let f = 0; f < 6; f++) { const d = Math.max(Math.abs(x - FACE_C[f][0]), Math.abs(z - FACE_C[f][1])); if (d < bd) (bd = d), (best = f); }
  return best;
}
// the planet point (a unit vector) at chart offset (lx, lz) from the middle of face f
function faceDir(f, lx, lz, out) {
  const F = FACES[f], t = Math.tan(lx / PLANET_R), q = Math.tan(lz / PLANET_R);
  return out.set(F.n[0] + t * F.r[0] + q * F.u[0], F.n[1] + t * F.r[1] + q * F.u[1], F.n[2] + t * F.r[2] + q * F.u[2]).normalize();
}
// the other way: which face a unit vector lies on, and where
function dirFace(p, out) {
  const ax = Math.abs(p.x), ay = Math.abs(p.y), az = Math.abs(p.z);
  const f = az >= ax && az >= ay ? (p.z > 0 ? 0 : 2) : ax >= ay ? (p.x > 0 ? 1 : 3) : p.y > 0 ? 4 : 5;
  const F = FACES[f], dn = p.x * F.n[0] + p.y * F.n[1] + p.z * F.n[2];
  out.f = f;
  out.lx = PLANET_R * Math.atan((p.x * F.r[0] + p.y * F.r[1] + p.z * F.r[2]) / dn);
  out.lz = PLANET_R * Math.atan((p.x * F.u[0] + p.y * F.u[1] + p.z * F.u[2]) / dn);
  return out;
}
// the local frame at a point of the planet: p up, tx east (the chart's x), tz = tx x p (the chart's z, "south")
function faceFrame(f, lx, lz, p, tx, tz) {
  faceDir(f, lx, lz, p);
  const F = FACES[f];
  tx.set(F.r[0], F.r[1], F.r[2]);
  tx.addScaledVector(p, -tx.dot(p)).normalize();
  tz.crossVectors(tx, p);
} // every row of cells is shifted by its own amount, so the islands do not line up in columns
const ISLE_NAMES = ["", "Tropical island", "Volcano", "Temple island", "Swamp", "City island", "Airport island"];
const WORLD_SEED = (() => {
  let q = null;
  try { q = new URLSearchParams(location.search).get("seed"); } catch (e) {}
  if (!q) return 1;
  let h = 7;
  for (const ch of q) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761);
  return h | 0;
})();
function hash3(i, j, k) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul((k + 7) | 0, 2147483629) ^ Math.imul(WORLD_SEED, 1597334677);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const ISLE_FORCED = { "1,0": 2, "-1,0": 3, "0,1": 5, "0,-1": 4, "1,1": 1, "-1,-1": 1, "-1,1": 6, "1,-1": 2 }; // a good mix close to home
const ISLE_MINR = [0, 45, 170, 150, 200, 210, 280];
const ISLE_H = [0, 12, 0, 9, 0, 4, 3]; // (volcano and tropical heights are set below)
const isleCache = new Map();
function islandCell(i, j) {
  const key = (i + 4096) * 8192 + (j + 4096);
  let a = isleCache.get(key);
  if (a) return a;
  const ci = i, cj = j, ox = 0, oz = 0;
  const home = i === 0 && j === 0;
  const fc = cellFace(GRID_OX + (i + 0.5) * CELL + rowOff(j), GRID_OZ + (j + 0.5) * CELL); // which face this cell is on (-1: between faces, all sea)
  a = { type: 0, x: 0, z: 0, r: 0, p1: 0, p2: 0, p3: 0, h: 0, feature: "", veg: 0, lob: 0.6, lobF: 0, cliffH: 0, cliffP: 0, lakeR: 0, road: false, farm: false, farmTh: 0, i, j, id: i + "," + j, seed: hash3(ci, cj, 9), face: fc };
  if (!home && fc >= 0) {
    // a size class first (islets to big islands), then what kind of island that size can be; plenty of cells are only open sea
    const sk = hash3(ci, cj, 10), rk = hash3(ci, cj, 2);
    let r = sk < 0.28 ? lerp(55, 120, rk) : sk < 0.54 ? lerp(120, 210, rk) : sk < 0.76 ? lerp(210, 300, rk) : sk < 0.9 ? lerp(300, 480, rk) : lerp(480, 720, rk); // (bigger landmasses: the largest are wider than their cell, and join the islands round them)
    let type = ISLE_FORCED[a.id];
    if (type) r = Math.max(r, ISLE_MINR[type] + 20 * rk);
    else if (hash3(ci, cj, 0) > 0.12 + 0.8 * smooth(0.34, 0.6, vnz((GRID_OX + (ci + 0.5) * CELL + rowOff(cj)) / 2700, (GRID_OZ + (cj + 0.5) * CELL) / 2700, 71))) type = 0; // (dense clusters, wide empty seas)
    else {
      const list = [1, 1, 1, 4];
      if (r >= 140) list.push(3, 3);
      if (r >= 170) list.push(2, 2, 2);
      if (r >= 210) list.push(5, 5);
      if (r >= 280) list.push(6, 6);
      type = list[Math.floor(hash3(ci, cj, 1) * list.length)];
    }
    if (type) {
      a.type = type;
      a.r = r;
      a.lobF = type === 6 ? 0 : hash3(ci, cj, 11);
      a.lob = 0.6 + 0.9 * a.lobF * (type === 6 ? 0 : 1);
      const cx = GRID_OX + (ci + 0.5) * CELL + rowOff(cj) + ox, cz = GRID_OZ + (cj + 0.5) * CELL + oz;
      const jit = Math.max(0, CELL / 2 - 1.42 * r - 140);
      a.x = cx + (hash3(ci, cj, 3) - 0.5) * 2 * jit;
      a.z = cz + (hash3(ci, cj, 4) - 0.5) * 2 * jit;
      a.p1 = hash3(ci, cj, 5) * 6.2832;
      a.p2 = hash3(ci, cj, 6) * 6.2832;
      a.p3 = hash3(ci, cj, 7) * 6.2832;
      if ((type === 1 || type === 2 || type === 3) && r >= 110 && hash3(ci, cj, 14) < 0.42) (a.cliffH = lerp(10, 32, hash3(ci, cj, 15))), (a.cliffP = hash3(ci, cj, 16) * 6.2832);
      a.road = (type === 1 || type === 2) && r >= 150 && hash3(ci, cj, 12) < 0.68;
      a.farm = (type === 1 || type === 3) && r >= 100 && hash3(ci, cj, 13) < 0.7;
      a.farmTh = hash3(ci, cj, 17) * 6.2832;
      a.lakeR = (type === 1 || type === 3 || type === 4) && r >= 140 && hash3(ci, cj, 90) < 0.5 ? r * lerp(0.1, 0.17, hash3(ci, cj, 91)) : 0; // a lake inland on some of the bigger islands
      { const vk = hash3(ci, cj, 80); a.veg = vk < 0.4 ? 0 : vk < 0.72 ? 1 : 2; } // palms / mixed / deep broadleaf woodland
      a.h = type === 2 ? clamp(r * 0.55, 85, 185) * (0.85 + 0.3 * hash3(ci, cj, 8)) : type === 1 ? Math.min(12, r * 0.06) : ISLE_H[type];
    }
  }
  if (!a.type && !home && fc >= 0) {
    // open sea, some of it with something out there: an oil rig, a wind farm, shipping
    const f = hash3(ci, cj, 30);
    a.feature = f < 0.22 ? "wind" : f < 0.44 ? "rig" : f < 0.72 ? "ship" : "";
    if (a.feature) {
      a.r = 90;
      a.x = GRID_OX + (ci + 0.5) * CELL + rowOff(cj) + ox + (hash3(ci, cj, 3) - 0.5) * 260;
      a.z = GRID_OZ + (cj + 0.5) * CELL + oz + (hash3(ci, cj, 4) - 0.5) * 260;
    }
  }
  isleCache.set(key, a);
  return a;
}
function isleCellOf(x, z) {
  const j = Math.floor((z - GRID_OZ) / CELL);
  return islandCell(Math.floor((x - GRID_OX - rowOff(j)) / CELL), j);
}
// the cells within `rad` cells of a point (the rows are offset, so each row finds its own column)
function cellsAround(x, z, rad) {
  const out = [], j0 = Math.floor((z - GRID_OZ) / CELL);
  for (let dj = -rad; dj <= rad; dj++) {
    const jj = j0 + dj, ii = Math.floor((x - GRID_OX - rowOff(jj)) / CELL);
    for (let di = -rad; di <= rad; di++) out.push(islandCell(ii + di, jj));
  }
  return out;
}
function isleCoastR(a, th) {
  return a.r * (1 + a.lob * (0.15 * Math.sin(3 * th + a.p1) + 0.08 * Math.sin(5 * th + a.p2) + 0.05 * Math.sin(9 * th + a.p3)));
}
// metres out to sea from this island's coast (negative on land)
function isleDist(a, x, z) {
  const qx = x - a.x, qz = z - a.z;
  return Math.hypot(qx, qz) - isleCoastR(a, Math.atan2(qz, qx));
}
// the land's own relief: rolling hills and ridged mountain ranges bent by a warp so nothing lines up, on top of the island's basic shape (the beach is left alone)
function reliefFbm(x, z, s, o) { let v = 0, a = 0.5; for (let i = 0; i < o; i++) { v += a * vnz(x, z, s + i); x = x * 2.03 + 11.7; z = z * 2.03 + 5.3; a *= 0.5; } return v / (1 - Math.pow(0.5, o)); }
function reliefRidged(x, z, s, o) { let v = 0, a = 0.5, w = 1, n; for (let i = 0; i < o; i++) { n = 1 - Math.abs(2 * vnz(x, z, s + i) - 1); n *= n * w; w = clamp(n * 2, 0, 1); v += n * a; x = x * 2.07 + 11.7; z = z * 2.07 + 5.3; a *= 0.5; } return v; }
function islandRelief(a, x, z, u, ty) {
  if (ty === 5) { // the city stands on rolling ground: hills, kept above the water
    const ic = smooth(30, 140, u);
    if (ic <= 0) return 0;
    const s5 = Math.floor(a.seed * 997);
    return ic * Math.max(-2.5, (reliefFbm(x / 190, z / 190, s5, 3) - 0.3) * 34 + (reliefFbm(x / 65, z / 65, s5 + 9, 2) - 0.5) * 7);
  }
  if (ty !== 1 && ty !== 2) return 0;
  const inl = smooth(8, 70, u);
  if (inl <= 0) return 0;
  const s0 = Math.floor(a.seed * 997), big = Math.min(1, a.r / 160);
  const wx = x + (reliefFbm(x / 110 + 3, z / 110, s0 + 40, 2) - 0.5) * 90, wz = z + (reliefFbm(x / 110, z / 110 + 7, s0 + 50, 2) - 0.5) * 90;
  if (ty === 1) return inl * big * ((reliefFbm(x / 75, z / 75, s0, 3) - 0.5) * 9 + reliefRidged(wx / 60, wz / 60, s0 + 10, 3) * 3.5 + (reliefFbm(x / 11, z / 11, s0 + 20, 2) - 0.5) * 1.1);
  const sc = a.h / 120;
  return inl * (reliefRidged(wx / 55, wz / 55, s0 + 10, 4) * 34 * sc + (reliefFbm(x / 60, z / 60, s0, 3) - 0.5) * 16 * sc + (reliefFbm(x / 9, z / 9, s0 + 20, 2) - 0.5) * 1.6);
}
// the sea floor off a coast: a gentle sand shelf, then a drop to the deep (full depth 350 m out, so far-off islands never matter)
function shelfJS(d) { const o = -45 * (1 - Math.exp((-d * 0.05) / 45)), t = smooth(200, 350, d); return o * (1 - t) - 45 * t; }
// Islands may overlap their cells and join: the land is the union of the islands round a point, softened (a smooth minimum of their coast distances)
// so two islands that meet are bridged by one landmass instead of showing a seam. The shader does the same with the 9 islands it is given.
const ISL_SOFT = 40;
const reachOf = (a) => a.r * (1 + 0.28 * a.lob);
function isleNb(x, z) { // the islands that could reach into this point's cell (worked out once per cell)
  const c = isleCellOf(x, z);
  if (c.nb) return c.nb;
  const x0 = GRID_OX + c.i * CELL + rowOff(c.j), z0 = GRID_OZ + c.j * CELL, out = [];
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const a = islandCell(c.i + di, c.j + dj);
    if (!a.type) continue;
    const dx = Math.max(x0 - a.x, 0, a.x - (x0 + CELL)), dz = Math.max(z0 - a.z, 0, a.z - (z0 + CELL));
    if (Math.hypot(dx, dz) < reachOf(a) + 450) out.push(a);
  }
  c.nb = out;
  return out;
}
const _dk = new Float64Array(32), _im = { d: 1e9, h: -45, a: null };
function isleMix(x, z, wantH) { // _im.d: softened distance to the land (negative on it); _im.h: the ground there; _im.a: the island that rules here
  const nb = isleNb(x, z);
  let dmin = 1e9;
  for (let k = 0; k < nb.length; k++) {
    const a = nb[k];
    if (Math.hypot(x - a.x, z - a.z) - reachOf(a) > 400) { _dk[k] = 1e9; continue; }
    const d = isleDist(a, x, z);
    _dk[k] = d;
    if (d < dmin) dmin = d;
  }
  if (dmin > 1e8) { _im.d = 1e9; _im.h = -45; _im.a = null; return _im; }
  let sw = 0;
  for (let k = 0; k < nb.length; k++) if (_dk[k] < dmin + 4 * ISL_SOFT) sw += Math.exp(-(_dk[k] - dmin) / ISL_SOFT);
  const dS = dmin - ISL_SOFT * Math.log(sw), delta = dS - dmin;
  let hs = 0, best = null, bw = -1;
  for (let k = 0; k < nb.length; k++) {
    const d = _dk[k];
    if (d >= dmin + 4 * ISL_SOFT) continue;
    const w = Math.exp(-(d - dmin) / ISL_SOFT);
    if (w > bw) { bw = w; best = nb[k]; }
    if (wantH) { let h = isleBed(nb[k], x, z, d + delta); if (d + delta < 0) h = poiFlatten(nb[k], x, z, h); hs += w * h; }
  }
  _im.d = dS; _im.h = wantH ? hs / sw : 0; _im.a = best;
  return _im;
}
function isleBed(a, x, z, d) {
  if (d > 0) return shelfJS(d);
  const qx = x - a.x, qz = z - a.z;
  const th = Math.atan2(qz, qx);
  const R = isleCoastR(a, th), rr = Math.hypot(qx, qz), rho = rr / R, u = -d;
  const ty = a.type;
  const bump = Math.sin(x * 0.11) * Math.sin(z * 0.09) * 0.5 + 0.5;
  const inland = 1 - smooth(-40, 0, d);
  let h;
  if (ty === 1) h = Math.min(u * 0.06, 5) + bump * 2.4 * inland + a.h * (1 - smooth(0.1, 0.8, rho)) * (0.6 + 0.4 * Math.sin(th * 2 + a.p2));
  else if (ty === 2) h = Math.min(u * 0.06, 4) + a.h * Math.pow(1 - smooth(0.04, 0.66, rho), 1.4) - 0.26 * a.h * (1 - smooth(0, 0.11, rho)) + bump * 1.5 * inland;
  else if (ty === 3) {
    const t = Math.min(u * 0.08, 9);
    h = Math.floor(t / 3) * 3 + 3 * smooth(0.6, 0.95, fract(t / 3)) + 0.3 * bump * inland;
  } else if (ty === 4)
    h = Math.min(u * 0.015, 0.8) + (Math.sin(x * 0.045) * Math.sin(z * 0.05 + a.p1) * 0.5 + Math.sin(x * 0.13 + a.p2) * Math.sin(z * 0.11) * 0.35) * smooth(0, 25, u) - 0.15;
  else if (ty === 5) h = Math.min(u * 0.12, 4);
  else h = Math.min(u * 0.1, 3);
  h += islandRelief(a, x, z, u, ty);
  if (a.cliffH) h += a.cliffH * smooth(0, 22, u) * smooth(0.3, 0.7, Math.sin(2 * th + a.cliffP) * 0.5 + 0.5); // sea cliffs and mesas along part of the coast
  if (ty === 1 || ty === 4) {
    // a river: a winding channel from near the middle out to the sea, cut below the waterline so the sea fills it
    const ra = a.p3 * 3, dx = Math.cos(ra), dz = Math.sin(ra);
    const s = qx * dx + qz * dz;
    const w = -qx * dz + qz * dx - 16 * Math.sin(s * 0.018 + a.p1);
    const wr = ty === 1 ? 7 : 12;
    const rm = (1 - smooth(wr, wr + 9, Math.abs(w))) * smooth(0.18 * R, 0.32 * R, s) * (1 - smooth(1.1 * R, 1.3 * R, s));
    h = Math.min(h, h + (-1.8 - h) * rm);
  }
  if (a.lakeR > 0) {
    // a lake: a round hollow inland, cut below the waterline so the sea level fills it
    const lx = x - (a.x + Math.cos(a.p2) * 0.3 * a.r), lz = z - (a.z + Math.sin(a.p2) * 0.3 * a.r);
    // (shallow: the ground round it is eased down to a gentle bowl about a metre deep, not a pit)
    const lq = Math.hypot(lx, lz) / a.lakeR, ht = lerp(-1.1, 4.0, smooth(0.6, 1.6, lq));
    h += (Math.min(h, ht) - h) * (1 - smooth(1.6, 2.8, lq));
  }
  return h;
}

const SHORE_GLSL = /* glsl */ `
  const vec2 ISL_C = vec2(${ISL.x.toFixed(1)}, ${ISL.z.toFixed(1)});
  const float ISL_R = ${ISL.r.toFixed(1)};
  const float BREAK_L = ${BREAK_L.toFixed(1)};
  const float BREAK_T = ${BREAK_T.toFixed(1)};

  const vec2 HARBOR_C = vec2(${HARBOR.x.toFixed(2)}, ${HARBOR.z.toFixed(2)});
  const float HARBOR_R = ${HARBOR.r.toFixed(1)};
  // the sheltered water round the dock, and the dredged basin the boat floats in
  float harborCalm(vec2 p) { vec2 q = p - HARBOR_C; return 1.0 - 0.85 * exp(-dot(q, q) / (HARBOR_R * HARBOR_R)); }
  float harborDredge(vec2 p) { vec2 q = p - HARBOR_C; return 1.7 * exp(-dot(q, q) / 196.0); }

  // The other islands (see islandCell in JS): this cell's island and the 3x3 cells round the camera are uniforms
  uniform vec4 uIslA[9]; // x, z, radius, type (0 = none)
  uniform vec4 uIslB[9]; // three phases, height
  uniform vec4 uIslC[9]; // cliff height and phase
  uniform vec2 uIslBase; // y = the first of the three rows of cells
  uniform vec3 uIslRowI; // the first cell of each of those rows
  uniform vec3 uIslRowO; // and how far each of those rows is shifted
  const float CELL_S = ${CELL.toFixed(1)};
  const vec2 GRID_O = vec2(${GRID_OX.toFixed(1)}, ${GRID_OZ.toFixed(1)});
  vec4 islLookup(vec2 p, out vec4 B, out vec4 C) {
    B = vec4(0.0);
    C = vec4(0.0);
    float jj = floor((p.y - GRID_O.y) / CELL_S);
    float rj = jj - uIslBase.y;
    if (rj < 0.0 || rj > 2.0) return vec4(0.0);
    float off = rj < 0.5 ? uIslRowO.x : (rj < 1.5 ? uIslRowO.y : uIslRowO.z);
    float ii = floor((p.x - GRID_O.x - off) / CELL_S);
    float rowBase = rj < 0.5 ? uIslRowI.x : (rj < 1.5 ? uIslRowI.y : uIslRowI.z);
    float ri = ii - rowBase;
    if (ri < 0.0 || ri > 2.0) return vec4(0.0);
    int k = int(ri) + 3 * int(rj);
    B = uIslB[k];
    C = uIslC[k];
    return uIslA[k];
  }
  float islDist(vec2 p, vec4 A, vec4 B) {
    vec2 q = p - A.xy;
    float th = atan(q.y, q.x);
    float lob = 0.6 + 1.8 * fract(A.w);
    return length(q) - A.z * (1.0 + lob * (0.15 * sin(3.0 * th + B.x) + 0.08 * sin(5.0 * th + B.y) + 0.05 * sin(9.0 * th + B.z)));
  }
  float shelf(float d) { return mix(-45.0 * (1.0 - exp(-d * 0.05 / 45.0)), -45.0, smoothstep(200.0, 350.0, d)); }
  float islBed(vec2 p, vec4 A, vec4 B, vec4 C, float d) {
    if (d > 0.0) return shelf(d);
    vec2 q = p - A.xy;
    float th = atan(q.y, q.x);
    float rr = length(q);
    float R = rr - d;
    float rho = rr / R;
    float u = -d;
    float ty = floor(A.w);
    float bump = sin(p.x * 0.11) * sin(p.y * 0.09) * 0.5 + 0.5;
    float inland = 1.0 - smoothstep(-40.0, 0.0, d);
    float h;
    if (ty < 1.5) h = min(u * 0.06, 5.0) + bump * 2.4 * inland + B.w * (1.0 - smoothstep(0.1, 0.8, rho)) * (0.6 + 0.4 * sin(th * 2.0 + B.y));
    else if (ty < 2.5) h = min(u * 0.06, 4.0) + B.w * pow(1.0 - smoothstep(0.04, 0.66, rho), 1.4) - 0.26 * B.w * (1.0 - smoothstep(0.0, 0.11, rho)) + bump * 1.5 * inland;
    else if (ty < 3.5) {
      float t = min(u * 0.08, 9.0);
      h = floor(t / 3.0) * 3.0 + 3.0 * smoothstep(0.6, 0.95, fract(t / 3.0)) + 0.3 * bump * inland;
    } else if (ty < 4.5)
      h = min(u * 0.015, 0.8) + (sin(p.x * 0.045) * sin(p.y * 0.05 + B.x) * 0.5 + sin(p.x * 0.13 + B.y) * sin(p.y * 0.11) * 0.35) * smoothstep(0.0, 25.0, u) - 0.15;
    else if (ty < 5.5) h = min(u * 0.12, 4.0);
    else h = min(u * 0.1, 3.0);
    if (C.x > 0.0) h += C.x * smoothstep(0.0, 22.0, u) * smoothstep(0.3, 0.7, sin(2.0 * th + C.y) * 0.5 + 0.5);
    if (ty < 1.5 || (ty > 3.5 && ty < 4.5)) {
      float ra = B.z * 3.0;
      vec2 dir = vec2(cos(ra), sin(ra));
      float s = dot(q, dir);
      float w = dot(q, vec2(-dir.y, dir.x)) - 16.0 * sin(s * 0.018 + B.x);
      float wr = ty < 1.5 ? 7.0 : 12.0;
      float rm = (1.0 - smoothstep(wr, wr + 9.0, abs(w))) * smoothstep(0.18 * R, 0.32 * R, s) * (1.0 - smoothstep(1.1 * R, 1.3 * R, s));
      h = min(h, h + (-1.8 - h) * rm);
    }
    if (C.z > 0.0) {
      vec2 lq = q - vec2(cos(B.y), sin(B.y)) * 0.3 * A.z;
      float lqq = length(lq) / C.z, ht = mix(-1.1, 4.0, smoothstep(0.6, 1.6, lqq));
      h += (min(h, ht) - h) * (1.0 - smoothstep(1.6, 2.8, lqq));
    }
    return h;
  }
  // the union of the islands round the camera, softened where two meet so they join into one landmass (the same as islMix in JS)
  const float ISL_S = 40.0;
  float islReach(vec4 A) { return A.z * (1.0 + 0.28 * (0.6 + 1.8 * fract(A.w))); }
  float islMix(vec2 p, bool wantH, out float h) { // returns the softened distance to land; h = the ground there
    float dk[9];
    float dmin = 1.0e9;
    for (int k = 0; k < 9; k++) {
      dk[k] = 1.0e9;
      vec4 A = uIslA[k];
      if (A.w < 0.5) continue;
      if (length(p - A.xy) - islReach(A) > 400.0) continue;
      dk[k] = islDist(p, A, uIslB[k]);
      dmin = min(dmin, dk[k]);
    }
    h = -45.0;
    if (dmin > 1.0e8) return 1.0e9;
    float sw = 0.0;
    for (int k = 0; k < 9; k++) if (dk[k] < dmin + 4.0 * ISL_S) sw += exp(-(dk[k] - dmin) / ISL_S);
    float dS = dmin - ISL_S * log(sw);
    if (wantH) {
      float delta = dS - dmin, hs = 0.0;
      for (int k = 0; k < 9; k++) if (dk[k] < dmin + 4.0 * ISL_S) hs += exp(-(dk[k] - dmin) / ISL_S) * islBed(p, uIslA[k], uIslB[k], uIslC[k], dk[k] + delta);
      h = hs / sw;
    }
    return dS;
  }
  float shoreDist(vec2 p) { // metres out to sea from the nearest coast (negative on land)
    float d = length(p - ISL_C) - ISL_R;
    float h;
    return min(d, islMix(p, false, h));
  }
  float shoreCoord(vec2 p) { return -shoreDist(p); }             // grows toward the shore

  // Height of the ground: a sand shelf out to sea that deepens to 45 m, a beach and low dunes on land
  float bedHeight(vec2 p) {
    float d = length(p - ISL_C) - ISL_R;
    float h;
    float di = islMix(p, true, h);
    if (di < d) return h;
    if (d > 0.0) return shelf(d) - harborDredge(p);
    float bump = (sin(p.x * 0.11) * sin(p.y * 0.09) * 0.5 + 0.5) * 2.4 * (1.0 - smoothstep(-40.0, 0.0, d));
    return min(-d * 0.06, 5.0) + bump;
  }

  // Where we are in the life of a breaker: 0 = open water, 1 = about to break, 2 = spent
  float breakStage(float depth) {
    return (1.0 - smoothstep(2.4, 8.0, depth)) + (1.0 - smoothstep(0.4, 2.4, depth));
  }
  // How tall the breaking wave is: it grows as the water shoals, then collapses
  float breakAmp(float depth) {
    float shoal = 1.0 - smoothstep(2.4, 9.0, depth);
    float spent = 1.0 - 0.7 * (1.0 - smoothstep(0.4, 2.4, depth));
    return 1.3 * shoal * spent * smoothstep(0.0, 0.5, depth);
  }
  // Phase of the breaker train (0 = crest). The crests slide toward the shore.
  float breakUAt(float s, vec2 p, float t) {
    vec2 q = p - ISL_C;
    float ang = atan(q.y, q.x);
    float wob = 0.08 * sin(ang * 7.0 + t * 0.2) + 0.05 * sin(ang * 19.0 - t * 0.13);
    return fract(-s / BREAK_L + t / BREAK_T + wob);
  }
  float breakU(vec2 p, float t) { return breakUAt(shoreCoord(p), p, t); }
  // The wave's profile: x = height, y = how far the lip leans toward the shore
  vec2 breakShape(float u, float stage) {
    float bd = u < 0.5 ? u : u - 1.0;
    float wf = mix(0.3, 0.09, clamp(stage, 0.0, 1.0)); // the face steepens as it nears breaking
    float w = bd < 0.0 ? wf : 0.32;
    float h = exp(-(bd * bd) / (w * w));
    float curl = clamp(stage - 0.6, 0.0, 1.0);
    float lq = (bd + 0.04) / 0.07;
    float lean = bd < 0.0 ? exp(-lq * lq) * curl : 0.0;
    return vec2(h, lean * 0.8);
  }
  // Each spent wave running up the beach and sliding back
  float swashLevel(vec2 p, float t) {
    vec2 q = p - ISL_C;
    float ang = atan(q.y, q.x);
    return harborCalm(p) * 0.3 * (0.5 + 0.5 * sin(t * 6.2832 / BREAK_T + ang * 3.0));
  }
`;

// ----- the same, in JS -----
const shoreDistJS = (x, z) => Math.hypot(x - ISL.x, z - ISL.z) - ISL.r;
function shoreDistAll(x, z) {
  return Math.min(shoreDistJS(x, z), isleMix(x, z, false).d);
}
function bedHeightJS(x, z) {
  const d = shoreDistJS(x, z);
  const m = isleMix(x, z, true);
  if (m.d < d) return m.h;
  if (d > 0) return shelfJS(d) - harborDredgeJS(x, z);
  const bump = (Math.sin(x * 0.11) * Math.sin(z * 0.09) * 0.5 + 0.5) * 2.4 * (1 - smooth(-40, 0, d));
  return Math.min(-d * 0.06, 5.0) + bump;
}
const breakStageJS = (depth) => 1 - smooth(2.4, 8, depth) + (1 - smooth(0.4, 2.4, depth));
const breakAmpJS = (depth) => 1.3 * (1 - smooth(2.4, 9, depth)) * (1 - 0.7 * (1 - smooth(0.4, 2.4, depth))) * smooth(0, 0.5, depth);
function breakUJS(x, z, t) {
  const s = -shoreDistAll(x, z);
  const ang = Math.atan2(z - ISL.z, x - ISL.x);
  const wob = 0.08 * Math.sin(ang * 7 + t * 0.2) + 0.05 * Math.sin(ang * 19 - t * 0.13);
  return fract(-s / BREAK_L + t / BREAK_T + wob);
}
function breakHeightJS(u, stage) {
  const bd = u < 0.5 ? u : u - 1;
  const wf = lerp(0.3, 0.09, clamp(stage, 0, 1));
  const w = bd < 0 ? wf : 0.32;
  return Math.exp(-(bd * bd) / (w * w));
}
const swashJS = (x, z, t) => harborCalmJS(x, z) * 0.3 * (0.5 + 0.5 * Math.sin((t * 6.2832) / BREAK_T + Math.atan2(z - ISL.z, x - ISL.x) * 3));

const _d = { x: 0, y: 0, z: 0 };
function waveDisp(x0, z0, t, out) {
  const depth = -bedHeightJS(x0, z0);
  const damp = lerp(0.12, 1, smooth(0.5, 8, depth)) * harborCalmJS(x0, z0); // waves shrink in shallow water, and in the harbour
  let steepSum = 0;
  for (const w of WAVES) steepSum += w.steep;
  const sideways = Math.min(1, 0.6 / Math.max(steepSum * waveScale * damp, 1e-4));
  let dx = 0, dy = 0, dz = 0;
  for (const w of WAVES) {
    const s = w.steep * waveScale * damp;
    const c = Math.sqrt(9.8 / w.k);
    const f = w.k * (w.dx * x0 + w.dz * z0 - c * t);
    const q = s * sideways;
    const cf = Math.cos(f);
    dx += w.dx * (q / w.k) * cf;
    dy += (s / w.k) * Math.sin(f);
    dz += w.dz * (q / w.k) * cf;
  }
  if (depth < 8) {
    const bA = (0.3 + 0.4 * waveScale) * breakAmpJS(depth) * harborCalmJS(x0, z0);
    if (bA > 0) dy += breakHeightJS(breakUJS(x0, z0, t), breakStageJS(depth)) * bA;
  }
  dy += (1 - smooth(0, 1.2, depth)) * swashJS(x0, z0, t);
  out.x = dx;
  out.y = dy;
  out.z = dz;
}
// Height of the sea at a point: find the grid point that the waves push onto it, then read its height
function waveHeight(x, z, t) {
  if (curBody) return -1e5; // (no sea out there)
  let x0 = x, z0 = z;
  for (let i = 0; i < 3; i++) {
    waveDisp(x0, z0, t, _d);
    x0 = x - _d.x;
    z0 = z - _d.z;
  }
  return _d.y;
}

