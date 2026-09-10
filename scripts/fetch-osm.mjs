/**
 * Fetch the raw OpenStreetMap data for the IIT Kanpur campus box and save it
 * as data/raw/iitk.osm.json (Overpass JSON shape).
 *
 *   npm run data:fetch                # Overpass API (default)
 *   node scripts/fetch-osm.mjs --osm-api   # fall back to api.openstreetmap.org /map
 *
 * The snapshot is committed to the repo: a build is always reproducible from
 * it, and the site does not depend on Overpass being up.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { CAMPUS_BBOX } from "../data/config.js";
import { bboxToOverpass } from "../src/lib/geo/bbox.js";
import { parseOsmXml } from "./osm-xml.mjs";

const USER_AGENT = "Lathi-IITK-Accessible/0.1 (https://github.com/sunilj24-maker/Lathi)";
const OUT = join(process.cwd(), "data/raw/iitk.osm.json");

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

function overpassQuery(bbox) {
  const b = bboxToOverpass(bbox);
  // Everything inside the box plus the nodes/ways referenced by those ways and
  // relations. `(._;>;)` unions the result so each element is output exactly
  // once, with its tags.
  return `[out:json][timeout:120];
(
  node(${b});
  way(${b});
  relation(${b});
);
(._;>;);
out body qt;`;
}

/** Keep one copy of each element, preferring the copy that carries tags. */
function dedupe(elements) {
  const byKey = new Map();
  for (const el of elements) {
    const key = `${el.type}/${el.id}`;
    const prev = byKey.get(key);
    if (!prev || (!prev.tags && el.tags)) byKey.set(key, el);
  }
  return [...byKey.values()];
}

async function fetchOverpass(bbox) {
  const query = overpassQuery(bbox);
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Overpass: ${endpoint}`);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const json = await res.json();
      if (!Array.isArray(json.elements)) throw new Error("Malformed Overpass response");
      return json;
    } catch (err) {
      lastErr = err;
      console.warn(`  failed: ${err.message}`);
    }
  }
  throw lastErr ?? new Error("All Overpass endpoints failed");
}

async function fetchOsmApi(bbox) {
  const b = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${b}`;
  console.log(`OSM API: ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`OSM API returned ${res.status} ${res.statusText}`);
  const xml = await res.text();
  return {
    version: 0.6,
    generator: "scripts/fetch-osm.mjs (osm-api)",
    osm3s: { copyright: "The data included in this document is from www.openstreetmap.org. The data is made available under ODbL." },
    ...parseOsmXml(xml),
  };
}

async function main() {
  const useOsmApi = process.argv.includes("--osm-api");
  let data;
  if (useOsmApi) {
    data = await fetchOsmApi(CAMPUS_BBOX);
  } else {
    try {
      data = await fetchOverpass(CAMPUS_BBOX);
    } catch (err) {
      console.warn(`Overpass unavailable (${err.message}); falling back to OSM API`);
      data = await fetchOsmApi(CAMPUS_BBOX);
    }
  }

  data.elements = dedupe(data.elements);
  data.fetchedAt = new Date().toISOString();
  data.bbox = CAMPUS_BBOX;

  const counts = { node: 0, way: 0, relation: 0 };
  for (const el of data.elements) counts[el.type] = (counts[el.type] ?? 0) + 1;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(data));
  const mb = (Buffer.byteLength(JSON.stringify(data)) / 1e6).toFixed(1);
  console.log(
    `Wrote ${OUT}\n  ${counts.node} nodes, ${counts.way} ways, ${counts.relation} relations (${mb} MB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
