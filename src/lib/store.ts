/** The live hamster, and everything derived from him. One source for the whole site. */
import { API, coreAbi, LIVE, roundAt, RPC_URLS } from '../../shared/chain';
import { backtest, forecast, train, type Backtest, type Forecast, type Model, type RoundHistory } from '../../shared/almanac';
import type { Session } from '../../shared/painting';
import { createPublicClient, http, fallback } from 'viem';
import { sepolia } from 'viem/chains';

export type Sky = 'day' | 'night' | 'lost';

export const client = createPublicClient({ chain: sepolia, transport: fallback((import.meta.env.VITE_RPC_URL ? [import.meta.env.VITE_RPC_URL as string] : RPC_URLS).map((u) => http(u))) });

interface Live {
  ready: boolean;
  sky: Sky;
  rpm: number;
  speedMmS: number;
  todayKm: number;
  work: number;
  height: number;
  progress: number;
  frontier: number;
  round: number;
  observedAt: string | null;
  error: string | null;
}

export const live: Live = { ready: false, sky: 'night', rpm: 0, speedMmS: 0, todayKm: 0, work: 0, height: 0, progress: 0, frontier: 0, round: roundAt(Date.now() / 1000), observedAt: null, error: null };

export const history: RoundHistory = { frontier: 0, active: [] };
export let model: Model | null = null;
export let test: Backtest | null = null;
export let sessions: Session[] = [];
export let sessionCount = 0;
export let kmPerDay = 8;

const listeners = new Set<() => void>();
export function onLive(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }
const notify = () => listeners.forEach((fn) => fn());

let previewDay = new URLSearchParams(location.search).get('sky');
export function preview(sky: Sky | null) { previewDay = sky; apply(); notify(); }
export const previewing = () => Boolean(previewDay);

let real: Sky = 'night';
let lastRunningAt = 0;
function apply() {
  const sky = (previewDay as Sky) || real;
  live.sky = sky;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.sky = sky;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', sky === 'day' ? '#1f5ee0' : sky === 'lost' ? '#262538' : '#1a1440');
  }
}

/** The hosted preview cannot reach outside services, so it shows a still night and says so. */
export const previewOnly = Boolean(import.meta.env.VITE_PREVIEW_ONLY);

async function poll() {
  if (previewOnly) { live.ready = true; live.round = roundAt(Date.now() / 1000); real = 'night'; apply(); notify(); return; }
  try {
    const res = await fetch(`${API}/v1/status`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    if (body.schemaVersion !== 1) throw new Error('unknown schema');
    const m = body.measurement;
    const anchor = body.builder?.anchor;
    const now = Date.now();
    live.error = null;
    live.ready = true;
    live.round = roundAt(now / 1000);
    if (m) {
      live.rpm = (m.rpmMilli ?? 0) / 1000;
      live.speedMmS = m.speedMmPerSecond ?? 0;
      live.todayKm = (m.distanceMm ?? 0) / 1e6;
      live.observedAt = m.observedAt;
      if (live.rpm > 0) lastRunningAt = now;
      // A stale reading can mean an outage, so it reads as unknown rather than as sleep.
      real = m.freshness !== 'online' || m.coreStatus === 'COUNTER_FAULT' ? 'lost' : now - lastRunningAt < 45_000 ? 'day' : 'night';
    } else real = 'lost';
    if (anchor) {
      live.work = Number(body.builder.projected?.cumulativeWork ?? anchor.cumulativeWork);
      live.height = Number(anchor.blockHeight);
      live.progress = Number(anchor.blockProgress) / 1e9;
      live.frontier = Number(anchor.settledThroughRound);
    }
  } catch (e) {
    live.error = (e as Error).message;
    real = 'lost';
  }
  apply();
  notify();
}

let loaded: Promise<void> | null = null;
export function loadHistory() {
  loaded ??= (async () => {
    const seed = await (await fetch('./seed-data.json')).json() as { frontier: number; active: [number, number, string][]; sessions: Session[]; sessionCount: number; kmPerDay: number };
    history.frontier = seed.frontier;
    history.active = seed.active.map(([round, work, hash]) => ({ round, work, hash }));
    sessions = seed.sessions;
    sessionCount = seed.sessionCount;
    kmPerDay = seed.kmPerDay;
    model = train(history);
    test = backtest(history);
    notify();
    await tailRounds();
  })().catch((e) => { console.warn('history', e); });
  return loaded;
}

/** Everything newer than the snapshot, read directly from SqueekCore. */
export async function tailRounds() {
  if (previewOnly) return;
  try {
    const state = await client.readContract({ address: LIVE.core, abi: coreAbi, functionName: 'state' });
    let cursor = BigInt(history.frontier);
    while (cursor < state.settledThroughRound) {
      const page = await client.readContract({ address: LIVE.core, abi: coreAbi, functionName: 'roundPage', args: [cursor, state.settledThroughRound, 16n] });
      let prev = page.start.cumulativeWork;
      for (const r of page.rounds) { history.active.push({ round: Number(r.roundId), work: Number(r.cumulativeWork - prev), hash: r.dataHash }); prev = r.cumulativeWork; }
      if (page.certifiedThroughRound <= cursor) break;
      cursor = page.certifiedThroughRound;
    }
    history.frontier = Number(cursor);
    model = train(history);
    notify();
  } catch (e) { console.warn('rounds', e); }
}

export function currentForecast(): Forecast | null {
  if (!model) return null;
  return forecast(model, history.frontier, live.sky === 'day', roundAt(Date.now() / 1000) + 1);
}

/** Share of certified rounds with no work: how often it is night here, from the real record. */
export function nightShare(): number | null {
  if (!history.frontier) return null;
  return 1 - history.active.length / history.frontier;
}

/** Today's wave seed: the round in progress and the newest settled data hash. */
export function nightSeed() {
  const newest = history.active[history.active.length - 1];
  const round = roundAt(Date.now() / 1000);
  return { round, text: `${round}:${newest?.hash ?? 'no-hash'}`, hash: newest?.hash ?? null };
}

export function startLive() {
  void poll();
  if (previewOnly) return;
  setInterval(poll, 3000);
  setInterval(() => { void tailRounds(); }, 90_000);
}
