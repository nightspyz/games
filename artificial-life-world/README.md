# Artificial Life World Prototype

This is a first working prototype of the uploaded simulation-first artificial-life architecture.

The simulation core lives in `src/simulation.js` and has no dependency on canvas, DOM, or rendering. The browser UI in `src/app.js` reads world state and draws it, while the headless runner in `src/headless.js` runs the same simulation from Node.

## Run the UI

```bash
npm start
```

Open:

```text
http://localhost:4173
```

## Run Headlessly

```bash
npm run headless -- 12345 15
```

The arguments are seed and simulated days.

## Implemented Prototype Features

- Persistent world state with grid cells and chunk indexing.
- Environment resources: sunlight, water, nutrients, temperature, rain, season.
- Plant organisms that grow, consume resources, seed, die, and decompose into nutrients.
- Animal organisms with species definitions, individual state, needs, perception, goals, movement, drinking, feeding, aging, death.
- Herbivores and predators using the same behavior pipeline with different species data.
- Generic combat abilities.
- Sexual reproduction with crossover and mutation.
- Simple territory objects for territorial species.
- Event stream and population statistics.
- Fixed timestep in the UI, independent render loop, and system update frequencies.
- Headless simulation runner using the same simulation API.
- Zoom and pan in the renderer without changing simulation state.
- Emoji-based top-down organisms with more natural terrain texture and daylight shading.
