/**
 * The Almanac: a small model that learns the hamster's habits from settled rounds.
 *
 * It is a two-state Markov chain (awake, asleep) whose transition odds depend on the half hour of
 * the UTC day, smoothed toward the overall rate where a slot has little data. Nothing here is
 * hard-coded about the hamster. Every number comes from rounds certified on SqueekCore.
 */
import { GENESIS_TIMESTAMP, ROUND_SECONDS } from './chain';

export interface ActiveRound { round: number; work: number; hash?: string }
export type RoundHistory = { frontier: number; active: ActiveRound[]; firstRound?: number };

const SLOTS = 48;
export const HORIZON = 18;

export function slotOf(round: number, genesis = GENESIS_TIMESTAMP): number {
  const t = genesis + (round - 1) * ROUND_SECONDS;
  return Math.floor(((t % 86400) + 86400) % 86400 / 1800);
}

export interface Model {
  wake: number[];
  stay: number[];
  overallWake: number;
  overallStay: number;
  medianWork: number;
  rounds: number;
  activeRounds: number;
}

export function train(history: RoundHistory, through = history.frontier): Model {
  const first = history.firstRound ?? 1;
  const active = new Set(history.active.filter((r) => r.round <= through).map((r) => r.round));
  const asleep = Array.from({ length: SLOTS }, () => [0, 0]);
  const awake = Array.from({ length: SLOTS }, () => [0, 0]);
  let wakeTotal = 0, sleepTotal = 0, stayTotal = 0, awakeTotal = 0;
  for (let r = first; r < through; r++) {
    const slot = slotOf(r + 1);
    if (active.has(r)) {
      awakeTotal++; awake[slot][1]++;
      if (active.has(r + 1)) { stayTotal++; awake[slot][0]++; }
    } else {
      sleepTotal++; asleep[slot][1]++;
      if (active.has(r + 1)) { wakeTotal++; asleep[slot][0]++; }
    }
  }
  const overallWake = (wakeTotal + 1) / (sleepTotal + 2);
  const overallStay = (stayTotal + 1) / (awakeTotal + 2);
  // Beta smoothing, then borrow from neighbouring half hours: habits do not change on the half hour.
  const smooth = (counts: number[][], prior: number, strength: number) => {
    const raw = counts.map(([hit, all]) => (hit + prior * strength) / (all + strength));
    return raw.map((_, i) => 0.25 * raw[(i + SLOTS - 1) % SLOTS] + 0.5 * raw[i] + 0.25 * raw[(i + 1) % SLOTS]);
  };
  const works = history.active.filter((r) => r.round <= through).map((r) => r.work).sort((a, b) => a - b);
  return {
    wake: smooth(asleep, overallWake, 12),
    stay: smooth(awake, overallStay, 6),
    overallWake, overallStay,
    medianWork: works.length ? works[Math.floor(works.length / 2)] : 0,
    rounds: Math.max(0, through - first + 1),
    activeRounds: works.length,
  };
}

export type CallKind = 'dawn' | 'dusk';

export interface Forecast {
  kind: CallKind;
  fromRound: number;
  /** probabilities[i] is the chance the change happens in round fromRound + i. */
  probabilities: number[];
  /** Chance the change comes after the horizon. */
  later: number;
  pick: number;
  expectedRounds: number;
}

/** Odds of when the state flips, given his state now. */
export function forecast(model: Model, _lastKnownRound: number, lastKnownAwake: boolean, fromRound: number, horizon = HORIZON): Forecast {
  const kind: CallKind = lastKnownAwake ? 'dusk' : 'dawn';
  const flip = (round: number, awake: boolean) => awake ? 1 - model.stay[slotOf(round)] : model.wake[slotOf(round)];
  let still = 1;
  const probabilities: number[] = [];
  for (let i = 0; i < horizon; i++) {
    const p = flip(fromRound + i, lastKnownAwake);
    probabilities.push(still * p);
    still *= 1 - p;
  }
  let pick = 0;
  for (let i = 1; i < horizon; i++) if (probabilities[i] > probabilities[pick]) pick = i;
  let expected = 0;
  probabilities.forEach((p, i) => { expected += p * i; });
  expected += still * horizon;
  return { kind, fromRound, probabilities, later: still, pick: fromRound + pick, expectedRounds: expected };
}

/** Points for a call against the round the change really happened. */
export function pointsFor(call: number, actual: number): number {
  const miss = Math.abs(call - actual);
  if (miss === 0) return 100;
  if (miss === 1) return 60;
  if (miss === 2) return 30;
  if (miss <= 4) return 10;
  return 0;
}

export interface Backtest { samples: number; almanacWithin1: number; baselineWithin1: number; brierModel: number; brierBase: number }

/**
 * Walk-forward test: for every state change, train only on rounds before it and see how close the
 * Almanac's call was, against always guessing the overall rate. Published on the site as is.
 */
export function backtest(history: RoundHistory, minRounds = 300): Backtest {
  const active = new Set(history.active.map((r) => r.round));
  let samples = 0, hit = 0, base = 0, brierModel = 0, brierBase = 0, brierCount = 0;
  const step = 24;
  for (let at = (history.firstRound ?? 1) + minRounds; at + HORIZON < history.frontier; at += step) {
    const model = train(history, at);
    const awake = active.has(at);
    const f = forecast(model, at, awake, at + 1);
    let actual = -1;
    for (let r = at + 1; r <= at + HORIZON; r++) if (active.has(r) !== awake) { actual = r; break; }
    if (actual < 0) continue;
    samples++;
    if (Math.abs(f.pick - actual) <= 1) hit++;
    const flat = awake ? 1 - model.overallStay : model.overallWake;
    let still = 1, bestI = 0, best = 0;
    for (let i = 0; i < HORIZON; i++) { const p = still * flat; if (p > best) { best = p; bestI = i; } still *= 1 - flat; }
    if (Math.abs(at + 1 + bestI - actual) <= 1) base++;
    const flipNext = active.has(at + 1) !== awake ? 1 : 0;
    brierModel += (f.probabilities[0] - flipNext) ** 2;
    brierBase += (flat - flipNext) ** 2;
    brierCount++;
  }
  return { samples, almanacWithin1: samples ? hit / samples : 0, baselineWithin1: samples ? base / samples : 0, brierModel: brierCount ? brierModel / brierCount : 0, brierBase: brierCount ? brierBase / brierCount : 0 };
}

/** Finds when a call settles: first round after `from` where the awake state differs. */
export function firstFlip(history: RoundHistory, fromAwake: boolean, from: number): number | null {
  const active = new Set(history.active.map((r) => r.round));
  for (let r = from; r <= history.frontier; r++) if (active.has(r) !== fromAwake) return r;
  return null;
}
