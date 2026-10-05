(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Alife = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TAU = Math.PI * 2;
  const SIM_DT = 1 / 30;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  class Random {
    constructor(seed = 12345) {
      this.seed = seed >>> 0;
    }

    next() {
      this.seed = (1664525 * this.seed + 1013904223) >>> 0;
      return this.seed / 4294967296;
    }

    range(min, max) {
      return min + this.next() * (max - min);
    }

    int(min, max) {
      return Math.floor(this.range(min, max + 1));
    }

    choice(items) {
      return items[Math.floor(this.next() * items.length)];
    }

    chance(probability) {
      return this.next() < probability;
    }
  }

  class EventBus {
    constructor() {
      this.listeners = new Map();
      this.recent = [];
    }

    on(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    }

    emit(type, payload) {
      const event = { type, payload, time: payload && payload.time ? payload.time : 0 };
      this.recent.push(event);
      if (this.recent.length > 80) this.recent.shift();
      const listeners = this.listeners.get(type) || [];
      for (const handler of listeners) handler(payload);
    }
  }

  const SpeciesRegistry = {
    grass: {
      id: "grass",
      type: "plant",
      name: "Grass",
      color: "#62c462",
      growthRate: 0.95,
      sunlightRequirement: 0.25,
      waterRequirement: 0.28,
      nutrientRequirement: 0.18,
      shadeTolerance: 0.32,
      droughtTolerance: 0.34,
      seedProduction: 0.035,
      seedDispersal: 4,
      maximumBiomass: 1.8,
      genomeParameters: { sunlightEfficiency: 0.72, waterNeed: 0.28, rootSize: 0.45, leafArea: 0.5 }
    },
    berry: {
      id: "berry",
      type: "plant",
      name: "Berry Shrub",
      color: "#3a9b74",
      growthRate: 0.55,
      sunlightRequirement: 0.36,
      waterRequirement: 0.34,
      nutrientRequirement: 0.28,
      shadeTolerance: 0.48,
      droughtTolerance: 0.25,
      seedProduction: 0.02,
      seedDispersal: 6,
      maximumBiomass: 3.6,
      genomeParameters: { sunlightEfficiency: 0.6, waterNeed: 0.36, rootSize: 0.6, leafArea: 0.7 }
    },
    grazer: {
      id: "grazer",
      type: "animal",
      name: "Grazers",
      diet: "herbivore",
      size: 0.42,
      color: "#d7b56d",
      baseMetabolism: 0.018,
      reproductionAge: 16,
      gestationTime: 6,
      lifespan: 130,
      territorial: true,
      territoryRadius: 5,
      baseGenome: {
        size: 0.42, speed: 0.48, strength: 0.34, vision: 0.42, hearing: 0.46, smell: 0.5,
        aggression: 0.16, fear: 0.72, curiosity: 0.34, intelligence: 0.34, metabolism: 0.42,
        waterEfficiency: 0.56, temperatureTolerance: 0.52, reproductionRate: 0.62, lifespan: 0.54
      },
      abilities: [{ id: "kick", range: 0.85, damage: 0.16, cooldown: 3, energyCost: 0.05, effects: [] }],
      behaviorParameters: { flocking: 0.5, riskTolerance: 0.22, foodPreference: "plant" }
    },
    sprinter: {
      id: "sprinter",
      type: "animal",
      name: "Sprinters",
      diet: "herbivore",
      size: 0.31,
      color: "#e0d184",
      baseMetabolism: 0.02,
      reproductionAge: 12,
      gestationTime: 4,
      lifespan: 95,
      territorial: false,
      territoryRadius: 3,
      baseGenome: {
        size: 0.32, speed: 0.78, strength: 0.22, vision: 0.56, hearing: 0.62, smell: 0.42,
        aggression: 0.08, fear: 0.82, curiosity: 0.44, intelligence: 0.3, metabolism: 0.52,
        waterEfficiency: 0.44, temperatureTolerance: 0.47, reproductionRate: 0.76, lifespan: 0.42
      },
      abilities: [{ id: "dash", range: 0, damage: 0, cooldown: 6, energyCost: 0.1, effects: ["speed_burst"] }],
      behaviorParameters: { flocking: 0.65, riskTolerance: 0.12, foodPreference: "plant" }
    },
    predator: {
      id: "predator",
      type: "animal",
      name: "Stalkers",
      diet: "carnivore",
      size: 0.55,
      color: "#c95454",
      baseMetabolism: 0.006,
      reproductionAge: 22,
      gestationTime: 8,
      lifespan: 150,
      territorial: true,
      territoryRadius: 8,
      baseGenome: {
        size: 0.56, speed: 0.62, strength: 0.72, vision: 0.68, hearing: 0.5, smell: 0.66,
        aggression: 0.68, fear: 0.25, curiosity: 0.36, intelligence: 0.48, metabolism: 0.62,
        waterEfficiency: 0.48, temperatureTolerance: 0.5, reproductionRate: 0.36, lifespan: 0.58
      },
      abilities: [
        { id: "bite", range: 0.8, damage: 0.42, cooldown: 1.8, energyCost: 0.02, effects: [] },
        { id: "pounce", range: 1.5, damage: 0.28, cooldown: 5.5, energyCost: 0.035, effects: ["slow"] }
      ],
      behaviorParameters: { packHunting: 0.25, riskTolerance: 0.58, foodPreference: "prey" }
    }
  };

  function cloneGenome(genome) {
    return Object.fromEntries(Object.entries(genome).map(([key, value]) => [key, value]));
  }

  function mutateGene(value, random, rate = 0.06) {
    if (!random.chance(rate)) return value;
    return clamp(value + random.range(-0.09, 0.09), 0.02, 0.98);
  }

  function combineGenomes(a, b, random) {
    const child = {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const base = random.chance(0.5) ? a[key] : b[key];
      const blended = lerp(base, (a[key] + b[key]) / 2, 0.25);
      child[key] = mutateGene(blended, random);
    }
    return child;
  }

  class World {
    constructor(options = {}) {
      this.seed = options.seed || 12345;
      this.random = new Random(this.seed);
      this.width = options.width || 96;
      this.height = options.height || 72;
      this.chunkSize = options.chunkSize || 16;
      this.time = 0;
      this.day = 0;
      this.season = "Spring";
      this.weather = { rain: 0.2, cloud: 0.2, temperature: 0.5 };
      this.cells = [];
      this.chunks = new Map();
      this.plants = new Map();
      this.animals = new Map();
      this.corpses = new Map();
      this.territories = new Map();
      this.species = SpeciesRegistry;
      this.nextId = 1;
      this.statistics = createStatistics();
      this.events = new EventBus();
      this.generate();
    }

    generate() {
      const rng = this.random;
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const nx = x / this.width - 0.5;
          const ny = y / this.height - 0.5;
          const ripple = Math.sin(x * 0.15 + this.seed) * 0.08 + Math.cos(y * 0.17) * 0.08;
          const river = Math.abs(Math.sin((x + y * 0.35 + this.seed * 0.01) * 0.09));
          const elevation = clamp(0.52 + ny * 0.25 + ripple + rng.range(-0.12, 0.12), 0, 1);
          const waterway = river < 0.08 || elevation < 0.18;
          const terrainType = waterway ? "water" : elevation > 0.8 ? "rock" : "soil";
          const moisture = clamp(waterway ? 1 : 0.35 + (0.15 - river) * 2 + rng.range(-0.1, 0.15), 0, 1);
          const nutrients = terrainType === "rock" ? rng.range(0.08, 0.25) : rng.range(0.35, 0.85);
          const sunlight = clamp(0.75 - Math.abs(ny) * 0.2 - (terrainType === "water" ? 0.04 : 0), 0.2, 1);
          this.cells.push({
            x, y, terrainType, elevation,
            temperature: clamp(0.55 - ny * 0.25 + rng.range(-0.05, 0.05), 0, 1),
            moisture,
            sunlight,
          water: waterway ? 1 : clamp(0.24 + moisture * 0.72 + rng.range(0, 0.08), 0, 1),
            nutrients,
            vegetationIds: new Set(),
            organismIds: new Set()
          });
        }
      }
    }

    createId(prefix) {
      return `${prefix}${this.nextId++}`;
    }

    getCell(x, y) {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return null;
      return this.cells[iy * this.width + ix];
    }

    getChunkKey(x, y) {
      return `${Math.floor(x / this.chunkSize)},${Math.floor(y / this.chunkSize)}`;
    }

    getChunk(x, y) {
      const key = this.getChunkKey(x, y);
      if (!this.chunks.has(key)) {
        this.chunks.set(key, { key, plantIds: new Set(), animalIds: new Set(), corpseIds: new Set() });
      }
      return this.chunks.get(key);
    }

    indexEntity(entity, type) {
      const cell = this.getCell(entity.x, entity.y);
      if (!cell) return;
      const chunk = this.getChunk(entity.x, entity.y);
      entity.cellKey = `${cell.x},${cell.y}`;
      entity.chunkKey = chunk.key;
      if (type === "plant") {
        cell.vegetationIds.add(entity.id);
        chunk.plantIds.add(entity.id);
      } else if (type === "animal") {
        cell.organismIds.add(entity.id);
        chunk.animalIds.add(entity.id);
      } else if (type === "corpse") {
        chunk.corpseIds.add(entity.id);
      }
    }

    unindexEntity(entity, type) {
      if (!entity) return;
      const [cx, cy] = (entity.cellKey || "").split(",").map(Number);
      const cell = Number.isFinite(cx) ? this.getCell(cx, cy) : null;
      const chunk = this.chunks.get(entity.chunkKey);
      if (type === "plant") {
        if (cell) cell.vegetationIds.delete(entity.id);
        if (chunk) chunk.plantIds.delete(entity.id);
      } else if (type === "animal") {
        if (cell) cell.organismIds.delete(entity.id);
        if (chunk) chunk.animalIds.delete(entity.id);
      } else if (type === "corpse") {
        if (chunk) chunk.corpseIds.delete(entity.id);
      }
    }

    moveAnimal(animal, nx, ny) {
      nx = clamp(nx, 0.5, this.width - 0.5);
      ny = clamp(ny, 0.5, this.height - 0.5);
      const oldCellKey = animal.cellKey;
      const oldChunkKey = animal.chunkKey;
      animal.x = nx;
      animal.y = ny;
      const cell = this.getCell(nx, ny);
      const chunk = this.getChunk(nx, ny);
      const newCellKey = `${cell.x},${cell.y}`;
      if (newCellKey !== oldCellKey) {
        const [cx, cy] = (oldCellKey || "").split(",").map(Number);
        const oldCell = Number.isFinite(cx) ? this.getCell(cx, cy) : null;
        if (oldCell) oldCell.organismIds.delete(animal.id);
        cell.organismIds.add(animal.id);
        animal.cellKey = newCellKey;
      }
      if (chunk.key !== oldChunkKey) {
        const oldChunk = this.chunks.get(oldChunkKey);
        if (oldChunk) oldChunk.animalIds.delete(animal.id);
        chunk.animalIds.add(animal.id);
        animal.chunkKey = chunk.key;
      }
    }

    getNearbyFrom(collection, x, y, radius) {
      const result = [];
      const minCx = Math.floor((x - radius) / this.chunkSize);
      const maxCx = Math.floor((x + radius) / this.chunkSize);
      const minCy = Math.floor((y - radius) / this.chunkSize);
      const maxCy = Math.floor((y + radius) / this.chunkSize);
      const r2 = radius * radius;
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const chunk = this.chunks.get(`${cx},${cy}`);
          if (!chunk) continue;
          const ids = collection === this.plants ? chunk.plantIds : collection === this.animals ? chunk.animalIds : chunk.corpseIds;
          for (const id of ids) {
            const item = collection.get(id);
            if (!item) continue;
            const dx = item.x - x;
            const dy = item.y - y;
            if (dx * dx + dy * dy <= r2) result.push(item);
          }
        }
      }
      return result;
    }

    getNearbyPlants(position, radius) {
      return this.getNearbyFrom(this.plants, position.x, position.y, radius);
    }

    getNearbyAnimals(position, radius) {
      return this.getNearbyFrom(this.animals, position.x, position.y, radius);
    }

    getNearbyEntities(position, radius) {
      return [
        ...this.getNearbyPlants(position, radius),
        ...this.getNearbyAnimals(position, radius),
        ...this.getNearbyFrom(this.corpses, position.x, position.y, radius)
      ];
    }

    waterScoreAround(x, y, radius) {
      let best = 0;
      for (let yy = Math.floor(y - radius); yy <= Math.ceil(y + radius); yy++) {
        for (let xx = Math.floor(x - radius); xx <= Math.ceil(x + radius); xx++) {
          const cell = this.getCell(xx, yy);
          if (!cell) continue;
          if (cell.water > best) best = cell.water;
        }
      }
      return best;
    }
  }

  function createStatistics() {
    return {
      populationBySpecies: {},
      birthsBySpecies: {},
      deathsBySpecies: {},
      averageAge: {},
      averageGenome: {},
      biomass: 0,
      plantCoverage: 0,
      resourceLevels: { water: 0, nutrients: 0, sunlight: 0 },
      territoryCount: 0,
      history: []
    };
  }

  class Simulation {
    constructor(options = {}) {
      this.options = { width: 96, height: 72, seed: 12345, maxPlants: 1400, ...options };
      this.world = new World(this.options);
      this.fixedDt = SIM_DT;
      this.systems = [
        { name: "environment", hz: 1, acc: 0, fn: this.environmentSystem.bind(this) },
        { name: "resources", hz: 2, acc: 0, fn: this.resourceSystem.bind(this) },
        { name: "plants", hz: 2, acc: 0, fn: this.plantSystem.bind(this) },
        { name: "needs", hz: 2, acc: 0, fn: this.needsSystem.bind(this) },
        { name: "perception", hz: 10, acc: 0, fn: this.perceptionSystem.bind(this) },
        { name: "behavior", hz: 10, acc: 0, fn: this.behaviorSystem.bind(this) },
        { name: "movement", hz: 30, acc: 0, fn: this.movementSystem.bind(this) },
        { name: "territory", hz: 1, acc: 0, fn: this.territorySystem.bind(this) },
        { name: "combat", hz: 10, acc: 0, fn: this.combatSystem.bind(this) },
        { name: "feeding", hz: 10, acc: 0, fn: this.feedingSystem.bind(this) },
        { name: "reproduction", hz: 1, acc: 0, fn: this.reproductionSystem.bind(this) },
        { name: "aging", hz: 1, acc: 0, fn: this.agingSystem.bind(this) },
        { name: "death", hz: 10, acc: 0, fn: this.deathSystem.bind(this) },
        { name: "decomposition", hz: 1, acc: 0, fn: this.decompositionSystem.bind(this) },
        { name: "population", hz: 1, acc: 0, fn: this.populationSystem.bind(this) }
      ];
      this.seedInitialLife();
    }

    reset(options = {}) {
      return new Simulation({ ...this.options, ...options });
    }

    seedInitialLife() {
      for (let i = 0; i < 820; i++) this.spawnPlant(this.world.random.chance(0.78) ? "grass" : "berry");
      for (let i = 0; i < 34; i++) this.spawnAnimal("grazer");
      for (let i = 0; i < 22; i++) this.spawnAnimal("sprinter");
      for (let i = 0; i < 8; i++) this.spawnAnimal("predator");
      this.populationSystem(0);
    }

    findHabitableCell(preferWater = false) {
      for (let tries = 0; tries < 500; tries++) {
        const x = this.world.random.range(2, this.world.width - 2);
        const y = this.world.random.range(2, this.world.height - 2);
        const cell = this.world.getCell(x, y);
        if (!cell || cell.terrainType === "rock") continue;
        if (preferWater && cell.water < 0.22) continue;
        if (cell.terrainType !== "water") return { x, y, cell };
      }
      return { x: this.world.width / 2, y: this.world.height / 2, cell: this.world.getCell(this.world.width / 2, this.world.height / 2) };
    }

    spawnPlant(speciesId, x = null, y = null, parentIds = []) {
      const species = this.world.species[speciesId];
      if (this.world.plants.size >= this.options.maxPlants) return null;
      const pos = x === null ? this.findHabitableCell(true) : { x, y, cell: this.world.getCell(x, y) };
      if (!pos.cell || pos.cell.terrainType !== "soil") return null;
      if (pos.cell.vegetationIds.size >= 3) return null;
      const id = this.world.createId("p");
      const g = species.genomeParameters;
      const plant = {
        id, speciesId, type: "plant", x: pos.x, y: pos.y, age: 0,
        health: 1, biomass: this.world.random.range(0.08, 0.28), storedEnergy: 0.2,
        rootSize: mutateGene(g.rootSize, this.world.random, 0.2),
        leafArea: mutateGene(g.leafArea, this.world.random, 0.2),
        waterNeed: mutateGene(g.waterNeed, this.world.random, 0.2),
        sunlightEfficiency: mutateGene(g.sunlightEfficiency, this.world.random, 0.2),
        nutrientNeed: species.nutrientRequirement,
        reproductionState: 0,
        parentIds
      };
      this.world.plants.set(id, plant);
      this.world.indexEntity(plant, "plant");
      this.world.events.emit("plantSeeded", { plant, time: this.world.time });
      return plant;
    }

    spawnAnimal(speciesId, x = null, y = null, genome = null, parentIds = []) {
      const species = this.world.species[speciesId];
      const pos = x === null ? this.findHabitableCell() : { x, y, cell: this.world.getCell(x, y) };
      if (!pos.cell || pos.cell.terrainType !== "soil") return null;
      const id = this.world.createId("a");
      const animal = {
        id, speciesId, type: "animal", x: pos.x, y: pos.y,
        vx: 0, vy: 0, age: this.world.random.range(0, species.reproductionAge * 0.9),
        health: 1, energy: this.world.random.range(0.45, 0.88),
        hunger: this.world.random.range(0.15, 0.45),
        thirst: this.world.random.range(0.1, 0.35),
        sex: this.world.random.chance(0.5) ? "F" : "M",
        genome: genome || cloneGenome(species.baseGenome),
        state: "wandering",
        goal: null,
        targetId: null,
        perception: { plants: [], prey: [], carrion: [], predators: [], rivals: [], mates: [], water: null },
        territoryId: null,
        pregnancy: null,
        cooldowns: {},
        parentIds
      };
      this.world.animals.set(id, animal);
      this.world.indexEntity(animal, "animal");
      this.world.events.emit("organismBorn", { organism: animal, time: this.world.time });
      this.world.statistics.birthsBySpecies[speciesId] = (this.world.statistics.birthsBySpecies[speciesId] || 0) + 1;
      return animal;
    }

    update(dt) {
      this.world.time += dt;
      this.world.day = Math.floor(this.world.time / 60);
      const seasons = ["Spring", "Summer", "Autumn", "Winter"];
      this.world.season = seasons[Math.floor((this.world.day % 80) / 20)];
      for (const system of this.systems) {
        system.acc += dt;
        const interval = 1 / system.hz;
        while (system.acc >= interval) {
          system.fn(interval);
          system.acc -= interval;
        }
      }
    }

    environmentSystem(dt) {
      const w = this.world;
      const phase = (w.time % 60) / 60;
      const daylight = clamp(Math.sin(phase * TAU - Math.PI * 0.18) * 0.7 + 0.35, 0.02, 1);
      const seasonTemp = { Spring: 0.55, Summer: 0.72, Autumn: 0.46, Winter: 0.28 }[w.season];
      const rainBase = { Spring: 0.32, Summer: 0.2, Autumn: 0.27, Winter: 0.18 }[w.season];
      w.weather.cloud = clamp(lerp(w.weather.cloud, w.random.range(0.05, 0.8), 0.08), 0, 1);
      w.weather.rain = clamp(rainBase + (w.weather.cloud - 0.45) * 0.4 + w.random.range(-0.04, 0.04), 0, 1);
      w.weather.temperature = seasonTemp;
      for (const cell of w.cells) {
        const canopy = Math.min(0.55, cell.vegetationIds.size * 0.012);
        cell.sunlight = clamp(daylight * (1 - w.weather.cloud * 0.45) * (1 - canopy), 0, 1);
        cell.temperature = clamp(lerp(cell.temperature, seasonTemp - cell.elevation * 0.18 + daylight * 0.16, 0.1), 0, 1);
      }
      w.events.emit("weatherChanged", { weather: { ...w.weather }, time: w.time });
    }

    resourceSystem(dt) {
      const w = this.world;
      for (const cell of w.cells) {
        const rain = w.weather.rain * dt * 0.09;
        const evaporation = (0.007 + cell.temperature * 0.014 + cell.sunlight * 0.008) * dt;
        if (cell.terrainType === "water") {
          cell.water = 1;
          cell.moisture = 1;
        } else {
          cell.water = clamp(cell.water + rain - evaporation, 0, 1);
          cell.moisture = clamp(lerp(cell.moisture, cell.water, 0.08), 0, 1);
        }
        cell.nutrients = clamp(cell.nutrients + 0.002 * dt, 0, 1);
      }
    }

    plantSystem(dt) {
      const dead = [];
      for (const plant of this.world.plants.values()) {
        const species = this.world.species[plant.speciesId];
        const cell = this.world.getCell(plant.x, plant.y);
        if (!cell) continue;
        const dayDt = dt / 60;
        plant.age += dt / 60;
        const waterUse = species.waterRequirement * plant.waterNeed * dayDt * 0.22;
        const nutrientUse = species.nutrientRequirement * dayDt * 0.42;
        const waterFactor = clamp((cell.water + species.droughtTolerance * 0.28) / Math.max(0.01, species.waterRequirement), 0, 1.25);
        const nutrientFactor = clamp(cell.nutrients / Math.max(0.01, species.nutrientRequirement), 0, 1.2);
        const sunlightFactor = clamp((cell.sunlight + species.shadeTolerance * 0.25) / species.sunlightRequirement, 0, 1.4);
        const effectiveSunlightFactor = cell.sunlight < 0.08 ? 1 : sunlightFactor;
        const resourceFactor = Math.min(waterFactor, nutrientFactor, effectiveSunlightFactor);
        cell.water = clamp(cell.water - waterUse * resourceFactor, 0, 1);
        cell.nutrients = clamp(cell.nutrients - nutrientUse * resourceFactor, 0, 1);
        const energyProduced = cell.sunlight * plant.leafArea * plant.sunlightEfficiency * dayDt * 2.4;
        const maintenance = (0.05 + plant.biomass * 0.028) * dayDt * (cell.sunlight < 0.08 ? 0.25 : 1);
        plant.storedEnergy += energyProduced * resourceFactor - maintenance;
        if (resourceFactor < 0.38 || plant.storedEnergy < -0.25) plant.health -= dayDt * 0.5 * (1.2 - resourceFactor);
        else plant.health = clamp(plant.health + dayDt * 0.2, 0, 1);
        if (plant.storedEnergy > 0.05 && plant.health > 0.25) {
          const growth = species.growthRate * resourceFactor * dayDt * 0.5;
          plant.biomass = clamp(plant.biomass + growth, 0, species.maximumBiomass);
          plant.storedEnergy -= growth * 0.55;
          plant.leafArea = clamp(plant.leafArea + growth * 0.08, 0.2, 1.5);
        }
        if (plant.biomass > species.maximumBiomass * 0.55 && plant.health > 0.55) {
          plant.reproductionState += species.seedProduction * Math.max(0, plant.storedEnergy) * resourceFactor * dayDt * 5;
          if (plant.reproductionState > 1) {
            plant.reproductionState = 0;
            const angle = this.world.random.range(0, TAU);
            const range = this.world.random.range(1, species.seedDispersal);
            this.spawnPlant(species.id, plant.x + Math.cos(angle) * range, plant.y + Math.sin(angle) * range, [plant.id]);
            plant.storedEnergy -= 0.35;
          }
        }
        if (plant.health <= 0 || plant.age > 260 + species.maximumBiomass * 20) dead.push(plant);
      }
      for (const plant of dead) this.killPlant(plant, "stress");
    }

    needsSystem(dt) {
      for (const animal of this.world.animals.values()) {
        const species = this.world.species[animal.speciesId];
        const cell = this.world.getCell(animal.x, animal.y);
        const metabolism = species.baseMetabolism * lerp(0.75, 1.65, animal.genome.metabolism);
        animal.hunger = clamp(animal.hunger + metabolism * dt * 0.28, 0, 1);
        animal.thirst = clamp(animal.thirst + (0.0045 / lerp(0.55, 1.35, animal.genome.waterEfficiency)) * dt, 0, 1);
        animal.energy = clamp(animal.energy - metabolism * dt * (animal.state === "hunting" ? 0.32 : 0.12), 0, 1);
        if (animal.state === "resting" && animal.hunger < 0.75 && animal.thirst < 0.75) {
          animal.energy = clamp(animal.energy + dt * 0.014, 0, 1);
        }
        if (cell && cell.water > 0.42 && animal.thirst > 0.08) {
          const drink = Math.min(animal.thirst, 0.12 * dt);
          animal.thirst -= drink;
          if (cell.terrainType !== "water") cell.water = clamp(cell.water - drink * 0.18, 0, 1);
        }
        if (animal.hunger > 0.92 || animal.thirst > 0.94) {
          animal.health -= dt * 0.055;
        } else if (animal.energy <= 0.02) {
          animal.health -= dt * 0.003;
        } else {
          animal.health = clamp(animal.health + dt * 0.01, 0, 1);
        }
        for (const key of Object.keys(animal.cooldowns)) {
          animal.cooldowns[key] = Math.max(0, animal.cooldowns[key] - dt);
        }
      }
    }

    perceptionSystem() {
      for (const animal of this.world.animals.values()) {
        const species = this.world.species[animal.speciesId];
        const radius = 3 + animal.genome.vision * 9 + animal.genome.smell * 4;
        const nearbyAnimals = this.world.getNearbyAnimals(animal, radius).filter((item) => item.id !== animal.id);
        const nearbyPlants = this.world.getNearbyPlants(animal, radius);
        const perception = { plants: [], prey: [], carrion: [], predators: [], rivals: [], mates: [], water: null };
        for (const other of nearbyAnimals) {
          const otherSpecies = this.world.species[other.speciesId];
          if (species.diet === "carnivore" && otherSpecies.diet === "herbivore") perception.prey.push(other);
          if (species.diet === "herbivore" && otherSpecies.diet === "carnivore") perception.predators.push(other);
          if (other.speciesId === animal.speciesId && other.sex !== animal.sex && this.canMate(animal, other)) perception.mates.push(other);
          if (other.speciesId === animal.speciesId && other.territoryId && animal.territoryId && other.territoryId !== animal.territoryId) perception.rivals.push(other);
        }
        if (species.diet === "herbivore") {
          perception.plants = nearbyPlants
            .filter((plant) => plant.biomass > 0.18)
            .sort((a, b) => distance(animal, a) - distance(animal, b))
            .slice(0, 8);
        }
        perception.prey.sort((a, b) => scorePrey(animal, a, this.world) - scorePrey(animal, b, this.world));
        if (species.diet === "carnivore") {
          perception.carrion = this.world.getNearbyFrom(this.world.corpses, animal.x, animal.y, radius)
            .filter((corpse) => corpse.biomass > 0.08)
            .sort((a, b) => distance(animal, a) - distance(animal, b))
            .slice(0, 4);
        }
        perception.predators.sort((a, b) => distance(animal, a) - distance(animal, b));
        perception.mates.sort((a, b) => distance(animal, a) - distance(animal, b));
        perception.water = this.findWater(animal, radius);
        animal.perception = perception;
      }
    }

    behaviorSystem() {
      for (const animal of this.world.animals.values()) {
        const species = this.world.species[animal.speciesId];
        const danger = animal.perception.predators.length ? clamp(1.2 - distance(animal, animal.perception.predators[0]) / 8, 0, 1) : 0;
        const mateDrive = this.canReproduceSoon(animal) && animal.perception.mates.length ? 0.45 + animal.genome.reproductionRate * 0.35 : 0;
        const territoryNeed = species.territorial && !animal.territoryId && animal.age > species.reproductionAge ? 0.36 : 0;
        const priorities = {
          safety: danger * (0.55 + animal.genome.fear * 0.75),
          thirst: animal.thirst * 1.05,
          food: animal.hunger * (species.diet === "carnivore" ? 1.1 : 0.95),
          rest: animal.energy < 0.5 && animal.hunger < 0.96 && animal.thirst < 0.9 ? (0.75 - animal.energy) * 1.2 : 0,
          mate: mateDrive,
          territory: territoryNeed
        };
        let goal = "wander";
        let best = 0.18 + animal.genome.curiosity * 0.18;
        for (const [key, value] of Object.entries(priorities)) {
          if (value > best) {
            best = value;
            goal = key;
          }
        }
        animal.goal = goal;
        animal.targetId = null;
        if (goal === "safety" && animal.perception.predators[0]) {
          animal.state = "fleeing";
          animal.targetId = animal.perception.predators[0].id;
        } else if (goal === "thirst" && animal.perception.water) {
          animal.state = "seeking_water";
        } else if (goal === "food" && species.diet === "herbivore" && animal.perception.plants[0]) {
          animal.state = "foraging";
          animal.targetId = animal.perception.plants[0].id;
        } else if (goal === "food" && species.diet === "carnivore" && animal.perception.carrion[0]) {
          animal.state = "scavenging";
          animal.targetId = animal.perception.carrion[0].id;
        } else if (goal === "food" && species.diet === "carnivore" && animal.perception.prey[0]) {
          animal.state = "hunting";
          animal.targetId = animal.perception.prey[0].id;
        } else if (goal === "mate" && animal.perception.mates[0]) {
          animal.state = "seeking_mate";
          animal.targetId = animal.perception.mates[0].id;
        } else if (goal === "territory") {
          animal.state = "claiming";
        } else if (goal === "rest") {
          animal.state = "resting";
        } else {
          animal.state = "wandering";
        }
      }
    }

    movementSystem(dt) {
      for (const animal of this.world.animals.values()) {
        const species = this.world.species[animal.speciesId];
        const speed = (0.7 + animal.genome.speed * 2.2) * (animal.energy > 0.15 ? 1 : 0.45);
        let tx = null;
        let ty = null;
        if (animal.state === "fleeing") {
          const predator = this.world.animals.get(animal.targetId);
          if (predator) {
            tx = animal.x + (animal.x - predator.x) * 2;
            ty = animal.y + (animal.y - predator.y) * 2;
          }
        } else if (animal.state === "foraging") {
          const plant = this.world.plants.get(animal.targetId);
          if (plant) { tx = plant.x; ty = plant.y; }
        } else if (animal.state === "hunting" || animal.state === "seeking_mate") {
          const target = this.world.animals.get(animal.targetId);
          if (target) { tx = target.x; ty = target.y; }
        } else if (animal.state === "scavenging") {
          const target = this.world.corpses.get(animal.targetId);
          if (target) { tx = target.x; ty = target.y; }
        } else if (animal.state === "seeking_water" && animal.perception.water) {
          tx = animal.perception.water.x + 0.5;
          ty = animal.perception.water.y + 0.5;
        } else if (animal.state === "claiming") {
          tx = animal.x + this.world.random.range(-2, 2);
          ty = animal.y + this.world.random.range(-2, 2);
        } else if (animal.state === "resting") {
          animal.vx *= 0.75;
          animal.vy *= 0.75;
        } else if (!animal.wanderTarget || distance(animal, animal.wanderTarget) < 1 || this.world.random.chance(0.03)) {
          const territory = animal.territoryId ? this.world.territories.get(animal.territoryId) : null;
          const anchor = territory || animal;
          animal.wanderTarget = {
            x: clamp(anchor.x + this.world.random.range(-6, 6), 1, this.world.width - 1),
            y: clamp(anchor.y + this.world.random.range(-6, 6), 1, this.world.height - 1)
          };
        }
        if (tx === null && animal.state !== "resting" && animal.wanderTarget) {
          tx = animal.wanderTarget.x;
          ty = animal.wanderTarget.y;
        }
        if (tx !== null) {
          const dx = tx - animal.x;
          const dy = ty - animal.y;
          const len = Math.hypot(dx, dy) || 1;
          const jitter = (animal.genome.curiosity - 0.5) * 0.4;
          const ax = dx / len + this.world.random.range(-jitter, jitter);
          const ay = dy / len + this.world.random.range(-jitter, jitter);
          animal.vx = lerp(animal.vx, ax * speed, 0.18);
          animal.vy = lerp(animal.vy, ay * speed, 0.18);
        }
        const nx = animal.x + animal.vx * dt;
        const ny = animal.y + animal.vy * dt;
        const cell = this.world.getCell(nx, ny);
        if (cell && cell.terrainType !== "rock") {
          const waterSlow = cell.terrainType === "water" ? 0.25 : 1;
          this.world.moveAnimal(animal, animal.x + animal.vx * dt * waterSlow, animal.y + animal.vy * dt * waterSlow);
        } else {
          animal.vx *= -0.35;
          animal.vy *= -0.35;
        }
        animal.energy = clamp(animal.energy - (Math.abs(animal.vx) + Math.abs(animal.vy)) * dt * 0.0007 * species.size, 0, 1);
      }
    }

    territorySystem() {
      for (const animal of this.world.animals.values()) {
        const species = this.world.species[animal.speciesId];
        if (!species.territorial || animal.territoryId || animal.age < species.reproductionAge || animal.energy < 0.38) continue;
        const nearbySame = this.world.getNearbyAnimals(animal, species.territoryRadius)
          .filter((other) => other.id !== animal.id && other.speciesId === animal.speciesId && other.territoryId);
        if (nearbySame.length > 2) continue;
        const id = this.world.createId("t");
        const territory = {
          id,
          ownerIds: new Set([animal.id]),
          x: animal.x,
          y: animal.y,
          radius: species.territoryRadius * lerp(0.75, 1.25, animal.genome.strength),
          resources: this.estimateTerritoryResources(animal.x, animal.y, species.territoryRadius),
          strength: animal.genome.strength + animal.energy,
          markedLocations: [{ x: animal.x, y: animal.y }]
        };
        this.world.territories.set(id, territory);
        animal.territoryId = id;
        this.world.events.emit("territoryClaimed", { territory, time: this.world.time });
      }
      for (const territory of this.world.territories.values()) {
        territory.ownerIds = new Set([...territory.ownerIds].filter((id) => this.world.animals.has(id)));
        if (!territory.ownerIds.size) this.world.territories.delete(territory.id);
      }
    }

    combatSystem() {
      for (const animal of this.world.animals.values()) {
        const species = this.world.species[animal.speciesId];
        if (species.diet !== "carnivore" || animal.state !== "hunting") continue;
        const prey = this.world.animals.get(animal.targetId);
        if (!prey || distance(animal, prey) > 1.6) continue;
        const ability = species.abilities.find((item) => (animal.cooldowns[item.id] || 0) <= 0 && distance(animal, prey) <= item.range);
        if (!ability || animal.energy < ability.energyCost) continue;
        const hitChance = clamp(0.35 + animal.genome.speed * 0.25 + animal.genome.strength * 0.25 - prey.genome.speed * 0.22, 0.12, 0.92);
        animal.energy -= ability.energyCost;
        animal.cooldowns[ability.id] = ability.cooldown;
        if (this.world.random.chance(hitChance)) {
          const damage = ability.damage * lerp(0.75, 1.45, animal.genome.strength) / lerp(0.8, 1.4, prey.genome.size);
          prey.health -= damage;
          prey.energy -= damage * 0.25;
          prey.state = "fleeing";
          prey.targetId = animal.id;
          this.world.events.emit("organismAttacked", { attacker: animal, target: prey, ability, damage, time: this.world.time });
          if (prey.health <= 0) {
            animal.hunger = clamp(animal.hunger - 0.45, 0, 1);
            animal.energy = clamp(animal.energy + 0.42, 0, 1);
            this.killAnimal(prey, "predation");
          }
        }
      }
    }

    feedingSystem(dt) {
      for (const animal of this.world.animals.values()) {
        const species = this.world.species[animal.speciesId];
        if (species.diet === "herbivore") {
          const plant = this.world.plants.get(animal.targetId);
          if (!plant || distance(animal, plant) > 0.8) continue;
          const bite = Math.min(plant.biomass, 0.012 * dt * (0.8 + animal.genome.size));
          plant.biomass -= bite;
          plant.health -= bite * 0.05;
          animal.hunger = clamp(animal.hunger - bite * 1.2, 0, 1);
          animal.energy = clamp(animal.energy + bite * 1.2, 0, 1);
          if (plant.biomass < 0.04 || plant.health <= 0) this.killPlant(plant, "eaten");
        } else if (species.diet === "carnivore") {
          const targetCorpse = this.world.corpses.get(animal.targetId);
          const corpses = targetCorpse ? [targetCorpse] : this.world.getNearbyFrom(this.world.corpses, animal.x, animal.y, 1.2);
          const corpse = corpses.find((item) => item.biomass > 0.05 && distance(animal, item) <= 1.2);
          if (!corpse) continue;
          const bite = Math.min(corpse.biomass, 0.035 * dt);
          corpse.biomass -= bite;
          animal.hunger = clamp(animal.hunger - bite * 1.8, 0, 1);
          animal.energy = clamp(animal.energy + bite * 1.25, 0, 1);
        }
      }
    }

    reproductionSystem(dt) {
      for (const animal of [...this.world.animals.values()]) {
        const species = this.world.species[animal.speciesId];
        if (animal.pregnancy) {
          animal.pregnancy.age += dt / 60;
          if (animal.pregnancy.age >= species.gestationTime) {
            const jitter = () => this.world.random.range(-1.2, 1.2);
            this.spawnAnimal(species.id, animal.x + jitter(), animal.y + jitter(), animal.pregnancy.genome, animal.pregnancy.parentIds);
            animal.pregnancy = null;
            animal.energy = clamp(animal.energy - 0.22, 0, 1);
          }
          continue;
        }
        if (animal.sex !== "F" || !this.canReproduceSoon(animal) || animal.energy < 0.56 || animal.hunger > 0.45 || animal.thirst > 0.52) continue;
        const mate = animal.perception.mates.find((other) => distance(animal, other) < 1.1 && other.energy > 0.45);
        if (!mate) continue;
        const chance = 0.18 * animal.genome.reproductionRate;
        if (!this.world.random.chance(chance)) continue;
        animal.pregnancy = {
          age: 0,
          genome: combineGenomes(animal.genome, mate.genome, this.world.random),
          parentIds: [animal.id, mate.id]
        };
        animal.energy -= 0.08;
        mate.energy -= 0.04;
      }
    }

    agingSystem(dt) {
      for (const animal of this.world.animals.values()) {
        const species = this.world.species[animal.speciesId];
        animal.age += dt / 60;
        const maxAge = species.lifespan * lerp(0.75, 1.35, animal.genome.lifespan);
        if (animal.age > maxAge) animal.health -= dt * 0.09 * (animal.age / maxAge);
      }
    }

    deathSystem() {
      for (const animal of [...this.world.animals.values()]) {
        if (animal.health <= 0 || animal.energy <= 0 && animal.hunger > 0.9) {
          this.killAnimal(animal, animal.health <= 0 ? "injury" : "starvation");
        }
      }
    }

    decompositionSystem(dt) {
      for (const corpse of [...this.world.corpses.values()]) {
        const cell = this.world.getCell(corpse.x, corpse.y);
        const decay = Math.min(corpse.biomass, (0.035 + (cell ? cell.moisture * 0.045 : 0.02)) * dt);
        corpse.biomass -= decay;
        if (cell) cell.nutrients = clamp(cell.nutrients + decay * 0.45, 0, 1);
        if (corpse.biomass <= 0.03) {
          this.world.unindexEntity(corpse, "corpse");
          this.world.corpses.delete(corpse.id);
        }
      }
    }

    populationSystem() {
      const stats = createStatistics();
      let ageSum = {};
      let count = {};
      let genomeTotals = {};
      for (const plant of this.world.plants.values()) {
        stats.populationBySpecies[plant.speciesId] = (stats.populationBySpecies[plant.speciesId] || 0) + 1;
        stats.biomass += plant.biomass;
      }
      for (const animal of this.world.animals.values()) {
        stats.populationBySpecies[animal.speciesId] = (stats.populationBySpecies[animal.speciesId] || 0) + 1;
        stats.biomass += this.world.species[animal.speciesId].size;
        ageSum[animal.speciesId] = (ageSum[animal.speciesId] || 0) + animal.age;
        count[animal.speciesId] = (count[animal.speciesId] || 0) + 1;
        genomeTotals[animal.speciesId] ||= {};
        for (const [key, value] of Object.entries(animal.genome)) {
          genomeTotals[animal.speciesId][key] = (genomeTotals[animal.speciesId][key] || 0) + value;
        }
      }
      for (const [id, total] of Object.entries(ageSum)) stats.averageAge[id] = total / count[id];
      for (const [id, genes] of Object.entries(genomeTotals)) {
        stats.averageGenome[id] = {};
        for (const [key, value] of Object.entries(genes)) stats.averageGenome[id][key] = value / count[id];
      }
      let water = 0, nutrients = 0, sunlight = 0, soil = 0, covered = 0;
      for (const cell of this.world.cells) {
        water += cell.water;
        nutrients += cell.nutrients;
        sunlight += cell.sunlight;
        if (cell.terrainType === "soil") soil++;
        if (cell.vegetationIds.size) covered++;
      }
      stats.resourceLevels = {
        water: water / this.world.cells.length,
        nutrients: nutrients / this.world.cells.length,
        sunlight: sunlight / this.world.cells.length
      };
      stats.plantCoverage = soil ? covered / soil : 0;
      stats.territoryCount = this.world.territories.size;
      stats.birthsBySpecies = { ...this.world.statistics.birthsBySpecies };
      stats.deathsBySpecies = { ...this.world.statistics.deathsBySpecies };
      const history = this.world.statistics.history || [];
      history.push({
        time: this.world.time,
        day: this.world.day,
        populations: { ...stats.populationBySpecies },
        resources: { ...stats.resourceLevels },
        biomass: stats.biomass
      });
      if (history.length > 240) history.shift();
      stats.history = history;
      this.world.statistics = stats;
    }

    estimateTerritoryResources(x, y, radius) {
      let food = 0, water = 0, cells = 0;
      for (let yy = Math.floor(y - radius); yy <= Math.ceil(y + radius); yy++) {
        for (let xx = Math.floor(x - radius); xx <= Math.ceil(x + radius); xx++) {
          const cell = this.world.getCell(xx, yy);
          if (!cell || Math.hypot(xx - x, yy - y) > radius) continue;
          cells++;
          water += cell.water;
          food += cell.vegetationIds.size + cell.nutrients * 0.3;
        }
      }
      return { food, water: cells ? water / cells : 0 };
    }

    canMate(a, b) {
      return a.speciesId === b.speciesId && a.sex !== b.sex && this.canReproduceSoon(a) && this.canReproduceSoon(b);
    }

    canReproduceSoon(animal) {
      const species = this.world.species[animal.speciesId];
      return animal.age >= species.reproductionAge && !animal.pregnancy;
    }

    findWater(animal, radius) {
      let best = null;
      let bestScore = -Infinity;
      for (let y = Math.floor(animal.y - radius); y <= Math.ceil(animal.y + radius); y++) {
        for (let x = Math.floor(animal.x - radius); x <= Math.ceil(animal.x + radius); x++) {
          const cell = this.world.getCell(x, y);
          if (!cell || cell.water < 0.42) continue;
          const d = Math.hypot(x + 0.5 - animal.x, y + 0.5 - animal.y);
          if (d > radius) continue;
          const score = cell.water - d * 0.035;
          if (score > bestScore) {
            bestScore = score;
            best = cell;
          }
        }
      }
      return best;
    }

    killPlant(plant, cause) {
      if (!this.world.plants.has(plant.id)) return;
      const cell = this.world.getCell(plant.x, plant.y);
      if (cell) cell.nutrients = clamp(cell.nutrients + plant.biomass * 0.1, 0, 1);
      this.world.unindexEntity(plant, "plant");
      this.world.plants.delete(plant.id);
      if (plant.biomass > 0.12) this.createCorpse(plant, plant.biomass * 0.35, cause);
    }

    killAnimal(animal, cause) {
      if (!this.world.animals.has(animal.id)) return;
      this.world.unindexEntity(animal, "animal");
      this.world.animals.delete(animal.id);
      this.createCorpse(animal, this.world.species[animal.speciesId].size * 1.6, cause);
      this.world.statistics.deathsBySpecies[animal.speciesId] = (this.world.statistics.deathsBySpecies[animal.speciesId] || 0) + 1;
      this.world.events.emit("organismDied", { organism: animal, cause, time: this.world.time });
    }

    createCorpse(source, biomass, cause) {
      const corpse = {
        id: this.world.createId("c"),
        x: source.x,
        y: source.y,
        speciesId: source.speciesId,
        biomass,
        cause,
        age: 0
      };
      this.world.corpses.set(corpse.id, corpse);
      this.world.indexEntity(corpse, "corpse");
      return corpse;
    }
  }

  function scorePrey(predator, prey) {
    return distance(predator, prey) - prey.health * 0.6 + prey.genome.speed * 0.8;
  }

  return { Simulation, World, SpeciesRegistry, Random, SIM_DT, combineGenomes };
});
