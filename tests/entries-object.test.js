import test from 'node:test';
import assert from 'node:assert/strict';
import { entriesObject } from '../src/entries-object.js';
test('maps own entries without Object.fromEntries and preserves property keys', () => {
  const original = Object.fromEntries;
  try {
    Object.fromEntries = undefined;
    const symbol = Symbol('key');
    const result = entriesObject([['__proto__', 3], ['constructor', 4], ['x', 1], ['x', 2], [symbol, 5]]);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(Object.getOwnPropertyDescriptor(result, '__proto__').value, 3);
    assert.deepEqual(Object.keys(result), ['__proto__', 'constructor', 'x']);
    assert.equal(result.x, 2); assert.equal(result[symbol], 5);
  } finally { Object.fromEntries = original; }
});
test('game catalogues initialize without Object.fromEntries', async () => {
  const original = Object.fromEntries;
  try {
    Object.fromEntries = undefined;
    const { ROOF_ACCESS } = await import('../src/roof-access-catalog.js');
    const { LOOT_SPAWNS } = await import('../src/loot-spawns.js');
    assert.ok(Object.keys(ROOF_ACCESS).length >= 8); assert.ok(Object.keys(LOOT_SPAWNS).length >= 8);
  } finally { Object.fromEntries = original; }
});
