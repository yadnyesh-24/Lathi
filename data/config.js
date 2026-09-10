/**
 * Shared configuration for the IITK Accessible app.
 * Imported by both the browser app (src/) and the Node data scripts (scripts/).
 * Keep this file free of browser- or Node-only APIs.
 */

/** IIT Kanpur campus bounding box (WGS84). Verified against OSM extract. */
export const CAMPUS_BBOX = {
  south: 26.495,
  west: 80.215,
  north: 26.53,
  east: 80.25,
};

/** Opening view: the Academic Area, not the whole campus. */
export const ACADEMIC_AREA_CENTER = { lat: 26.5119, lon: 80.2324 };

export const INITIAL_ZOOM = 16.5;
export const MIN_ZOOM = 14;
export const MAX_ZOOM = 20;

/** Free vector basemap, no key, no quota. */
export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * When true, both route endpoints must be inside the Academic Area polygon.
 * We currently route across the whole campus using whatever OSM already has,
 * and only *warn* when an endpoint is outside the detailed-coverage zone.
 */
export const RESTRICT_ROUTING_TO_ACADEMIC_AREA = false;

/** OSM `highway=*` values that pedestrians may use. Order does not matter. */
export const ROUTABLE_HIGHWAYS = [
  "footway",
  "path",
  "pedestrian",
  "steps",
  "corridor",
  "living_street",
  "residential",
  "service",
  "unclassified",
  "tertiary",
  "secondary",
  "primary",
  "track",
  "cycleway",
  "elevator",
];

/** Highways that are roads: walkable, but we prefer footways where they exist. */
export const ROAD_HIGHWAYS = new Set([
  "residential",
  "service",
  "unclassified",
  "tertiary",
  "secondary",
  "primary",
  "track",
  "cycleway",
]);

/** Snap a place to the graph only if a graph node is within this distance. */
export const SNAP_MAX_METERS = 250;

export const PROFILES = [
  {
    id: "normal",
    label: "Normal",
    hint: "Shortest reasonable walk; stairs allowed",
    walkingSpeedMps: 1.3,
  },
  {
    id: "wheelchair",
    label: "Wheelchair",
    hint: "Step-free only; avoids steep, narrow or rough paths",
    walkingSpeedMps: 1.0,
  },
];

/** Map colours for the paths layer and the route (team palette). */
export const PATH_COLORS = {
  ground: "rgb(122, 198, 255)", // paths on level 0
  upper: "rgb(2, 109, 180)", // paths on level 1+ (skywalks, upper corridors)
  route: "rgb(255, 0, 255)", // the chosen route
  ramp: "rgb(255, 237, 90)",
  stairs: "rgb(255, 176, 55)",
  elevator: "#0891b2",
  road: "rgb(122, 198, 255)", // roads are ground paths too, drawn thinner
};

/** Map layer modes offered by the layer picker. */
export const MAP_MODES = [
  { id: "buildings", label: "Buildings", hint: "Base map with building names only" },
  { id: "paths", label: "Paths", hint: "Every walkable path, coloured by floor" },
];

/** Accessibility feature kinds we classify from OSM tags, with display styling. */
export const FEATURE_KINDS = {
  ramp: { label: "Ramp", color: "rgb(255, 237, 90)" },
  stairs: { label: "Stairs", color: "rgb(255, 176, 55)" },
  skywalk: { label: "Skywalk", color: "#7c3aed" },
  crossing: { label: "Crossing", color: "#f59e0b" },
  elevator: { label: "Elevator", color: "#0891b2" },
  entrance: { label: "Entrance", color: "#2563eb" },
  bench: { label: "Bench", color: "#a16207" },
  rest_area: { label: "Rest area", color: "#65a30d" },
  drinking_water: { label: "Drinking water", color: "#0ea5e9" },
  toilets: { label: "Toilets", color: "#6b7280" },
  parking_disabled: { label: "Accessible parking", color: "#1d4ed8" },
  other: { label: "Accessibility note", color: "#64748b" },
};
