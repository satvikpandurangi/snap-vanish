import test from "node:test";
import assert from "node:assert/strict";
import { SnapGesture } from "../engine/snap.js";
const hand = (released = false, dx = 0) => {
  const p = Array.from({ length: 21 }, () => ({ x: 0.5 + dx, y: 0.5, z: 0 }));
  p[0] = { x: 0.5 + dx, y: 0.7, z: 0 };
  p[9] = { x: 0.5 + dx, y: 0.5, z: 0 };
  p[4] = { x: 0.5 + dx, y: 0.3, z: 0 };
  p[12] = { x: 0.51 + dx, y: released ? 0.54 : 0.3, z: 0 };
  return { landmarks: [p], handedness: [[{ categoryName: "Right" }]] };
};
test("actual pinch/release needs a recent click", () => {
  const g = new SnapGesture();
  assert.equal(g.update(hand(), 100), false);
  g.update(hand(), 140);
  assert.equal(g.update(hand(true), 180), false);
  g.click(190);
  assert.equal(g.update(hand(true), 210), true);
});
test("vision without a click never triggers at maximum sensitivity", () => {
  const g = new SnapGesture();
  g.update(hand(), 100, 10);
  g.update(hand(), 140, 10);
  assert.equal(g.update(hand(true), 180, 10), false);
  assert.equal(g.update(hand(true), 300, 10), false);
});
test("a click without a snap motion cannot trigger", () => {
  const g = new SnapGesture();
  g.click(150);
  for (let t = 100; t < 500; t += 40) assert.equal(g.update(hand(), t), false);
});
test("whole-hand motion and typing-like translation do not trigger", () => {
  const g = new SnapGesture();
  g.update(hand(), 100);
  g.update(hand(), 140);
  g.click(180);
  assert.equal(g.update(hand(false, 0.2), 180), false);
});
test("lost hand resets armed state", () => {
  const g = new SnapGesture();
  g.update(hand(), 100);
  g.update(hand(), 140);
  g.update({ landmarks: [] }, 160);
  g.click(180);
  assert.equal(g.update(hand(true), 180), false);
});
test("stale audio cannot confirm a snap", () => {
  const g = new SnapGesture();
  g.click(-200);
  g.update(hand(), 100);
  g.update(hand(), 140);
  assert.equal(g.update(hand(true), 180), false);
});
test("cooldown prevents two triggers from one snap", () => {
  const g = new SnapGesture();
  g.update(hand(), 100);
  g.update(hand(), 140);
  g.click(180);
  assert.equal(g.update(hand(true), 180), true);
  g.update(hand(), 250);
  g.update(hand(), 290);
  g.click(330);
  assert.equal(g.update(hand(true), 330), false);
});
