/**
 * Door-first snapping and building door rules, checked on the real campus data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Graph } from "../src/lib/routing/graph.js";
import { computeRoutes } from "../src/lib/routing/route.js";
import { snapTiers } from "../src/lib/routing/snap.js";

const graph = new Graph(JSON.parse(readFileSync("public/data/graph.json", "utf8")));
const places = JSON.parse(readFileSync("public/data/places.json", "utf8"));
const place = (name) => {
  const p = places.find((x) => x.name === name || x.aliases?.includes(name));
  assert.ok(p, `place "${name}" missing`);
  return p;
};

test("searching a short form resolves to the building (LH7 → Lecture Hall 7)", () => {
  assert.equal(place("LH7").name, "Lecture Hall 7");
  assert.equal(place("L7").name, "Lecture Hall 7");
});

test("a building's own doors are not listed as separate search entries", () => {
  assert.equal(places.filter((p) => p.name.startsWith("Lecture Hall 7 —")).length, 0);
});

test("routes to a building end at one of its doors, not on the ground next to it", () => {
  const lh7 = place("Lecture Hall 7");
  const doorKeys = new Set(lh7.entrances.flatMap((e) => e.keys));
  for (const profile of ["normal", "wheelchair"]) {
    const { main } = computeRoutes(graph, place("Hall 3 Mess"), lh7, profile);
    assert.ok(doorKeys.has(main.nodeIds.at(-1)), `${profile}: ended at ${main.nodeIds.at(-1)} which is not an LH7 door`);
    assert.equal(main.directions.at(-1).level, "1", `${profile}: should arrive on level 1`);
  }
});

test("Tutorial Block rules: wheelchair uses the right-side door of the room's floor", () => {
  const r202 = place("Room 202 (Tutorial Block)");
  const r101 = place("Room 101 (Tutorial Block)");
  assert.equal(r202.level, "1");
  assert.equal(r101.level, "0");
  const tiers202 = snapTiers(graph, r202, "wheelchair");
  assert.ok(tiers202[0].every((c) => c.via === "rule" && c.nodeId.startsWith("14152492797@")), "first floor → node 14152492797");
  const tiers101 = snapTiers(graph, r101, "wheelchair");
  assert.ok(tiers101[0].every((c) => c.via === "rule" && c.nodeId.startsWith("2734116498@")), "ground floor → node 2734116498");
  const tiersN = snapTiers(graph, r202, "normal");
  const ids = new Set(tiersN[0].map((c) => c.nodeId.split("@")[0]));
  assert.deepEqual([...ids].sort(), ["13657840007", "14152492797", "2734116498"].sort());
});

test("Tutorial Block: wheelchair route to a first-floor room arrives at node 14152492797 via the ramp", () => {
  const { main } = computeRoutes(graph, place("Lecture Hall 7"), place("Room 202 (Tutorial Block)"), "wheelchair");
  assert.ok(main.nodeIds.at(-1).startsWith("14152492797@"));
  assert.ok(main.directions.some((d) => /ramp/i.test(d.text)), "should mention the ramp");
  assert.equal(main.counts.stairs, 0);
});
