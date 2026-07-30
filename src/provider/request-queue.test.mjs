import assert from "node:assert/strict";
import test from "node:test";
import { createRequestQueue } from "./request-queue.js";

test("request queue limits only active model requests", async () => {
  const queue = createRequestQueue(5);
  let active = 0;
  let peak = 0;
  const releases = [];
  const jobs = Array.from({ length: 8 }, (_, index) => queue.run(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => releases.push(resolve));
    active--;
    return index;
  }));

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(queue.stats().active, 5);
  assert.equal(queue.stats().waiting, 3);
  releases.splice(0).forEach((release) => release());
  await new Promise((resolve) => setTimeout(resolve, 0));
  releases.splice(0).forEach((release) => release());
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(peak, 5);
});
