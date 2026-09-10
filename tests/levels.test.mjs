import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph } from "../src/lib/routing/graph.js";
import { shortestPath } from "../src/lib/routing/dijkstra.js";
import { buildDirections } from "../src/lib/routing/directions.js";
import { parseLevels, isMultiLevel, levelLabel } from "../src/lib/levels.js";

/**
 * Two floors of a building, drawn on top of each other:
 *
 *   level 1:   A1 ── B1 ── C1            (corridor, level=1)
 *              │           │
 *           stairs        lift            stairs: way "st" level=0;1 (own nodes A@cst, B@cst)
 *              │           │              lift:   node C, highway=elevator, joins C@0 <-> C@1
 *   level 0:   A0 ── B0 ── C0            (corridor, level=0)
 *
 * A0/A1 share the OSM node "A" (same lat/lon) but live at different levels; a
 * path may only go between them via the stairs (normal) or the lift (both).
 */
function twoFloors({ withLift = true, withStairs = true, ramp = false } = {}) {
  const edges = [
    ["A@0", "B@0", 100, "c0"],
    ["B@0", "C@0", 100, "c0"],
    ["A@1", "B@1", 100, "c1"],
    ["B@1", "C@1", 100, "c1"],
  ];
  const ways = {
    c0: { highway: "corridor", level: "0", name: "Ground corridor" },
    c1: { highway: "corridor", level: "1", name: "First floor corridor" },
  };
  if (withStairs) {
    // stairs drawn from A (bottom) to a landing node L then back to A (top); modelled as connector chain
    edges.push(["A@cst", "L@cst", 6, "st"], ["A@cst", "A@0", 0, "st"], ["L@cst", "A@1", 0, "st"]);
    ways.st = ramp
      ? { highway: "footway", ramp: "yes", incline: "6%", level: "0;1", wheelchair: "yes" }
      : { highway: "steps", level: "0;1", step_count: "14", handrail: "yes" };
  }
  if (withLift) {
    edges.push(["C@0", "C@1", 4, "elevC"]);
    ways.elevC = { highway: "elevator", level: "0;1", wheelchair: "yes" };
  }
  return new Graph({
    nodes: {
      "A@0": [80.23, 26.51, "0"],
      "B@0": [80.231, 26.51, "0"],
      "C@0": [80.232, 26.51, "0"],
      "A@1": [80.23, 26.51, "1"],
      "B@1": [80.231, 26.51, "1"],
      "C@1": [80.232, 26.51, "1"],
      "A@cst": [80.23, 26.51, "0;1"],
      "L@cst": [80.23, 26.51005, "0;1"],
    },
    nodeTags: { C: { highway: "elevator", level: "0;1" } },
    ways,
    edges,
  });
}

test("level parsing", () => {
  assert.deepEqual(parseLevels("0;1"), ["0", "1"]);
  assert.deepEqual(parseLevels("1;0"), ["1", "0"]);
  assert.deepEqual(parseLevels(undefined), ["0"]);
  assert.deepEqual(parseLevels("0-2"), ["0", "1", "2"]);
  assert.equal(isMultiLevel({ level: "0;1" }), true);
  assert.equal(isMultiLevel({ level: "1" }), false);
  assert.equal(levelLabel("0"), "Ground");
  assert.equal(levelLabel("1"), "Level 1");
});

test("same spot on two floors is NOT connected directly", () => {
  const g = twoFloors({ withLift: false, withStairs: false });
  assert.equal(shortestPath(g, "B@0", "B@1", "normal"), null);
  assert.equal(shortestPath(g, "B@0", "B@1", "wheelchair"), null);
});

test("normal takes the stairs when they are the shortest level change", () => {
  const g = twoFloors();
  const p = shortestPath(g, "A@0", "A@1", "normal");
  assert.ok(p);
  assert.ok(p.wayIds.includes("st"), "should use the stairs");
  assert.ok(!p.wayIds.includes("elevC"));
});

test("wheelchair refuses the stairs and uses the lift instead", () => {
  const g = twoFloors();
  const p = shortestPath(g, "A@0", "A@1", "wheelchair");
  assert.ok(p);
  assert.ok(!p.wayIds.includes("st"), "must not use stairs");
  assert.ok(p.wayIds.includes("elevC"), "should use the lift");
  // Went along ground to C, up the lift, back along level 1.
  assert.deepEqual(p.nodeIds, ["A@0", "B@0", "C@0", "C@1", "B@1", "A@1"]);
});

test("wheelchair with stairs only and no lift → no route", () => {
  const g = twoFloors({ withLift: false });
  assert.ok(shortestPath(g, "A@0", "A@1", "normal"));
  assert.equal(shortestPath(g, "A@0", "A@1", "wheelchair"), null);
});

test("a ramp works for both profiles", () => {
  const g = twoFloors({ withLift: false, ramp: true });
  for (const profile of ["normal", "wheelchair"]) {
    const p = shortestPath(g, "A@0", "A@1", profile);
    assert.ok(p, profile);
    assert.ok(p.wayIds.includes("st"));
  }
});

test("directions announce the level change", () => {
  const g = twoFloors();
  const normal = shortestPath(g, "B@0", "B@1", "normal");
  const steps = buildDirections(g, normal.nodeIds, normal.wayIds, { to: "Room 201" });
  const lvl = steps.find((s) => s.type === "level");
  assert.ok(lvl, "expected a level-change step");
  assert.match(lvl.text, /stairs up to Level 1/);
  assert.match(lvl.text, /14 steps/);
  assert.match(steps.at(-1).text, /Arrive at Room 201 \(Level 1\)/);

  const wheel = shortestPath(g, "B@0", "B@1", "wheelchair");
  const wsteps = buildDirections(g, wheel.nodeIds, wheel.wayIds, { to: "Room 201" });
  assert.match(wsteps.find((s) => s.type === "level").text, /lift to Level 1/);
});
