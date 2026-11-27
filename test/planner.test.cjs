const test = require('node:test');
const assert = require('node:assert/strict');
const planner = require('../src/shared/planner');

const study = (time, duration) => ({ title: 'مطالعه', type: 'task', time, duration });

test('exact and moved time earn the agreed weighted share, capped at the planned minutes', () => {
  const plan = [study('09:00', 120)];
  const result = planner.score(plan, [study('09:00', 60), study('14:00', 30)], 0, 0, 0);
  assert.equal(result.adherence, 35);
  assert.equal(result.score, 35);
  assert.equal(planner.score(plan, [study('08:00', 600)], 1, 1, -1).score, 100);
  assert.equal(planner.compare(plan, [study('14:00', 30), study('14:00', 30)]).anotherTime, 30);
});

test('idle and blank days cannot earn points, and a late actual entry updates a past zero', () => {
  const idle = { ...study('10:00', 120), type: 'idle' };
  assert.equal(planner.score([idle], [idle], 3, 3, -1).score, 0);
  assert.equal(planner.score([study('10:00', 120)], [], 0, 0, 0).pending, true);
  assert.equal(planner.score([study('10:00', 120)], [], 3, 3, -1).pending, false);
  assert.equal(planner.score([study('10:00', 120)], [study('10:00', 120)], 3, 3, -1).score, 100);
});
