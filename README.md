# Lathi
# IITK Accessible — Frozen MVP Plan

Accessibility-aware navigation for IIT Kanpur. The website shows the whole IITK
campus as a base map, but the detailed accessibility layer and routing cover
only the **Academic Area**. Users pick From, To, and an accessibility profile
(Normal / Wheelchair first) and get the most *suitable* route, not just the
shortest one.

Team: 3 people. Timeline: ~1 month. Budget: free tiers only.

---

## 1. What is in / out of scope

**Must have**

- Full-IITK base map, viewport locked to the campus, opening on the Academic Area
- Academic Area boundary polygon drawn on the map (the "detailed coverage" zone)
- Search From / To among Academic Area buildings, entrances, landmarks
- Profiles: Normal, Wheelchair (Crutches / Elderly / Visually impaired only if time permits)
- Mapped accessibility features: ramps, stairs, skywalks, crossings, elevators,
  accessible entrances, benches, rest areas
- Click any feature → popup with its accessibility attributes and last-checked date
- Route rendering with a short summary (distance, ramps used, stairs avoided)

**Dropped**

- Complaint / problem reporting, AI classification, admin dashboard
- Real-time updates, user accounts, database writes from the website
- Detailed mapping outside the Academic Area
- Turn-by-turn / voice / live blue-dot navigation, native mobile app
- PostGIS / any server database (not needed at this data size — see §4)

---

## 2. Architecture

```
            Field survey (phone GPS + photos + notes)
                            │
                            ▼
                 JOSM (edit + validate)
                            │  upload
                            ▼
              OpenStreetMap database (global)
                            │
        ┌───────────────────┴───────────────────┐
        │ Overpass API (bbox = IIT Kanpur)       │  npm run data:fetch
        ▼                                       │
  data/raw/iitk.osm.json  (committed snapshot)  │
        │                                       │
        │  npm run data:build                    │
        ▼                                       │
  public/data/features.geojson   ← accessibility layer (Academic Area)
  data/graph.json                ← pedestrian routing graph (nodes/edges/tags)
  public/data/places.json        ← searchable buildings / entrances
  public/data/academic-area.geojson ← hand-drawn boundary polygon
        │
        ▼
  Next.js (TypeScript) on Vercel Hobby tier
    ├─ MapLibre GL JS map, basemap = free OSM-based tiles (see §5)
    ├─ /api/route  → profile-weighted Dijkstra over data/graph.json
    └─ UI: From/To search, profile picker, feature popups, route summary
```

Two data layers, kept separate:

| Layer | Lives in | Edited with | Contains |
|---|---|---|---|
| Geography + accessibility tags | OpenStreetMap | JOSM | footways, steps, ramps (`incline`, `width`, `surface`, `wheelchair`), skywalks, entrances, elevators, benches, crossings |
| App-only extras | `data/overrides.json` in this repo (keyed by OSM id) | text editor | photos, survey notes, anything OSM tagging cannot express |

We never edit the exported OSM JSON by hand. Fix the source (OSM via JOSM, or
the override file) and rebuild.

---

## 3. Where map editing happens and where data lives

1. **JOSM is only an editor.** Download the IITK area into JOSM → survey → add
   or retag features → run the JOSM Validator → upload. After upload the data
   lives in the global OSM database, not in JOSM.
2. Save a local `.osm` file of each editing session as a backup
   (`data/josm-sessions/`, optional). The build script can also read a `.osm`
   file directly, so unuploaded edits can be tested in the website first.
3. **Refreshing the site after edits:** `npm run data:fetch && npm run data:build`,
   commit the regenerated files, push. Vercel redeploys automatically. Overpass
   usually reflects OSM uploads within minutes. No live sync is needed for the
   demo; a fixed snapshot is fine.
4. The campus bounding box and the Academic Area polygon are stored in the repo
   (`data/config.ts` and `public/data/academic-area.geojson`). Approximate
   campus box to verify in overpass-turbo before use:
   `south 26.495, west 80.215, north 26.530, east 80.250`.

### OSM tagging cheat-sheet (use standard tags, never invent new ones)

| Feature | Tags |
|---|---|
| Ramp | `highway=footway` + `incline=6%` (or `up`/`down`), `width=1.5`, `surface=concrete`, `handrail=yes`, `wheelchair=yes`, `ramp=yes` |
| Staircase | `highway=steps`, `step_count=12`, `handrail=yes`, `width=`, `ramp=no` or `ramp:wheelchair=yes` if a ramp runs beside it |
| Skywalk | `highway=footway` + `bridge=yes` + `layer=1`, `covered=yes`, `lit=yes`, `wheelchair=` |
| Crossing | node `highway=crossing`, `crossing=marked/unmarked`, `kerb=lowered/raised`, `tactile_paving=yes/no` |
| Elevator | node `highway=elevator`, `wheelchair=yes`, `level=` |
| Accessible entrance | node on building outline `entrance=main/yes`, `wheelchair=yes/limited/no`, `door=`, `width=` |
| Bench | node `amenity=bench`, `seats=3`, `backrest=yes`, `armrest=yes`, `shelter=yes` (shade) |
| Rest area | `leisure=picnic_table` / `amenity=shelter` + `bench=yes`, `drinking_water=yes` nearby |
| Condition | `smoothness=excellent/good/intermediate/bad`, `check_date=YYYY-MM-DD` |

Rules the mapper must follow:

- Connectivity matters more than centimetre accuracy. Every ramp / stair /
  skywalk must **share a node** with the footway it joins. Run Validator before
  each upload ("Way end node near other way", "Crossing ways").
- Use Bing / Esri / Maxar imagery inside JOSM. Never trace from Google Maps
  (licence-incompatible with OSM).
- Each team member uses their own OSM account, writes meaningful changeset
  comments, and adds the hashtag `#IITKAccessible` so edits can be found later.

---

## 4. Routing (the project's contribution)

- Build a graph from OSM ways with `highway` in
  `footway, path, pedestrian, steps, corridor, living_street, residential,
  service, unclassified, tertiary, elevator`. Nodes = OSM nodes, edges =
  consecutive node pairs with haversine length and the parent way's tags.
- Snap From / To to the nearest graph node (prefer the building's `entrance` nodes).
- Cost per edge = `length × surfaceFactor + penalties`, where penalties and
  factors depend on the profile. Dijkstra (or A*) in TypeScript; the graph is
  a few thousand nodes so a request finishes in milliseconds.

| Rule | Normal | Wheelchair |
|---|---|---|
| `highway=steps` | ×1.2 | forbidden unless `ramp:wheelchair=yes` |
| `wheelchair=no` | ×1 | forbidden |
| `incline` > 8 % (or `steep`) | ×1 | ×6 |
| `incline` 5–8 % | ×1 | ×2.5 |
| `width` < 0.9 m | ×1 | ×4 |
| `surface` in gravel/sand/ground/unpaved | ×1.1 | ×3 |
| `smoothness` bad/very_bad | ×1.1 | ×4 |
| crossing with `kerb=raised` | +5 m | +200 m |
| `wheelchair=yes` ramp / `highway=elevator` | ×1 | ×0.8 (preferred) |

If Wheelchair finds no path, tell the user honestly ("No step-free route
known yet between these points") instead of silently returning the Normal route.

Both endpoints must be inside the Academic Area polygon; otherwise the UI shows
"Detailed accessible routing is currently available inside the IITK Academic
Area only."

---

## 5. Web stack (all free)

| Concern | Choice | Cost |
|---|---|---|
| Framework | Next.js 15, TypeScript, Tailwind, shadcn/ui | free |
| Map | MapLibre GL JS (`react-map-gl/maplibre`) | free |
| Basemap tiles | OpenFreeMap vector tiles (no key, no quota). Fallback: MapTiler free tier or `tile.openstreetmap.org` raster (attribution required, light use only) | free |
| Accessibility layer | our own `features.geojson` rendered by MapLibre — always matches our snapshot, independent of tile refresh delays | free |
| Search | `places.json` built from OSM building/entrance names + client-side fuzzy search (Fuse.js). No geocoder service needed | free |
| Routing API | Next.js Route Handler `/api/route`, graph JSON loaded in memory | free |
| Hosting | Vercel Hobby (`*.vercel.app` domain, auto-deploy on push) | free |
| Data refresh | Overpass API + `osmtogeojson` in `scripts/` | free |
| Optional later | Protomaps PMTiles extract of IITK (~few MB static file) if we want tiles restricted to campus only | free |

Map behaviour:

- `maxBounds` = IITK campus box so users cannot pan away; `minZoom` ≈ 14.
- Initial view = Academic Area at zoom ≈ 16.5.
- Outside the Academic Area polygon: base map only, lightly dimmed, with a
  "coverage limited" hint. Inside: full feature layer + popups + routing.

---

## 6. Repository layout

```
.
├── app/                    Next.js app router (map page, /api/route)
├── components/             Map, SearchBox, ProfilePicker, FeaturePopup, RouteSummary
├── lib/routing/            graph loader, profiles, dijkstra, snapping
├── lib/geo/                haversine, point-in-polygon, bbox helpers
├── scripts/
│   ├── fetch-osm.ts        Overpass query → data/raw/iitk.osm.json
│   └── build-data.ts       raw OSM (json or .osm) → geojson / graph / places
├── data/
│   ├── config.ts           campus bbox, academic-area centre, zoom defaults
│   ├── raw/                committed OSM snapshot (source of truth for a build)
│   ├── overrides.json      app-only extras keyed by OSM id
│   └── graph.json          generated routing graph
├── public/data/            features.geojson, places.json, academic-area.geojson
└── PLAN.md
```

---

## 7. Team split

| Person | Owns |
|---|---|
| 1 — Mapping + data | Survey coordination, JOSM editing, tagging QA, Academic Area polygon, `check_date` upkeep, `overrides.json` |
| 2 — Frontend | Map page, search, profile picker, feature popups, route rendering, mobile layout |
| 3 — Data pipeline + routing | `fetch-osm` / `build-data` scripts, graph builder, profile weights, `/api/route`, tests for connectivity and forbidden-edge rules |

Everyone surveys when needed.

---

## 8. Four-week plan

| Week | Goal | Done when |
|---|---|---|
| 1 | Map on screen | Overpass snapshot committed; Next.js + MapLibre page deployed to Vercel; viewport locked to IITK; Academic Area polygon drawn; JOSM set up; survey sheet designed; survey starts |
| 2 | Accessibility layer | Features from OSM render with icons; clicking shows attributes + check date; places search works; first JOSM uploads done and pulled into the snapshot |
| 3 | Routing | Normal and Wheelchair routes differ where they should; endpoints outside Academic Area rejected gracefully; no-route case handled |
| 4 | Polish + demo | Extra profiles if time; mobile layout; README; data refresh rehearsed end-to-end; demo script with 3–4 showcase routes |

First task before heavy coding: run the Overpass query for the campus box in
overpass-turbo and look at what is already mapped. That decides whether the
survey needs to add 10 features or 100.
