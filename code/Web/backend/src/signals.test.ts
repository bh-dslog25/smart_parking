import test from 'node:test';
import assert from 'node:assert/strict';
import { signalState, validPlan } from './signals.js';

const plan = { mode: 'automatic' as const, north_south_green: 30, east_west_green: 20, yellow: 3, all_red: 2, cycle_started_at: new Date(0) };
test('cycle starts with clearance and separates conflicting green phases', () => {
  const expected = [[0, 'red', 'red', 2], [2, 'green', 'red', 30], [32, 'yellow', 'red', 3], [35, 'red', 'red', 2], [37, 'red', 'green', 20], [57, 'red', 'yellow', 3], [60, 'red', 'red', 2]] as const;
  for (const [seconds, northSouth, eastWest, remaining] of expected) assert.deepEqual(signalState(plan, seconds * 1000), { northSouth, eastWest, remaining });
  for (let second = 0; second < 600; second++) {
    const state = signalState(plan, second * 1000);
    assert.ok(state.northSouth === 'red' || state.eastWest === 'red');
  }
  assert.deepEqual(signalState({ ...plan, mode: 'all_red' }, 50000), { northSouth: 'red', eastWest: 'red', remaining: null });
});
test('invalid timing and modes are rejected', () => {
  assert.equal(validPlan(plan), true);
  for (const override of [{ north_south_green: 9 }, { east_west_green: 181 }, { yellow: 2 }, { all_red: 1 }, { yellow: 3.5 }, { north_south_green: '30' }, { mode: 'manual' }, { mode: ['automatic'] }]) assert.equal(validPlan({ ...plan, ...override }), false);
});
