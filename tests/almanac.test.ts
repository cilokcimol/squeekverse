import { describe, expect, it } from 'vitest';
import { backtest, firstFlip, forecast, pointsFor, slotOf, train, type RoundHistory } from '../shared/almanac';
import { roundAt, roundStart, GENESIS_TIMESTAMP } from '../shared/chain';
import { buildWave } from '../shared/seed';
import { florets, toSessions } from '../shared/painting';
import { raidBoss, raidWeek } from '../shared/raid';

const nightOwl = (): RoundHistory => {
  // Awake for six rounds around one slot every day, asleep otherwise.
  const active = [];
  for (let r = 1; r <= 144 * 20; r++) { const s = slotOf(r); if (s >= 44 && s <= 45) active.push({ round: r, work: 500 }); }
  return { frontier: 144 * 20, active };
};

describe('rounds', () => {
  it('matches the docs formula', () => {
    expect(roundAt(GENESIS_TIMESTAMP - 1)).toBe(0);
    expect(roundAt(GENESIS_TIMESTAMP)).toBe(1);
    expect(roundAt(GENESIS_TIMESTAMP + 599)).toBe(1);
    expect(roundAt(GENESIS_TIMESTAMP + 600)).toBe(2);
    expect(roundAt(roundStart(77))).toBe(77);
  });
});

describe('the Almanac', () => {
  it('learns a daily habit and calls it better than the flat rate', () => {
    const h = nightOwl();
    const m = train(h);
    expect(Math.max(...m.wake)).toBeGreaterThan(m.overallWake * 2);
    const bt = backtest(h);
    expect(bt.samples).toBeGreaterThan(5);
    expect(bt.brierModel).toBeLessThanOrEqual(bt.brierBase);
  });
  it('gives a distribution that sums to one', () => {
    const m = train(nightOwl());
    const f = forecast(m, 100, false, 101);
    const sum = f.probabilities.reduce((a, b) => a + b, 0) + f.later;
    expect(sum).toBeCloseTo(1, 6);
    expect(f.kind).toBe('dawn');
    expect(forecast(m, 100, true, 101).kind).toBe('dusk');
  });
  it('never trains on rounds after the cut-off', () => {
    const h = nightOwl();
    const early = train(h, 500);
    expect(early.rounds).toBe(500);
    expect(early.activeRounds).toBeLessThan(train(h).activeRounds);
  });
  it('scores calls by distance', () => {
    expect([0, 1, 2, 4, 9].map((d) => pointsFor(100 + d, 100))).toEqual([100, 60, 30, 10, 0]);
  });
  it('finds the first change and waits when it has not happened', () => {
    const h: RoundHistory = { frontier: 10, active: [{ round: 5, work: 1 }] };
    expect(firstFlip(h, false, 2)).toBe(5);
    expect(firstFlip(h, true, 5)).toBe(6);
    expect(firstFlip(h, false, 6)).toBe(null);
  });
});

describe('the night wave', () => {
  it('is the same for everyone in a round and differs between rounds', () => {
    const a = buildWave('1200:0xabc', 18), b = buildWave('1200:0xabc', 18), c = buildWave('1201:0xabc', 18);
    expect(a).toEqual(b);
    expect(a.seedNumber).not.toBe(c.seedNumber);
    expect(a.spawns.length).toBeGreaterThan(30);
    expect(a.spawns.every((s) => s.target >= 0 && s.target < 18)).toBe(true);
  });
});

describe('pressed flowers', () => {
  it('splits sessions on a five minute gap', () => {
    const seg = (start: number, n: number) => ({ startAt: new Date(start).toISOString(), endAt: new Date(start + n * 500).toISOString(), workUnits: String(n), passages: Array.from({ length: n }, (_, i) => ({ at: new Date(start + i * 500).toISOString() })) });
    const s = toSessions([seg(0, 40), seg(30_000, 40), seg(30_000 + 20 * 60_000, 40)]);
    expect(s.length).toBe(2);
    expect(s[0].passages).toBe(80);
  });
  it('gives faster passages larger, warmer florets', () => {
    const fast = florets([200, 200])[0], slow = florets([3000, 3000])[0];
    expect(fast.r).toBeGreaterThan(slow.r);
    expect(fast.hue).toBeGreaterThan(slow.hue);
  });
});

describe('the raid', () => {
  it('rolls weeks on Monday noon UTC', () => {
    const w = raidWeek(Date.UTC(2026, 10, 4));
    expect(w.index).toBe(1);
    expect(new Date(w.startMs).toISOString()).toBe('2026-11-02T12:00:00.000Z');
  });
  it('sizes the boss from recent pace', () => {
    expect(raidBoss(0, 8.8).hpKm).toBe(68);
    expect(raidBoss(0, 0).hpKm).toBe(20);
  });
});
