/**
 * The player's record. With a Squeekverse server it is shared: leaderboards, crews and raids.
 * Without one (for example while hosted only on IPFS) the same features run on this device.
 */
import { firstFlip, pointsFor } from '../../shared/almanac';
import { history, currentForecast, live } from './store';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
let online: boolean | null = null;

export async function serverOnline(): Promise<boolean> {
  if (online !== null) return online;
  if (import.meta.env.VITE_PREVIEW_ONLY) return (online = false);
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(4000) });
    online = res.ok && (res.headers.get('content-type') ?? '').includes('json');
  } catch { online = false; }
  return online;
}

const read = <T>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window */ } };

export interface Profile { id: string; name: string; seeds: number; crew: string | null; wallet: string | null }
export interface Call { kind: 'dawn' | 'dusk'; fromRound: number; target: number; almanac: number; stake: number; actual: number | null; points: number | null; almanacPoints: number | null; createdAt: number }
export interface LocalRun { round: number; score: number; flowers: number; seeds: number; at: number }

let token: string | null = read('sw.token', null);

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(token ? { 'x-player-token': token } : {}), ...init.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

const localProfile = (): Profile => read('sw.profile', { id: 'local', name: `Keeper ${Math.floor(Math.random() * 9000 + 1000)}`, seeds: 0, crew: null, wallet: null });

export async function profile(): Promise<Profile> {
  if (await serverOnline()) {
    try {
      if (!token) throw new Error('none');
      return await call<Profile>('/me/profile');
    } catch {
      const created = await call<Profile & { token: string }>('/players', { method: 'POST', body: JSON.stringify({ name: localProfile().name }) });
      token = created.token;
      write('sw.token', token);
      return created;
    }
  }
  const p = localProfile();
  write('sw.profile', p);
  return p;
}

export async function updateProfile(patch: { name?: string; crew?: string | null }): Promise<Profile> {
  if (await serverOnline()) { await profile(); return call<Profile>('/me/profile', { method: 'PATCH', body: JSON.stringify(patch) }); }
  const p = { ...localProfile(), ...patch };
  if (patch.name) p.name = patch.name.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 24) || localProfile().name;
  write('sw.profile', p);
  return p;
}

export async function submitRun(run: { round: number; score: number; flowers: number; seeds: number }): Promise<{ rank: number | null }> {
  const runs = read<LocalRun[]>('sw.runs', []);
  runs.unshift({ ...run, at: Date.now() });
  write('sw.runs', runs.slice(0, 50));
  if (await serverOnline()) {
    await profile();
    return call<{ rank: number }>('/me/runs', { method: 'POST', body: JSON.stringify(run) });
  }
  const p = localProfile();
  p.seeds += run.seeds;
  write('sw.profile', p);
  return { rank: null };
}

export const localRuns = () => read<LocalRun[]>('sw.runs', []);

export async function leaderboard(round: number): Promise<{ rows: { name: string; score: number }[]; allTime: { name: string; score: number }[]; shared: boolean }> {
  if (await serverOnline()) return { ...(await call<{ rows: { name: string; score: number }[]; allTime: { name: string; score: number }[] }>(`/runs/top?round=${round}`)), shared: true };
  const name = localProfile().name;
  const runs = localRuns();
  return { rows: runs.filter((r) => r.round === round).sort((a, b) => b.score - a.score).slice(0, 5).map((r) => ({ name, score: r.score })), allTime: [...runs].sort((a, b) => b.score - a.score).slice(0, 5).map((r) => ({ name, score: r.score })), shared: false };
}

function settleLocal(calls: Call[]) {
  let changed = false;
  const p = localProfile();
  for (const c of calls) {
    if (c.actual !== null) continue;
    const actual = firstFlip(history, c.kind === 'dusk', c.fromRound);
    if (actual === null) continue;
    c.actual = actual;
    c.points = pointsFor(c.target, actual);
    c.almanacPoints = pointsFor(c.almanac, actual);
    p.seeds += Math.round(c.stake * (c.points / 50)) * (c.points > c.almanacPoints ? 2 : 1);
    changed = true;
  }
  if (changed) { write('sw.calls', calls); write('sw.profile', p); }
  return calls;
}

export async function myCalls(): Promise<Call[]> {
  if (await serverOnline()) { await profile(); return (await call<{ calls: Call[] }>('/me/calls')).calls; }
  return settleLocal(read<Call[]>('sw.calls', []));
}

export async function placeCall(target: number, stake: number): Promise<Call> {
  if (await serverOnline()) {
    await profile();
    await call('/me/calls', { method: 'POST', body: JSON.stringify({ target, stake }) });
    return (await myCalls())[0];
  }
  const f = currentForecast();
  if (!f) throw new Error('The Almanac is still reading the rounds.');
  const calls = read<Call[]>('sw.calls', []);
  if (calls.some((c) => c.actual === null && c.kind === f.kind)) throw new Error('call_already_open');
  const p = localProfile();
  const used = Math.max(0, Math.min(p.seeds, Math.floor(stake)));
  p.seeds -= used;
  write('sw.profile', p);
  const entry: Call = { kind: f.kind, fromRound: f.fromRound, target, almanac: f.pick, stake: used, actual: null, points: null, almanacPoints: null, createdAt: Date.now() };
  calls.unshift(entry);
  write('sw.calls', calls.slice(0, 50));
  return entry;
}

export async function keeperLine(): Promise<{ text: string; written: string }> {
  if (await serverOnline()) { await profile(); return call('/me/keeper'); }
  const p = localProfile();
  const calls = settleLocal(read<Call[]>('sw.calls', []));
  const settled = calls.filter((c) => c.actual !== null);
  const beaten = settled.filter((c) => (c.points ?? 0) > (c.almanacPoints ?? 0)).length;
  const best = Math.max(0, ...localRuns().map((r) => r.score));
  const sky = live.sky === 'day' ? 'The sun is up' : 'It is dark out';
  let text = `${sky}, ${p.name}. I do not know you yet. Hold a night shift, or make a call, and I will start a page for you.`;
  if (settled.length && Math.abs(settled[0].target - settled[0].actual!) === 0) text = `${sky}, ${p.name}. You called the last one to the round. I have checked my figures twice and I do not enjoy it.`;
  else if (settled.length && Math.abs(settled[0].target - settled[0].actual!) > 4) text = `${sky}, ${p.name}. Your last call missed by ${Math.abs(settled[0].target - settled[0].actual!)} rounds. He does not read your notes, and he does not read mine.`;
  else if (settled.length > 2 && beaten > settled.length / 2) text = `${sky}, ${p.name}. You have beaten me ${beaten} times out of ${settled.length}. I have started writing your calls in pencil.`;
  else if (best) text = `${sky}, ${p.name}. Your best shift stands at ${best.toLocaleString('en-US')}. The moths have not forgotten it either.`;
  else if (calls.length) text = `${sky}, ${p.name}. ${calls.length} calls on your page so far. Keep them coming.`;
  return { text, written: 'template' };
}

export const api = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) }),
};
