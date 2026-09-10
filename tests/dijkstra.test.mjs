import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph } from "../src/lib/routing/graph.js";
import { shortestPath, MinHeap } from "../src/lib/routing/dijkstra.js";
import { buildDirections } from "../src/lib/routing/directions.js";

/**
 * Tiny synthetic campus, ~1e-4 deg ≈ 11 m:
 *
 *   A ─── B ─── C        top row: footway
 *   │           │
 *   │  (steps)  │        A–D is a staircase (short cut), C–D a footway
 *   D ──────────┘
 */
function tinyGraph() {
  return new Graph({
    nodes: {
      A: [80.2300, 26.5100],
      B: [80.2310, 26.5100],
      C: [80.2320, 26.5100],
      D: [80.2300, 26.5090],
    },
    nodeTags: {},
    ways: {
      top: { highway: "footway", name: "Top Path" },
      right: { highway: "footway", name: "Right Path" },
      stairs: { highway: "steps", step_count: 12 },
    },
    edges: [
      ["A", "B", 100, "top"],
      ["B", "C", 100, "top"],
      ["C", "D", 250, "right"],
      ["A", "D", 110, "stairs"],
    ],
  });
}

test("min-heap pops in key order", () => {
  const h = new MinHeap();
  for (const k of [5, 1, 4, 2, 3]) h.push(k, `v${k}`);
  const out = [];
  while (h.size) out.push(h.pop().key);
  assert.deepEqual(out, [1, 2, 3, 4, 5]);
});

test("normal profile takes the stairs shortcut; wheelchair goes around", () => {
  const g = tinyGraph();
  const normal = shortestPath(g, "A", "D", "normal");
  assert.deepEqual(normal.nodeIds, ["A", "D"]);
  assert.equal(normal.lengthM, 110);

  const wheel = shortestPath(g, "A", "D", "wheelchair");
  assert.deepEqual(wheel.nodeIds, ["A", "B", "C", "D"]);
  assert.equal(wheel.lengthM, 450);
});

test("returns null when the only connection is forbidden", () => {
  const g = new Graph({
    nodes: { A: [80.23, 26.51], B: [80.231, 26.51] },
    nodeTags: {},
    ways: { s: { highway: "steps" } },
    edges: [["A", "B", 50, "s"]],
  });
  assert.ok(shortestPath(g, "A", "B", "normal"));
  assert.equal(shortestPath(g, "A", "B", "wheelchair"), null);
});

test("plain Dijkstra (no heuristic) and A* agree", () => {
  const g = tinyGraph();
  const a = shortestPath(g, "A", "D", "wheelchair");
  const d = shortestPath(g, "A", "D", "wheelchair", { heuristicWeight: 0 });
  assert.deepEqual(a.nodeIds, d.nodeIds);
  assert.equal(a.cost, d.cost);
});

test("directions name the ways and finish with an arrive step", () => {
  const g = tinyGraph();
  const p = shortestPath(g, "A", "D", "wheelchair");
  const steps = buildDirections(g, p.nodeIds, p.wayIds, { to: "Library" });
  assert.match(steps[0].text, /^Head east on Top Path/);
  assert.match(steps[1].text, /Right Path/);
  assert.equal(steps.at(-1).type, "arrive");
  assert.equal(steps.at(-1).text, "Arrive at Library");
});
