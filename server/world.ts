/** Background sync: follows SqueekCore, settles calls, writes the chronicle and posts to bots. */
import { readFileSync, existsSync } from 'node:fs';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { backtest, firstFlip, forecast, pointsFor, train, type RoundHistory } from '../shared/almanac';
import { API, coreAbi, LIVE, roundAt, RPC_URLS } from '../shared/chain';
import { spellLine, spells } from '../shared/chronicle';
import { raidBoss, raidWeek } from '../shared/raid';
import { all, get, run } from './db';
import { announce } from './bots';
import { rewrite } from './voice';

const client = createPublicClient({ chain: sepolia, transport: http(process.env.RPC_URL ?? RPC_URLS[0]) });

export const world = {
  status: null as any,
  stats: null as any,
  history: { frontier: 0, active: [] } as RoundHistory,
  model: null as ReturnType<typeof train> | null,
  test: null as ReturnType<typeof backtest> | null,
  awake: false,
  fresh: false,
  updatedAt: 0,
};

function meta(key: string) { return get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)?.value; }
function setMeta(key: string, value: string) { run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value); }

function seedFromFile() {
  if (meta('frontier') || !existsSync('public/seed-data.json')) return;
  const seed = JSON.parse(readFileSync('public/seed-data.json', 'utf8')) as { frontier: number; active: [number, number, string][] };
  for (const [round, work, hash] of seed.active) run('INSERT OR IGNORE INTO rounds VALUES (?, ?, ?)', round, work, hash);
  setMeta('frontier', String(seed.frontier));
}

async function syncRounds() {
  const state = await client.readContract({ address: LIVE.core, abi: coreAbi, functionName: 'state' });
  let cursor = BigInt(meta('frontier') ?? 0);
  while (cursor < state.settledThroughRound) {
    const page = await client.readContract({ address: LIVE.core, abi: coreAbi, functionName: 'roundPage', args: [cursor, state.settledThroughRound, 16n] });
    let prev = page.start.cumulativeWork;
    for (const r of page.rounds) { run('INSERT OR REPLACE INTO rounds VALUES (?, ?, ?)', Number(r.roundId), Number(r.cumulativeWork - prev), r.dataHash); prev = r.cumulativeWork; }
    if (page.certifiedThroughRound <= cursor) break;
    cursor = page.certifiedThroughRound;
    setMeta('frontier', cursor.toString());
  }
  const active = all<{ round: number; work: number; hash: string }>('SELECT round, work, hash FROM rounds ORDER BY round');
  world.history = { frontier: Number(cursor), active };
  world.model = train(world.history);
  if (!world.test || Number(cursor) % 12 === 0) world.test = backtest(world.history);
}

function settleCalls() {
  const open = all<any>('SELECT * FROM calls WHERE actual IS NULL');
  for (const call of open) {
    const actual = firstFlip(world.history, call.kind === 'dusk', call.from_round);
    if (actual === null) continue;
    const points = pointsFor(call.target, actual);
    const almanacPoints = pointsFor(call.almanac, actual);
    run('UPDATE calls SET actual = ?, points = ?, almanac_points = ? WHERE id = ?', actual, points, almanacPoints, call.id);
    // A stake pays back by how close the call was. Beating the Almanac doubles it. Seeds have no money value.
    const payout = Math.round(call.stake * (points / 50)) * (points > almanacPoints ? 2 : 1);
    if (payout) run('UPDATE players SET seeds = seeds + ? WHERE id = ?', payout, call.player);
  }
}

async function writeChronicle() {
  const list = spells(world.history.active, world.history.frontier);
  const known = new Set(all<{ from_round: number; to_round: number }>('SELECT from_round, to_round FROM chronicle').map((c) => `${c.from_round}:${c.to_round}`));
  const newest = list.slice(-3);
  // A new or reset database replays history quietly, so a restart never spams the channels.
  const quiet = known.size === 0;
  for (const spell of list) {
    if (known.has(`${spell.from}:${spell.to}`)) continue;
    const base = spellLine(spell);
    const fresh = newest.includes(spell);
    const text = fresh ? await rewrite(base, spell) : base;
    run('INSERT OR REPLACE INTO chronicle VALUES (?, ?, ?, ?, ?)', spell.from, spell.kind, spell.to, spell.work, text);
    if (fresh && !quiet && spell !== list[list.length - 1]) await announce(`${spell.kind === 'day' ? 'Daybreak' : 'Nightfall'} on Squeekverse: ${text}`);
  }
}

async function refreshStatus() {
  const res = await fetch(`${API}/v1/status`);
  if (!res.ok) return;
  const body = await res.json() as any;
  const before = world.awake;
  world.status = body;
  world.fresh = body.measurement?.freshness === 'online';
  world.awake = world.fresh && (body.measurement?.rpmMilli ?? 0) > 0;
  world.updatedAt = Date.now();
  if (world.awake && !before && world.fresh) await announce('He just woke up. The sun is rising on Squeekverse.');
}

async function refreshStats() {
  const res = await fetch(`${API}/v1/measurement/stats?range=30d`);
  if (res.ok) world.stats = await res.json();
}

export function raidState(nowMs = Date.now()) {
  const week = raidWeek(nowMs);
  const days: { date: string; distanceMm: string | number | null }[] = world.stats?.activity?.days ?? [];
  const startDate = new Date(week.startMs).toISOString().slice(0, 10);
  const inWeek = days.filter((d) => d.date >= startDate);
  const earlier = days.filter((d) => d.date < startDate && d.distanceMm).slice(-7);
  const km = (d: { distanceMm: string | number | null }) => Number(d.distanceMm ?? 0) / 1e6;
  const pace = earlier.length ? earlier.reduce((a, d) => a + km(d), 0) / earlier.length : 8;
  const boss = raidBoss(week.index, pace);
  const doneKm = inWeek.reduce((a, d) => a + km(d), 0);
  const crews = all<{ crew: string; score: number; players: number }>(`SELECT p.crew AS crew, SUM(r.score) AS score, COUNT(DISTINCT p.id) AS players FROM runs r JOIN players p ON p.id = r.player WHERE p.crew IS NOT NULL AND r.created_at >= ? GROUP BY p.crew ORDER BY score DESC LIMIT 10`, week.startMs);
  return { ready: Boolean(world.stats), week: week.index, startMs: week.startMs, endMs: week.endMs, boss: boss.name, hpKm: boss.hpKm, doneKm, paceKmPerDay: pace, crews, defeated: doneKm >= boss.hpKm };
}

export function currentForecast() {
  if (!world.model) return null;
  const round = roundAt(Date.now() / 1000);
  return forecast(world.model, world.history.frontier, world.awake, round + 1);
}

const every = (ms: number, task: () => Promise<void> | void) => {
  const go = async () => { try { await task(); } catch (e) { console.error('[sync]', (e as Error).message); } setTimeout(go, ms); };
  void go();
};

export function startWorld() {
  seedFromFile();
  every(5_000, refreshStatus);
  every(45_000, async () => { await syncRounds(); settleCalls(); await writeChronicle(); });
  every(300_000, refreshStats);
}
