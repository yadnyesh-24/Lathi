/**
 * Shortest-path search over the routing graph.
 *
 * `shortestPath` is A* with a haversine heuristic scaled by MIN_FACTOR so it
 * stays admissible (no profile ever makes an edge cheaper than 0.8 × length).
 * Passing `heuristicWeight = 0` turns it into plain Dijkstra.
 */
import { edgeCost, MIN_FACTOR } from "./profiles.js";

/** Minimal binary min-heap keyed on a number. */
export class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(key, value) {
    const items = this.items;
    items.push({ key, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].key <= items[i].key) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    if (!items.length) return undefined;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l].key < items[m].key) m = l;
        if (r < items.length && items[r].key < items[m].key) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * @param {import('./graph.js').Graph} graph
 * @param {string} startId
 * @param {string} goalId
 * @param {string} profileId  "normal" | "wheelchair"
 * @param {{ heuristicWeight?: number }} [opts]
 * @returns {{ nodeIds: string[], wayIds: string[], cost: number, lengthM: number, visited: number } | null}
 */
export function shortestPath(graph, startId, goalId, profileId, opts = {}) {
  if (!graph.has(startId) || !graph.has(goalId)) return null;
  if (startId === goalId) return { nodeIds: [startId], wayIds: [], cost: 0, lengthM: 0, visited: 1 };

  const hWeight = opts.heuristicWeight ?? MIN_FACTOR;
  const h = hWeight > 0 ? (id) => graph.distanceBetween(id, goalId) * hWeight : () => 0;

  const dist = new Map([[startId, 0]]);
  const prev = new Map(); // nodeId -> { from, wayId, length }
  const closed = new Set();
  const heap = new MinHeap();
  heap.push(h(startId), startId);
  let visited = 0;

  while (heap.size) {
    const { value: current } = heap.pop();
    if (closed.has(current)) continue;
    closed.add(current);
    visited += 1;
    if (current === goalId) break;

    const dCur = dist.get(current);
    for (const edge of graph.neighbours(current)) {
      if (closed.has(edge.to)) continue;
      const c = edgeCost(profileId, edge.length, graph.wayTags(edge.wayId), graph.tagsOfNode(edge.to));
      if (!Number.isFinite(c)) continue;
      const nd = dCur + c;
      if (nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        prev.set(edge.to, { from: current, wayId: edge.wayId, length: edge.length });
        heap.push(nd + h(edge.to), edge.to);
      }
    }
  }

  if (!dist.has(goalId) || !closed.has(goalId)) return null;

  const nodeIds = [goalId];
  const wayIds = [];
  let lengthM = 0;
  let cur = goalId;
  while (cur !== startId) {
    const p = prev.get(cur);
    nodeIds.push(p.from);
    wayIds.push(p.wayId);
    lengthM += p.length;
    cur = p.from;
  }
  nodeIds.reverse();
  wayIds.reverse();
  return { nodeIds, wayIds, cost: dist.get(goalId), lengthM, visited };
}
