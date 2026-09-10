import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeCost, parseIncline, parseWidthMeters, FORBIDDEN } from "../src/lib/routing/profiles.js";

const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("steps: ×1.2 + 15 m per flight for normal, never usable for wheelchair", () => {
  assert.equal(edgeCost("normal", 100, { highway: "steps" }), 135);
  assert.equal(edgeCost("normal", 0, { highway: "steps" }), 0); // transfer edge: no penalty
  assert.equal(edgeCost("wheelchair", 100, { highway: "steps" }), FORBIDDEN);
  assert.equal(edgeCost("wheelchair", 100, { highway: "steps", wheelchair: "yes" }), FORBIDDEN);
  assert.equal(edgeCost("wheelchair", 100, { highway: "steps", "ramp:wheelchair": "yes" }), FORBIDDEN); // draw the ramp as its own way
});

test("wheelchair=no is forbidden only for the wheelchair profile", () => {
  assert.equal(edgeCost("normal", 50, { highway: "footway", wheelchair: "no" }), 50);
  assert.equal(edgeCost("wheelchair", 50, { highway: "footway", wheelchair: "no" }), FORBIDDEN);
});

test("incline bands", () => {
  assert.equal(edgeCost("wheelchair", 100, { highway: "footway", incline: "10%" }), 600);
  assert.equal(edgeCost("wheelchair", 100, { highway: "footway", incline: "-6%" }), 250);
  assert.equal(edgeCost("wheelchair", 100, { highway: "footway", incline: "steep" }), 600);
  assert.equal(edgeCost("wheelchair", 100, { highway: "footway", incline: "3%" }), 100);
  assert.equal(edgeCost("normal", 100, { highway: "footway", incline: "10%" }), 100);
});

test("narrow, loose and rough surfaces", () => {
  assert.equal(edgeCost("wheelchair", 100, { highway: "footway", width: "0.8" }), 400);
  assert.equal(edgeCost("wheelchair", 100, { highway: "footway", surface: "gravel" }), 300);
  approx(edgeCost("normal", 100, { highway: "footway", surface: "gravel" }), 110);
  assert.equal(edgeCost("wheelchair", 100, { highway: "footway", smoothness: "bad" }), 400);
  approx(edgeCost("normal", 100, { highway: "footway", smoothness: "very_bad" }), 110);
});

test("ramps are always usable and preferred (×0.8) regardless of incline; lifts too", () => {
  assert.equal(edgeCost("wheelchair", 100, { highway: "footway", ramp: "yes", wheelchair: "yes" }), 80);
  approx(edgeCost("wheelchair", 100, { highway: "footway", ramp: "yes", incline: "10.5%" }), 80);
  approx(edgeCost("wheelchair", 100, { highway: "footway", level: "0;1", incline: "12%" }), 80); // sloped connector = ramp
  assert.equal(edgeCost("normal", 100, { highway: "footway", ramp: "yes", incline: "10.5%" }), 100);
  assert.equal(edgeCost("wheelchair", 100, { highway: "elevator" }), 80);
});

test("raised kerb at a crossing adds +5 m / +200 m", () => {
  const node = { highway: "crossing", kerb: "raised" };
  assert.equal(edgeCost("normal", 10, { highway: "footway" }, node), 15);
  assert.equal(edgeCost("wheelchair", 10, { highway: "footway" }, node), 210);
  const lowered = { highway: "crossing", kerb: "lowered" };
  assert.equal(edgeCost("wheelchair", 10, { highway: "footway" }, lowered), 10);
});

test("tag parsers", () => {
  assert.deepEqual(parseIncline("6%"), { kind: "percent", value: 6 });
  assert.deepEqual(parseIncline("up"), { kind: "direction" });
  assert.equal(parseIncline(undefined), null);
  assert.equal(parseWidthMeters("150 cm"), 1.5);
  assert.equal(parseWidthMeters("1.5 m"), 1.5);
  assert.equal(parseWidthMeters("2"), 2);
});
