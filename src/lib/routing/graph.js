/**
 * In-memory routing graph built from public/data/graph.json.
 *
 * graph.json shape (produced by scripts/build-data.mjs):
 *   nodes:    { [key]: [lon, lat, levelLabel] }   key = "<osmNodeId>@<level>"
 *   nodeTags: { [osmNodeId]: { ...tags } }        only nodes with routing-relevant tags
 *   ways:     { [wayId]: { ...tags } }            incl. synthetic "elev<nodeId>" lift ways
 *   edges:    [ [fromKey, toKey, lengthM, wayId], ... ]   undirected
 *
 * Levels: a node key's level is "0", "1", … for a floor, or "c<wayId>" while
 * on a connector (stairs / ramp). Two floors are joined only through connector
 * or lift edges, never directly.
 */
import { haversineMeters } from "../geo/haversine.js";
import { splitKey } from "../levels.js";

export class Graph {
  constructor(json) {
    this.nodes = json.nodes;
    this.nodeTags = json.nodeTags ?? {};
    this.ways = json.ways;
    /** @type {Map<string, Array<{to: string, length: number, wayId: string}>>} */
    this.adjacency = new Map();
    this.edgeCount = 0;
    for (const [a, b, length, wayId] of json.edges) {
      this.#link(a, b, length, wayId);
      this.#link(b, a, length, wayId);
      this.edgeCount += 1;
    }
    this.nodeIds = Object.keys(this.nodes);
    /** Floors present ("0","1",…), sorted. */
    const levels = new Set();
    for (const k of this.nodeIds) {
      const l = this.nodes[k][2];
      if (l && !l.includes(";")) levels.add(l);
    }
    this.levels = [...levels].sort((x, y) => Number(x) - Number(y));
  }

  #link(from, to, length, wayId) {
    let list = this.adjacency.get(from);
    if (!list) {
      list = [];
      this.adjacency.set(from, list);
    }
    list.push({ to, length, wayId });
  }

  has(key) {
    return key in this.nodes;
  }

  /** [lon, lat] of a node key. */
  coord(key) {
    const n = this.nodes[key];
    return n ? [n[0], n[1]] : undefined;
  }

  /** Floor label of a node: "0", "1", or "0;1" while on stairs/ramp. */
  levelOf(key) {
    return this.nodes[key]?.[2] ?? "0";
  }

  /** True when the node sits on a connector (stairs/ramp), i.e. between floors. */
  isConnectorNode(key) {
    return splitKey(key).level.startsWith("c");
  }

  neighbours(key) {
    return this.adjacency.get(key) ?? [];
  }

  wayTags(wayId) {
    return this.ways[wayId] ?? {};
  }

  /** OSM node tags (shared by all level-variants of the node). */
  tagsOfNode(key) {
    return this.nodeTags[splitKey(key).osmId] ?? null;
  }

  distanceBetween(aKey, bKey) {
    const a = this.nodes[aKey];
    const b = this.nodes[bKey];
    return haversineMeters(a[1], a[0], b[1], b[0]);
  }

  /**
   * Nearest graph node to a lon/lat, optionally restricted to a floor.
   * Linear scan over a few thousand nodes: well under a millisecond.
   * @param {{ level?: string|null, maxMeters?: number, filter?: (key: string) => boolean }} [opts]
   */
  nearestNode(lon, lat, opts = {}) {
    const { level = null, maxMeters = Infinity, filter } = opts;
    let best = null;
    let bestD = maxMeters;
    for (const key of this.nodeIds) {
      const n = this.nodes[key];
      if (Math.abs(n[1] - lat) > 0.01 || Math.abs(n[0] - lon) > 0.01) continue;
      if (level != null && n[2] !== level) continue;
      if (filter && !filter(key)) continue;
      const d = haversineMeters(lat, lon, n[1], n[0]);
      if (d < bestD) {
        bestD = d;
        best = key;
      }
    }
    return best ? { nodeId: best, distance: bestD } : null;
  }
}

let cached = null;

/** Fetch + build the graph once per page load. */
export async function loadGraph(url = "/data/graph.json") {
  if (cached) return cached;
  cached = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to load graph (${r.status})`);
      return r.json();
    })
    .then((json) => new Graph(json));
  return cached;
}
