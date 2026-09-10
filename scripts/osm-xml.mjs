/**
 * Minimal OSM XML (.osm) parser — enough to read JOSM session files and the
 * OSM API /map response. Produces Overpass-JSON-shaped elements so the rest of
 * the pipeline does not care where the data came from.
 *
 * Accepts both attribute quote styles: the OSM API writes id="1", JOSM writes id='1'.
 * Elements marked action='delete' by JOSM are skipped; other actions are kept
 * and reported via `element.action`.
 */

function decodeXml(s) {
  return s
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&#10;", "\n")
    .replaceAll("&amp;", "&");
}

const ATTR = (name) => new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`);

function attr(block, name) {
  const m = block.match(ATTR(name));
  return m ? decodeXml(m[1] ?? m[2] ?? "") : undefined;
}

const TAG_RE = /<tag\s+([^>]*?)\/>/g;

function parseTags(inner) {
  const tags = {};
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(inner))) {
    const k = attr(m[1], "k");
    const v = attr(m[1], "v");
    if (k != null && v != null) tags[k] = v;
  }
  return Object.keys(tags).length ? tags : undefined;
}

function common(open) {
  const out = {};
  for (const k of ["version", "timestamp", "changeset", "user", "uid", "action", "visible"]) {
    const v = attr(open, k);
    if (v != null) out[k] = k === "version" || k === "changeset" || k === "uid" ? Number(v) : v;
  }
  return out;
}

/** @returns {{ elements: Array<object>, bounds?: object }} */
export function parseOsmXml(xml) {
  const elements = [];

  const b = xml.match(/<bounds\b([^>]*)\/?>/);
  const bounds = b
    ? { minlat: Number(attr(b[1], "minlat")), minlon: Number(attr(b[1], "minlon")), maxlat: Number(attr(b[1], "maxlat")), maxlon: Number(attr(b[1], "maxlon")) }
    : undefined;

  const nodeRe = /<node\b([^>]*?)\/>|<node\b([^>]*)>([\s\S]*?)<\/node>/g;
  let nm;
  while ((nm = nodeRe.exec(xml))) {
    const open = nm[1] ?? nm[2] ?? "";
    const id = Number(attr(open, "id"));
    const lat = Number(attr(open, "lat"));
    const lon = Number(attr(open, "lon"));
    if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (attr(open, "action") === "delete") continue;
    const el = { type: "node", id, lat, lon, ...common(open) };
    const tags = nm[3] ? parseTags(nm[3]) : undefined;
    if (tags) el.tags = tags;
    elements.push(el);
  }

  const wayRe = /<way\b([^>]*)>([\s\S]*?)<\/way>/g;
  let wm;
  while ((wm = wayRe.exec(xml))) {
    const id = Number(attr(wm[1], "id"));
    if (!Number.isFinite(id)) continue;
    if (attr(wm[1], "action") === "delete") continue;
    const nodes = [];
    const ndRe = /<nd\s+ref=(?:"(-?\d+)"|'(-?\d+)')\s*\/>/g;
    let dm;
    while ((dm = ndRe.exec(wm[2]))) nodes.push(Number(dm[1] ?? dm[2]));
    const el = { type: "way", id, nodes, ...common(wm[1]) };
    const tags = parseTags(wm[2]);
    if (tags) el.tags = tags;
    elements.push(el);
  }

  const relRe = /<relation\b([^>]*)>([\s\S]*?)<\/relation>/g;
  let rm;
  while ((rm = relRe.exec(xml))) {
    const id = Number(attr(rm[1], "id"));
    if (!Number.isFinite(id)) continue;
    if (attr(rm[1], "action") === "delete") continue;
    const members = [];
    const memRe = /<member\s+([^>]*)\/>/g;
    let mm;
    while ((mm = memRe.exec(rm[2]))) {
      members.push({ type: attr(mm[1], "type"), ref: Number(attr(mm[1], "ref")), role: attr(mm[1], "role") ?? "" });
    }
    const el = { type: "relation", id, members, ...common(rm[1]) };
    const tags = parseTags(rm[2]);
    if (tags) el.tags = tags;
    elements.push(el);
  }

  return bounds ? { elements, bounds } : { elements };
}
