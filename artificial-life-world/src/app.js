(function () {
  "use strict";

  const canvas = document.getElementById("world");
  const ctx = canvas.getContext("2d");
  const graph = document.getElementById("graph");
  const gtx = graph.getContext("2d");
  const playButton = document.getElementById("playPause");
  const resetButton = document.getElementById("reset");
  const zoomInButton = document.getElementById("zoomIn");
  const zoomOutButton = document.getElementById("zoomOut");
  const speedInput = document.getElementById("speed");
  const speedLabel = document.getElementById("speedLabel");
  const zoomInput = document.getElementById("zoom");
  const zoomLabel = document.getElementById("zoomLabel");
  const seedInput = document.getElementById("seed");
  const statsEl = document.getElementById("stats");
  const speciesEl = document.getElementById("species");
  const eventsEl = document.getElementById("events");
  const inspectorEl = document.getElementById("inspector");

  let simulation = new Alife.Simulation({ seed: Number(seedInput.value), width: 96, height: 72, chunkSize: 16 });
  let paused = false;
  let speed = Number(speedInput.value);
  let accumulator = 0;
  let last = performance.now();
  let selected = null;
  const camera = { scale: 1, baseScale: 1, zoom: Number(zoomInput.value), ox: 0, oy: 0, panX: 0, panY: 0 };
  const drag = { active: false, moved: false, x: 0, y: 0 };
  const emoji = {
    grass: "🌱",
    berry: "🫐",
    grazer: "🦌",
    sprinter: "🐇",
    predator: "🐺",
    corpse: "🦴"
  };

  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    graph.width = Math.floor(graph.getBoundingClientRect().width * dpr);
    graph.height = Math.floor(graph.getBoundingClientRect().height * dpr);
    gtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function reset() {
    simulation = new Alife.Simulation({ seed: Number(seedInput.value) || 1, width: 96, height: 72, chunkSize: 16 });
    selected = null;
    accumulator = 0;
    camera.panX = 0;
    camera.panY = 0;
    updatePanels();
    render();
  }

  playButton.addEventListener("click", () => {
    paused = !paused;
    playButton.textContent = paused ? "Resume" : "Pause";
  });

  resetButton.addEventListener("click", reset);
  speedInput.addEventListener("input", () => {
    speed = Number(speedInput.value);
    speedLabel.textContent = `${speed.toFixed(1)}x`;
  });

  zoomInput.addEventListener("input", () => {
    setZoom(Number(zoomInput.value));
  });

  zoomInButton.addEventListener("click", () => setZoom(camera.zoom * 1.25));
  zoomOutButton.addEventListener("click", () => setZoom(camera.zoom / 1.25));

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const before = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    setZoom(camera.zoom * factor, false);
    layoutCamera();
    const afterX = before.x * camera.scale + camera.ox;
    const afterY = before.y * camera.scale + camera.oy;
    camera.panX += event.clientX - rect.left - afterX;
    camera.panY += event.clientY - rect.top - afterY;
    constrainCamera();
    updateZoomLabel();
  }, { passive: false });

  canvas.addEventListener("pointerdown", (event) => {
    drag.active = true;
    drag.moved = false;
    drag.x = event.clientX;
    drag.y = event.clientY;
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!drag.active) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 2) drag.moved = true;
    camera.panX += dx;
    camera.panY += dy;
    drag.x = event.clientX;
    drag.y = event.clientY;
    constrainCamera();
  });

  canvas.addEventListener("pointerup", (event) => {
    if (drag.active && !drag.moved) inspectAt(event.clientX, event.clientY);
    drag.active = false;
    canvas.classList.remove("is-dragging");
  });

  canvas.addEventListener("pointercancel", () => {
    drag.active = false;
    canvas.classList.remove("is-dragging");
  });

  function inspectAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const cell = screenToWorld(clientX - rect.left, clientY - rect.top);
    const candidates = [
      ...simulation.world.getNearbyAnimals(cell, 1.5),
      ...simulation.world.getNearbyPlants(cell, 1.2)
    ];
    candidates.sort((a, b) => Math.hypot(a.x - cell.x, a.y - cell.y) - Math.hypot(b.x - cell.x, b.y - cell.y));
    selected = candidates[0] ? candidates[0].id : null;
    updateInspector();
  }

  window.addEventListener("resize", () => {
    fitCanvas();
    render();
  });

  function screenToWorld(x, y) {
    return { x: (x - camera.ox) / camera.scale, y: (y - camera.oy) / camera.scale };
  }

  function layoutCamera() {
    const rect = canvas.getBoundingClientRect();
    camera.baseScale = Math.min(rect.width / simulation.world.width, rect.height / simulation.world.height);
    camera.scale = camera.baseScale * camera.zoom;
    camera.ox = (rect.width - simulation.world.width * camera.scale) / 2 + camera.panX;
    camera.oy = (rect.height - simulation.world.height * camera.scale) / 2 + camera.panY;
    constrainCamera();
  }

  function constrainCamera() {
    const rect = canvas.getBoundingClientRect();
    const worldW = simulation.world.width * camera.scale;
    const worldH = simulation.world.height * camera.scale;
    const centerX = (rect.width - worldW) / 2;
    const centerY = (rect.height - worldH) / 2;
    if (worldW <= rect.width) camera.panX = 0;
    else camera.panX = clamp(camera.panX, rect.width - worldW - centerX, -centerX);
    if (worldH <= rect.height) camera.panY = 0;
    else camera.panY = clamp(camera.panY, rect.height - worldH - centerY, -centerY);
    camera.ox = centerX + camera.panX;
    camera.oy = centerY + camera.panY;
  }

  function setZoom(value, rerender = true) {
    camera.zoom = clamp(value, Number(zoomInput.min), Number(zoomInput.max));
    zoomInput.value = camera.zoom.toFixed(2);
    updateZoomLabel();
    if (rerender) render();
  }

  function updateZoomLabel() {
    zoomLabel.textContent = `${camera.zoom.toFixed(1)}x`;
  }

  function tick(now) {
    const realDt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) {
      accumulator += realDt * speed;
      while (accumulator >= Alife.SIM_DT) {
        simulation.update(Alife.SIM_DT);
        accumulator -= Alife.SIM_DT;
      }
    }
    render();
    if (Math.floor(now / 250) !== Math.floor((now - realDt * 1000) / 250)) updatePanels();
    requestAnimationFrame(tick);
  }

  function render() {
    layoutCamera();
    const w = simulation.world;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(camera.ox, camera.oy);
    ctx.scale(camera.scale, camera.scale);
    drawTerrain(w);
    drawResourceTexture(w);
    drawTerritories(w);
    drawCorpses(w);
    drawPlants(w);
    drawAnimals(w);
    drawDaylight(w);
    ctx.restore();
    drawGraph();
  }

  function drawTerrain(world) {
    for (const cell of world.cells) {
      const moisture = Math.floor(34 + cell.moisture * 42);
      const nutrient = Math.floor(42 + cell.nutrients * 38);
      const shade = Math.sin(cell.x * 1.7 + cell.y * 0.9) * 5 + Math.cos(cell.y * 1.3) * 4;
      if (cell.terrainType === "water") ctx.fillStyle = `rgb(${35 + shade}, ${92 + cell.water * 62 + shade}, ${150 + shade})`;
      else if (cell.terrainType === "rock") ctx.fillStyle = `rgb(${82 + nutrient * 0.2 + shade}, ${86 + nutrient * 0.2 + shade}, ${82 + nutrient * 0.2 + shade})`;
      else ctx.fillStyle = `rgb(${nutrient + 34 + shade}, ${moisture + 68 + shade}, ${42 + nutrient * 0.34 + shade})`;
      ctx.fillRect(cell.x - 0.02, cell.y - 0.02, 1.04, 1.04);
    }
  }

  function drawResourceTexture(world) {
    ctx.save();
    ctx.globalAlpha = camera.zoom > 2 ? 0.18 : 0.1;
    for (const cell of world.cells) {
      if (cell.terrainType === "soil" && cell.water > 0.72 && (cell.x * 17 + cell.y * 23) % 11 < 2) {
        ctx.fillStyle = "rgba(60, 115, 120, 0.45)";
        ctx.beginPath();
        ctx.arc(cell.x + 0.32, cell.y + 0.68, 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
      if (cell.terrainType === "water" && (cell.x + cell.y) % 5 === 0) {
        ctx.strokeStyle = "rgba(210, 238, 244, 0.35)";
        ctx.lineWidth = 0.025;
        ctx.beginPath();
        ctx.moveTo(cell.x + 0.18, cell.y + 0.48);
        ctx.lineTo(cell.x + 0.82, cell.y + 0.42);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawTerritories(world) {
    ctx.lineWidth = 0.18;
    for (const territory of world.territories.values()) {
      const owner = [...territory.ownerIds].map((id) => world.animals.get(id)).find(Boolean);
      if (!owner) continue;
      ctx.strokeStyle = world.species[owner.speciesId].diet === "carnivore" ? "rgba(160, 35, 35, 0.4)" : "rgba(230, 216, 116, 0.35)";
      ctx.beginPath();
      ctx.arc(territory.x, territory.y, territory.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawPlants(world) {
    setupEmojiText();
    for (const plant of world.plants.values()) {
      const size = Math.max(0.48, Math.sqrt(plant.biomass) * 0.62);
      ctx.globalAlpha = 0.55 + plant.health * 0.45;
      const offset = jitter(plant.id);
      ctx.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      ctx.fillText(emoji[plant.speciesId] || "🌿", plant.x + offset.x, plant.y + offset.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawAnimals(world) {
    setupEmojiText();
    for (const animal of world.animals.values()) {
      const size = 0.85 + animal.genome.size * 0.75;
      if (animal.id === selected || animal.state === "fleeing") {
        ctx.strokeStyle = animal.id === selected ? "rgba(255,255,255,0.9)" : "rgba(255,240,181,0.7)";
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.arc(animal.x, animal.y, size * 0.52, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = animal.health < 0.35 ? 0.65 : 1;
      ctx.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      ctx.fillText(emoji[animal.speciesId] || "•", animal.x, animal.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawCorpses(world) {
    setupEmojiText();
    for (const corpse of world.corpses.values()) {
      ctx.globalAlpha = clamp(corpse.biomass, 0.25, 0.85);
      ctx.font = `${Math.max(0.55, Math.sqrt(corpse.biomass) * 0.55)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      ctx.fillText(emoji.corpse, corpse.x, corpse.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawDaylight(world) {
    const darkness = clamp(0.34 - world.statistics.resourceLevels.sunlight * 0.38, 0, 0.28);
    if (darkness <= 0) return;
    ctx.fillStyle = `rgba(5, 12, 20, ${darkness})`;
    ctx.fillRect(0, 0, world.width, world.height);
  }

  function setupEmojiText() {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }

  function jitter(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return {
      x: ((hash & 255) / 255 - 0.5) * 0.34,
      y: (((hash >>> 8) & 255) / 255 - 0.5) * 0.34
    };
  }

  function drawGraph() {
    const rect = graph.getBoundingClientRect();
    gtx.clearRect(0, 0, rect.width, rect.height);
    const history = simulation.world.statistics.history;
    if (history.length < 2) return;
    const series = [
      ["grass", "#62c462"],
      ["berry", "#3a9b74"],
      ["grazer", "#d7b56d"],
      ["sprinter", "#e0d184"],
      ["predator", "#c95454"]
    ];
    const maxPop = Math.max(10, ...history.flatMap((h) => series.map(([id]) => h.populations[id] || 0)));
    gtx.strokeStyle = "rgba(255,255,255,0.12)";
    gtx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (rect.height / 4) * i;
      gtx.beginPath();
      gtx.moveTo(0, y);
      gtx.lineTo(rect.width, y);
      gtx.stroke();
    }
    for (const [id, color] of series) {
      gtx.strokeStyle = color;
      gtx.lineWidth = id === "predator" ? 2 : 1.6;
      gtx.beginPath();
      history.forEach((point, index) => {
        const x = (index / (history.length - 1)) * rect.width;
        const y = rect.height - ((point.populations[id] || 0) / maxPop) * (rect.height - 8) - 4;
        if (index === 0) gtx.moveTo(x, y);
        else gtx.lineTo(x, y);
      });
      gtx.stroke();
    }
  }

  function updatePanels() {
    const world = simulation.world;
    const stats = world.statistics;
    statsEl.innerHTML = `
      <div><span>Day</span><strong>${world.day}</strong></div>
      <div><span>Season</span><strong>${world.season}</strong></div>
      <div><span>Rain</span><strong>${Math.round(world.weather.rain * 100)}%</strong></div>
      <div><span>Sun</span><strong>${Math.round(stats.resourceLevels.sunlight * 100)}%</strong></div>
      <div><span>Water</span><strong>${Math.round(stats.resourceLevels.water * 100)}%</strong></div>
      <div><span>Nutrients</span><strong>${Math.round(stats.resourceLevels.nutrients * 100)}%</strong></div>
      <div><span>Coverage</span><strong>${Math.round(stats.plantCoverage * 100)}%</strong></div>
      <div><span>Territories</span><strong>${stats.territoryCount}</strong></div>
    `;
    speciesEl.innerHTML = Object.entries(world.species)
      .map(([id, species]) => {
        const pop = stats.populationBySpecies[id] || 0;
        const born = stats.birthsBySpecies[id] || 0;
        const died = stats.deathsBySpecies[id] || 0;
        return `<tr><td><span class="swatch" style="background:${species.color}"></span>${species.name}</td><td>${pop}</td><td>${born}</td><td>${died}</td></tr>`;
      }).join("");
    const recent = world.events.recent.slice(-6).reverse();
    eventsEl.innerHTML = recent.map((event) => `<li>${formatEvent(event)}</li>`).join("");
    updateInspector();
  }

  function updateInspector() {
    if (!selected) {
      inspectorEl.textContent = "Click a plant or animal to inspect its simulation state.";
      return;
    }
    const world = simulation.world;
    const entity = world.animals.get(selected) || world.plants.get(selected);
    if (!entity) {
      selected = null;
      inspectorEl.textContent = "The selected organism is gone. That is often how ecosystems make their point.";
      return;
    }
    const species = world.species[entity.speciesId];
    if (entity.type === "animal") {
      inspectorEl.innerHTML = `
        <strong>${species.name}</strong>
        <span>${entity.sex}, age ${entity.age.toFixed(1)}, ${entity.state}</span>
        <span>Health ${pct(entity.health)} · Energy ${pct(entity.energy)} · Hunger ${pct(entity.hunger)} · Thirst ${pct(entity.thirst)}</span>
        <span>Genes: speed ${pct(entity.genome.speed)}, strength ${pct(entity.genome.strength)}, vision ${pct(entity.genome.vision)}, reproduction ${pct(entity.genome.reproductionRate)}</span>
      `;
    } else {
      inspectorEl.innerHTML = `
        <strong>${species.name}</strong>
        <span>Age ${entity.age.toFixed(1)} · Health ${pct(entity.health)} · Biomass ${entity.biomass.toFixed(2)}</span>
        <span>Leaf ${entity.leafArea.toFixed(2)} · Root ${entity.rootSize.toFixed(2)} · Stored energy ${entity.storedEnergy.toFixed(2)}</span>
      `;
    }
  }

  function pct(value) {
    return `${Math.round(clamp(value, 0, 1) * 100)}%`;
  }

  function formatEvent(event) {
    const time = `d${Math.floor((event.time || 0) / 60)}`;
    if (event.type === "organismBorn") return `${time}: ${simulation.world.species[event.payload.organism.speciesId].name} born`;
    if (event.type === "organismDied") return `${time}: ${simulation.world.species[event.payload.organism.speciesId].name} died (${event.payload.cause})`;
    if (event.type === "organismAttacked") return `${time}: ${simulation.world.species[event.payload.attacker.speciesId].name} used ${event.payload.ability.id}`;
    if (event.type === "territoryClaimed") return `${time}: territory claimed`;
    if (event.type === "plantSeeded") return `${time}: seed took root`;
    if (event.type === "weatherChanged") return `${time}: weather shifted`;
    return `${time}: ${event.type}`;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  fitCanvas();
  updatePanels();
  requestAnimationFrame(tick);
})();
