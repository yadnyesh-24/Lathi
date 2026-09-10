/** Loaders for the static data files produced by scripts/build-data.mjs. */

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return res.json();
}

const cache = new Map();
function once(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

export const loadPlaces = () => once("places", () => getJson("/data/places.json"));
export const loadFeatures = () => once("features", () => getJson("/data/features.geojson"));
export const loadBuildings = () => once("buildings", () => getJson("/data/buildings.geojson"));
export const loadAcademicArea = () => once("academic", () => getJson("/data/academic-area.geojson"));
export const loadMeta = () => once("meta", () => getJson("/data/meta.json").catch(() => null));
export const loadIndoor = () => once("indoor", () => getJson("/data/indoor.geojson").catch(() => null));
export const loadPaths = () => once("paths", () => getJson("/data/paths.geojson").catch(() => null));
export const loadQa = () => once("qa", () => getJson("/data/qa.json").catch(() => null));

/** Build a place-like object from a raw map click (on the floor being viewed). */
export function pointPlace(lon, lat, label, level = "0") {
  return {
    id: `point/${lon.toFixed(5)},${lat.toFixed(5)}@${level}`,
    name: label ?? `Dropped pin (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
    kind: "point",
    lon,
    lat,
    level: level ?? "0",
  };
}

/** Build a place-like object from a clicked building feature. */
export function buildingPlace(feature, places) {
  const osmId = feature.properties.osmId;
  const known = places?.find((p) => p.id === osmId);
  if (known) return known;
  const ring = feature.geometry.coordinates[0];
  let lon = 0;
  let lat = 0;
  const n = ring.length - 1 || 1;
  for (let i = 0; i < n; i++) {
    lon += ring[i][0];
    lat += ring[i][1];
  }
  return {
    id: osmId,
    name: feature.properties.name ?? "Unnamed building",
    kind: "building",
    lon: lon / n,
    lat: lat / n,
    inAcademicArea: Boolean(feature.properties.inAcademicArea),
  };
}
