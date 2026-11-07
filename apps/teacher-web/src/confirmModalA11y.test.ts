import assert from 'node:assert/strict';
import { nextTabFocusIndex, shouldCancelOnEscape } from './confirmModalA11y.js';

assert.equal(shouldCancelOnEscape('Escape', false), true);
assert.equal(shouldCancelOnEscape('Escape', true), false);
assert.equal(shouldCancelOnEscape('Enter', false), false);

assert.equal(nextTabFocusIndex(0, 0, false), null);
assert.equal(nextTabFocusIndex(2, 0, false), 1);
assert.equal(nextTabFocusIndex(2, 1, false), 0);
assert.equal(nextTabFocusIndex(2, 0, true), 1);
assert.equal(nextTabFocusIndex(2, 1, true), 0);
assert.equal(nextTabFocusIndex(3, 1, false), 2);
assert.equal(nextTabFocusIndex(3, 1, true), 0);

console.log('confirmModalA11y.test.ts ok');
