/**
 * Build the app's data files from the raw OSM snapshot.
 *
 *   npm run data:build                       # from data/raw/iitk.osm.json
 *   node scripts/build-data.mjs --file x.osm # from a JOSM .osm file (unuploaded edits)
 *
 * Outputs (public/data/):
 *   graph.json        level-aware pedestrian routing graph
 *   buildings.geojson building footprints (ways + multipolygon relations)
 *   indoor.geojson    corridors, rooms, doors with their level (floor switcher)
 *   features.geojson  accessibility features (ramps, stairs, lifts, crossings, entrances, …)
 *   places.json       searchable buildings / entrances / rooms / landmarks
 *   qa.json           data-quality issues for the mappers (islands, unconnected entrances, …)
 *   meta.json         counts + snapshot timestamp shown in the UI
 *
 * Level model
 * -----------
 * Every graph node is "<osmNodeId>@<level>". A way tagged level=L (or untagged
 * = outdoors = 0) connects its nodes at level L only. A way spanning several
 * levels (level=0;1: stairs, ramps, lifts drawn as ways) is a *connector*: its
 * own nodes live at "<id>@c<wayId>" and are joined by zero-length transfer
 * edges to every level present at those nodes. Lift nodes (highway=elevator,
 * level=0;1;2) join the levels present at that node directly. Nothing else
 * ever joins two levels, so the router cannot step from floor 0 to floor 1
 * except through a connector, and profile rules (stairs forbidden for
 * wheelchair, …) apply to the connector edges.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CAMPUS_BBOX, ROAD_HIGHWAYS, ROUTABLE_HIGHWAYS } from "../data/config.js";
import { haversineMeters } from "../src/lib/geo/haversine.js";
import { pointInGeometry, ringCentroid } from "../src/lib/geo/pointInPolygon.js";
import { bboxContains } from "../src/lib/geo/bbox.js";
import { classifyFeature } from "../src/lib/features.js";
import { GROUND, isMultiLevel, nodeKey, parseLevels } from "../src/lib/levels.js";
import { parseOsmXml } from "./osm-xml.mjs";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "public/data");
const ROUTABLE = new Set(ROUTABLE_HIGHWAYS);
const ELEVATOR_METERS_PER_LEVEL = 4;

// ---------------------------------------------------------------- input

function loadRaw() {
  const idx = process.argv.indexOf("--file");
  if (idx !== -1 && process.argv[idx + 1]) {
    const file = process.argv[idx + 1];
    console.log(`Reading ${file}`);
    const text = readFileSync(file, "utf8");
    return file.endsWith(".json") ? JSON.parse(text) : parseOsmXml(text);
  }
  const p = join(ROOT, "data/raw/iitk.osm.json");
  if (!existsSync(p)) throw new Error("Missing data/raw/iitk.osm.json — run `npm run data:fetch` first");
  return JSON.parse(readFileSync(p, "utf8"));
}

function loadOverrides() {
  const p = join(ROOT, "data/overrides.json");
  if (!existsSync(p)) return {};
  const raw = JSON.parse(readFileSync(p, "utf8"));
  const out = {};
  for (const [k, v] of Object.entries(raw)) if (!k.startsWith("_")) out[k] = v;
  return out;
}

function loadRoutingRules() {
  const p = join(ROOT, "data/routing-rules.json");
  if (!existsSync(p)) return { buildings: {} };
  const raw = JSON.parse(readFileSync(p, "utf8"));
  return { buildings: raw.buildings ?? {} };
}

function loadAcademicArea() {
  const gj = JSON.parse(readFileSync(join(OUT_DIR, "academic-area.geojson"), "utf8"));
  return gj.features[0].geometry;
}

// ---------------------------------------------------------------- helpers

const round = (n) => Math.round(n * 1e6) / 1e6;

function footAllowed(tags) {
  if (tags.foot === "no" || tags.foot === "private") return false;
  if (["no", "private"].includes(tags.access) && !["yes", "designated", "permissive"].includes(tags.foot)) return false;
  if (tags.highway === "construction" || tags.construction) return false;
  return true;
}

const isRoutableWay = (tags) => Boolean(tags.highway) && ROUTABLE.has(tags.highway) && footAllowed(tags);

/** Tags on a node that matter for routing or display. */
function relevantNodeTags(tags) {
  if (!tags) return null;
  const keep = {};
  for (const k of Object.keys(tags)) {
    if (
      /^(highway|crossing|kerb|tactile_paving|barrier|entrance|wheelchair|door|width|level|access|foot|check_date|name|ramp|automatic_door|step_count|handrail|bicycle|motor_vehicle|locked|indoor|capacity)$|^crossing:|^ramp:|^kerb:/.test(
        k,
      )
    ) {
      keep[k] = tags[k];
    }
  }
  return Object.keys(keep).length ? keep : null;
}

function wayCoords(way, nodes) {
  const coords = [];
  for (const id of way.nodes) {
    const n = nodes.get(id);
    if (n) coords.push([round(n.lon), round(n.lat)]);
  }
  return coords;
}

const isClosed = (way) => way.nodes.length > 3 && way.nodes[0] === way.nodes[way.nodes.length - 1];

/** Chain the outer member ways of a multipolygon relation into closed rings. */
function assembleRings(memberWays) {
  const rings = [];
  const pending = memberWays.map((w) => [...w.nodes]).filter((n) => n.length > 1);
  while (pending.length) {
    let ring = pending.shift();
    let progress = true;
    while (ring[0] !== ring[ring.length - 1] && progress) {
      progress = false;
      for (let i = 0; i < pending.length; i++) {
        const seg = pending[i];
        const last = ring[ring.length - 1];
        if (seg[0] === last) ring = ring.concat(seg.slice(1));
        else if (seg[seg.length - 1] === last) ring = ring.concat(seg.slice(0, -1).reverse());
        else if (seg[0] === ring[0]) ring = seg.slice(1).reverse().concat(ring);
        else if (seg[seg.length - 1] === ring[0]) ring = seg.slice(0, -1).concat(ring);
        else continue;
        pending.splice(i, 1);
        progress = true;
        break;
      }
    }
    if (ring[0] === ring[ring.length - 1] && ring.length > 3) rings.push(ring);
  }
  return rings;
}

// ---------------------------------------------------------------- main

function main() {
  const raw = loadRaw();
  const overrides = loadOverrides();
  const academic = loadAcademicArea();
  const inArea = (lon, lat) => pointInGeometry(lon, lat, academic);
  const inCampus = (n) => bboxContains(CAMPUS_BBOX, n.lon, n.lat);

  const nodes = new Map();
  const ways = [];
  const waysById = new Map();
  const relations = [];
  for (const el of raw.elements) {
    if (el.type === "node") {
      const prev = nodes.get(el.id);
      if (!prev || (!prev.tags && el.tags)) nodes.set(el.id, el);
    } else if (el.type === "way") {
      if (waysById.has(el.id)) continue;
      waysById.set(el.id, el);
      ways.push(el);
    } else if (el.type === "relation") relations.push(el);
  }

  /** osm node id -> ways passing through it */
  const parentWays = new Map();
  for (const way of ways) for (const id of way.nodes) {
    if (!parentWays.has(id)) parentWays.set(id, []);
    parentWays.get(id).push(way);
  }

  // =====================================================================
  // 1. Level-aware routing graph
  // =====================================================================
  const graphNodes = {}; // key -> [lon, lat, levelLabel]
  const graphWays = {}; // wayId -> tags
  const edges = [];
  const seenEdge = new Set();
  /** osm node id -> Set(level) reached by single-level ways */
  const levelsAtNode = new Map();
  const connectorWays = [];

  const addNode = (key, n, level) => {
    graphNodes[key] ??= [round(n.lon), round(n.lat), level];
  };
  const addEdge = (aKey, bKey, len, wayId) => {
    const k = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    if (seenEdge.has(k)) return;
    seenEdge.add(k);
    edges.push([aKey, bKey, Math.round(len * 10) / 10, String(wayId)]);
  };

  /** Level at which an untagged (outdoor) way touches a node: the door's level if it is an entrance. */
  const outdoorLevelAt = (n) => {
    const t = n.tags;
    if (t?.entrance && t.level != null) {
      const ls = parseLevels(t.level);
      if (ls.length === 1) return ls[0];
    }
    return GROUND;
  };

  // Pass 1: single-level ways.
  for (const way of ways) {
    const tags = way.tags ?? {};
    if (!isRoutableWay(tags)) continue;
    if (isMultiLevel(tags)) {
      connectorWays.push(way);
      continue;
    }
    const tagged = tags.level != null;
    const wayLevel = tagged ? parseLevels(tags.level)[0] : null;
    let used = false;
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = nodes.get(way.nodes[i]);
      const b = nodes.get(way.nodes[i + 1]);
      if (!a || !b) continue;
      if (!inCampus(a) && !inCampus(b)) continue;
      const la = tagged ? wayLevel : outdoorLevelAt(a);
      const lb = tagged ? wayLevel : outdoorLevelAt(b);
      const ka = nodeKey(a.id, la);
      const kb = nodeKey(b.id, lb);
      addNode(ka, a, la);
      addNode(kb, b, lb);
      if (!levelsAtNode.has(a.id)) levelsAtNode.set(a.id, new Set());
      if (!levelsAtNode.has(b.id)) levelsAtNode.set(b.id, new Set());
      levelsAtNode.get(a.id).add(la);
      levelsAtNode.get(b.id).add(lb);
      addEdge(ka, kb, Math.max(0.5, haversineMeters(a.lat, a.lon, b.lat, b.lon)), way.id);
      used = true;
    }
    if (used) graphWays[way.id] = tags;
  }

  // Pass 2: connector ways (stairs / ramps / lifts spanning levels).
  for (const way of connectorWays) {
    const tags = way.tags;
    const cLevel = `c${way.id}`;
    const label = parseLevels(tags.level).join(";");
    let used = false;
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = nodes.get(way.nodes[i]);
      const b = nodes.get(way.nodes[i + 1]);
      if (!a || !b) continue;
      if (!inCampus(a) && !inCampus(b)) continue;
      const ka = nodeKey(a.id, cLevel);
      const kb = nodeKey(b.id, cLevel);
      addNode(ka, a, label);
      addNode(kb, b, label);
      addEdge(ka, kb, Math.max(0.5, haversineMeters(a.lat, a.lon, b.lat, b.lon)), way.id);
      used = true;
    }
    if (!used) continue;
    graphWays[way.id] = tags;
    // Transfer edges: connector <-> every level present at each of its nodes.
    for (const id of way.nodes) {
      const own = nodeKey(id, cLevel);
      if (!graphNodes[own]) continue;
      for (const L of levelsAtNode.get(id) ?? []) addEdge(own, nodeKey(id, L), 0, way.id);
      // Two connectors meeting at a node (stairs landing on a ramp) also join.
      for (const other of parentWays.get(id) ?? []) {
        if (other === way || !isRoutableWay(other.tags ?? {}) || !isMultiLevel(other.tags)) continue;
        const otherKey = nodeKey(id, `c${other.id}`);
        if (graphNodes[otherKey]) addEdge(own, otherKey, 0, way.id);
      }
    }
  }

  // Pass 3: lift nodes join the levels present at that node.
  for (const n of nodes.values()) {
    const t = n.tags;
    if (t?.highway !== "elevator") continue;
    const present = [...(levelsAtNode.get(n.id) ?? [])].sort((x, y) => Number(x) - Number(y));
    if (present.length < 2) continue;
    const wayId = `elev${n.id}`;
    graphWays[wayId] = { ...t, highway: "elevator" };
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const diff = Math.abs(Number(present[j]) - Number(present[i])) || 1;
        addEdge(nodeKey(n.id, present[i]), nodeKey(n.id, present[j]), diff * ELEVATOR_METERS_PER_LEVEL, wayId);
      }
    }
  }

  const graphNodeTags = {};
  const osmIdsInGraph = new Set(Object.keys(graphNodes).map((k) => k.slice(0, k.indexOf("@"))));
  for (const idStr of osmIdsInGraph) {
    const t = relevantNodeTags(nodes.get(Number(idStr))?.tags);
    if (t) graphNodeTags[idStr] = t;
  }

  const graph = { generatedAt: new Date().toISOString(), nodes: graphNodes, nodeTags: graphNodeTags, ways: graphWays, edges };

  /** All graph keys for an OSM node id. */
  const keysOfNode = (id) => {
    const out = [];
    for (const L of levelsAtNode.get(id) ?? []) out.push(nodeKey(id, L));
    for (const w of parentWays.get(id) ?? []) if (graphWays[w.id] && isMultiLevel(w.tags)) out.push(nodeKey(id, `c${w.id}`));
    return out.filter((k) => graphNodes[k]);
  };

  // =====================================================================
  // 2. Buildings (closed ways + multipolygon relations)
  // =====================================================================
  const buildings = [];
  const buildingIndex = []; // { id, name, tags, centroid, outlineNodeIds, ring }
  /**
   * @param rings          [outerRing, ...holes] of the main polygon
   * @param outlineNodeIds every node id on any ring (doors can be on courtyard rings)
   * @param extraOuters    further outer rings (multipolygon with several parts)
   */
  const registerBuilding = (osmId, tags, rings, outlineNodeIds, extraOuters = []) => {
    const c = ringCentroid(rings[0]);
    if (!c || !bboxContains(CAMPUS_BBOX, c.lon, c.lat)) return;
    const entranceIds = [...new Set(outlineNodeIds)].filter((id) => nodes.get(id)?.tags?.entrance);
    buildings.push({
      type: "Feature",
      properties: {
        osmId,
        name: tags.name ?? null,
        building: tags.building ?? "yes",
        levels: tags["building:levels"] ?? null,
        wheelchair: tags.wheelchair ?? null,
        inAcademicArea: inArea(c.lon, c.lat),
        entrances: entranceIds.length,
      },
      geometry: extraOuters.length ? { type: "MultiPolygon", coordinates: [rings, ...extraOuters.map((r) => [r])] } : { type: "Polygon", coordinates: rings },
    });
    buildingIndex.push({ id: osmId, name: tags.name ?? null, tags, centroid: c, entranceIds, ring: rings[0] });
  };

  const relationWayIds = new Set();
  for (const rel of relations) {
    const t = rel.tags ?? {};
    if (t.type !== "multipolygon" || !(t.building || (t.amenity && t.name))) continue;
    const memberWays = (rel.members ?? []).filter((m) => m.type === "way").map((m) => ({ role: m.role, way: waysById.get(m.ref) })).filter((m) => m.way);
    const outers = memberWays.filter((m) => m.role !== "inner").map((m) => m.way);
    const inners = memberWays.filter((m) => m.role === "inner").map((m) => m.way);
    if (!outers.length) continue;
    const toCoords = (ids) => ids.map((id) => nodes.get(id)).filter(Boolean).map((n) => [round(n.lon), round(n.lat)]);
    const outerRings = assembleRings(outers).map(toCoords);
    if (!outerRings.length || outerRings[0].length < 4) continue;
    const innerRings = assembleRings(inners).map(toCoords).filter((r) => r.length >= 4);
    for (const w of [...outers, ...inners]) relationWayIds.add(w.id);
    // Polygon = outer ring + holes. Doors may sit on a courtyard (inner) ring too.
    const rings = [outerRings[0], ...innerRings];
    registerBuilding(`relation/${rel.id}`, { building: "yes", ...t }, rings, memberWays.flatMap((m) => m.way.nodes), outerRings.length > 1 ? outerRings.slice(1) : []);
  }
  for (const way of ways) {
    const tags = way.tags ?? {};
    if (!tags.building || !isClosed(way) || relationWayIds.has(way.id)) continue;
    const coords = wayCoords(way, nodes);
    if (coords.length < 4) continue;
    registerBuilding(`way/${way.id}`, tags, [coords], way.nodes);
  }

  // Doors on *any* way tagged building=* + the same name (e.g. a split-off
  // piece of an outline) count as doors of that building too.
  {
    const byName = new Map(buildingIndex.filter((b) => b.name).map((b) => [b.name.toLowerCase(), b]));
    for (const way of ways) {
      const t = way.tags ?? {};
      if (!t.building || !t.name) continue;
      const b = byName.get(t.name.toLowerCase());
      if (!b) continue;
      for (const id of way.nodes) if (nodes.get(id)?.tags?.entrance && !b.entranceIds.includes(id)) b.entranceIds.push(id);
    }
    for (const f of buildings) {
      const b = buildingIndex.find((x) => x.id === f.properties.osmId);
      if (b) f.properties.entrances = b.entranceIds.length;
    }
  }

  const buildingContaining = (lon, lat) => buildingIndex.find((b) => b.name && pointInGeometry(lon, lat, { type: "Polygon", coordinates: [b.ring] }));
  const nearestBuildingName = (lon, lat, maxM = 60) => {
    let best = null;
    let bestD = maxM;
    for (const b of buildingIndex) {
      if (!b.name) continue;
      const d = haversineMeters(lat, lon, b.centroid.lat, b.centroid.lon);
      if (d < bestD) {
        bestD = d;
        best = b.name;
      }
    }
    return best;
  };

  // =====================================================================
  // 3. Indoor layer (corridors / rooms / doors per level)
  // =====================================================================
  const indoor = [];
  for (const way of ways) {
    const t = way.tags ?? {};
    const coords = wayCoords(way, nodes);
    if (coords.length < 2) continue;
    const mid = coords[Math.floor(coords.length / 2)];
    if (!bboxContains(CAMPUS_BBOX, mid[0], mid[1])) continue;
    if (t.indoor === "room" || t.indoor === "area" || (t.indoor && isClosed(way) && !t.highway)) {
      if (!isClosed(way)) continue;
      indoor.push({
        type: "Feature",
        properties: { osmId: `way/${way.id}`, kind: "room", name: t.name ?? null, ref: t.ref ?? null, level: t.level ?? GROUND, indoor: t.indoor },
        geometry: { type: "Polygon", coordinates: [coords] },
      });
    } else if (t.highway && t.level != null && (t.highway === "corridor" || t.indoor || t.highway === "footway" || t.highway === "steps" || t.highway === "path")) {
      indoor.push({
        type: "Feature",
        properties: { osmId: `way/${way.id}`, kind: t.highway === "steps" ? "stairs" : isMultiLevel(t) ? "connector" : "corridor", name: t.name ?? null, level: t.level, highway: t.highway },
        geometry: { type: "LineString", coordinates: coords },
      });
    }
  }
  for (const n of nodes.values()) {
    const t = n.tags;
    if (!t || !inCampus(n)) continue;
    if (t.indoor === "door" || (t.door && !t.entrance)) {
      indoor.push({ type: "Feature", properties: { osmId: `node/${n.id}`, kind: "door", level: t.level ?? GROUND, name: t.name ?? null }, geometry: { type: "Point", coordinates: [round(n.lon), round(n.lat)] } });
    }
  }

  // =====================================================================
  // 3b. Paths layer: every routable way, coloured by floor / kind in the UI
  // =====================================================================
  const pathKind = (t) => {
    if (t.highway === "steps") return "stairs";
    if (t.highway === "elevator") return "elevator";
    if (t.ramp === "yes" || t["ramp:wheelchair"] === "yes" || (t.highway !== "steps" && isMultiLevel(t))) return "ramp";
    if (ROAD_HIGHWAYS.has(t.highway)) return "road";
    return "path";
  };
  const paths = [];
  for (const way of ways) {
    const t = way.tags ?? {};
    if (!graphWays[way.id]) continue;
    const coords = wayCoords(way, nodes);
    if (coords.length < 2) continue;
    const levels = parseLevels(t.level);
    paths.push({
      type: "Feature",
      properties: {
        osmId: `way/${way.id}`,
        kind: pathKind(t),
        highway: t.highway,
        name: t.name ?? null,
        level: t.level ?? GROUND,
        // numeric floor used for colouring: connectors take their upper floor
        floor: Math.max(...levels.map(Number).filter(Number.isFinite), 0),
        bridge: t.bridge === "yes",
        wheelchair: t.wheelchair ?? null,
      },
      geometry: { type: "LineString", coordinates: coords },
    });
  }

  // =====================================================================
  // 4. Accessibility features
  // =====================================================================
  const features = [];
  const featureOf = (osmId, kind, tags, geometry, lon, lat) => {
    const extra = overrides[osmId] ?? {};
    return {
      type: "Feature",
      properties: {
        osmId,
        kind,
        name: tags.name ?? null,
        level: tags.level ?? null,
        check_date: extra.check_date ?? tags.check_date ?? null,
        wheelchair: tags.wheelchair ?? null,
        inAcademicArea: inArea(lon, lat),
        tags: JSON.stringify(tags),
        notes: extra.notes ?? null,
        photo: extra.photo ?? null,
      },
      geometry,
    };
  };
  for (const n of nodes.values()) {
    if (!n.tags || !inCampus(n)) continue;
    const kind = classifyFeature(n.tags);
    if (!kind) continue;
    features.push(featureOf(`node/${n.id}`, kind, n.tags, { type: "Point", coordinates: [round(n.lon), round(n.lat)] }, n.lon, n.lat));
  }
  for (const way of ways) {
    if (!way.tags || way.tags.building) continue;
    const kind = classifyFeature(way.tags);
    if (!kind) continue;
    const coords = wayCoords(way, nodes);
    if (coords.length < 2) continue;
    const mid = coords[Math.floor(coords.length / 2)];
    if (!bboxContains(CAMPUS_BBOX, mid[0], mid[1])) continue;
    features.push(featureOf(`way/${way.id}`, kind, way.tags, { type: "LineString", coordinates: coords }, mid[0], mid[1]));
  }

  // =====================================================================
  // 5. Places (search index)
  // =====================================================================
  const places = [];
  const seenName = new Set();
  const rules = loadRoutingRules();

  /** Search aliases: OSM alternative names + generated short forms ("LH7", "LH 7", "L7"). */
  const aliasesFor = (tags) => {
    const out = new Set();
    for (const k of ["short_name", "alt_name", "official_name", "old_name", "name:en", "loc_name", "nickname"]) {
      if (tags[k]) for (const v of String(tags[k]).split(";")) if (v.trim()) out.add(v.trim());
    }
    const m = (tags.name ?? "").match(/^Lecture Hall\s*(\d+)$/i);
    if (m) for (const a of [`LH${m[1]}`, `LH ${m[1]}`, `L${m[1]}`, `L-${m[1]}`, `LH-${m[1]}`]) out.add(a);
    const r = (tags.name ?? "").match(/^Room\s+(\S+)$/i);
    if (r) out.add(r[1]);
    return [...out].filter((a) => a.toLowerCase() !== (tags.name ?? "").toLowerCase());
  };

  /** Resolve a rules entry's door node ids to graph keys, per profile and floor. */
  const doorRulesFor = (rule) => {
    if (!rule?.doors) return null;
    const out = {};
    for (const [profile, byLevel] of Object.entries(rule.doors)) {
      out[profile] = {};
      for (const [level, ids] of Object.entries(byLevel)) {
        const keys = ids.flatMap((osmId) => keysOfNode(Number(String(osmId).replace("node/", ""))));
        if (keys.length) out[profile][level] = keys;
      }
    }
    return out;
  };

  const buildingsWithSearchableEntrances = new Set();
  for (const b of buildingIndex) {
    if (!b.name) continue;
    const key = b.name.toLowerCase();
    if (seenName.has(key)) continue;
    seenName.add(key);
    const rule = rules.buildings[b.id];
    const entrances = b.entranceIds.map((id) => {
      const n = nodes.get(id);
      return { id: String(id), lon: round(n.lon), lat: round(n.lat), type: n.tags.entrance, level: n.tags.level ?? null, wheelchair: n.tags.wheelchair ?? null, keys: keysOfNode(id) };
    });
    if (entrances.some((e) => e.keys.length)) buildingsWithSearchableEntrances.add(b.id);
    const place = {
      id: b.id,
      name: b.name,
      aliases: aliasesFor(b.tags),
      kind: "building",
      category: b.tags.amenity ?? b.tags.building ?? null,
      lon: round(b.centroid.lon),
      lat: round(b.centroid.lat),
      inAcademicArea: inArea(b.centroid.lon, b.centroid.lat),
      snapNodes: b.entranceIds.flatMap(keysOfNode),
      entrances,
    };
    const doorRules = doorRulesFor(rule);
    if (doorRules) place.doorRules = doorRules;
    places.push(place);
  }

  for (const n of nodes.values()) {
    const t = n.tags;
    if (!t || !inCampus(n)) continue;
    if (t.entrance) {
      const hostB = buildingIndex.find((b) => b.entranceIds.includes(n.id));
      // A building's own doors are reached by searching the building itself
      // (the router picks the door). Only list a door separately when it has a
      // name of its own or belongs to no searchable building.
      if (hostB && buildingsWithSearchableEntrances.has(hostB.id) && !t.name) continue;
      const host = hostB?.name ?? nearestBuildingName(n.lon, n.lat);
      const label = t.name || (host ? `${host} — ${t.entrance === "main" ? "main entrance" : "entrance"}${t.level != null && t.level !== "0" ? ` (level ${t.level})` : ""}` : null);
      if (!label) continue;
      places.push({
        id: `node/${n.id}`,
        name: label,
        kind: "entrance",
        category: t.entrance,
        lon: round(n.lon),
        lat: round(n.lat),
        level: t.level ?? null,
        wheelchair: t.wheelchair ?? null,
        inAcademicArea: inArea(n.lon, n.lat),
        snapNodes: keysOfNode(n.id),
      });
    } else if (t.name && (t.amenity || t.shop || t.leisure || t.tourism || t.office || t.healthcare)) {
      const key = t.name.toLowerCase();
      if (seenName.has(key)) continue;
      seenName.add(key);
      places.push({
        id: `node/${n.id}`,
        name: t.name,
        kind: "landmark",
        category: t.amenity ?? t.shop ?? t.leisure ?? t.tourism ?? t.office ?? t.healthcare,
        lon: round(n.lon),
        lat: round(n.lat),
        level: t.level ?? null,
        inAcademicArea: inArea(n.lon, n.lat),
        snapNodes: keysOfNode(n.id),
      });
    }
  }

  // Indoor rooms (lecture halls inside a complex, numbered rooms, offices).
  for (const way of ways) {
    const t = way.tags ?? {};
    if (!(t.indoor === "room" || t.indoor === "area") || !isClosed(way)) continue;
    if (!t.name && !t.ref) continue;
    const coords = wayCoords(way, nodes);
    const c = ringCentroid(coords);
    if (!c || !bboxContains(CAMPUS_BBOX, c.lon, c.lat)) continue;
    const hostBuilding = buildingContaining(c.lon, c.lat) ?? null;
    const host = hostBuilding?.name ?? nearestBuildingName(c.lon, c.lat, 80);
    const rule = hostBuilding ? rules.buildings[hostBuilding.id] : null;
    const rawName = t.name ?? t.ref;
    const isNumber = /^[\dA-Za-z]?-?\d+[A-Za-z]?$/.test(rawName);
    // Floor: OSM level tag, else (per building rule) the room number's first digit: 1xx -> 0, 2xx -> 1.
    let level = t.level != null ? parseLevels(t.level)[0] : null;
    if (level == null && rule?.roomLevelFromNumber && isNumber) {
      const digits = rawName.match(/\d+/)[0];
      if (digits.length >= 3) level = String(Number(digits[0]) - 1);
    }
    level ??= GROUND;
    const base = isNumber ? `Room ${rawName}` : rawName;
    const name = host && !base.toLowerCase().includes(host.toLowerCase()) ? `${base} (${host})` : base;
    const key = name.toLowerCase();
    if (seenName.has(key)) continue;
    seenName.add(key);
    // Doors / outline nodes that sit on the routing graph at this level.
    const snapNodes = way.nodes.map((id) => nodeKey(id, level)).filter((k) => graphNodes[k]);
    const place = {
      id: `way/${way.id}`,
      name,
      aliases: aliasesFor({ ...t, name: base }),
      kind: "room",
      category: t.indoor,
      lon: round(c.lon),
      lat: round(c.lat),
      level,
      building: host ?? null,
      inAcademicArea: inArea(c.lon, c.lat),
      snapNodes,
    };
    const doorRules = doorRulesFor(rule);
    if (doorRules) place.doorRules = doorRules;
    places.push(place);
  }

  // Named non-building areas (sports grounds, parks, …)
  for (const way of ways) {
    const t = way.tags;
    if (!t?.name || t.building || t.highway || t.indoor || !isClosed(way)) continue;
    if (!(t.amenity || t.leisure || t.landuse === "education" || t.tourism || t.office)) continue;
    const key = t.name.toLowerCase();
    if (seenName.has(key)) continue;
    const c = ringCentroid(wayCoords(way, nodes));
    if (!c || !bboxContains(CAMPUS_BBOX, c.lon, c.lat)) continue;
    seenName.add(key);
    places.push({ id: `way/${way.id}`, name: t.name, kind: "landmark", category: t.amenity ?? t.leisure ?? t.tourism ?? t.office ?? "area", lon: round(c.lon), lat: round(c.lat), inAcademicArea: inArea(c.lon, c.lat), snapNodes: [] });
  }

  places.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  // =====================================================================
  // 6. Data-quality report for the mappers
  // =====================================================================
  const issues = [];
  const issue = (type, severity, message, lon, lat, osm) => issues.push({ type, severity, message, lon: round(lon), lat: round(lat), osm });

  // 6a. Connected components (structural, normal profile).
  const adjacency = new Map();
  for (const [a, b] of edges) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }
  const compOf = new Map();
  const comps = [];
  for (const start of Object.keys(graphNodes)) {
    if (compOf.has(start)) continue;
    const id = comps.length;
    const members = [];
    const stack = [start];
    compOf.set(start, id);
    while (stack.length) {
      const k = stack.pop();
      members.push(k);
      for (const nb of adjacency.get(k) ?? []) if (!compOf.has(nb)) {
        compOf.set(nb, id);
        stack.push(nb);
      }
    }
    comps.push(members);
  }
  const mainComp = comps.reduce((best, c, i) => (c.length > comps[best].length ? i : best), 0);
  const islands = comps
    .map((members, i) => ({ i, members }))
    .filter((c) => c.i !== mainComp && c.members.length >= 2)
    .sort((a, b) => b.members.length - a.members.length);
  for (const isl of islands.slice(0, 80)) {
    let lon = 0;
    let lat = 0;
    const kinds = new Set();
    for (const k of isl.members) {
      lon += graphNodes[k][0];
      lat += graphNodes[k][1];
    }
    lon /= isl.members.length;
    lat /= isl.members.length;
    for (const k of isl.members) for (const nb of adjacency.get(k) ?? []) {
      const e = edges.find((ed) => (ed[0] === k && ed[1] === nb) || (ed[1] === k && ed[0] === nb));
      if (e) kinds.add(graphWays[e[3]]?.highway ?? "?");
    }
    const near = nearestBuildingName(lon, lat, 120);
    if (!inArea(lon, lat) && isl.members.length < 10) continue; // outside the detailed zone: only large islands matter
    issue("island", inArea(lon, lat) ? "high" : "low", `Disconnected group of ${isl.members.length} path points (${[...kinds].join(", ")})${near ? ` near ${near}` : ""} — not reachable from the rest of the campus`, lon, lat, `node/${isl.members[0].split("@")[0]}`);
  }

  // 6b. Entrances not on any path / not reaching the main network.
  for (const n of nodes.values()) {
    const t = n.tags;
    if (!t?.entrance || !inCampus(n) || !inArea(n.lon, n.lat)) continue;
    const keys = keysOfNode(n.id);
    const host = nearestBuildingName(n.lon, n.lat, 80) ?? "a building";
    if (!keys.length) issue("entrance-unconnected", "high", `Entrance of ${host} (level ${t.level ?? "0"}) is not on any footway/corridor — join a path to this node`, n.lon, n.lat, `node/${n.id}`);
    else if (!keys.some((k) => compOf.get(k) === mainComp)) issue("entrance-island", "high", `Entrance of ${host} (level ${t.level ?? "0"}) connects only to an isolated path group`, n.lon, n.lat, `node/${n.id}`);
  }

  // 6c. Multi-level ways that are not clearly stairs / ramps / lifts.
  for (const way of connectorWays) {
    const t = way.tags;
    const explicit = t.highway === "steps" || t.highway === "elevator" || t.ramp === "yes" || t["ramp:wheelchair"] === "yes" || t.incline;
    const coords = wayCoords(way, nodes);
    if (!coords.length) continue;
    const mid = coords[Math.floor(coords.length / 2)];
    if (!explicit) issue("ambiguous-connector", "high", `Footway tagged level=${t.level} but no incline/ramp/steps — it acts as a free level change for everyone. Retag level=<one floor>, or add incline=…% + ramp=yes`, mid[0], mid[1], `way/${way.id}`);
    const inc = String(t.incline ?? "").match(/(\d+(?:\.\d+)?)\s*%/);
    if (inc && parseFloat(inc[1]) > 8) issue("steep-ramp", "medium", `Ramp incline ${t.incline} exceeds 8 % — heavily penalised for wheelchair users`, mid[0], mid[1], `way/${way.id}`);
    for (const end of [way.nodes[0], way.nodes[way.nodes.length - 1]]) {
      const others = (parentWays.get(end) ?? []).filter((w) => w !== way && (isRoutableWay(w.tags ?? {}) || w.tags?.building || w.tags?.indoor));
      const n = nodes.get(end);
      if (n && !others.length && !n.tags?.entrance) issue("dead-end-connector", "high", `${t.highway === "steps" ? "Stairs" : "Ramp/connector"} (level ${t.level}) ends in mid-air — nothing attached at this end`, n.lon, n.lat, `way/${way.id}`);
    }
  }

  // 6d. Level "walls": node shared by ways of different single levels with no connector there.
  for (const [id, levels] of levelsAtNode) {
    if (levels.size < 2) continue;
    const hasConnector = (parentWays.get(id) ?? []).some((w) => graphWays[w.id] && isMultiLevel(w.tags)) || nodes.get(id)?.tags?.highway === "elevator";
    if (hasConnector) continue;
    const n = nodes.get(id);
    if (!n || !inArea(n.lon, n.lat)) continue;
    issue("level-wall", "medium", `Paths on levels ${[...levels].join(" and ")} share this node but there are no stairs/ramp/lift here — treated as a wall. If people can change level here, draw the stairs/ramp`, n.lon, n.lat, `node/${id}`);
  }

  // 6e. Named Academic-Area buildings without any entrance node.
  for (const b of buildingIndex) {
    if (!b.name || !inArea(b.centroid.lon, b.centroid.lat)) continue;
    if (!b.entranceIds.length) issue("building-no-entrance", "low", `${b.name} has no entrance node — routes will end at the nearest outdoor path instead of the door`, b.centroid.lon, b.centroid.lat, b.id);
  }

  const sev = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => sev[a.severity] - sev[b.severity] || a.type.localeCompare(b.type));
  const qa = { generatedAt: graph.generatedAt, mainComponentSize: comps[mainComp].length, components: comps.length, issues };

  // =====================================================================
  // 7. Write
  // =====================================================================
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "graph.json"), JSON.stringify(graph));
  writeFileSync(join(OUT_DIR, "buildings.geojson"), JSON.stringify({ type: "FeatureCollection", features: buildings }));
  writeFileSync(join(OUT_DIR, "indoor.geojson"), JSON.stringify({ type: "FeatureCollection", features: indoor }));
  writeFileSync(join(OUT_DIR, "paths.geojson"), JSON.stringify({ type: "FeatureCollection", features: paths }));
  writeFileSync(join(OUT_DIR, "features.geojson"), JSON.stringify({ type: "FeatureCollection", features }));
  writeFileSync(join(OUT_DIR, "places.json"), JSON.stringify(places));
  writeFileSync(join(OUT_DIR, "qa.json"), JSON.stringify(qa, null, 1));

  const kinds = {};
  for (const f of features) kinds[f.properties.kind] = (kinds[f.properties.kind] ?? 0) + 1;
  const levelSet = new Set();
  for (const k of Object.keys(graphNodes)) {
    const l = graphNodes[k][2];
    if (!l.includes(";")) levelSet.add(l);
  }
  const meta = {
    builtAt: graph.generatedAt,
    osmFetchedAt: raw.fetchedAt ?? null,
    graph: { nodes: Object.keys(graphNodes).length, edges: edges.length, ways: Object.keys(graphWays).length, connectors: connectorWays.filter((w) => graphWays[w.id]).length, components: comps.length, mainComponent: comps[mainComp].length },
    levels: [...levelSet].sort((a, b) => Number(a) - Number(b)),
    buildings: buildings.length,
    namedBuildings: buildings.filter((b) => b.properties.name).length,
    indoor: indoor.length,
    features: features.length,
    featureKinds: kinds,
    places: places.length,
    rooms: places.filter((p) => p.kind === "room").length,
    qaIssues: { high: issues.filter((i) => i.severity === "high").length, medium: issues.filter((i) => i.severity === "medium").length, low: issues.filter((i) => i.severity === "low").length },
  };
  writeFileSync(join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(`Graph:     ${meta.graph.nodes} nodes, ${meta.graph.edges} edges, ${meta.graph.ways} ways, ${meta.graph.connectors} level connectors, ${meta.graph.components} components (main ${meta.graph.mainComponent})`);
  console.log(`Levels:    ${meta.levels.join(", ")}`);
  console.log(`Buildings: ${meta.buildings} (${meta.namedBuildings} named)   Indoor: ${meta.indoor}   Rooms searchable: ${meta.rooms}`);
  console.log(`Features:  ${meta.features} ${JSON.stringify(kinds)}`);
  console.log(`Places:    ${meta.places}`);
  console.log(`QA:        ${meta.qaIssues.high} high, ${meta.qaIssues.medium} medium, ${meta.qaIssues.low} low → public/data/qa.json`);
}

main();
