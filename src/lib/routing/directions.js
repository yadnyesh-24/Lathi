/**
 * Turn the node/way sequence of a route into Google-Maps-style steps:
 * "Head north on Hall 3 Road", "Turn left onto footpath",
 * "Take the stairs up to Level 1", "Take the lift to Level 2", "Arrive".
 */
import { bearingDegrees } from "../geo/haversine.js";
import { isMultiLevel, levelLabel } from "../levels.js";

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function compassName(bearing) {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

/** Display name for a way: name, else a description of the way type. */
export function wayLabel(tags = {}) {
  if (tags.name) return tags.name;
  const hw = tags.highway;
  if (hw === "steps") return "stairs";
  if (hw === "elevator") return "lift";
  if (hw === "corridor") return "indoor corridor";
  if (hw === "footway" && tags.bridge) return tags.level != null && !isMultiLevel(tags) ? "elevated walkway" : "skywalk";
  if (hw === "footway" && tags.footway === "sidewalk") return "footpath";
  if (hw === "footway" && tags.footway === "crossing") return "crossing";
  if (hw === "footway" || hw === "path" || hw === "pedestrian") return "footpath";
  if (hw === "cycleway") return "cycle track";
  if (hw === "service") return tags.service === "parking_aisle" ? "parking area" : "service lane";
  if (hw === "living_street") return "lane";
  if (hw === "track") return "track";
  if (hw) return "road";
  return "path";
}

/** Icon key + special verb for notable way kinds. */
export function wayKind(tags = {}) {
  if (tags.highway === "steps") return "stairs";
  if (tags.highway === "elevator") return "elevator";
  if (tags.ramp === "yes" || tags["ramp:wheelchair"] === "yes" || (tags.incline && tags.highway !== "steps")) return "ramp";
  if (isMultiLevel(tags)) return "ramp"; // a sloped connector without explicit tags
  if (tags.bridge === "yes" && (tags.highway === "footway" || tags.highway === "path")) return "skywalk";
  if (tags.footway === "crossing") return "crossing";
  if (tags.highway === "corridor" || tags.indoor) return "indoor";
  return "walk";
}

function turnWord(delta) {
  const a = Math.abs(delta);
  if (a < 25) return "straight";
  if (a > 150) return "uturn";
  const side = delta > 0 ? "right" : "left";
  if (a < 60) return `slight-${side}`;
  if (a > 120) return `sharp-${side}`;
  return side;
}

const turnPhrase = (turn) => turn.replace("-", " ");

function verbFor(turn, kind, label) {
  const the = kind === "skywalk" ? `the ${label}` : label;
  if (turn === "straight") return `Continue onto ${the}`;
  if (turn === "uturn") return `Make a U-turn onto ${the}`;
  return `Turn ${turnPhrase(turn)} onto ${the}`;
}

/** "up to Level 1" / "down to Ground" / "to Level 2". */
function levelChangePhrase(fromLevel, toLevel, verbless = false) {
  if (fromLevel == null || toLevel == null || fromLevel === toLevel) return "";
  const dir = Number(toLevel) > Number(fromLevel) ? "up" : "down";
  return verbless ? `to ${levelLabel(toLevel)}` : `${dir} to ${levelLabel(toLevel)}`;
}

function connectorText(turn, kind, label, fromLevel, toLevel, tags) {
  const change = levelChangePhrase(fromLevel, toLevel, kind === "elevator");
  const turnPrefix = turn && turn !== "straight" && turn !== "uturn" ? `Turn ${turnPhrase(turn)} and ` : "";
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  if (kind === "stairs") {
    const count = tags.step_count ? ` (${tags.step_count} steps${tags.handrail && tags.handrail !== "no" ? ", handrail" : ""})` : "";
    return cap(`${turnPrefix}take the stairs ${change}`.trim()) + count;
  }
  if (kind === "elevator") return cap(`${turnPrefix}take the lift ${change}`.trim());
  if (kind === "ramp") {
    const grade = tags.incline && /%/.test(tags.incline) ? ` (${tags.incline})` : "";
    return cap(`${turnPrefix}take the ramp ${change}`.trim()) + grade;
  }
  return verbFor(turn ?? "straight", kind, label);
}

/**
 * @param {import('./graph.js').Graph} graph
 * @param {string[]} nodeIds
 * @param {string[]} wayIds   wayIds[i] joins nodeIds[i] and nodeIds[i+1]
 * @param {{ from?: string, to?: string }} [names]  human names of the endpoints
 */
export function buildDirections(graph, nodeIds, wayIds, names = {}) {
  const floorOf = (key) => {
    const l = graph.levelOf(key);
    return l && !l.includes(";") ? l : null;
  };

  if (nodeIds.length < 2) {
    return [{ type: "arrive", kind: "arrive", text: `You are already at ${names.to ?? "your destination"}`, distance: 0, coord: graph.coord(nodeIds[0]), level: floorOf(nodeIds[0]) }];
  }

  // 1. Per-edge records (skip zero-length transfer edges: they carry no geometry).
  const edges = [];
  for (let i = 0; i < wayIds.length; i++) {
    const a = graph.coord(nodeIds[i]);
    const b = graph.coord(nodeIds[i + 1]);
    const tags = graph.wayTags(wayIds[i]);
    const length = graph.distanceBetween(nodeIds[i], nodeIds[i + 1]);
    const kind = wayKind(tags);
    if (length < 0.05 && kind !== "elevator") continue;
    edges.push({
      from: nodeIds[i],
      to: nodeIds[i + 1],
      a,
      b,
      length,
      bearing: length < 0.05 ? null : bearingDegrees(a[1], a[0], b[1], b[0]),
      label: wayLabel(tags),
      kind,
      tags,
      connector: kind === "stairs" || kind === "elevator" || kind === "ramp",
      fromLevel: floorOf(nodeIds[i]),
      toLevel: floorOf(nodeIds[i + 1]),
    });
  }
  if (!edges.length) {
    return [{ type: "arrive", kind: "arrive", text: `Arrive at ${names.to ?? "your destination"}`, distance: 0, coord: graph.coord(nodeIds[nodeIds.length - 1]), level: floorOf(nodeIds[0]) }];
  }

  // 2. Merge consecutive edges with the same label + kind into legs.
  const legs = [];
  for (const e of edges) {
    const last = legs[legs.length - 1];
    if (last && last.label === e.label && last.kind === e.kind && !(e.kind === "elevator" && last.kind === "elevator" && last.edges.length)) {
      last.length += e.length;
      last.edges.push(e);
    } else {
      legs.push({ label: e.label, kind: e.kind, length: e.length, edges: [e], tags: e.tags, connector: e.connector });
    }
  }

  // Floor before / after each leg (connector internals have no floor).
  // The route may start on a transfer edge that was skipped above, so take the
  // floor from the true first node, then the first floor node along the path.
  const hinted = names.startLevel != null && !String(names.startLevel).includes(";") ? String(names.startLevel) : null;
  let currentLevel = floorOf(nodeIds[0]) ?? hinted ?? nodeIds.map(floorOf).find((l) => l != null) ?? "0";
  for (const leg of legs) {
    leg.levelBefore = currentLevel;
    for (const e of leg.edges) if (e.toLevel != null) currentLevel = e.toLevel;
    leg.levelAfter = currentLevel;
  }
  // A connector leg's nodes are between floors, so its "after" floor is the
  // first floor node the following legs touch.
  for (let i = 0; i < legs.length; i++) {
    if (!legs[i].connector) continue;
    let found = null;
    for (let j = i + 1; j < legs.length && found == null; j++) {
      for (const e of legs[j].edges) {
        if (e.fromLevel != null) {
          found = e.fromLevel;
          break;
        }
        if (e.toLevel != null) {
          found = e.toLevel;
          break;
        }
      }
    }
    if (found == null) found = floorOf(nodeIds[nodeIds.length - 1]) ?? legs[i].levelAfter;
    legs[i].levelAfter = found;
  }
  // Propagate so each leg starts on the floor the previous one ended on.
  for (let i = 1; i < legs.length; i++) legs[i].levelBefore = legs[i - 1].levelAfter;
  for (const leg of legs) if (!leg.connector) leg.levelAfter = leg.levelBefore;

  const lastBearing = (leg) => {
    for (let i = leg.edges.length - 1; i >= 0; i--) if (leg.edges[i].bearing != null) return leg.edges[i].bearing;
    return null;
  };
  const firstBearing = (leg) => leg.edges.find((e) => e.bearing != null)?.bearing ?? null;

  // 3. Emit steps.
  const steps = [];
  const first = legs[0];
  steps.push({
    type: "depart",
    kind: first.kind,
    text: first.connector
      ? connectorText(null, first.kind, first.label, first.levelBefore, first.levelAfter, first.tags)
      : `Head ${firstBearing(first) != null ? compassName(firstBearing(first)) + " " : ""}on ${first.label}`,
    distance: first.length,
    coord: first.edges[0].a,
    level: first.levelBefore,
    levelAfter: first.levelAfter,
    tags: first.tags,
  });

  for (let i = 1; i < legs.length; i++) {
    const prevLeg = legs[i - 1];
    const leg = legs[i];
    const inB = lastBearing(prevLeg);
    const outB = firstBearing(leg);
    const turn = inB == null || outB == null ? "straight" : turnWord(((outB - inB + 540) % 360) - 180);
    const levelChange = leg.connector && leg.levelBefore !== leg.levelAfter;
    steps.push({
      type: levelChange ? "level" : turn === "straight" ? "continue" : "turn",
      turn,
      kind: leg.kind,
      text: leg.connector ? connectorText(turn, leg.kind, leg.label, leg.levelBefore, leg.levelAfter, leg.tags) : verbFor(turn, leg.kind, leg.label),
      distance: leg.length,
      coord: leg.edges[0].a,
      level: leg.levelBefore,
      levelAfter: leg.levelAfter,
      tags: leg.tags,
    });
  }

  const last = legs[legs.length - 1];
  steps.push({
    type: "arrive",
    kind: "arrive",
    text: `Arrive at ${names.to ?? "your destination"}${last.levelAfter && last.levelAfter !== "0" ? ` (${levelLabel(last.levelAfter)})` : ""}`,
    distance: 0,
    coord: last.edges[last.edges.length - 1].b,
    level: last.levelAfter,
  });
  return steps;
}
