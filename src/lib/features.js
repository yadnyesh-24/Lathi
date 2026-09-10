/**
 * Classify OSM tags into the accessibility feature kinds the app knows about.
 * Shared by the build script (Node) and the browser popups.
 * Returns a key of FEATURE_KINDS (data/config.js) or null when the element is
 * not an accessibility feature.
 */
export function classifyFeature(tags) {
  if (!tags) return null;
  const hw = tags.highway;

  if (hw === "steps") return "stairs";
  if (hw === "elevator") return "elevator";
  if (hw === "crossing" || tags.footway === "crossing") return "crossing";
  if (tags.entrance) return "entrance";
  if (tags.amenity === "bench") return "bench";
  if (tags.leisure === "picnic_table" || (tags.amenity === "shelter" && tags.shelter_type !== "public_transport")) return "rest_area";
  if (tags.amenity === "drinking_water") return "drinking_water";
  if (tags.amenity === "toilets") return "toilets";
  if (tags.amenity === "parking_space" && tags.parking_space === "disabled") return "parking_disabled";
  if (tags.amenity === "parking" && tags["capacity:disabled"]) return "parking_disabled";

  const isFootish = hw === "footway" || hw === "path" || hw === "pedestrian" || hw === "corridor";
  if (isFootish && (tags.bridge === "yes" || tags.bridge === "viaduct")) return "skywalk";
  if (tags.ramp === "yes" || tags["ramp:wheelchair"] === "yes") return "ramp";
  if (isFootish && tags.incline && tags.incline !== "0" && tags.incline !== "0%") return "ramp";

  // Anything else that carries an explicit accessibility statement.
  if (tags.wheelchair || tags.handrail || tags.tactile_paving || tags.kerb) return "other";
  return null;
}

/** Human-readable label for a tag value used in popups. */
export function prettyValue(v) {
  if (v == null) return "—";
  return String(v).replaceAll("_", " ");
}

/** Popup-worthy tags in display order. */
export const POPUP_TAG_ORDER = [
  "wheelchair",
  "incline",
  "width",
  "surface",
  "smoothness",
  "handrail",
  "step_count",
  "ramp",
  "ramp:wheelchair",
  "kerb",
  "tactile_paving",
  "crossing",
  "covered",
  "lit",
  "door",
  "automatic_door",
  "entrance",
  "level",
  "seats",
  "backrest",
  "armrest",
  "shelter",
  "bridge",
  "layer",
];
