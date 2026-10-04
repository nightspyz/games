# Lantern Tide: how the wider world and its places of interest work

The game is one HTML file (`index.html`); this note describes the world systems inside it.

## Terrain: a deterministic grid of islands
- The world is a grid of 1300 m cells; alternate rows are shifted half a cell. `islandCell(i, j)` hashes the cell and the world seed
  (`?seed=` in the address) into an island: type, size, position (jittered so it lies wholly inside its cell), shape phases, and
  features (cliffs, a road, farmland). A third of the cells are open sea. Cells beyond `WORLD_N` are empty.
- An island's height is **one formula, written twice**: `isleBed` in JS (walking, building the land) and `islBed` in GLSL (the water's
  depth, breakers, foam). The nine cells round the camera are uniforms (`uIslA/B/C`), so the shaders need no loaded geometry.
- Revisiting a place cannot change it: everything derives from the cell hash. Neighbouring cells never share an island (no duplicates).

## Chunks: streaming
- `updateWorld` loads the cells within one cell of you: coarse land (14 m grid) first, then cheap instanced palms, then the island's
  extras (volcano smoke, temple, mangroves, city, airport, road, farm). Work is spent from a 3.5 ms-per-frame budget, nearest first,
  and everything starts well inside the haze, so nothing visibly loads.
- Near an island (about 600 m) the land is rebuilt finer, and (about 420 m) the instanced palms become the real wind-blown ones.
  Leaving reverses both. Leaving a cell unloads its chunk (geometry disposed, colliders removed).
- The curve of the earth: chunk materials sink by distance squared (`uCurve`), so islands come up over the horizon. The sea is flat.

## Places of interest (POIs)
- `definePOI({ id, types, chance, inland, elev, maxSlope, radius, flatTol, clear, blend, spacing, forest, proxy(), *detail() })`.
- Placement (`islandPOIs`, from the island seed alone): try spots at the allowed distance inland; keep the first that passes
  elevation, slope, a flat footprint ring with no water, forest density, and spacing from the others on the island.
- Adaptation: `poiFlatten` levels the ground under a POI and blends it out (applied in `bedHeightJS`, so walking and the mesh agree);
  palms keep clear (`poiKeepClear`); dirt paths run from each POI to the beach and between neighbours (tinted into the land).
- Streaming levels: metadata always; a merged-box **proxy** within 1.1 km; the full **detail** scene (props, lights, sounds, walkable
  porches and piers, interactions) within 130 m, dropped again beyond 200 m. Detail is built by a generator with a time budget.
- State (`poiSave`, also in localStorage): lit fires and lanterns, offerings, diary page, whether you have found the place (shown on the map).
- Interactions: `E` on a screen, or the trigger with a hand held close, on the highlighted object.

## Performance notes
- Merged geometry per prop group, instancing for trees, bales, poles and reeds, shared materials, canvas textures made once.
- The base scene (sea twice over, reef) is the heavy part; the world adds little (chunks far away are frustum-culled and coarse).
- Not yet tested on a headset: please check frame rate on the Quest 3 and tell me where it dips.
