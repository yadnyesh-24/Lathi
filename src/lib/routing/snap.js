/**
 * Snap a place or an arbitrary map point onto the (level-aware) routing graph.
 *
 * Preference order for a building / room / entrance:
 *   1. one of its own graph nodes (`snapNodes`: entrance / door nodes that lie on a path)
 *      â€” for the wheelchair profile, entrances tagged wheelchair=no are skipped
 *   2. the graph node nearest to any of its entrances, on the entrance's floor
 *   3. the graph node nearest to the place itself, on the place's floor (rooms)
 *      or on the ground floor (everything else), then on any floor
 */
import { SNAP_MAX_METERS } from "../../../data/config.js";
import { GROUND, splitKey } from "../levels.js";

/** Best single snap for a place (first candidate). */
export function snapPlace(graph, place, profileId = "normal") {
  return snapCandidates(graph, place, profileId, 1)[0] ?? null;
}

/**
 * Snap candidates for a place, grouped in tiers of decreasing preference.
 * The router exhausts a tier before falling back to the next, so a route to a
 * building always ends at one of its doors when any door is reachable:
 *
 *   1. "rules"    doors prescribed in data/routing-rules.json for this profile & floor
 *   2. "door"     the place's own mapped doors / entrance nodes that lie on a path
 *   3. "near"     the path node nearest to one of its entrances (same floor)
 *   4. "nearest"  the path node nearest to the place itself
 *
 * @returns {Array<Array<{nodeId, snapDistance, via, anchor, level}>>}
 */
export function snapTiers(graph, place, profileId = "normal") {
  const wheelchair = profileId === "wheelchair";
  const usable = (e) => !(wheelchair && e.wheelchair === "no");
  const seen = new Set();
  const tier = () => {
    const list = [];
    list.push2 = (c) => {
      if (c && graph.has(c.nodeId) && !seen.has(c.nodeId)) {
        seen.add(c.nodeId);
        list.push(c);
      }
    };
    return list;
  };
  const floorOf = (k, fallback) => (graph.isConnectorNode(k) && fallback ? fallback : graph.levelOf(k));
  const single = (l) => (l != null && !String(l).includes(";") ? String(l) : null);
  const byFloorFirst = (keys) => [...keys].sort((a, b) => graph.isConnectorNode(a) - graph.isConnectorNode(b));

  // Explicit graph node (dropped pin that hit a node, legacy places).
  const explicit = tier();
  if (place.nodeId) explicit.push2({ nodeId: place.nodeId, snapDistance: 0, via: "node", anchor: [place.lon, place.lat], level: graph.levelOf(place.nodeId) });

  // 1. Building-specific door rules.
  const rules = tier();
  const rule = place.doorRules?.[profileId] ?? place.doorRules?.normal;
  if (rule) {
    const level = single(place.level);
    const lists = level != null ? [rule[level], rule["*"]] : [rule["0"], rule["*"], ...Object.keys(rule).filter((k) => k !== "0" && k !== "*").map((k) => rule[k])];
    for (const keys of lists) for (const k of byFloorFirst(keys ?? [])) rules.push2({ nodeId: k, snapDistance: 0, via: "rule", anchor: [place.lon, place.lat], level: graph.levelOf(k) });
  }

  // 2. Own doors.
  const doors = tier();
  const entrances = [...(place.entrances ?? [])].filter(usable).sort((a, b) => (b.type === "main") - (a.type === "main"));
  for (const e of entrances) for (const k of byFloorFirst(e.keys ?? [])) doors.push2({ nodeId: k, snapDistance: 0, via: "entrance", anchor: [e.lon, e.lat], level: floorOf(k, single(e.level)) });
  for (const k of byFloorFirst(place.snapNodes ?? [])) doors.push2({ nodeId: k, snapDistance: 0, via: place.kind === "room" ? "door" : "entrance", anchor: [place.lon, place.lat], level: graph.levelOf(k) });

  // 3. Near an entrance, on the entrance's floor.
  const near = tier();
  for (const e of entrances) {
    const hit = graph.nearestNode(e.lon, e.lat, { level: single(e.level) ?? GROUND, maxMeters: SNAP_MAX_METERS });
    if (hit) near.push2({ nodeId: hit.nodeId, snapDistance: hit.distance, via: "near-entrance", anchor: [e.lon, e.lat], level: graph.levelOf(hit.nodeId) });
  }

  // 4. Nearest path to the place itself: its own floor first, then any floor.
  const nearest = tier();
  const wantLevel = single(place.level) ?? GROUND;
  const hitLevel = graph.nearestNode(place.lon, place.lat, { level: wantLevel, maxMeters: place.kind === "room" ? 60 : SNAP_MAX_METERS });
  if (hitLevel) nearest.push2({ nodeId: hitLevel.nodeId, snapDistance: hitLevel.distance, via: "nearest", anchor: [place.lon, place.lat], level: graph.levelOf(hitLevel.nodeId) });
  const hitAny = graph.nearestNode(place.lon, place.lat, { maxMeters: SNAP_MAX_METERS, filter: (k) => !graph.isConnectorNode(k) });
  if (hitAny) nearest.push2({ nodeId: hitAny.nodeId, snapDistance: hitAny.distance, via: "nearest", anchor: [place.lon, place.lat], level: graph.levelOf(hitAny.nodeId) });

  return [explicit, rules, doors, near, nearest].filter((t) => t.length);
}

/** Flat list of candidates, best first (kept for callers that want one list). */
export function snapCandidates(graph, place, profileId = "normal", limit = 8) {
  return snapTiers(graph, place, profileId).flat().slice(0, limit);
}

/** Snap a raw map click, preferring the floor the user is looking at. */
export function snapPoint(graph, lon, lat, level = GROUND) {
  const hit =
    graph.nearestNode(lon, lat, { level, maxMeters: SNAP_MAX_METERS }) ??
    graph.nearestNode(lon, lat, { maxMeters: SNAP_MAX_METERS, filter: (k) => !graph.isConnectorNode(k) });
  if (!hit) return null;
  return { nodeId: hit.nodeId, snapDistance: hit.distance, via: "nearest", anchor: [lon, lat], level: graph.levelOf(hit.nodeId) };
}

export { splitKey };
