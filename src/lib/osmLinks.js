/** Links into OpenStreetMap and JOSM (Remote Control) for a given element. */

export function osmUrl(osmId) {
  return `https://www.openstreetmap.org/${osmId}`;
}

/**
 * JOSM Remote Control: loads the surrounding area and selects the object.
 * Works when JOSM is running with Preferences → Remote Control enabled.
 */
export function josmUrl(lon, lat, osmId, halfSizeDeg = 0.0008) {
  const params = new URLSearchParams({
    left: (lon - halfSizeDeg).toFixed(6),
    right: (lon + halfSizeDeg).toFixed(6),
    top: (lat + halfSizeDeg).toFixed(6),
    bottom: (lat - halfSizeDeg).toFixed(6),
  });
  if (osmId) params.set("select", osmId.replace("/", ""));
  return `http://127.0.0.1:8111/load_and_zoom?${params.toString()}`;
}
