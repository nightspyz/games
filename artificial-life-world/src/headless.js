const { Simulation, SIM_DT } = require("./simulation");

const seed = Number(process.argv[2] || 12345);
const days = Number(process.argv[3] || 15);
const sim = new Simulation({ seed, width: 96, height: 72, chunkSize: 16 });
const totalSeconds = days * 60;

for (let t = 0; t < totalSeconds; t += SIM_DT) {
  sim.update(SIM_DT);
}

const stats = sim.world.statistics;
console.log(`Headless run complete: seed ${seed}, ${days} simulated days`);
console.log(`Season: ${sim.world.season}`);
console.log("Populations:");
for (const [id, species] of Object.entries(sim.world.species)) {
  const pop = stats.populationBySpecies[id] || 0;
  const births = stats.birthsBySpecies[id] || 0;
  const deaths = stats.deathsBySpecies[id] || 0;
  console.log(`  ${species.name}: ${pop} alive, ${births} births, ${deaths} deaths`);
}
console.log(`Resources: water ${(stats.resourceLevels.water * 100).toFixed(1)}%, nutrients ${(stats.resourceLevels.nutrients * 100).toFixed(1)}%, sunlight ${(stats.resourceLevels.sunlight * 100).toFixed(1)}%`);
console.log(`Plant coverage: ${(stats.plantCoverage * 100).toFixed(1)}%`);
console.log(`Territories: ${stats.territoryCount}`);
