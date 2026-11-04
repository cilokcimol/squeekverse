import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createPublicClient, http, parseAbi, verifyMessage, type Address, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { API, LIVE, roundAt, RPC_URLS } from '../shared/chain';
import { GAME_LIMITS } from '../shared/seed';
import { all, get, run } from './db';
import { startBots } from './bots';
import { greet, voiceEnabled, type Memory } from './voice';
import { currentForecast, raidState, startWorld, world } from './world';

const app = new Hono<{ Variables: { player: any } }>();
const client = createPublicClient({ chain: sepolia, transport: http(process.env.RPC_URL ?? RPC_URLS[0]) });
app.use('/api/*', cors({ origin: process.env.CORS_ORIGIN ?? '*', allowHeaders: ['content-type', 'x-player-token'] }));

const hits = new Map<string, { n: number; at: number }>();
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET') {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
    const entry = hits.get(ip);
    const now = Date.now();
    if (!entry || now - entry.at > 60_000) hits.set(ip, { n: 1, at: now });
    else if (++entry.n > 60) return c.json({ error: 'slow_down' }, 429);
  }
  await next();
});

const cleanName = (raw: unknown, fallback = '') => {
  const name = String(raw ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 24);
  return name.length >= 2 ? name : fallback;
};
const authed = (token?: string) => token ? get<any>('SELECT * FROM players WHERE token = ?', token) : undefined;

app.get('/api/health', (c) => c.json({ ok: true, frontier: world.history.frontier, voice: voiceEnabled, statusAgeMs: Date.now() - world.updatedAt }));

app.post('/api/players', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { name?: string };
  const id = randomUUID();
  const token = randomBytes(24).toString('hex');
  const name = cleanName(body.name, `Keeper ${Math.floor(Math.random() * 9000 + 1000)}`);
  run('INSERT INTO players(id, token, name, seeds, created_at) VALUES (?, ?, ?, 0, ?)', id, token, name, Date.now());
  return c.json({ id, token, name, seeds: 0, crew: null, wallet: null });
});

app.use('/api/me/*', async (c, next) => {
  const player = authed(c.req.header('x-player-token'));
  if (!player) return c.json({ error: 'unknown_player' }, 401);
  c.set('player', player);
  await next();
});

const memoryOf = (player: any): Memory => {
  const calls = get<{ n: number; beat: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(points > almanac_points), 0) AS beat FROM calls WHERE player = ? AND actual IS NOT NULL', player.id)!;
  const last = get<{ miss: number }>('SELECT ABS(target - actual) AS miss FROM calls WHERE player = ? AND actual IS NOT NULL ORDER BY id DESC LIMIT 1', player.id);
  const runs = get<{ n: number; best: number }>('SELECT COUNT(*) AS n, COALESCE(MAX(score), 0) AS best FROM runs WHERE player = ?', player.id)!;
  return { name: player.name, calls: calls.n, beaten: calls.beat, lastMiss: last?.miss ?? null, bestScore: runs.best, runs: runs.n };
};

app.get('/api/me/profile', (c) => {
  const p = c.get('player');
  return c.json({ id: p.id, name: p.name, seeds: p.seeds, crew: p.crew, wallet: p.wallet, memory: memoryOf(p) });
});

app.patch('/api/me/profile', async (c) => {
  const p = c.get('player');
  const body = await c.req.json() as { name?: string; crew?: string | null };
  if (body.name !== undefined) run('UPDATE players SET name = ? WHERE id = ?', cleanName(body.name, p.name), p.id);
  if (body.crew !== undefined) run('UPDATE players SET crew = ? WHERE id = ?', body.crew === null ? null : cleanName(body.crew) || null, p.id);
  const fresh = get<any>('SELECT * FROM players WHERE id = ?', p.id);
  return c.json({ id: fresh.id, name: fresh.name, seeds: fresh.seeds, crew: fresh.crew, wallet: fresh.wallet });
});

app.get('/api/me/keeper', async (c) => c.json(await greet(memoryOf(c.get('player')), world.awake)));

app.post('/api/me/runs', async (c) => {
  const p = c.get('player');
  const body = await c.req.json() as { round: number; score: number; flowers: number; seeds: number };
  const now = roundAt(Date.now() / 1000);
  if (!Number.isInteger(body.round) || Math.abs(body.round - now) > 1) return c.json({ error: 'wrong_round' }, 400);
  const score = Math.min(GAME_LIMITS.maxScore, Math.max(0, Math.floor(Number(body.score) || 0)));
  const flowers = Math.min(GAME_LIMITS.flowers, Math.max(0, Math.floor(Number(body.flowers) || 0)));
  const seeds = Math.min(400, Math.max(0, Math.floor(Number(body.seeds) || 0)));
  run('INSERT INTO runs(player, round, score, flowers, seeds, created_at) VALUES (?, ?, ?, ?, ?, ?)', p.id, body.round, score, flowers, seeds, Date.now());
  run('UPDATE players SET seeds = seeds + ? WHERE id = ?', seeds, p.id);
  const rank = get<{ n: number }>('SELECT COUNT(DISTINCT player) AS n FROM runs WHERE round = ? AND score > ?', body.round, score)!.n + 1;
  return c.json({ rank, seeds });
});

app.get('/api/runs/top', (c) => {
  const round = Number(c.req.query('round') ?? roundAt(Date.now() / 1000));
  const rows = all<{ name: string; score: number; flowers: number }>('SELECT p.name AS name, MAX(r.score) AS score, r.flowers AS flowers FROM runs r JOIN players p ON p.id = r.player WHERE r.round = ? GROUP BY r.player ORDER BY score DESC LIMIT 10', round);
  const allTime = all<{ name: string; score: number }>('SELECT p.name AS name, MAX(r.score) AS score FROM runs r JOIN players p ON p.id = r.player GROUP BY r.player ORDER BY score DESC LIMIT 10');
  return c.json({ round, rows, allTime });
});

app.post('/api/me/calls', async (c) => {
  const p = c.get('player');
  const body = await c.req.json() as { target: number; stake: number };
  const f = currentForecast();
  if (!f) return c.json({ error: 'almanac_not_ready' }, 503);
  const target = Math.floor(Number(body.target));
  if (target < f.fromRound || target >= f.fromRound + f.probabilities.length) return c.json({ error: 'round_out_of_range' }, 400);
  const stake = Math.max(0, Math.min(p.seeds, Math.floor(Number(body.stake) || 0)));
  const existing = get('SELECT id FROM calls WHERE player = ? AND kind = ? AND actual IS NULL', p.id, f.kind);
  if (existing) return c.json({ error: 'call_already_open' }, 409);
  run('INSERT INTO calls(player, kind, from_round, target, almanac, stake, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', p.id, f.kind, f.fromRound, target, f.pick, stake, Date.now());
  if (stake) run('UPDATE players SET seeds = seeds - ? WHERE id = ?', stake, p.id);
  return c.json({ ok: true, kind: f.kind, target, almanac: f.pick, stake });
});

app.get('/api/me/calls', (c) => c.json({ calls: all('SELECT kind, from_round AS fromRound, target, almanac, stake, actual, points, almanac_points AS almanacPoints, created_at AS createdAt FROM calls WHERE player = ? ORDER BY id DESC LIMIT 30', c.get('player').id) }));

app.get('/api/almanac', (c) => {
  const totals = get<{ n: number; beat: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(points > almanac_points), 0) AS beat FROM calls WHERE actual IS NOT NULL')!;
  return c.json({ forecast: currentForecast(), backtest: world.test, trainedOn: world.model?.rounds ?? 0, record: totals, voice: voiceEnabled });
});

app.get('/api/chronicle', (c) => c.json({ entries: all('SELECT from_round AS "from", to_round AS "to", kind, work, text FROM chronicle ORDER BY from_round DESC LIMIT 40') }));
app.get('/api/raid', (c) => c.json(raidState()));

app.get('/api/squeeks/names', (c) => c.json({ names: all('SELECT token_id AS tokenId, name, owner FROM names ORDER BY updated_at DESC LIMIT 200') }));
app.get('/api/squeeks/nonce', (c) => {
  const nonce = randomBytes(12).toString('hex');
  run('DELETE FROM nonces WHERE expires_at < ?', Date.now());
  run('INSERT INTO nonces VALUES (?, ?)', nonce, Date.now() + 10 * 60_000);
  return c.json({ nonce });
});

const ownerAbi = parseAbi(['function ownerOf(uint256) view returns (address)']);
export const namingMessage = (tokenId: number, name: string, nonce: string) => `Name Squeek #${tokenId} "${name}" on Squeekverse.\nThis signature costs nothing and moves nothing.\nNonce: ${nonce}`;

app.post('/api/squeeks/:id/name', async (c) => {
  const tokenId = Number(c.req.param('id'));
  const body = await c.req.json() as { name: string; address: Address; signature: Hex; nonce: string };
  const name = cleanName(body.name);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 9999 || !name) return c.json({ error: 'bad_request' }, 400);
  const nonce = get<{ expires_at: number }>('SELECT expires_at FROM nonces WHERE nonce = ?', body.nonce);
  if (!nonce || nonce.expires_at < Date.now()) return c.json({ error: 'nonce_expired' }, 400);
  const valid = await verifyMessage({ address: body.address, message: namingMessage(tokenId, name, body.nonce), signature: body.signature }).catch(() => false);
  if (!valid) return c.json({ error: 'bad_signature' }, 401);
  run('DELETE FROM nonces WHERE nonce = ?', body.nonce);
  let holder = (await client.readContract({ address: LIVE.squeeks, abi: ownerAbi, functionName: 'ownerOf', args: [BigInt(tokenId)] })).toLowerCase();
  if (holder !== body.address.toLowerCase()) {
    // A Squeek deposited in staking is held by the staking contract; its depositor still owns the name.
    const info = await (await fetch(`${API}/v1/squeeks/${tokenId}`)).json() as { custody?: { depositor?: string | null } };
    holder = info.custody?.depositor?.toLowerCase() ?? holder;
  }
  if (holder !== body.address.toLowerCase()) return c.json({ error: 'not_your_squeek' }, 403);
  run('INSERT INTO names VALUES (?, ?, ?, ?) ON CONFLICT(token_id) DO UPDATE SET name = excluded.name, owner = excluded.owner, updated_at = excluded.updated_at', tokenId, name, holder, Date.now());
  return c.json({ tokenId, name });
});

if (existsSync('dist')) app.use('/*', serveStatic({ root: './dist' }));

startWorld();
startBots({ world, raid: () => raidState(), forecast: currentForecast });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`Squeekverse server on :${port}`));
