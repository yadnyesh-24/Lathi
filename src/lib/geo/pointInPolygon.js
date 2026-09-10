/**
 * Ray-casting point-in-ring test.
 * @param {number} lon
 * @param {number} lat
 * @param {number[][]} ring  Array of [lon, lat] pairs (closed or open).
 */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Point-in-polygon supporting holes (GeoJSON Polygon coordinates).
 * @param {number} lon
 * @param {number} lat
 * @param {number[][][]} polygon  [outerRing, ...holes]
 */
export function pointInPolygon(lon, lat, polygon) {
  if (!polygon?.length) return false;
  if (!pointInRing(lon, lat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lon, lat, polygon[i])) return false;
  }
  return true;
}

/** Point-in-GeoJSON geometry (Polygon or MultiPolygon). */
export function pointInGeometry(lon, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygon(lon, lat, geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((poly) => pointInPolygon(lon, lat, poly));
  }
  return false;
}

/** Centroid (arithmetic mean of vertices) of a ring. */
export function ringCentroid(ring) {
  let lon = 0;
  let lat = 0;
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1
    : ring.length;
  if (!n) return null;
  for (let i = 0; i < n; i++) {
    lon += ring[i][0];
    lat += ring[i][1];
  }
  return { lon: lon / n, lat: lat / n };
}
