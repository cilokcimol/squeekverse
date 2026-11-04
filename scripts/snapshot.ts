/**
 * Writes public/seed-data.json: every settled active round plus recent running sessions, read from
 * SqueekCore and the Squeekchain API. The site starts from this file and fetches only what is newer.
 */
import { writeFileSync } from 'node:fs';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { API, coreAbi, LIVE, RPC_URLS } from '../shared/chain';
import { toSessions } from '../shared/painting';

const client = createPublicClient({ chain: sepolia, transport: http(RPC_URLS[0]) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const state = await client.readContract({ address: LIVE.core, abi: coreAbi, functionName: 'state' });
const frontier = Number(state.settledThroughRound);
const active: [number, number, string][] = [];
let cursor = 0n;
while (cursor < state.settledThroughRound) {
  const page = await client.readContract({ address: LIVE.core, abi: coreAbi, functionName: 'roundPage', args: [cursor, state.settledThroughRound, 16n] });
  let prev = page.start.cumulativeWork;
  for (const r of page.rounds) { active.push([Number(r.roundId), Number(r.cumulativeWork - prev), r.dataHash]); prev = r.cumulativeWork; }
  if (page.certifiedThroughRound <= cursor) throw new Error('roundPage did not advance');
  cursor = page.certifiedThroughRound;
}
console.log('rounds', frontier, 'active', active.length);

type Segment = { startAt: string; endAt: string; workUnits: string; passages: { at: string }[] };
const segments: Segment[] = [];
let next: string | null = null, last: string | null = null, pages = 0;
for (;;) {
  const url = `${API}/v1/measurement/runs?limit=100${next ? `&cursor=${next}` : ''}`;
  const res = await fetch(url);
  if (res.status === 429) { await sleep(Number(res.headers.get('retry-after') ?? 2) * 1000); continue; }
  if (!res.ok) throw new Error(`runs ${res.status}`);
  const body = await res.json() as { items: Segment[]; nextCursor: string | null };
  segments.push(...body.items);
  pages++;
  if (body.nextCursor) last = body.nextCursor;
  if (!body.items.length || !body.nextCursor) break;
  next = body.nextCursor;
  await sleep(620);
}
const sessions = toSessions(segments);
console.log('segments', segments.length, 'pages', pages, 'sessions', sessions.length);

const stats = await (await fetch(`${API}/v1/measurement/stats?range=7d`)).json() as { activity: { summary: { averageDistancePerActiveDayMm: string } } };
// Keep the newest sessions. Gaps are stored to the nearest 10 ms and capped, which keeps the file small.
const keep = sessions.slice(-24).map((s) => {
  const stride = Math.max(1, Math.floor(s.gapsMs.length / 900));
  return { start: s.start, end: s.end, passages: s.passages, gapsMs: s.gapsMs.filter((_, i) => i % stride === 0).map((g) => Math.min(9990, Math.round(g / 10) * 10)) };
});
writeFileSync('public/seed-data.json', JSON.stringify({
  generatedAt: new Date().toISOString(), frontier, active, sessions: keep, sessionCount: sessions.length, runsCursor: last,
  kmPerDay: Number(stats.activity.summary.averageDistancePerActiveDayMm) / 1e6,
}));
console.log('done');
