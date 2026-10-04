"use strict";
// ===== Chinese festival lanterns =====
// Brush-stroke wishes, painted in red ink on the paper
function brushWish(ctx, cx, cy, size, rgba) {
  ctx.strokeStyle = rgba;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let k = 0; k < 8; k++) {
    ctx.lineWidth = size * rand(0.05, 0.12);
    ctx.beginPath();
    const x0 = cx + rand(-0.5, 0.5) * size, y0 = cy + rand(-0.5, 0.5) * size;
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x0 + rand(-0.5, 0.5) * size, y0 + rand(-0.5, 0.5) * size, cx + rand(-0.5, 0.5) * size, cy + rand(-0.5, 0.5) * size, cx + rand(-0.5, 0.5) * size, cy + rand(-0.5, 0.5) * size);
    ctx.stroke();
  }
}

// ----- Sky lanterns (Kongming): paper, open at the bottom, a flame inside, rising on the wind -----
const skyTex = canvasTex(512, 256, (ctx, W, H) => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#fff0cc");
  g.addColorStop(0.55, "#ffcf8a");
  g.addColorStop(1, "#ff9440");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(120,60,20,0.35)";
  for (let i = 0; i < 16; i++) ctx.fillRect((i * W) / 16 - 1, 0, 2, H); // paper panels
  ctx.fillRect(0, H * 0.08, W, 3);
  ctx.fillRect(0, H * 0.92, W, 3);
  for (let p = 0; p < 4; p++) brushWish(ctx, W * (p + 0.5) / 4, H * 0.5, 100, "rgba(150,18,18,0.85)");
});
const SKY_N = 46;
const skyGeo = mergeGeos([
  { g: new THREE.CylinderGeometry(0.2, 0.14, 0.5, 20, 1, true), color: 0xffffff },
  { g: new THREE.CircleGeometry(0.2, 20).rotateX(-Math.PI / 2).translate(0, 0.25, 0), color: 0xffb060 },
  { g: new THREE.TorusGeometry(0.14, 0.008, 6, 20).rotateX(Math.PI / 2).translate(0, -0.25, 0), color: 0x5a3a1a },
]);
const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, vertexColors: true, side: THREE.DoubleSide, fog: false });
const skyMesh = new THREE.InstancedMesh(skyGeo, skyMat, SKY_N);
skyMesh.frustumCulled = false;
scene.add(skyMesh);
const skyGlowMat = new THREE.SpriteMaterial({ map: dotTexture, color: 0xffa040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
const skyLanterns = Array.from({ length: SKY_N }, () => {
  const sprite = new THREE.Sprite(skyGlowMat);
  scene.add(sprite);
  return { sprite, x: 0, y: 0, z: 0, vy: 0, size: 1, phase: Math.random() * 6.28, spin: rand(-0.3, 0.3), age: 0 };
});
function launchSky(l, anywhere) {
  l.x = player.x + rand(-110, 110);
  l.z = player.z + rand(-20, 130);
  l.y = anywhere ? rand(3, 170) : Math.max(bedHeightJS(l.x, l.z), 0) + rand(0.5, 2);
  l.vy = rand(0.7, 1.3);
  l.size = rand(0.85, 1.4);
  l.age = anywhere ? 5 : 0; // new ones swell out of the dark as they are lit
}
skyLanterns.forEach((l) => launchSky(l, true));
const dummy = new THREE.Object3D();
function updateSky(dt, t, lampsOn) {
  const wdx = Math.cos(weather.windAngle), wdz = Math.sin(weather.windAngle);
  const drift = 1.2 + 4.5 * (weather.windSpeed / 24);
  skyMat.color.setRGB(lerp(0.9, 1.8, lampsOn), lerp(0.85, 1.05, lampsOn), lerp(0.8, 0.5, lampsOn));
  skyGlowMat.opacity = 0.2 + 0.6 * lampsOn;
  skyLanterns.forEach((l, i) => {
    l.age += dt;
    l.x += (wdx * drift + Math.sin(t * 0.25 + l.phase) * 0.5) * dt;
    l.z += (wdz * drift + Math.cos(t * 0.21 + l.phase * 1.7) * 0.5) * dt;
    l.y += l.vy * dt * (1 + 0.15 * Math.sin(t * 0.6 + l.phase));
    if (l.y > 200 || Math.hypot(l.x - player.x, l.z - player.z) > 260) launchSky(l, false);
    const s = l.size * Math.min(1, l.age / 3) * (1 - smooth(170, 200, l.y));
    dummy.position.set(l.x, l.y, l.z);
    dummy.rotation.set(Math.sin(t * 0.9 + l.phase) * 0.06, t * l.spin + l.phase, Math.cos(t * 0.8 + l.phase) * 0.06);
    dummy.scale.setScalar(Math.max(s, 0.001));
    dummy.updateMatrix();
    skyMesh.setMatrixAt(i, dummy.matrix);
    const flick = 1 + 0.12 * Math.sin(t * 9 + l.phase * 5) + 0.06 * Math.sin(t * 17 + l.phase);
    l.sprite.position.set(l.x, l.y - 0.12 * s, l.z);
    l.sprite.scale.setScalar(Math.max(0.001, s * (1.0 + 2.2 * lampsOn) * flick));
  });
  skyMesh.instanceMatrix.needsUpdate = true;
}

// ----- Lotus river lanterns, drifting on the sea toward the shore -----
const lotusGeo = (() => {
  const list = [];
  const petal = (sx, sy, sz, tilt, r0, y, ang, color) => {
    const g = new THREE.SphereGeometry(1, 8, 6).scale(sx, sy, sz).translate(0, 0, sz + r0).rotateX(-tilt).translate(0, y, 0).rotateY(ang);
    list.push({ g, color });
  };
  for (let i = 0; i < 9; i++) petal(0.075, 0.02, 0.17, 0.3, 0.05, 0.0, (i / 9) * 6.283, 0xffd9e3);
  for (let i = 0; i < 8; i++) petal(0.06, 0.02, 0.13, 0.75, 0.03, 0.03, ((i + 0.5) / 8) * 6.283, 0xff93b4);
  for (let i = 0; i < 6; i++) petal(0.045, 0.018, 0.09, 1.15, 0.02, 0.06, (i / 6) * 6.283 + 0.3, 0xffc2d4);
  list.push({ g: new THREE.CircleGeometry(0.27, 14).rotateX(-Math.PI / 2).translate(0, -0.015, 0), color: 0x2f6b3a });
  return mergeGeos(list);
})();
const lotusMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x401020, side: THREE.DoubleSide });
const candleGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.11, 10, 1, true).translate(0, 0.085, 0);
const candleMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, side: THREE.DoubleSide, fog: false });
const lotusGlowMat = new THREE.SpriteMaterial({ map: dotTexture, color: 0xffa860, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
const LOTUS_N = 22;
const lotuses = Array.from({ length: LOTUS_N }, () => {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(lotusGeo, lotusMat));
  g.add(new THREE.Mesh(candleGeo, candleMat));
  const sprite = new THREE.Sprite(lotusGlowMat);
  sprite.position.y = 0.12;
  g.add(sprite);
  scene.add(g);
  return { g, sprite, x: 0, z: 0, y: 0, phase: Math.random() * 6.28, wander: Math.random() * 6.28, t: 0, fade: 1, speed: rand(0.8, 1.2), size: rand(0.9, 1.4) };
});
function placeLotus(l, first) {
  const a = Math.PI / 2 + rand(-1.15, 1.15);
  const d = first ? rand(6, 110) : rand(70, 115);
  l.x = ISL.x + Math.cos(a) * (ISL.r + d);
  l.z = ISL.z + Math.sin(a) * (ISL.r + d);
  l.t = 0;
  l.fade = 0;
}
lotuses.forEach((l) => (placeLotus(l, true), (l.fade = 1)));
function updateLotus(dt, t, lampsOn) {
  const drift = 0.22 + 0.55 * weather.value;
  candleMat.color.setRGB(lerp(0.75, 1.9, lampsOn), lerp(0.62, 1.1, lampsOn), lerp(0.45, 0.5, lampsOn));
  lotusGlowMat.opacity = 0.2 + 0.6 * lampsOn;
  lotusMat.emissive.setRGB(0.2 + 0.25 * lampsOn, 0.1 + 0.1 * lampsOn, 0.12 + 0.1 * lampsOn); // petals never go dark, even in daylight
  for (const l of lotuses) {
    l.wander += dt * 0.25;
    const toC = Math.atan2(ISL.z - l.z, ISL.x - l.x); // the tide carries them shoreward
    l.x += (Math.cos(toC) * drift * l.speed + Math.cos(l.wander) * 0.12) * dt;
    l.z += (Math.sin(toC) * drift * l.speed + Math.sin(l.wander * 1.3) * 0.12) * dt;
    if (shoreDistJS(l.x, l.z) < 1.2) l.fade = Math.max(0, l.fade - dt * 0.8);
    else l.fade = Math.min(1, l.fade + dt * 0.5);
    if (l.fade <= 0 && shoreDistJS(l.x, l.z) < 1.2) placeLotus(l, false);
    const h = waveHeight(l.x, l.z, t);
    const hx = waveHeight(l.x + 0.4, l.z, t) - waveHeight(l.x - 0.4, l.z, t);
    const hz = waveHeight(l.x, l.z + 0.4, t) - waveHeight(l.x, l.z - 0.4, t);
    l.y = h;
    l.g.position.set(l.x, h + 0.015, l.z);
    l.g.rotation.set(Math.atan2(hz, 0.8) * 0.9, l.phase + t * 0.03, -Math.atan2(hx, 0.8) * 0.9, "YXZ");
    l.g.scale.setScalar(l.size * Math.max(l.fade, 0.001));
    l.sprite.scale.setScalar((0.5 + 1.8 * lampsOn) * (1 + 0.1 * Math.sin(t * 8 + l.phase)));
  }
}

// ----- Red lanterns strung on bamboo poles along the beach -----
const garland = (() => {
  const redTex = canvasTex(512, 128, (ctx, W, H) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#9e0f14");
    g.addColorStop(0.5, "#e0262a");
    g.addColorStop(1, "#a30f15");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,210,90,0.9)";
    for (let i = 0; i < 16; i++) ctx.fillRect((i * W) / 16 - 1.5, 0, 3, H); // gold ribs
    for (let k = 0; k < 4; k++) {
      // a gold medallion on each face
      const cx = (k + 0.5) * (W / 4), cy = H / 2;
      ctx.strokeStyle = "#ffd25a";
      ctx.fillStyle = "rgba(255,210,90,0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 28, 0, 6.283);
      ctx.stroke();
      for (let p = 0; p < 6; p++) {
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(p * 1.047) * 13, cy + Math.sin(p * 1.047) * 13, 9, 5, p * 1.047, 0, 6.283);
        ctx.fill();
      }
    }
  });
  const prof = [];
  for (let i = 0; i <= 20; i++) {
    const a = -1.2 + (i / 20) * 2.4;
    prof.push(new THREE.Vector2(0.27 * Math.cos(a), 0.2 * (Math.sin(a) / Math.sin(1.2)) - 0.31));
  }
  const bodyGeo = new THREE.LatheGeometry(prof, 20);
  const goldGeo = mergeGeos([
    { g: new THREE.CylinderGeometry(0.006, 0.006, 0.14, 5).translate(0, 0.07, 0), color: 0xd9a521 },
    { g: new THREE.CylinderGeometry(0.09, 0.12, 0.05, 14).translate(0, -0.075, 0), color: 0xd9a521 },
    { g: new THREE.CylinderGeometry(0.12, 0.09, 0.05, 14).translate(0, -0.545, 0), color: 0xd9a521 },
    { g: new THREE.CylinderGeometry(0.01, 0.01, 0.12, 5).translate(0, -0.63, 0), color: 0xd9a521 },
    { g: new THREE.SphereGeometry(0.03, 8, 6).translate(0, -0.7, 0), color: 0xe8b830 },
    { g: new THREE.ConeGeometry(0.055, 0.24, 10, 1, true).translate(0, -0.84, 0), color: 0xc61a22 },
  ]);
  const bodyMat = new THREE.MeshStandardMaterial({ map: redTex, emissiveMap: redTex, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.6, side: THREE.DoubleSide });
  const goldMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide });
  const g = new THREE.Group();
  scene.add(g);
  // bamboo poles
  const bambooPoleTex = bambooTex.clone();
  bambooPoleTex.repeat.set(1, 4);
  bambooPoleTex.needsUpdate = true;
  const thetas = [-0.1, -0.2, -0.3, -0.4];
  const poles = thetas.map((d) => {
    const a = Math.PI / 2 + d, r = ISL.r - 17;
    const x = ISL.x + Math.cos(a) * r, z = ISL.z + Math.sin(a) * r, y = groundY(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 4.6, 8), new THREE.MeshStandardMaterial({ map: bambooPoleTex, roughness: 0.55 }));
    pole.position.set(x, y + 2.2, z);
    g.add(pole);
    colliders.push({ x, z, r: 0.12 });
    return new THREE.Vector3(x, y + 4.3, z);
  });
  // ropes with a sag, and lanterns hung along them
  const attach = [];
  const ropeMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  for (let s = 0; s < poles.length - 1; s++) {
    const A = poles[s], B = poles[s + 1];
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      pts.push(new THREE.Vector3(lerp(A.x, B.x, u), lerp(A.y, B.y, u) - Math.sin(u * Math.PI) * 0.75, lerp(A.z, B.z, u)));
    }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 4), ropeMat));
    for (let k = 1; k <= 3; k++) {
      const u = k / 4;
      attach.push(new THREE.Vector3(lerp(A.x, B.x, u), lerp(A.y, B.y, u) - Math.sin(u * Math.PI) * 0.75, lerp(A.z, B.z, u)));
    }
  }
  const N = attach.length;
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, N);
  const golds = new THREE.InstancedMesh(goldGeo, goldMat, N);
  bodies.frustumCulled = golds.frustumCulled = false;
  g.add(bodies, golds);
  const phases = attach.map(() => Math.random() * 6.28);
  const d = new THREE.Object3D();
  return {
    attach,
    group: g,
    update(t, lampsOn) {
      bodyMat.emissiveIntensity = 0.15 + 1.5 * lampsOn;
      const str = windU.uWindStr.value;
      const wd = windU.uWind.value;
      attach.forEach((p, i) => {
        const gust = 0.5 + 0.5 * Math.sin(t * (0.6 + str) + p.x * 0.05 + p.z * 0.04);
        const tilt = (0.04 + 0.35 * str * (0.4 + gust)) + Math.sin(t * 1.3 + phases[i]) * 0.05 * (0.4 + str);
        d.position.copy(p);
        d.rotation.set(wd.y * tilt, 0, -wd.x * tilt + Math.sin(t * 0.9 + phases[i] * 2) * 0.03);
        d.updateMatrix();
        bodies.setMatrixAt(i, d.matrix);
        golds.setMatrixAt(i, d.matrix);
      });
      bodies.instanceMatrix.needsUpdate = true;
      golds.instanceMatrix.needsUpdate = true;
    },
  };
})();

// ===== Campfire on the beach =====
const fire = (() => {
  const a = Math.PI / 2 - 0.09, r = ISL.r - 11;
  const x = ISL.x + Math.cos(a) * r, z = ISL.z + Math.sin(a) * r, y = groundY(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  scene.add(g);
  colliders.push({ x, z, r: 1.0 });
  const stone = rockMaterial();
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Mesh(makeRock(2, i * 3.7, 9), stone);
    s.scale.setScalar(rand(0.1, 0.17));
    const ang = (i / 10) * 6.283;
    s.position.set(Math.cos(ang) * 0.62, 0.05, Math.sin(ang) * 0.62);
    s.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    g.add(s);
  }
  const logMat = new THREE.MeshStandardMaterial({ map: charTex, roughness: 0.9, emissive: 0x401000, emissiveMap: charTex, emissiveIntensity: 0.6 });
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 7), logMat);
    log.position.y = 0.13;
    log.rotation.set(Math.PI / 2 - 0.25, (i / 4) * Math.PI * 2 + 0.4, 0, "YXZ");
    g.add(log);
  }
  const embers = new THREE.Mesh(new THREE.CircleGeometry(0.4, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff5a14, fog: false }));
  embers.position.y = 0.07;
  g.add(embers);
  const flameTex = canvasTex(64, 128, (ctx, W, H) => {
    const gr = ctx.createRadialGradient(32, 84, 2, 32, 84, 50);
    gr.addColorStop(0, "rgba(255,245,190,1)");
    gr.addColorStop(0.35, "rgba(255,170,50,0.85)");
    gr.addColorStop(0.75, "rgba(230,70,10,0.35)");
    gr.addColorStop(1, "rgba(200,40,0,0)");
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(32, 2);
    ctx.bezierCurveTo(60, 50, 62, 110, 32, 126);
    ctx.bezierCurveTo(2, 110, 4, 50, 32, 2);
    ctx.fill();
  });
  const flames = Array.from({ length: 5 }, (_, i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    s.center.set(0.5, 0.1);
    s.position.set(Math.cos(i * 1.26) * 0.12, 0.12, Math.sin(i * 1.26) * 0.12);
    g.add(s);
    return { s, ph: Math.random() * 6.28 };
  });
  const light = new THREE.PointLight(0xff8a3a, 0, 16, 2);
  light.position.set(0, 0.8, 0);
  g.add(light);
  // sparks rising from the flames
  const SP = 40;
  const sparkPos = new Float32Array(SP * 3);
  const sparks = Array.from({ length: SP }, () => ({ x: 0, y: -5, z: 0, vx: 0, vy: 0, vz: 0, life: Math.random() * 2 }));
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  const sparkPts = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ map: dotTexture, color: 0xffb050, size: 0.07, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  sparkPts.frustumCulled = false;
  g.add(sparkPts);
  return {
    pos: new THREE.Vector3(x, y + 0.7, z),
    flick: 1,
    update(dt, t) {
      const wd = windU.uWind.value, str = windU.uWindStr.value;
      this.flick = 1 + 0.25 * Math.sin(t * 13) * Math.sin(t * 7.3 + 1) + 0.1 * Math.sin(t * 29);
      for (const f of flames) {
        const k = 0.8 + 0.3 * Math.sin(t * 9 + f.ph) + 0.15 * Math.sin(t * 17 + f.ph * 2);
        f.s.scale.set(0.38 * (0.9 + 0.2 * Math.sin(t * 11 + f.ph)), 0.85 * k, 1);
        f.s.position.x += (Math.cos(f.ph) * 0.12 + wd.x * str * 0.15 - f.s.position.x) * 0.1;
        f.s.position.z += (Math.sin(f.ph) * 0.12 + wd.y * str * 0.15 - f.s.position.z) * 0.1;
      }
      light.intensity = (1.6 + 0.9 * (1 - lastEnv.light)) * this.flick;
      for (let i = 0; i < SP; i++) {
        const s = sparks[i];
        s.life -= dt;
        if (s.life <= 0) {
          s.life = rand(0.8, 2.2);
          s.x = rand(-0.2, 0.2);
          s.z = rand(-0.2, 0.2);
          s.y = 0.3;
          s.vx = rand(-0.3, 0.3);
          s.vy = rand(0.8, 1.8);
          s.vz = rand(-0.3, 0.3);
        }
        s.x += (s.vx + wd.x * str * 1.2) * dt;
        s.y += s.vy * dt;
        s.z += (s.vz + wd.y * str * 1.2) * dt;
        sparkPos.set(s.life > 0 ? [s.x, s.y, s.z] : [0, -5, 0], i * 3);
      }
      sparkGeo.attributes.position.needsUpdate = true;
    },
  };
})();

// ===== Lamps that light the water and the sand =====
function updateLamps(lampsOn) {
  const P = waterUniforms.uLampPos.value, C = waterUniforms.uLampColor.value;
  P[0].copy(fire.pos);
  C[0].set(1.0, 0.5, 0.18).multiplyScalar(1.3 * fire.flick * (0.5 + 0.5 * lampsOn));
  for (let i = 0; i < 2; i++) {
    P[1 + i].copy(garland.attach[i === 0 ? 1 : garland.attach.length - 2]).add(tmpV.set(0, -0.3, 0));
    C[1 + i].set(1.0, 0.2, 0.1).multiplyScalar(0.8 * lampsOn * opts.festival);
  }
  const near = lotuses.slice().sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
  for (let i = 3; i < MAX_LAMPS; i++) {
    const l = near[i - 3];
    P[i].set(l.x, l.y + 0.2, l.z);
    C[i].set(1.0, 0.55, 0.3).multiplyScalar(0.55 * lampsOn * l.fade * opts.festival);
  }
}

// ===== Controls =====
const DEAD = 0.15;
const keys = new Set();
let eTap = false;
addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "KeyE" && !e.repeat) eTap = true;
});
addEventListener("keyup", (e) => keys.delete(e.code));
{
  let drag = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (drag = { x: e.clientX, y: e.clientY }));
  addEventListener("pointerup", () => (drag = null));
  addEventListener("pointermove", (e) => {
    if (!drag || renderer.xr.isPresenting) return;
    if (controllerProp.holder === "screen") {
      // flying the drone: dragging turns it and tilts its camera
      drone.yaw -= (e.clientX - drag.x) * 0.005;
      drone.pitch = clamp(drone.pitch - (e.clientY - drag.y) * 0.004, -1.2, 0.4);
      drag.x = e.clientX;
      drag.y = e.clientY;
      return;
    }
    yaw -= (e.clientX - drag.x) * 0.005;
    pitch = clamp(pitch - (e.clientY - drag.y) * 0.005, -1.2, 1.2);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
}
const input = { x: 0, z: 0, turn: 0, roll: 0, pitch: 0 };
let runOn = false, stickWas = false; // click the left stick to switch running on and off
function readControls(dt) {
  input.x = input.z = input.turn = input.roll = input.pitch = 0;
  if (renderer.xr.isPresenting) {
    const L = handOf("left"), R = handOf("right");
    const la = L && L.gamepad ? L.gamepad.axes : [];
    const lx = la.length >= 4 ? la[2] : la[0] || 0;
    const ly = la.length >= 4 ? la[3] : la[1] || 0;
    const flyingDrone = !!controllerProp.holder || menu.open; // with the drone controller in hand, the sticks fly the drone instead
    if (Math.abs(lx) > DEAD && !flyingDrone) input.x = lx;
    if (Math.abs(ly) > DEAD && !flyingDrone) input.z = ly;
    const click = !!(L && L.gamepad && L.gamepad.buttons[3] && L.gamepad.buttons[3].pressed);
    if (click && !stickWas) {
      runOn = !runOn;
      buzz(L, 0.3, 40);
    }
    stickWas = click;
    const ra = R && R.gamepad ? R.gamepad.axes : [];
    const rx = ra.length >= 4 ? ra[2] : ra[0] || 0;
    if (Math.abs(rx) > DEAD && !flyingDrone) input.turn = rx;
    if (sp.on && !flyingDrone) { // in space the right stick rolls your view (sideways) and pitches it (forward = nose down) instead of turning
      const ry = ra.length >= 4 ? ra[3] : ra[1] || 0;
      input.roll = input.turn; input.turn = 0;
      if (Math.abs(ry) > DEAD) input.pitch = ry;
    }
    yaw -= input.turn * dt * 1.5; // smooth turning
  } else if (!controllerProp.holder && !menu.open) {
    if (keys.has("KeyW") || keys.has("ArrowUp")) input.z -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) input.z += 1;
    if (keys.has("KeyA")) input.x -= 1;
    if (keys.has("KeyD")) input.x += 1;
    if (keys.has("ArrowLeft")) yaw += dt * 1.6;
    if (keys.has("ArrowRight")) yaw -= dt * 1.6;
    if (sp.on) input.roll = (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0); // (E and Q roll in space; R and F pitch up and down)
    if (sp.on) input.pitch = (keys.has("KeyR") ? 1 : 0) - (keys.has("KeyF") ? 1 : 0);
  }
}

// ===== Walking, climbing, jumping and swimming =====
// player.y is where your feet are. On land you stand on the highest thing under you (sand, a rock, the dock, the boat's deck) and
// can step up about half a metre; to get onto something higher, jump. In water deeper than your chest you swim: you move the way
// you look (look down to dive, up to rise), and A kicks you up toward the surface.
const camFwd = new THREE.Vector3();
const camDir3 = new THREE.Vector3();
const tmpV = new THREE.Vector3();
let vigWant = 0;
let aWas = false;
const STEP_UP = 0.6;
const SWIM_ENTER = 1.35; // water this deep (above the floor) and you swim
const SWIM_EXIT = 1.05;
player.vy = 0;
player.fv = new THREE.Vector3(); // flying velocity
const flyDir = new THREE.Vector3(), flyQ = new THREE.Quaternion(), flyTmp = new THREE.Vector3();
// Flight, VRChat style: jump, then hold a trigger and you fly the way that controller points; let go and you fall.
function flightDirection() {
  flyDir.set(0, 0, 0);
  if (renderer.xr.isPresenting) {
    for (const h of hands) {
      if (!h.side || !trigDown(h) || props.some((q) => q.holder === h)) continue;
      h.ray.getWorldQuaternion(flyQ);
      flyDir.add(flyTmp.set(0, 0, -1).applyQuaternion(flyQ));
    }
  } else if (keys.has("Space") && !props.some((q) => q.holder)) flyDir.copy(camDir3);
  return flyDir.lengthSq() > 1e-4 ? flyDir.normalize() : null;
}
player.sv = new THREE.Vector3(); // swimming velocity from arm strokes
const strokePrev = [null, null];
const strokeV = new THREE.Vector3();
// Swimming with your arms: hold a trigger and sweep that hand through the water; the water pushes you the other way.
function armStrokes(dt) {
  let any = false;
  hands.forEach((h, i) => {
    const p = h.grip.position;
    const prev = strokePrev[i] || (strokePrev[i] = new THREE.Vector3().copy(p));
    strokeV.copy(p).sub(prev).divideScalar(Math.max(dt, 1e-3)); // the hand's velocity relative to your body
    prev.copy(p);
    if (!renderer.xr.isPresenting || !h.side || !trigDown(h) || props.some((q) => q.holder === h) || menu.open) return;
    const sp = strokeV.length();
    if (sp < 0.3) return;
    strokeV.applyQuaternion(rig.quaternion).multiplyScalar((-0.9 * Math.min(sp, 3)) / sp); // pushing the water back moves you forward
    player.sv.addScaledVector(strokeV, Math.min(1, dt * 6));
    any = true;
    buzz(h, Math.min(0.6, sp * 0.2), 20);
  });
  const m = player.sv.length();
  if (m > 3) player.sv.multiplyScalar(3 / m);
  player.sv.multiplyScalar(Math.exp(-dt * (any ? 0.8 : 1.3))); // the water slows you down between strokes
}
player.swim = false;
player.grounded = true;
player.under = false;
player.waterSm = 0;
const surfaceAt = (x, z) => {
  if (curBody) return bodyGroundY(x, z);
  // the highest thing you could stand on here
  let y = groundY(x, z);
  const r = rockSurfaceAt(x, z);
  if (r > y) y = r;
  const dh = dockHeightAt(x, z);
  if (dh !== null && dh > y) y = dh;
  const ps = poiSurfaceAt(x, z);
  if (ps > y) y = ps;
  const bh = boatDeckAt(x, z);
  if (typeof bh === "number" && bh > y) y = bh;
  return y;
};
function blocked(x, z) {
  if (curBody) return surfaceAt(x, z) - player.y > STEP_UP; // (the home world's walls and rocks are not here)
  if (boatDeckAt(x, z) === "cabin") return true;
  if (player.y < 150 && worldBoundsEdge(x, z) < 30) return true; // the edge of the world (you can fly over it)
  if (!player.swim && surfaceAt(x, z) - player.y > STEP_UP) return true; // too high to step up: jump
  for (const c of colliders) {
    if (c.hw !== undefined) {
      // a building: a (rotated) box, solid up to its roof, so you cannot walk or fly in through the sides
      if (player.y > c.top) continue;
      const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.rot), sn = Math.sin(c.rot);
      if (Math.abs(dx * cs - dz * sn) < c.hw + 0.35 && Math.abs(dx * sn + dz * cs) < c.hd + 0.35) return true;
    } else if (Math.hypot(x - c.x, z - c.z) < c.r + 0.3) return true;
  }
  return false;
}
function updatePlayer(dt) {
  readControls(dt);
  if (boatDrive.on) {
    boatDrive.throttle = clamp(-input.z, -1, 1);
    boatDrive.turn = clamp(-input.x, -1, 1);
    input.x = input.z = 0; // the stick steers the boat instead of walking
  }
  const t = shared.uTime.value;
  camera.getWorldDirection(camDir3);
  camFwd.copy(camDir3);
  camFwd.y = 0;
  if (camFwd.lengthSq() < 1e-4) camFwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  camFwd.normalize();
  const rightX = -camFwd.z, rightZ = camFwd.x;
  const mag = Math.hypot(input.x, input.z);
  const len = Math.min(1, mag);

  // how deep the water is under you, and the (smoothed) surface
  const floorY = surfaceAt(player.x, player.z);
  const surf = waveHeight(player.x, player.z, t);
  player.waterSm += (surf - player.waterSm) * (1 - Math.exp(-dt * 2.5));
  const depth = player.waterSm - floorY;
  if (!player.swim && depth > SWIM_ENTER && (player.grounded || player.y < surf - 0.3)) {
    player.swim = true;
    splash(player.x, surf, player.z, 14, 2.2);
  } else if (player.swim && depth < SWIM_EXIT) player.swim = false;

  // jump (A on the right controller, or Space on a screen when your hands are empty)
  const Rh = handOf("right");
  const aDown = !!(Rh && Rh.gamepad && Rh.gamepad.buttons[4] && Rh.gamepad.buttons[4].pressed);
  let jumpReq = aDown && !aWas;
  aWas = aDown;
  if (!renderer.xr.isPresenting && spaceTap && !props.some((p) => p.holder)) jumpReq = true;
  if (menu.open || boatDrive.on) jumpReq = false;

  // moving
  let mx = 0, mz = 0, my = 0;
  if (mag > 0) {
    const nx = input.x / mag, nz = input.z / mag;
    if (player.swim) {
      const sp = 1.9 * len;
      // forward is wherever you look (including up and down); sideways stays level
      mx = camDir3.x * -nz * sp + rightX * nx * sp * 0.65;
      mz = camDir3.z * -nz * sp + rightZ * nx * sp * 0.65;
      my = camDir3.y * -nz * sp;
    } else {
      const wade = 1 - 0.4 * clamp(depth / 1.2, 0, 1); // the water slows you
      const sp = (keys.has("ShiftLeft") || runOn ? 5 : 2.3) * len * wade;
      mx = (rightX * nx - camFwd.x * nz) * sp;
      mz = (rightZ * nx - camFwd.z * nz) * sp;
    }
  }
  let flying = false;
  if (opts.flight && !player.swim && !player.grounded && !menu.open) {
    const fd = flightDirection();
    if (fd) {
      flying = true;
      player.fv.lerp(flyTmp.copy(fd).multiplyScalar(player.y > 400000 ? 0 : Math.min(FLIGHT_SPEEDS[opts.flightSpd][1], 22 + 1.4 * Math.max(0, player.y - Math.max(0, surfaceAt(player.x, player.z))))), 1 - Math.exp(-dt * 3));
    }
  }
  if (!flying) {
    if (player.grounded || player.swim) player.fv.set(0, 0, 0);
    else player.fv.set(player.fv.x * Math.exp(-dt * 1.2), 0, player.fv.z * Math.exp(-dt * 1.2)); // carry on a little after you let go
  }
  if (!player.swim && !player.grounded) {
    mx += player.fv.x;
    mz += player.fv.z;
  }
  if (player.swim) {
    armStrokes(dt);
    mx += player.sv.x;
    mz += player.sv.z;
    my += player.sv.y * 0.8;
  } else player.sv.set(0, 0, 0);
  const dx = mx * dt, dz = mz * dt;
  // slide along walls, rocks and the edge of things instead of stopping dead
  if (!blocked(player.x + dx, player.z + dz)) (player.x += dx), (player.z += dz);
  else if (!blocked(player.x + dx, player.z)) player.x += dx;
  else if (!blocked(player.x, player.z + dz)) player.z += dz;

  // up and down
  const here = surfaceAt(player.x, player.z);
  if (player.swim) {
    // treading water: you ride the waves with just your eyes a hand's breadth above the surface, bobbing a little as they pass
    const eyeH = clamp(camera.position.y, 0.9, 2.1);
    const floatY = lerp(player.waterSm, surf, 0.85) - eyeH + 0.1 + 0.025 * Math.sin(t * 1.7 + player.x);
    let target = floatY;
    if (Math.abs(my) > 0.05) target = player.y + my * 0.6; // swimming up or down
    player.vy += (clamp((target - player.y) * 4, -2.5, 2.5) - player.vy) * (1 - Math.exp(-dt * 6));
    if (jumpReq) {
      if (player.y > floatY - 0.9) {
        // at the surface: spring out of the water, ready to fly (or fall back in)
        player.swim = false;
        player.y = Math.max(player.y, surf + 0.3);
        player.vy = 7;
      } else player.vy = 3; // a kick toward the surface
    }
    player.y += player.vy * dt;
    player.y = player.swim ? clamp(player.y, Math.max(here + 0.12, player.waterSm - 5), floatY + 0.25) : player.y; // (no diving deeper than a few metres)
    player.grounded = false;
  } else {
    if (jumpReq && player.grounded) {
      player.vy = 4.8; // about 1.2 m: enough to get onto a rock
      player.grounded = false;
    }
    if (flying) player.vy = player.fv.y;
    else {
      player.vy -= GRAV * dt;
      // let go and you do not drop like a stone: you float down, slower the nearer the ground (and never faster than a skydiver)
      player.vy = Math.max(player.vy, -Math.min(70, 2.5 + 0.9 * Math.max(0, player.y - here)));
    }
    let feet = player.y + player.vy * dt;
    // arriving fast over deep water: stop just under the surface and swim from there, never down to the seabed
    if (depth > SWIM_ENTER && player.vy < 0 && feet < player.waterSm - 1.2) {
      feet = Math.max(feet, player.waterSm - 1.2);
      player.vy = 0;
    }
    if (feet <= here + 0.001) {
      feet = here;
      player.vy = 0;
      player.grounded = true;
    } else if (player.grounded && feet - here < 0.35 && player.vy <= 0) {
      feet += (here - feet) * (1 - Math.exp(-dt * 25)); // follow the ground down a slope
      player.vy = 0;
    } else player.grounded = false;
    // stepping up onto something a little higher: a quick, smooth rise rather than a pop
    if (player.grounded && here > player.y && here - player.y < STEP_UP) feet = player.y + (here - player.y) * (1 - Math.exp(-dt * 18));
    player.y = feet;
  }
  {
    const dk = boatDeckAt(player.x, player.z);
    player.onBoat = typeof dk === "number" && player.y > dk - 0.5 && player.y < dk + 1.5;
  }
  rig.position.set(player.x, player.y, player.z);
  rig.rotation.y = yaw;
  if (!renderer.xr.isPresenting) camera.rotation.set(pitch, 0, 0, "YXZ");
  vigWant = renderer.xr.isPresenting ? Math.min(1, len * (runOn ? 0.7 : 0.4) + Math.abs(input.turn) * 0.5 + (flying ? 0.35 + 0.5 * Math.min(1, player.fv.length() / 300) : 0)) * 0.45 : 0;
}

// ===== Comfort: the edges of your view darken a little while you move or turn =====
const vigCanvas = document.createElement("canvas");
vigCanvas.width = vigCanvas.height = 256;
{
  const ctx = vigCanvas.getContext("2d");
  const gr = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
  gr.addColorStop(0, "rgba(0,0,0,0)");
  gr.addColorStop(0.55, "rgba(0,0,0,0)");
  gr.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 256, 256);
}
const vignette = new THREE.Mesh(
  new THREE.PlaneGeometry(0.75, 0.75),
  new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(vigCanvas), transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false })
);
vignette.position.z = -0.22;
vignette.renderOrder = 50;
vignette.visible = false;
camera.add(vignette);
// a quick fade from black after a teleport or a long jump, so arriving is never a hard cut
let screenFade = 0;
const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
fadeQuad.position.z = -0.15;
fadeQuad.renderOrder = 100;
fadeQuad.visible = false;
camera.add(fadeQuad);

function buzz(h, strength = 0.5, ms = 50) {
  try {
    const a = h && h.gamepad && h.gamepad.hapticActuators && h.gamepad.hapticActuators[0];
    if (a) a.pulse(strength, ms);
  } catch (e) {}
}

// ===== Marks in the sand: footprints, and lines drawn with a stick =====
// Marks are stamped into the wrapping texture the sand shader reads (see impRT). Each stamp is a small quad drawn
// with MAX blending, so overlapping marks only ever get deeper. Every fifth of a second a pass wears the texture
// down: the swash wipes anything it reaches, rain and wind slowly smooth the rest, and a band at the texture's seam
// is cleared so old marks never wrap round into view.
const impScene = new THREE.Scene();
const impCam = new THREE.OrthographicCamera(0, IMP_S, IMP_S, 0, -1, 1);
const impBlend = { depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
const footMat = new THREE.ShaderMaterial(
  Object.assign(
    {
      vertexShader: "varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        float ell(vec2 p, vec2 c, vec2 r) { return 1.0 - smoothstep(0.6, 1.0, length((p - c) / r)); }
        void main() {
          vec2 p = (vUv - 0.5) * vec2(0.3, 0.4); // metres, toes toward +y
          float heel = ell(p, vec2(0.0, -0.125), vec2(0.038, 0.048));
          float arch = ell(p, vec2(0.014, -0.03), vec2(0.03, 0.07)) * 0.4;
          float ball = ell(p, vec2(-0.004, 0.065), vec2(0.05, 0.065));
          float toes = 0.0;
          toes = max(toes, ell(p, vec2(-0.032, 0.16), vec2(0.016, 0.019)));
          toes = max(toes, ell(p, vec2(-0.010, 0.17), vec2(0.011, 0.016)));
          toes = max(toes, ell(p, vec2(0.009, 0.165), vec2(0.0105, 0.015)));
          toes = max(toes, ell(p, vec2(0.026, 0.155), vec2(0.0095, 0.014)));
          toes = max(toes, ell(p, vec2(0.040, 0.14), vec2(0.008, 0.012)));
          float v = max(max(heel * 0.9, ball), max(arch, toes * 0.85));
          gl_FragColor = vec4(v, v, v, 1.0);
        }
      `,
    },
    impBlend
  )
);
const lineMat = new THREE.ShaderMaterial(
  Object.assign(
    {
      vertexShader: "varying vec2 vUv;\nvarying vec2 vSize;\nvoid main() { vUv = uv; vSize = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz)); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }",
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec2 vSize;
        void main() {
          vec2 p = (vUv - 0.5) * vSize;
          float halfW = vSize.y * 0.5;
          vec2 h = vec2(max(vSize.x * 0.5 - halfW, 0.0), 0.0);
          float d = length(p - clamp(p, -h, h)) / halfW; // 0 on the line's spine, 1 at its edge
          float v = 0.85 * (1.0 - smoothstep(0.45, 1.0, d));
          gl_FragColor = vec4(v, v, v, 1.0);
        }
      `,
    },
    impBlend
  )
);
const erodeUniforms = { uIslA: shared.uIslA, uIslB: shared.uIslB, uIslC: shared.uIslC, uIslBase: shared.uIslBase, uIslRowI: shared.uIslRowI, uIslRowO: shared.uIslRowO, uPlayer: { value: new THREE.Vector2() }, uTime: shared.uTime, uRate: { value: 0 } };
const erodeMat = new THREE.ShaderMaterial({
  uniforms: erodeUniforms,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.ReverseSubtractEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  vertexShader: "varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: /* glsl */ `
    ${NOISE_GLSL}
    ${SHORE_GLSL}
    const float IMP_S = ${IMP_S.toFixed(1)};
    uniform vec2 uPlayer;
    uniform float uTime;
    uniform float uRate;
    varying vec2 vUv;
    void main() {
      vec2 delta = fract(vUv - uPlayer / IMP_S + 0.5) - 0.5; // this texel, relative to the player
      vec2 w = uPlayer + delta * IMP_S;
      float seam = step(IMP_S * 0.5 - 1.6, max(abs(delta.x), abs(delta.y)) * IMP_S);
      float y = bedHeight(w);
      float tide = swashLevel(w, uTime);
      float washed = 1.0 - smoothstep(tide - 0.03, tide + 0.05, y);
      float slow = step(hash(vUv * 977.0 + uTime), uRate * 255.0) / 255.0; // dithered, as the texture is 8-bit
      float a = max(seam, washed) + slow;
      gl_FragColor = vec4(a, a, a, 0.0);
    }
  `,
});
const erodeQuad = new THREE.Mesh(new THREE.PlaneGeometry(IMP_S, IMP_S).translate(IMP_S / 2, IMP_S / 2, 0), erodeMat);
erodeQuad.renderOrder = -1;
erodeQuad.visible = false;
impScene.add(erodeQuad);
const footGeo = new THREE.PlaneGeometry(0.3, 0.4);
const segGeo = new THREE.PlaneGeometry(1, 1);
const footPool = Array.from({ length: 24 }, () => {
  const m = new THREE.Mesh(footGeo, footMat);
  m.visible = false;
  impScene.add(m);
  return m;
});
const segPool = Array.from({ length: 220 }, () => {
  const m = new THREE.Mesh(segGeo, lineMat);
  m.visible = false;
  impScene.add(m);
  return m;
});
const stamps = [];
const wrapS = (v) => ((v % IMP_S) + IMP_S) % IMP_S;
function stampFoot(x, z, hx, hz, left) {
  stamps.push({ foot: true, x, z, hx, hz, left });
}
function stampSeg(x0, z0, x1, z1, w) {
  stamps.push({ foot: false, x0, z0, x1, z1, w });
}
let footUsed = 0, segUsed = 0;
function placeCopies(pool, used, cx, cz, rad, setup) {
  const px = wrapS(cx), pz = wrapS(cz);
  for (const ox of [-IMP_S, 0, IMP_S])
    for (const oz of [-IMP_S, 0, IMP_S]) {
      const X = px + ox, Z = pz + oz;
      if (X < -rad || X > IMP_S + rad || Z < -rad || Z > IMP_S + rad) continue;
      if (used >= pool.length) return used;
      const m = pool[used++];
      m.visible = true;
      setup(m, X, Z);
    }
  return used;
}
let impTimer = 0, impReady = false, lastFoot = null, footSide = 1;
function withImprintTarget(fn) {
  const xr = renderer.xr.enabled, ac = renderer.autoClear;
  renderer.xr.enabled = false;
  renderer.autoClear = false;
  renderer.setRenderTarget(impRT);
  try { fn(); } finally {
    renderer.setRenderTarget(null);
    renderer.autoClear = ac;
    renderer.xr.enabled = xr;
  }
}
function setImprintRes(n) {
  if (n === IMP_N) return;
  IMP_N = n;
  impRT.dispose();
  impRT = makeImpRT(n);
  landUniforms.uImprint.value = impRT.texture;
  landUniforms.uImpN.value = n;
  impReady = false; // cleared on the next frame
  stamps.length = 0;
  lastFoot = null;
}
function clearImprint() {
  impReady = false;
  stamps.length = 0;
}
function trackFeet() {
  if (player.swim || !player.grounded) return void (lastFoot = null);
  const x = camPos.x, z = camPos.z;
  if (!lastFoot) return void (lastFoot = { x, z });
  const dx = x - lastFoot.x, dz = z - lastFoot.z, d = Math.hypot(dx, dz);
  if (d > 0.62) {
    const hx = dx / d, hz = dz / d;
    stampFoot(x - hz * 0.085 * footSide, z + hx * 0.085 * footSide, hx, hz, footSide < 0);
    footSide = -footSide;
    lastFoot = { x, z };
  }
}
function updateImprint(dt) {
  landUniforms.uImpPlayer.value.set(camPos.x, camPos.z);
  trackFeet();
  impTimer -= dt;
  const erode = impTimer <= 0;
  if (!impReady) {
    withImprintTarget(() => {
      const oc = new THREE.Color();
      renderer.getClearColor(oc);
      const oa = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.setClearColor(oc, oa);
    });
    impReady = true;
  }
  if (!erode && !stamps.length) return;
  erodeQuad.visible = erode;
  if (erode) {
    impTimer = 0.2;
    erodeUniforms.uPlayer.value.set(camPos.x, camPos.z);
    erodeUniforms.uRate.value = 0.0008 + 0.006 * wx.rain;
  }
  footUsed = segUsed = 0;
  for (const s of stamps) {
    if (s.foot) {
      footUsed = placeCopies(footPool, footUsed, s.x, s.z, 0.35, (m, X, Z) => {
        m.position.set(X, Z, 0);
        m.rotation.set(0, 0, Math.atan2(-s.hx, s.hz));
        m.scale.set(s.left ? -1 : 1, 1, 1);
      });
    } else {
      const dx = s.x1 - s.x0, dz = s.z1 - s.z0, len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      segUsed = placeCopies(segPool, segUsed, (s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2, len / 2 + s.w, (m, X, Z) => {
        m.position.set(X, Z, 0);
        m.rotation.set(0, 0, Math.atan2(dz, dx));
        m.scale.set(len + s.w, s.w, 1);
      });
    }
  }
  stamps.length = 0;
  for (let i = footUsed; i < footPool.length; i++) footPool[i].visible = false;
  for (let i = segUsed; i < segPool.length; i++) segPool[i].visible = false;
  withImprintTarget(() => renderer.render(impScene, impCam));
  erodeQuad.visible = false;
}

// ===== Things you can pick up: the drawing stick, fireworks, and the drone controller =====
// In VR, squeeze a grip near one to take it (let go to put it down). On a screen, E picks up the nearest or
// puts it down. Each prop has a hold() (how it sits in your hand), rest() (lying where it was dropped) and tick().
const props = [];
const gripDown = (h) => !!(h && h.gamepad && h.gamepad.buttons[1] && h.gamepad.buttons[1].pressed);
const trigDown = (h) => !!(h && h.gamepad && h.gamepad.buttons[0] && h.gamepad.buttons[0].pressed);
const stickOf = (h) => {
  const a = h && h.gamepad ? h.gamepad.axes : [];
  return a.length >= 4 ? [a[2], a[3]] : [a[0] || 0, a[1] || 0];
};
const _sT = new THREE.Vector3();
const _sC = new THREE.Vector3();
const _sD = new THREE.Vector3();
const _sQ = new THREE.Quaternion();
const makeProp = (o) => {
  const p = Object.assign({ holder: null }, o);
  props.push(p);
  return p;
};
let spaceTap = false;
addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.repeat) spaceTap = true;
});
const fwd3 = (obj, out) => out.set(0, 1, 0).applyQuaternion(obj.getWorldQuaternion(_sQ)); // an object's +y, in the world
// Spots near where you start, so everything is within a few steps: f metres ahead of you, r to the right
const startFwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
const spot = (f, r) => {
  return [player.x + startFwd.x * f + Math.cos(yaw) * r, player.z + startFwd.z * f - Math.sin(yaw) * r];
};

// ===== The drawing stick =====
const stick = (() => {
  const group = new THREE.Group();
  const bodyGeo = new THREE.CylinderGeometry(0.02, 0.011, 1.15, 8, 10);
  const bp = bodyGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i);
    const f = 1 + 0.25 * (jnoise(bp.getX(i) * 9, y * 4, bp.getZ(i) * 9) - 0.5);
    bp.setXYZ(i, bp.getX(i) * f + Math.sin(y * 3.1) * 0.012, y, bp.getZ(i) * f);
  }
  bodyGeo.computeVertexNormals();
  const barkMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.9 });
  const body = new THREE.Mesh(
    mergeGeos([
      { g: bodyGeo },
      { g: new THREE.CylinderGeometry(0.005, 0.01, 0.2, 6).translate(0, 0.1, 0).rotateZ(0.7).translate(0.01, 0.15, 0) },
      { g: new THREE.CylinderGeometry(0.004, 0.008, 0.14, 6).translate(0, 0.07, 0).rotateZ(-0.8).translate(-0.01, -0.1, 0) },
    ]),
    barkMat
  );
  group.add(body);
  const tip = new THREE.Object3D();
  tip.position.set(0, -0.575, 0);
  body.add(tip);
  scene.add(group);
  const s = makeProp({ name: "stick", group, body, tip, lastTip: null });
  s.rest = (x, z, yawR) => {
    scene.add(group);
    group.position.set(x, Math.max(groundY(x, z), 0.1) + 0.022, z);
    group.rotation.set(0, yawR, 0);
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, Math.PI / 2 - 0.04);
    s.holder = null;
    s.lastTip = null;
  };
  s.hold = (parent, screen) => {
    parent.add(group);
    // the grip is 30 cm from the thick end; the thin end points forward and down
    group.position.set(screen ? 0.3 : 0, screen ? -0.34 : 0, screen ? -0.25 : 0);
    group.rotation.set(Math.PI / 2 - (screen ? 0.55 : 0.5), 0, 0);
    body.position.set(0, -0.275, 0);
    body.rotation.set(0, 0, 0);
  };
  s.drop = (x, z) => s.rest(x, z, rand(0, 6.28));
  s.tick = () => {
    const aimRing = s.aimRing;
    if (aimRing) aimRing.visible = false;
    if (!s.holder) return;
    if (s.holder !== "screen") {
      s.tip.getWorldPosition(_sT);
      const g = groundY(_sT.x, _sT.z);
      const touching = g > -0.05 && _sT.y < g + 0.03 && _sT.y > g - 0.4;
      if (touching && !s.lastTip) buzz(s.holder, 0.25, 30);
      drawAt(_sT.x, _sT.y, _sT.z, touching);
      return;
    }
    camera.getWorldDirection(_sD);
    let hit = null;
    for (let t = 0.4; t < 7; t += 0.05) {
      const x = camPos.x + _sD.x * t, y = camPos.y + _sD.y * t, z = camPos.z + _sD.z * t;
      if (y < groundY(x, z)) { hit = { x, y, z }; break; }
    }
    if (hit && groundY(hit.x, hit.z) > -0.05) {
      aimRing.visible = true;
      aimRing.position.set(hit.x, groundY(hit.x, hit.z) + 0.02, hit.z);
      drawAt(hit.x, hit.y, hit.z, keys.has("Space"));
    } else s.lastTip = null;
  };
  return s;
})();
{
  const [x, z] = [ISL.x + Math.cos(Math.PI / 2 - 0.03) * (ISL.r - 7), ISL.z + Math.sin(Math.PI / 2 - 0.03) * (ISL.r - 7)];
  stick.rest(x, z, 0.5);
}
const aimRing = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.06, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false }));
aimRing.renderOrder = 20;
aimRing.visible = false;
scene.add(aimRing);
stick.aimRing = aimRing;
function drawAt(x, y, z, touching) {
  if (touching) {
    if (stick.lastTip) {
      const dx = x - stick.lastTip.x, dz = z - stick.lastTip.z;
      if (Math.hypot(dx, dz) > 0.004 && Math.hypot(dx, dz) < 3) stampSeg(stick.lastTip.x, stick.lastTip.z, x, z, 0.045);
    }
    stick.lastTip = { x, z };
  } else stick.lastTip = null;
}

// ===== Fireworks (from Coastline): five kinds of shell, with a whistle on the way up and a boom that arrives late =====
const FW_N = 3000;
const fwPos = new Float32Array(FW_N * 3).fill(-9999);
const fwCol = new Float32Array(FW_N * 3);
const fwVel = new Float32Array(FW_N * 3);
const fwBase = new Float32Array(FW_N * 3);
const fwLife = new Float32Array(FW_N);
const fwMax = new Float32Array(FW_N);
const fwDrag = new Float32Array(FW_N);
const fwGrav = new Float32Array(FW_N);
const fwStrobe = new Uint8Array(FW_N);
let fwNext = 0;
const fwGeo = new THREE.BufferGeometry();
fwGeo.setAttribute("position", new THREE.BufferAttribute(fwPos, 3));
fwGeo.setAttribute("aCol", new THREE.BufferAttribute(fwCol, 3));
// (round, soft sparks sized in world units; the pixel size is worked out from the real viewport so it is right in a headset too)
const fwUniforms = { uVH: { value: 600 }, uSize: { value: 1.3 } };
const fwPoints = new THREE.Points(
  fwGeo,
  new THREE.ShaderMaterial({
    uniforms: fwUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aCol;
      uniform float uVH;
      uniform float uSize;
      varying vec3 vC;
      void main() {
        vC = aCol;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * projectionMatrix[1][1] * uVH * 0.5 / max(-mv.z, 0.1), 1.0, 80.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = 1.0 - smoothstep(0.05, 0.5, d);
        gl_FragColor = vec4(vC, a);
      }
    `,
  })
);
fwPoints.frustumCulled = false;
fwPoints.renderOrder = 3;
scene.add(fwPoints);
const fwFlash = new THREE.PointLight(0xffffff, 0, 600, 1.5);
scene.add(fwFlash);
const FW_PALETTES = [
  [[1, 0.25, 0.2], [1, 0.8, 0.4]],
  [[0.3, 0.6, 1], [0.9, 0.95, 1]],
  [[0.4, 1, 0.45], [1, 1, 0.6]],
  [[1, 0.45, 0.9], [0.6, 0.4, 1]],
  [[1, 0.75, 0.3], [1, 0.95, 0.75]],
];
const FW_KINDS = ["peony", "peony", "willow", "ring", "crackle", "double"];
const rockets = [];
function spark(x, y, z, vx, vy, vz, c, life, drag, grav, strobe = 0) {
  const i = fwNext;
  fwNext = (fwNext + 1) % FW_N;
  fwPos[i * 3] = x;
  fwPos[i * 3 + 1] = y;
  fwPos[i * 3 + 2] = z;
  fwVel[i * 3] = vx;
  fwVel[i * 3 + 1] = vy;
  fwVel[i * 3 + 2] = vz;
  fwBase[i * 3] = c[0];
  fwBase[i * 3 + 1] = c[1];
  fwBase[i * 3 + 2] = c[2];
  fwLife[i] = fwMax[i] = life;
  fwDrag[i] = drag;
  fwGrav[i] = grav;
  fwStrobe[i] = strobe;
}
function explode(r) {
  const [c1, c2] = r.pal;
  const sphere = (n, speed, col, life, drag, grav, strobe) => {
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const v = speed * rand(0.85, 1.1);
      spark(r.x, r.y, r.z, Math.cos(a) * s * v + r.vx * 0.3, u * v + r.vy * 0.2, Math.sin(a) * s * v + r.vz * 0.3, Math.random() < 0.8 ? col : c2, life * rand(0.8, 1.15), drag, grav, strobe);
    }
  };
  if (r.kind === "peony") sphere(160, 24, c1, 2.2, 1.3, 4);
  if (r.kind === "willow") sphere(140, 15, [1, 0.72, 0.32], 3.8, 1.6, 7);
  if (r.kind === "crackle") sphere(120, 20, [1, 0.95, 0.85], 1.7, 1.2, 4, 1);
  if (r.kind === "double") {
    sphere(130, 25, c1, 2.1, 1.3, 4);
    sphere(70, 12, c2, 1.8, 1.3, 4);
  }
  if (r.kind === "ring") {
    // A flat ring at a random tilt
    const ax = rand(-0.8, 0.8);
    for (let k = 0; k < 110; k++) {
      const a = (k / 110) * Math.PI * 2;
      const v = 23;
      const x = Math.cos(a) * v;
      const z = Math.sin(a) * v;
      spark(r.x, r.y, r.z, x, z * Math.sin(ax), z * Math.cos(ax), k % 2 ? c1 : c2, 2.2, 1.2, 3);
    }
    sphere(40, 6, c2, 1.5, 1.4, 4);
  }
  fwFlash.position.set(r.x, r.y, r.z);
  fwFlash.color.setRGB(c1[0], c1[1], c1[2]);
  fwFlash.intensity = 5;
  audio.fwBoom(Math.hypot(r.x - camPos.x, r.y - camPos.y, r.z - camPos.z), r.kind === "crackle" || r.kind === "willow");
}
function updateFireworks(dt) {
  const vh = renderer.xr.isPresenting && renderer.xr.getSession() && renderer.xr.getSession().renderState.baseLayer ? renderer.xr.getSession().renderState.baseLayer.framebufferHeight : renderer.domElement.height;
  fwUniforms.uVH.value = vh;
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.vy -= 9.8 * 0.35 * dt;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    r.z += r.vz * dt;
    r.t -= dt;
    // A short golden trail of sparks behind the rising shell
    for (let k = 0; k < 3; k++) spark(r.x, r.y, r.z, rand(-1, 1), rand(-3, -1), rand(-1, 1), [1, 0.7, 0.35], rand(0.3, 0.6), 2, 2);
    if (r.t <= 0) {
      explode(r);
      rockets.splice(i, 1);
    }
  }
  fwFlash.intensity = Math.max(0, fwFlash.intensity - dt * 9);
  let any = false;
  for (let i = 0; i < FW_N; i++) {
    if (fwLife[i] <= 0) continue;
    any = true;
    fwLife[i] -= dt;
    if (fwLife[i] <= 0) {
      fwPos[i * 3 + 1] = -9999;
      continue;
    }
    const k = Math.exp(-fwDrag[i] * dt);
    fwVel[i * 3] *= k;
    fwVel[i * 3 + 1] = fwVel[i * 3 + 1] * k - fwGrav[i] * dt;
    fwVel[i * 3 + 2] *= k;
    fwPos[i * 3] += fwVel[i * 3] * dt;
    fwPos[i * 3 + 1] += fwVel[i * 3 + 1] * dt;
    fwPos[i * 3 + 2] += fwVel[i * 3 + 2] * dt;
    let b = Math.pow(fwLife[i] / fwMax[i], 0.6);
    if (fwStrobe[i]) b *= Math.random() < 0.5 ? 1.6 : 0.1;
    fwCol[i * 3] = fwBase[i * 3] * b;
    fwCol[i * 3 + 1] = fwBase[i * 3 + 1] * b;
    fwCol[i * 3 + 2] = fwBase[i * 3 + 2] * b;
  }
  if (any || rockets.length) {
    fwGeo.attributes.position.needsUpdate = true;
    fwGeo.attributes.aCol.needsUpdate = true;
  }
}

// The crate of rockets. Take one, light it (trigger, or touch its fuse to the campfire) and it shoots up from your
// hand; set it down and it plants itself upright in the sand and flies straight up.
const fwCrate = (() => {
  const [cx, cz] = spot(2.4, -0.6);
  const cy = groundY(cx, cz);
  const g = new THREE.Group();
  g.position.set(cx, cy, cz);
  g.rotation.y = yaw;
  const wood = new THREE.MeshStandardMaterial({ map: driftTex, roughness: 0.9 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.3, 0.55), wood).translateY(0.15));
  const inner = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, 0.45), new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 1 }));
  inner.position.y = 0.3;
  g.add(inner);
  scene.add(g);
  colliders.push({ x: cx, z: cz, r: 0.6 });
  return { g, x: cx, y: cy, z: cz };
})();
function makeFirework(slotIndex) {
  const group = new THREE.Group();
  const kindIdx = Math.floor(Math.random() * FW_KINDS.length);
  const pal = FW_PALETTES[Math.floor(Math.random() * FW_PALETTES.length)];
  const col = new THREE.Color(pal[0][0], pal[0][1], pal[0][2]);
  const wrap = pixTex(64, 64, (u, v) => {
    const band = Math.sin(v * 6.283 * 4) > 0.55 ? 1 : 0;
    const k = 0.85 + 0.2 * jnoise(u * 8, v * 8, 4);
    return band ? [1.0, 0.92, 0.7] : [col.r * k, col.g * k, col.b * k];
  });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 12), new THREE.MeshStandardMaterial({ map: wrap, roughness: 0.7 }));
  tube.position.y = 0.27;
  group.add(tube);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.1, 12), new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.8), roughness: 0.6 }));
  nose.position.y = 0.49;
  group.add(nose);
  const guide = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.55, 6), new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.9 }));
  guide.position.y = -0.175;
  group.add(guide);
  for (let k = 0; k < 3; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.09, 0.06), new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.7), side: THREE.DoubleSide }));
    fin.position.set(0, 0.16, 0);
    fin.rotation.y = (k / 3) * Math.PI;
    fin.translateZ(0.04);
    group.add(fin);
  }
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 5), new THREE.MeshStandardMaterial({ color: 0x4a2f1c }));
  fuse.position.set(0.034, 0.13, 0);
  fuse.rotation.z = -0.5;
  group.add(fuse);
  const fuseTip = new THREE.Object3D();
  fuseTip.position.set(0.058, 0.165, 0);
  group.add(fuseTip);
  const fuseGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture, color: 0xffb050, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  fuseGlow.position.copy(fuseTip.position);
  fuseGlow.scale.setScalar(0.001);
  group.add(fuseGlow);
  scene.add(group);

  const p = makeProp({ name: "firework", group, body: tube, kind: FW_KINDS[kindIdx], pal, state: "ready", timer: 0, respawn: 0, planted: false, trigWas: false });
  const slotPos = () => {
    const ix = slotIndex % 3, iz = Math.floor(slotIndex / 3);
    const lx = (ix - 1) * 0.28, lz = (iz - 0.5) * 0.24;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [fwCrate.x + lx * c + lz * s, fwCrate.z - lx * s + lz * c];
  };
  p.reset = () => {
    p.kind = FW_KINDS[Math.floor(Math.random() * FW_KINDS.length)];
    p.pal = FW_PALETTES[Math.floor(Math.random() * FW_PALETTES.length)];
    p.state = "ready";
    p.planted = false;
    p.holder = null;
    scene.add(group);
    const [x, z] = slotPos();
    group.position.set(x, fwCrate.y + 0.3 + 0.4, z);
    group.rotation.set(0, rand(0, 6.28), 0);
    group.visible = true;
    fuseGlow.scale.setScalar(0.001);
  };
  p.hold = (parent, screen) => {
    parent.add(group);
    p.planted = false;
    group.position.set(screen ? 0.3 : 0, screen ? -0.3 : 0, screen ? -0.45 : 0);
    group.rotation.set(-(Math.PI / 2 - (screen ? 0.9 : 0.7)), 0, 0); // pointing forward and up
  };
  p.rest = (x, z) => {
    // planted upright in the sand, ready to fly straight up
    scene.add(group);
    group.position.set(x, groundY(x, z) + 0.32, z);
    group.rotation.set(0, rand(0, 6.28), 0);
    p.planted = true;
    p.holder = null;
  };
  p.drop = (x, z) => p.rest(x, z);
  const ignite = () => {
    if (p.state !== "ready") return;
    p.state = "lit";
    p.timer = 1.5;
    audio.fwLaunch();
    if (p.holder && p.holder !== "screen") buzz(p.holder, 0.5, 120);
  };
  p.tick = (dt) => {
    if (!group.visible) {
      p.respawn -= dt;
      if (p.respawn <= 0) p.reset();
      return;
    }
    fuseTip.getWorldPosition(_sT);
    if (p.state === "ready") {
      let go = false;
      if (p.holder && p.holder !== "screen") {
        const d = trigDown(p.holder);
        go = d && !p.trigWas;
        p.trigWas = d;
      } else if (p.holder === "screen" && spaceTap) {
        go = true;
        spaceTap = false;
      }
      // touching the fuse to the campfire lights it
      if (!go && p.holder && Math.hypot(_sT.x - fire.pos.x, _sT.z - fire.pos.z) < 0.5 && Math.abs(_sT.y - fire.pos.y) < 1.1) go = true;
      if (go) ignite();
      return;
    }
    // lit: the fuse fizzes, then it flies
    p.timer -= dt;
    fuseGlow.scale.setScalar(0.12 + 0.1 * Math.random());
    for (let k = 0; k < 2; k++) spark(_sT.x, _sT.y, _sT.z, rand(-1.2, 1.2), rand(0.5, 2), rand(-1.2, 1.2), [1, 0.8, 0.4], rand(0.15, 0.35), 3, 6);
    if (p.timer > 0) return;
    // launch along the tube, but never lower than about 55 degrees
    if (p.holder === "screen") camera.getWorldDirection(_sD);
    else if (p.holder) fwd3(group, _sD);
    else _sD.set(rand(-0.08, 0.08), 1, rand(-0.08, 0.08));
    _sD.normalize();
    if (_sD.y < 0.82) {
      const h = Math.hypot(_sD.x, _sD.z) || 1;
      _sD.set((_sD.x / h) * 0.57, 0.82, (_sD.z / h) * 0.57);
    }
    rockets.push({ x: _sT.x, y: _sT.y, z: _sT.z, vx: _sD.x * 38, vy: Math.max(_sD.y * 38, 28), vz: _sD.z * 38, t: rand(1.9, 2.3), kind: p.kind, pal: p.pal });
    audio.fwLaunch();
    p.holder = null;
    group.visible = false;
    p.respawn = 10;
    p.state = "ready";
  };
  p.reset();
  group.position.y = fwCrate.y + 0.3 + 0.4;
  return p;
}
const fireworks = Array.from({ length: 6 }, (_, i) => makeFirework(i));

// ===== The drone (Coastline's camera drone): a model, a landing pad and a hand controller with a live camera screen =====
const DRONE_RANGE = 200; // metres from you, in any direction
const DRONE_BATTERY = 180; // seconds of flight
const drone = { idle: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: -0.2, mode: "landed", battery: DRONE_BATTERY, padX: 0, padY: 0, padZ: 0, spin: 0, warned: false, msg: "" };
const droneCam = new THREE.PerspectiveCamera(65, 320 / 192, 0.25, 6000);
const droneGroup = new THREE.Group();
const droneRotors = [];
const droneLeds = [];
{
  const body = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.4, metalness: 0.3 });
  const shell = new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.35 });
  droneGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.34), shell));
  droneGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.26), body).translateY(-0.05));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.045), body);
    arm.position.set(sx * 0.2, 0.0, sz * 0.2);
    arm.rotation.y = -sx * sz * Math.PI / 4;
    droneGroup.add(arm);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.05, 10), body);
    motor.position.set(sx * 0.33, 0.02, sz * 0.33);
    droneGroup.add(motor);
    const rotor = new THREE.Group();
    rotor.position.set(sx * 0.33, 0.06, sz * 0.33);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.006, 0.03), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 }));
    rotor.add(blade);
    const blur = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9aa4ae, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    rotor.add(blur);
    rotor.userData.blur = blur;
    droneGroup.add(rotor);
    droneRotors.push(rotor);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 5), body);
    leg.position.set(sx * 0.12, -0.1, sz * 0.14);
    droneGroup.add(leg);
  }
  // camera gimbal under the nose
  const gim = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), body);
  gim.position.set(0, -0.08, -0.16);
  droneGroup.add(gim);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10), new THREE.MeshStandardMaterial({ color: 0x0a1018, roughness: 0.1, metalness: 0.7 }));
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, -0.08, -0.21);
  droneGroup.add(lens);
  // navigation LEDs: red on the left, green on the right, a white strobe at the back
  for (const [x, z, c] of [[-0.3, -0.3, 0xff2a2a], [0.3, -0.3, 0x2aff5a], [0, 0.2, 0xffffff]]) {
    const mat = new THREE.MeshBasicMaterial({ color: c, fog: false });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), mat);
    led.position.set(x, 0.0, z);
    droneGroup.add(led);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.position.copy(led.position);
    glow.scale.setScalar(0.35);
    droneGroup.add(glow);
    droneLeds.push({ glow, strobe: c === 0xffffff });
  }
  droneGroup.scale.setScalar(1.5);
  scene.add(droneGroup);
}
const dronePad = (() => {
  const [px, pz] = spot(3.2, 2.4);
  const py = groundY(px, pz);
  const tex = canvasTex(128, 128, (ctx, W, H) => {
    ctx.fillStyle = "#2b2f33";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#f2c230";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 6, 0, 6.283);
    ctx.stroke();
    ctx.fillStyle = "#f2f2f2";
    ctx.font = "bold 70px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("H", W / 2, H / 2 + 4);
  });
  const pad = new THREE.Mesh(new THREE.CircleGeometry(0.85, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  pad.position.set(px, py + 0.02, pz);
  scene.add(pad);
  // a small table beside it for the controller
  const [tx, tz] = spot(3.2, 3.6);
  const ty = groundY(tx, tz);
  const table = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 0.45), new THREE.MeshStandardMaterial({ map: driftTex, roughness: 0.9 }));
  table.position.set(tx, ty + 0.27, tz);
  scene.add(table);
  colliders.push({ x: tx, z: tz, r: 0.45 });
  drone.padX = px;
  drone.padZ = pz;
  drone.padY = py + 0.02;
  drone.x = px;
  drone.z = pz;
  drone.y = py + 0.02 + 0.13 * 1.5 + 0.1;
  drone.yaw = yaw;
  return { x: px, z: pz, tableX: tx, tableZ: tz, tableTop: ty + 0.55 };
})();

// The controller: a gamepad with a phone-sized screen showing what the drone sees
const FPV_W = 320, FPV_H = 192;
const fpvRT = new THREE.WebGLRenderTarget(FPV_W, FPV_H);
const hudCanvas = document.createElement("canvas");
hudCanvas.width = 256;
hudCanvas.height = 54;
const hudTex = new THREE.CanvasTexture(hudCanvas);
const controllerProp = (() => {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.5, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.1), dark);
  group.add(body);
  for (const sx of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.11), dark);
    grip.position.set(sx * 0.1, -0.012, 0.012);
    group.add(grip);
    const stk = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 8), new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.4 }));
    stk.position.set(sx * 0.07, 0.034, 0.025);
    group.add(stk);
  }
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.115, 0.05).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: fpvRT.texture, toneMapped: false }));
  screen.position.set(0, 0.0215, -0.019);
  group.add(screen);
  const hud = new THREE.Mesh(new THREE.PlaneGeometry(0.115, 0.024).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: hudTex, toneMapped: false }));
  hud.position.set(0, 0.0222, 0.0325); // (below the picture, with a gap: it never lies over the screen)
  group.add(hud);
  scene.add(group);
  const p = makeProp({ name: "controller", group, body, trigWas: false, hudT: 0, frame: 0 });
  p.rest = (x, z, yawR) => {
    scene.add(group);
    group.scale.setScalar(1);
    const onTable = Math.hypot(x - dronePad.tableX, z - dronePad.tableZ) < 0.5;
    group.position.set(x, onTable ? dronePad.tableTop + 0.022 : Math.max(groundY(x, z), 0.1) + 0.022, z);
    group.rotation.set(0, yawR, 0);
    p.holder = null;
  };
  p.hold = (parent, screenMode) => {
    parent.add(group);
    group.scale.setScalar(screenMode ? 1 : 1.8); // in VR it takes the place of your hand, large enough to read the screen
    group.position.set(screenMode ? 0.18 : 0, screenMode ? -0.2 : 0.02, screenMode ? -0.42 : -0.04);
    group.rotation.set(screenMode ? 0.55 : 0.75, 0, 0); // the screen tipped back toward your eyes
  };
  p.drop = (x, z) => p.rest(x, z, rand(0, 6.28));
  p.tick = (dt) => {
    if (!p.holder) return;
    // the trigger (or Space) sends the drone up, and brings it back down
    let go = false;
    if (p.holder !== "screen") {
      const d = trigDown(p.holder);
      go = d && !p.trigWas;
      p.trigWas = d;
    } else if (spaceTap) {
      go = true;
      spaceTap = false;
    }
    if (go) {
      if (drone.mode === "landed" && drone.battery > 20) {
        drone.mode = "flying";
        drone.vy = 3;
        drone.warned = false;
      } else if (drone.mode === "flying") drone.mode = "landing";
    }
  };
  p.rest(dronePad.tableX, dronePad.tableZ, yaw + Math.PI);
  return p;
})();

// Flying: smooth and a little floaty, kept above the sea and land and within radio range
function updateDrone(dt, t) {
  const ctl = controllerProp.holder;
  // Not used for a while: it flies itself home, and if it's still been forgotten, everything is put back
  drone.idle = ctl ? 0 : drone.idle + dt;
  if (drone.idle > 45 && drone.mode === "flying") drone.mode = "landing";
  if (drone.idle > 90) {
    const offTable = Math.hypot(controllerProp.group.position.x - dronePad.tableX, controllerProp.group.position.z - dronePad.tableZ) > 0.6 || controllerProp.group.parent !== scene;
    if (drone.mode !== "landed" || offTable || drone.battery < DRONE_BATTERY) {
      drone.mode = "landed";
      drone.vx = drone.vy = drone.vz = 0;
      drone.yaw = yaw;
      drone.pitch = -0.2;
      drone.battery = DRONE_BATTERY;
      drone.warned = false;
      if (!ctl) controllerProp.rest(dronePad.tableX, dronePad.tableZ, yaw + Math.PI);
    }
    drone.idle = 0;
  }
  let fwd = 0, side = 0, up = 0, turn = 0;
  if (ctl && drone.mode === "flying") {
    if (ctl === "screen") {
      fwd = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
      side = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
      up = (keys.has("KeyR") ? 1 : 0) - (keys.has("KeyF") ? 1 : 0);
      turn = (keys.has("ArrowLeft") ? 1 : 0) - (keys.has("ArrowRight") ? 1 : 0);
    } else {
      const [lx, ly] = stickOf(handOf("left"));
      const [rx, ry] = stickOf(handOf("right"));
      // like a real drone remote: left stick = throttle (up / down) and yaw (rotate); right stick = fly forward / back and strafe
      up = Math.abs(ly) > DEAD ? -ly : 0;
      turn = Math.abs(lx) > DEAD ? -lx : 0;
      fwd = Math.abs(ry) > DEAD ? -ry : 0;
      side = Math.abs(rx) > DEAD ? rx : 0;
    }
  }
  drone.yaw += turn * 1.4 * dt;
  const fx = -Math.sin(drone.yaw), fz = -Math.cos(drone.yaw);
  const rx = Math.cos(drone.yaw), rz = -Math.sin(drone.yaw);
  const k = 1 - Math.exp(-dt * 2.5);
  const SPEED = 14;
  const groundMin = Math.max(waveHeight(drone.x, drone.z, t) + 1.5, groundY(drone.x, drone.z) + 2.5);
  if (drone.mode === "flying" || drone.mode === "landing") {
    let tvx = (fx * fwd + rx * side) * SPEED, tvz = (fz * fwd + rz * side) * SPEED, tvy = up * 6;
    if (drone.mode === "landing") {
      // fly home to the pad, then settle on it
      const dx = drone.padX - drone.x, dz = drone.padZ - drone.z, d = Math.hypot(dx, dz);
      const s = Math.min(d * 0.6, 8);
      tvx = d > 0.3 ? (dx / d) * s : 0;
      tvz = d > 0.3 ? (dz / d) * s : 0;
      tvy = d < 2 ? -1.6 : drone.y < 18 ? 2 : 0;
    }
    drone.vx += (tvx - drone.vx) * k;
    drone.vz += (tvz - drone.vz) * k;
    drone.vy += (tvy - drone.vy) * k;
    drone.x += drone.vx * dt;
    drone.y += drone.vy * dt;
    drone.z += drone.vz * dt;
    const nearPad = Math.hypot(drone.x - drone.padX, drone.z - drone.padZ) < 1.5;
    if (!(drone.mode === "landing" && nearPad) && drone.y < groundMin) {
      drone.y = groundMin;
      drone.vy = Math.max(drone.vy, 0);
    }
    drone.y = Math.min(drone.y, 150);
    // radio range, from you
    const dx = drone.x - camPos.x, dy = drone.y - camPos.y, dz = drone.z - camPos.z, d = Math.hypot(dx, dy, dz);
    if (d > DRONE_RANGE) {
      drone.x = camPos.x + (dx * DRONE_RANGE) / d;
      drone.y = Math.max(camPos.y + (dy * DRONE_RANGE) / d, groundMin);
      drone.z = camPos.z + (dz * DRONE_RANGE) / d;
      drone.msg = "📶 Signal limit";
    } else drone.msg = "";
    drone.battery -= dt;
    if (drone.battery < 25 && drone.mode === "flying" && !drone.warned) {
      drone.warned = true;
      buzz(controllerProp.holder, 0.7, 300);
    }
    if (drone.battery <= 0) {
      drone.battery = 0;
      drone.mode = "landing"; // flat battery: it flies itself home
    }
    if (drone.mode === "landing" && Math.hypot(drone.x - drone.padX, drone.z - drone.padZ) < 0.6 && drone.y <= drone.padY + 0.45) {
      drone.mode = "landed";
      drone.vx = drone.vy = drone.vz = 0;
    }
  } else {
    // sitting on the pad, recharging
    drone.x = drone.padX;
    drone.z = drone.padZ;
    drone.y = drone.padY + 0.13 * 1.5 + 0.1;
    drone.battery = Math.min(DRONE_BATTERY, drone.battery + dt * 0.5);
  }
  // the model: a hover wobble and a lean into the direction of travel
  const lean = (drone.vx * rx + drone.vz * rz) * 0.015;
  const nose = (drone.vx * fx + drone.vz * fz) * 0.015;
  droneGroup.position.set(drone.x, drone.y + (drone.mode === "landed" ? 0 : Math.sin(t * 2.1) * 0.04), drone.z);
  droneGroup.rotation.set(-nose + Math.sin(t * 1.7) * 0.01, drone.yaw, -lean, "YXZ");
  const flying = drone.mode !== "landed";
  drone.spin += dt * (flying ? 60 : 0);
  droneRotors.forEach((r, i) => {
    r.rotation.y = drone.spin * (i % 2 ? 1 : -1) + i;
    r.userData.blur.material.opacity += ((flying ? 0.22 : 0) - r.userData.blur.material.opacity) * (1 - Math.exp(-dt * 8));
    r.children[0].visible = !flying;
  });
  const dark = 1 - lastEnv.light;
  droneLeds.forEach((l) => {
    const blink = l.strobe ? (Math.sin(t * 9) > 0.8 ? 1 : 0.15) : 1;
    l.glow.material.opacity = (0.25 + 0.75 * dark) * (flying ? blink : 0.4);
  });
  // its buzz, fading with distance from you
  audio.droneLevel(flying ? 1 / (1 + Math.hypot(drone.x - camPos.x, drone.y - camPos.y, drone.z - camPos.z) / 25) : 0, drone.vx * drone.vx + drone.vz * drone.vz);
}

// What the drone sees: its camera, looking where it points, drawn into the controller's screen (or, on a screen, a corner of the window)
const fpvSaved = { cam: new THREE.Vector3(), sky: new THREE.Vector3(), ocean: new THREE.Vector3(), water: new THREE.Vector3() };
function renderFpv(target, rect) {
  const lookPitch = clamp(drone.pitch - (drone.vx * -Math.sin(drone.yaw) + drone.vz * -Math.cos(drone.yaw)) * 0.012, -1.3, 0.5);
  droneCam.position.set(drone.x - Math.sin(drone.yaw) * 0.3, drone.y - 0.1, drone.z - Math.cos(drone.yaw) * 0.3);
  droneCam.rotation.set(lookPitch, drone.yaw, 0, "YXZ");
  droneCam.updateMatrixWorld(true);
  // the sea, sky and horizon are centred on the camera, so centre them on the drone for this picture
  fpvSaved.cam.copy(waterUniforms.uCamPos.value);
  fpvSaved.sky.copy(sky.position);
  fpvSaved.ocean.copy(farOcean.position);
  fpvSaved.water.copy(water.position);
  waterUniforms.uCamPos.value.copy(droneCam.position);
  sky.position.copy(droneCam.position);
  farOcean.position.set(droneCam.position.x, 0, droneCam.position.z);
  water.position.set(Math.round(droneCam.position.x / WATER_STEP) * WATER_STEP, 0, Math.round(droneCam.position.z / WATER_STEP) * WATER_STEP);
  droneGroup.visible = false;
  const xr = renderer.xr.enabled;
  renderer.xr.enabled = false;
  try {
    if (target) {
      droneCam.aspect = FPV_W / FPV_H;
      droneCam.updateProjectionMatrix();
      renderer.setRenderTarget(target);
      renderer.render(scene, droneCam);
      renderer.setRenderTarget(null);
    } else {
      droneCam.aspect = rect.w / rect.h;
      droneCam.updateProjectionMatrix();
      renderer.setScissorTest(true);
      renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
      renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
      renderer.clear();
      renderer.render(scene, droneCam);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    }
  } finally {
    renderer.xr.enabled = xr;
    droneGroup.visible = true;
    waterUniforms.uCamPos.value.copy(fpvSaved.cam);
    sky.position.copy(fpvSaved.sky);
    farOcean.position.copy(fpvSaved.ocean);
    water.position.copy(fpvSaved.water);
  }
}
const pipEl = $("pip");
function droneStats() {
  const alt = Math.max(0, drone.y - Math.max(waveHeight(drone.x, drone.z, shared.uTime.value), groundY(drone.x, drone.z)));
  return {
    label: drone.mode === "landed" ? "ON PAD" : drone.mode === "landing" ? "RETURNING" : "FLYING",
    alt: Math.round(alt),
    dist: Math.round(Math.hypot(drone.x - camPos.x, drone.z - camPos.z)),
    pct: Math.round((drone.battery / DRONE_BATTERY) * 100),
  };
}
function droneStatus() {
  const alt = Math.max(0, drone.y - Math.max(waveHeight(drone.x, drone.z, shared.uTime.value), groundY(drone.x, drone.z)));
  const dist = Math.hypot(drone.x - camPos.x, drone.z - camPos.z);
  return `${drone.mode === "landed" ? "ON PAD" : drone.mode === "landing" ? "RETURNING" : "FLYING"} · ALT ${Math.round(alt)} m · ${Math.round(dist)}/${DRONE_RANGE} m · 🔋 ${Math.round((drone.battery / DRONE_BATTERY) * 100)}%${drone.msg ? " · " + drone.msg : ""}`;
}
function updateDroneView(dt) {
  const held = controllerProp.holder;
  pipEl.hidden = held !== "screen";
  if (!held) return;
  controllerProp.hudT -= dt;
  if (held !== "screen" && controllerProp.hudT <= 0) {
    controllerProp.hudT = 0.25;
    const c = hudCanvas.getContext("2d");
    const st = droneStats();
    c.fillStyle = "#0b1820";
    c.fillRect(0, 0, 256, 54);
    c.textBaseline = "alphabetic";
    c.fillStyle = drone.mode === "landed" ? "#9fb4b8" : "#7ff0c8";
    c.font = "700 19px system-ui, sans-serif";
    c.textAlign = "left";
    c.fillText(st.label, 8, 21);
    c.fillStyle = "#e6efee";
    c.textAlign = "right";
    c.fillText(`ALT ${st.alt} m`, 248, 21);
    c.textAlign = "left";
    c.fillStyle = "#cfe8e4";
    c.font = "600 15px system-ui, sans-serif";
    c.fillText(`${st.dist}/${DRONE_RANGE} m`, 8, 42);
    c.fillStyle = "rgba(255,255,255,0.18)";
    c.fillRect(104, 30, 144, 14);
    c.fillStyle = drone.battery < DRONE_BATTERY * 0.15 ? "#ff7a5a" : "#7ff0c8";
    c.fillRect(104, 30, 144 * (drone.battery / DRONE_BATTERY), 14);
    c.fillStyle = "#06231b";
    c.font = "700 12px system-ui, sans-serif";
    c.fillText(`${st.pct}%`, 110, 41);
    hudTex.needsUpdate = true;
  }
  if (held !== "screen") {
    if (renderer.xr.isPresenting && (controllerProp.frame++ & 1) === 0) renderFpv(fpvRT);
  } else {
    pipEl.firstElementChild.textContent = droneStatus();
  }
}
// (called after the main picture on a screen, to fill the corner window)
function drawPip() {
  if (controllerProp.holder !== "screen" || renderer.xr.isPresenting) return;
  const r = pipEl.getBoundingClientRect();
  const h = renderer.domElement.clientHeight;
  renderFpv(null, { x: Math.round(r.left), y: Math.round(h - r.bottom), w: Math.round(r.width), h: Math.round(r.height) });
}

// ===== One place to pick things up, put them down, and run what they do =====
const handWas = {};
let eTap2 = false;
addEventListener("keydown", (e) => {
  if (e.code === "KeyE" && !e.repeat) eTap2 = true;
});
function updateProps(dt) {
  if (renderer.xr.isPresenting) {
    for (const h of hands) {
      if (!h.side) continue;
      const down = gripDown(h);
      const was = !!handWas[h.side];
      handWas[h.side] = down;
      h.grip.getWorldPosition(_sT);
      if (down && !was) {
        let best = null, bd = 0.5;
        for (const p of props) {
          if (p.holder || !p.group.visible) continue;
          p.body.getWorldPosition(_sC);
          const d = _sT.distanceTo(_sC);
          if (d < bd) (best = p), (bd = d);
        }
        if (best) {
          best.holder = h;
          best.hold(h.grip, false);
          buzz(h, 0.4, 40);
        }
      } else if (!down && was) {
        for (const p of props) if (p.holder === h) p.drop(_sT.x, _sT.z);
      }
    }
  } else if (eTap2) {
    eTap2 = false;
    const held = props.find((p) => p.holder === "screen");
    if (held) {
      camera.getWorldDirection(_sD);
      held.drop(camPos.x + _sD.x * 0.9, camPos.z + _sD.z * 0.9);
    } else {
      let best = null, bd = 2.8;
      for (const p of props) {
        if (p.holder || !p.group.visible) continue;
        p.body.getWorldPosition(_sC);
        const d = Math.hypot(_sC.x - camPos.x, _sC.z - camPos.z);
        if (d < bd) (best = p), (bd = d);
      }
      if (best) {
        best.holder = "screen";
        best.hold(camera, true);
      }
    }
  }
  for (const h of hands) h.sph.visible = !props.some((p) => p.holder === h);
  for (const p of props) p.tick(dt);
  spaceTap = false;
}

