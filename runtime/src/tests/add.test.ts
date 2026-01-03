import assert from "node:assert/strict";

import { add } from "../examples/add.js";

export async function testAdd(): Promise<void> {
  assert.equal(add(1, 2), 3);
  assert.equal(add(-1, -2), -3);
  assert.equal(add(-1, 2), 1);
  assert.equal(add(0, 0), 0);
  assert.ok(Math.abs(add(0.1, 0.2) - 0.3) < 1e-10);
}

