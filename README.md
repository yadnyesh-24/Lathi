# Lathi — IITK Accessible

Accessibility-aware pedestrian navigation for IIT Kanpur, built on OpenStreetMap data.
Pick **From**, **To** and a profile (**Normal** / **Wheelchair**) and get the most
*suitable* route, not just the shortest one, drawn Google-Maps-style with turn-by-turn steps.

The full product plan is in [`Plan.md`](Plan.md). This README covers what is built and how to run it.

## Stack

| Concern | Choice |
|---|---|
| UI | React 19 + JSX, Vite 7 (no TypeScript) |
| Map | MapLibre GL JS, OpenFreeMap vector tiles (free, no key) |
| Routing | Profile-weighted A*/Dijkstra written in plain JS, runs **in the browser** over `public/data/graph.json` (no server) |
| Search | Fuse.js over `public/data/places.json` |
| Data | OpenStreetMap via Overpass → committed snapshot → build script → static JSON/GeoJSON |
| Tests | Node's built-in test runner (`node --test`) |
| Hosting | Any static host (Vercel / Netlify / GitHub Pages) |

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # routing unit tests + campus integration tests
npm run build      # production build into dist/
```

## Data pipeline (how the map gets updated)

```
OpenStreetMap  ──npm run data:fetch──▶  data/raw/iitk.osm.json  ──npm run data:build──▶  public/data/*
  (edit in JOSM)                          (committed snapshot)                            (what the site loads)
```

1. Survey, then edit the map in **JOSM** (or the OSM web editor) using standard tags — see the cheat-sheet in `Plan.md` §3. Upload with the changeset hashtag `#IITKAccessible`.
2. Refresh the site's data:
   ```bash
   npm run data:refresh      # = data:fetch + data:build
   ```
   Commit the regenerated `data/raw/iitk.osm.json` and `public/data/*`, push, and the deployed site updates.
3. To preview **unuploaded** JOSM edits first, save the session as `.osm` and build straight from it:
   ```bash
   node scripts/build-data.mjs --file data/josm-sessions/2026-09-10.osm
   ```
   (`.osm` files are git-ignored; JOSM's single-quoted attributes and `action=` marks are understood.)
   If Overpass lags behind a fresh upload, fetch straight from the live API instead: `node scripts/fetch-osm.mjs --osm-api`.
4. App-only extras that OSM tags cannot hold (photos, survey notes) go in `data/overrides.json`, keyed by OSM id.

`npm run data:fetch` tries three Overpass mirrors and falls back to the OSM API. The snapshot is committed so builds are reproducible and the site never depends on Overpass being up.

### Generated files (`public/data/`)

| File | Contents |
|---|---|
| `graph.json` | Level-aware routing graph: `nodes` (`"<osmId>@<level>" → [lon, lat, level]`), `edges` (`[from, to, metres, wayId]`), `ways` (tags per way, plus synthetic `elev<nodeId>` lifts), `nodeTags` |
| `buildings.geojson` | Building footprints (closed ways **and** multipolygon relations) with name, floors, entrance count, `inAcademicArea` |
| `indoor.geojson` | Corridors, rooms and doors with their `level`, for the floor switcher |
| `features.geojson` | Accessibility features: ramps, stairs, skywalks, crossings, lifts, entrances, benches, rest areas, toilets, drinking water |
| `places.json` | Search index: buildings (with entrance nodes), entrances, **rooms** (e.g. "Room 201 (Tutorial Block)", "Lecture Hall 9"), landmarks |
| `qa.json` | Data-quality issues for the mapping team (see below) |
| `academic-area.geojson` | Hand-drawn detailed-coverage polygon (edit by hand) |
| `meta.json` | Counts and snapshot timestamp shown in the UI footer |

## Floors and level changes

Every graph node is `"<osmNodeId>@<level>"`. A way tagged `level=1` connects its nodes on floor 1 only; outdoor ways without a `level` tag are floor 0. Two floors are joined **only** through:

| Connector in OSM | Who can use it |
|---|---|
| `highway=steps` + `level=0;1` | Normal only (forbidden for wheelchair unless `ramp:wheelchair=yes`) |
| `highway=footway` + `ramp=yes` + `incline=6%` + `level=0;1` | Both; cost depends on incline |
| node `highway=elevator` + `level=0;1;2` | Both (×0.8 for wheelchair, +20 s wait for normal) |

Nothing else joins floors: a level-0 and a level-1 corridor that share a node without stairs there is a wall. The router picks whichever connector makes the whole trip cheapest, so "use the nearest ramp" falls out of the shortest-path search. Directions say "Take the stairs up to Level 1 (14 steps)", "Take the ramp down to Ground (6%)", "Take the lift to Level 2". The floor switcher (G / 1 / 2) on the map filters indoor rooms, corridors and features; the route is drawn solid on the selected floor and dashed on other floors.

Mapping rules that make this work (full guide in the chat/plan): each floor uses its own nodes; only stairs/ramps/lifts share nodes across floors; entrance nodes sit **on** the building outline and are shared with the corridor or the stairs; `level=a;b` only on connectors.

## Doors, aliases and building rules

- Searching a building routes to **one of its doors**; the router tries every mapped door before it ever falls back to "nearest path". Doors are not listed as separate search entries unless they have their own name.
- Short forms work: `LH7`, `LH 7`, `L7` → Lecture Hall 7; OSM `short_name` / `alt_name` / `official_name` are indexed too, and a room's number (`202`) finds "Room 202 (Tutorial Block)".
- `data/routing-rules.json` holds hand-written rules per building. For the Tutorial Block: room floor from the number (1xx → ground, 2xx → level 1) when OSM has no `level`, and fixed arrival doors — wheelchair: node 2734116498 (ground, right side) / node 14152492797 (level 1, right side, via the ramp); normal: any of those or the top door 13657840007.
- A staircase is never a wheelchair path, whatever it is tagged; a ramp beside stairs must be drawn as its own `ramp=yes` way.

## Map layers and colours

The layer picker (bottom-left) switches between **Buildings** (base map + building names) and **Paths** (every walkable way): ground paths `rgb(122,198,255)`, level 1+ / skywalks `rgb(2,109,180)`, ramps `rgb(255,237,90)`, stairs `rgb(255,176,55)`, the chosen route `rgb(255,0,255)` (with a stairs/ramp-coloured casing on connector sections). Colours live in `PATH_COLORS` in `data/config.js`; the paths come from `public/data/paths.geojson`. URL: `?mode=buildings`.

## Map data check (QA)

`npm run data:build` also writes `public/data/qa.json`, shown in the site's **Map data check** panel and as dots on the map (`?qa=1`). It flags: disconnected path islands, entrances not on any path, `level=a;b` footways without ramp/stairs tags (they act as free level changes), stairs/ramps ending in mid-air, floors sharing a node without a connector, ramps steeper than 8 %, and Academic-Area buildings with no entrance node. Each item has *View on OSM* and *Open in JOSM* (JOSM Remote Control) links.

## Routing rules

Cost per edge = `length × factor + penalties`. Forbidden edges are simply never used.

| Rule | Normal | Wheelchair |
|---|---|---|
| `highway=steps` | ×1.2 **+ 15 m per flight** | forbidden unless `ramp:wheelchair=yes` |
| `wheelchair=no` | ×1 | forbidden |
| ramp (`ramp=yes`, `ramp:wheelchair=yes`, or a sloped `level=0;1` footway) | ×1 | **always usable, ×0.8** (incline ignored — campus ramps are built for wheelchairs) |
| `incline` > 8 % or `steep` on an ordinary path (not a ramp) | ×1 | ×6 |
| `incline` 5–8 % on an ordinary path | ×1 | ×2.5 |
| `width` < 0.9 m | ×1 | ×4 |
| loose surface (gravel/sand/ground/unpaved…) | ×1.1 | ×3 |
| `smoothness` bad/very_bad | ×1.1 | ×4 |
| crossing with `kerb=raised` | +5 m | +200 m |
| confirmed ramp (`wheelchair=yes`) / `highway=elevator` | ×1 | ×0.8 |
| roads without a sidewalk (both profiles prefer footways) | ×1.1–1.35 | ×1.1–1.35 |

If the Wheelchair profile finds no path the UI says *"No step-free route known yet between these points"* rather than silently falling back. When Wheelchair is selected the shortest Normal route is also computed and drawn dashed grey for comparison ("Avoids 2 staircases on the shortest route (+120 m)").

Routing currently works across the whole campus using whatever OSM already has; endpoints outside the Academic Area produce a warning, not a refusal. Flip `RESTRICT_ROUTING_TO_ACADEMIC_AREA` in `data/config.js` to enforce the strict behaviour from the plan.

## Using the site

- Search a building/room/entrance/landmark in **A** and **B**, or click anywhere on the map → *Directions from here / to here* (a click on an upper floor drops the pin on that floor). Clicking a building, room or feature shows its attributes, floor and last-checked date.
- Hover a direction step to highlight it on the map; click it to zoom there and switch to that floor.
- Links are shareable: `/?from=way/123&to=Rajeev%20Motwani%20Building&profile=wheelchair&level=1` (ids or names both work).
- Layer toggles (buildings, indoor, features, snap points) are at the bottom of the panel. *Snap points* shows exactly where each endpoint joined the path network, useful when a route starts somewhere unexpected.

## Repository layout

```
.
├── index.html, vite.config.js
├── src/
│   ├── main.jsx, App.jsx, styles.css
│   ├── components/      MapView, SearchBox, ProfilePicker, FeaturePopup, RouteSummary, FloorSwitcher, QaPanel, QaPopup
│   └── lib/
│       ├── routing/     graph, profiles, dijkstra (A*), snap, directions, route
│       ├── geo/         haversine, pointInPolygon, bbox
│       ├── levels.js    level parsing, node keys, labels
│       ├── features.js  OSM tags → feature kind
│       ├── osmLinks.js  OSM / JOSM remote-control links
│       └── data.js      loaders
├── scripts/
│   ├── fetch-osm.mjs    Overpass / OSM API → data/raw/iitk.osm.json
│   ├── build-data.mjs   raw OSM → public/data/*
│   └── osm-xml.mjs      .osm (JOSM) parser
├── data/
│   ├── config.js        campus bbox, zoom, profiles, feature kinds, routable highways
│   ├── raw/             committed OSM snapshot
│   ├── overrides.json   app-only extras keyed by OSM id
│   └── josm-sessions/   optional .osm backups (git-ignored)
├── public/data/         generated GeoJSON/JSON + hand-drawn academic-area.geojson
├── tests/               profiles, dijkstra, campus integration
└── Plan.md
```

## Current OSM coverage (snapshot in repo)

177 named buildings (incl. 5 multipolygons such as P K Kelkar Library), 124 entrances, 31 searchable rooms, 6,743 path points on 3 floors, 26 staircases, 2 ramps, 43 elevated walkways, **no lifts yet**, 4 crossings, and almost no kerb/width/surface tags. The Lecture Hall Complex and Tutorial Block have indoor corridors on levels 0–1. The *Map data check* panel lists what still needs fixing in JOSM (dead-end stairs, `level=1;0` footways that should be `level=1`, unconnected entrances at LH16–20, …).

Data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL.
