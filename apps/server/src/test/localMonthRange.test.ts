import assert from 'node:assert/strict';
import { localMonthRange } from '../utils/csv.js';

/** Month boundary: local calendar month, not UTC. */
const nov = localMonthRange('2026-11');
const dec = localMonthRange('2026-12');
const jan = localMonthRange('2027-01');

assert.equal(new Date(nov.start).getDate(), 1);
assert.equal(new Date(nov.start).getMonth(), 10); // Nov
assert.equal(new Date(nov.end).getMonth(), 11); // Dec 1 local
assert.ok(new Date(nov.end).getTime() === new Date(dec.start).getTime());
assert.ok(new Date(dec.end).getTime() === new Date(jan.start).getTime());

// End of Oct session must not fall in Nov local range
const endOfOctLocal = new Date(2026, 9, 31, 23, 59, 59, 999).toISOString();
assert.ok(endOfOctLocal < nov.start || endOfOctLocal < nov.start);
assert.ok(new Date(endOfOctLocal).getTime() < new Date(nov.start).getTime());

console.log('localMonthRange boundary ok', { nov, dec });
