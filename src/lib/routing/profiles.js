/**
 * Profile-weighted edge costs — the project's core contribution.
 *
 * cost = length × factor + penalties, per Plan.md §4:
 *
 *   Rule                                     Normal   Wheelchair
 *   highway=steps                            ×1.2     forbidden unless ramp:wheelchair=yes
 *   wheelchair=no                            ×1       forbidden
 *   incline > 8 % (or steep)                 ×1       ×6
 *   incline 5–8 %                            ×1       ×2.5
 *   width < 0.9 m                            ×1       ×4
 *   surface gravel/sand/ground/unpaved       ×1.1     ×3
 *   smoothness bad/very_bad                  ×1.1     ×4
 *   crossing with kerb=raised                +5 m     +200 m
 *   wheelchair=yes ramp / highway=elevator   ×1       ×0.8
 *
 * Returns Infinity for forbidden edges/nodes.
 */
import { ROAD_HIGHWAYS } from "../../../data/config.js";
import { isMultiLevel } from "../levels.js";

export const FORBIDDEN = Infinity;

/** Smallest multiplicative factor any profile applies — keeps the A* heuristic admissible. */
export const MIN_FACTOR = 0.8;

const LOOSE_SURFACES = new Set([
  "gravel",
  "fine_gravel",
  "sand",
  "ground",
  "unpaved",
  "dirt",
  "earth",
  "grass",
  "mud",
  "pebblestone",
  "woodchips",
  "compacted",
]);
const BAD_SMOOTHNESS = new Set(["bad", "very_bad", "horrible", "very_horrible", "impassable"]);

/** Parse OSM incline into a percentage (absolute) or a keyword. */
export function parseIncline(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (v === "up" || v === "down") return { kind: "direction" };
  if (v === "steep") return { kind: "steep" };
  const m = v.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (m) return { kind: "percent", value: Math.abs(parseFloat(m[1])) };
  const deg = v.match(/^(-?\d+(?:\.\d+)?)\s*°$/);
  if (deg) return { kind: "percent", value: Math.abs(Math.tan((parseFloat(deg[1]) * Math.PI) / 180) * 100) };
  return null;
}

/** Parse OSM width ("1.5", "1.5 m", "150 cm") into metres. */
export function parseWidthMeters(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  const cm = v.match(/^(\d+(?:\.\d+)?)\s*cm$/);
  if (cm) return parseFloat(cm[1]) / 100;
  const m = v.match(/^(\d+(?:\.\d+)?)\s*(m)?$/);
  if (m) return parseFloat(m[1]);
  return null;
}

/** Shared road preference: nudge both profiles onto footways where they exist. */
function roadFactor(tags) {
  const hw = tags.highway;
  if (!ROAD_HIGHWAYS.has(hw)) return 1;
  if (tags.sidewalk && tags.sidewalk !== "no" && tags.sidewalk !== "none") return 1;
  if (hw === "primary" || hw === "secondary") return 1.35;
  if (hw === "tertiary" || hw === "unclassified") return 1.2;
  if (hw === "track") return 1.15;
  return 1.1; // residential, service, cycleway
}

function normalEdgeFactor(tags) {
  let f = roadFactor(tags);
  if (tags.highway === "steps") f *= 1.2;
  if (LOOSE_SURFACES.has(tags.surface)) f *= 1.1;
  if (BAD_SMOOTHNESS.has(tags.smoothness)) f *= 1.1;
  return f;
}

function wheelchairEdgeFactor(tags) {
  if (tags.wheelchair === "no") return FORBIDDEN;
  // A staircase is never a wheelchair path, whatever it is tagged. A ramp that
  // runs beside stairs must be drawn as its own ramp=yes way.
  if (tags.highway === "steps") return FORBIDDEN;
  let f = roadFactor(tags);

  // A mapped ramp is, by definition, the wheelchair way between levels: always
  // usable and preferred, whatever its incline. (Team decision — ramps on
  // campus are built for wheelchairs; the incline tag is kept for information.)
  const isRamp = tags.ramp === "yes" || tags["ramp:wheelchair"] === "yes" || (tags.highway !== "steps" && isMultiLevel(tags));
  if (isRamp) return f * MIN_FACTOR;

  const inc = parseIncline(tags.incline);
  if (inc) {
    // Ordinary sloped path (not a built ramp): steepness matters.
    if (inc.kind === "steep") f *= 6;
    else if (inc.kind === "percent") {
      if (inc.value > 8) f *= 6;
      else if (inc.value >= 5) f *= 2.5;
    } else if (inc.kind === "direction") f *= 1.5; // slope of unknown grade
  }

  const width = parseWidthMeters(tags.width);
  if (width != null && width < 0.9) f *= 4;

  if (LOOSE_SURFACES.has(tags.surface)) f *= 3;
  if (BAD_SMOOTHNESS.has(tags.smoothness)) f *= 4;
  if (tags.wheelchair === "limited") f *= 2;

  if (tags.highway === "elevator") f *= MIN_FACTOR;
  return f;
}

/** Extra metres added when a route passes *through* a node (crossings, kerbs, barriers). */
function nodePenalty(tags, profileId) {
  if (!tags) return 0;
  const wheelchair = profileId === "wheelchair";

  if (wheelchair && tags.wheelchair === "no") return FORBIDDEN;
  if (wheelchair && ["turnstile", "cycle_barrier", "kissing_gate", "stile"].includes(tags.barrier)) {
    return FORBIDDEN;
  }
  if (tags.barrier === "gate" && (tags.access === "private" || tags.access === "no" || tags.locked === "yes")) {
    return FORBIDDEN;
  }

  let p = 0;
  const isCrossing = tags.highway === "crossing" || tags.barrier === "kerb";
  if (isCrossing) {
    if (tags.kerb === "raised") p += wheelchair ? 200 : 5;
    else if (!tags.kerb && wheelchair && tags.highway === "crossing") p += 15; // unknown kerb: mild caution
    if (wheelchair && tags.tactile_paving === "no") p += 0; // matters for VI profile later
  }
  if (tags.highway === "elevator") p += wheelchair ? 0 : 20; // waiting time; wheelchair users prefer it
  return p;
}

/**
 * Fixed metres added per staircase edge for walkers: climbing a flight costs
 * time and effort beyond its length, so a level walkway a little longer than
 * "down the stairs, along the road, up the stairs" should win.
 */
export const STAIRS_PENALTY_M = 15;

function normalEdgePenalty(tags) {
  return tags.highway === "steps" ? STAIRS_PENALTY_M : 0;
}

export const PROFILE_RULES = {
  normal: { edgeFactor: normalEdgeFactor, edgePenalty: normalEdgePenalty, nodePenalty: (t) => nodePenalty(t, "normal") },
  wheelchair: { edgeFactor: wheelchairEdgeFactor, edgePenalty: () => 0, nodePenalty: (t) => nodePenalty(t, "wheelchair") },
};

/**
 * Cost of traversing an edge of `length` metres with `wayTags`, arriving at a
 * node carrying `toNodeTags`. Infinity when forbidden for the profile.
 */
export function edgeCost(profileId, length, wayTags, toNodeTags) {
  const rules = PROFILE_RULES[profileId] ?? PROFILE_RULES.normal;
  const tags = wayTags ?? {};
  const f = rules.edgeFactor(tags);
  if (f === FORBIDDEN) return FORBIDDEN;
  const p = rules.nodePenalty(toNodeTags);
  if (p === FORBIDDEN) return FORBIDDEN;
  // Zero-length transfer edges (floor <-> connector) carry no penalty.
  return length * f + p + (length > 0 ? rules.edgePenalty(tags) : 0);
}
