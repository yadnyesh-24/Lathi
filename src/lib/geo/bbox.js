/** Convert {south, west, north, east} to MapLibre LngLatBoundsLike [[w, s], [e, n]]. */
export function bboxToBounds(bbox) {
  return [
    [bbox.west, bbox.south],
    [bbox.east, bbox.north],
  ];
}

/** Overpass / OSM API bbox string "south,west,north,east". */
export function bboxToOverpass(bbox) {
  return `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
}

export function bboxContains(bbox, lon, lat) {
  return lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north;
}

/** Bounding box of an array of [lon, lat] coordinates. */
export function coordsBbox(coords) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

/** Pad a bbox by a fraction of its size on each side. */
export function padBbox(bbox, fraction = 0.1) {
  const dw = (bbox.east - bbox.west) * fraction;
  const dh = (bbox.north - bbox.south) * fraction;
  return {
    west: bbox.west - dw,
    east: bbox.east + dw,
    south: bbox.south - dh,
    north: bbox.north + dh,
  };
}
