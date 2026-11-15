export type SignalPlan = {
  mode: 'automatic' | 'all_red';
  north_south_green: number;
  east_west_green: number;
  yellow: number;
  all_red: number;
  cycle_started_at: Date | string;
};

// Two non-conflicting through movements; every green follows a clearance.
// This is a software simulation, not physical controller telemetry.
export function signalState(plan: SignalPlan, now = Date.now()) {
  if (plan.mode === 'all_red') return { northSouth: 'red', eastWest: 'red', remaining: null };
  const phases = [
    [plan.all_red, 'red', 'red'],
    [plan.north_south_green, 'green', 'red'],
    [plan.yellow, 'yellow', 'red'],
    [plan.all_red, 'red', 'red'],
    [plan.east_west_green, 'red', 'green'],
    [plan.yellow, 'red', 'yellow'],
  ] as const;
  const total = phases.reduce((sum, [duration]) => sum + duration, 0);
  let elapsed = Math.floor(Math.max(0, now - new Date(plan.cycle_started_at).getTime()) / 1000) % total;
  for (const [duration, northSouth, eastWest] of phases) {
    if (elapsed < duration) return { northSouth, eastWest, remaining: duration - elapsed };
    elapsed -= duration;
  }
  throw new Error('Invalid signal plan');
}

export function validPlan(body: Record<string, unknown>) {
  return typeof body.mode === 'string' && ['automatic', 'all_red'].includes(body.mode) &&
    [['north_south_green', 10, 180], ['east_west_green', 10, 180], ['yellow', 3, 10], ['all_red', 2, 10]]
      .every(([key, min, max]) => typeof body[key] === 'number' && Number.isInteger(body[key]) && Number(body[key]) >= Number(min) && Number(body[key]) <= Number(max));
}
