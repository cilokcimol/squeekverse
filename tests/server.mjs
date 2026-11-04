// Runs the real server against stand-in Telegram, Discord and a Sepolia fork, and checks the parts that need them.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
const RPC = 'http://127.0.0.1:8545', NFT = '0xcb98349c134ab983da5bfd80527dfe2552bdb70f';
const results = []; const check = (n, ok, x = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', n, String(x).slice(0, 170)); };
const posts = { discord: [], telegram: [] };
let served = false;
createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/hook')) { posts.discord.push(JSON.parse(body)); return res.end('{}'); }
    if (req.url.endsWith('/getUpdates')) {
      if (served) return setTimeout(() => res.end('{"ok":true,"result":[]}'), 800);
      served = true;
      return res.end(JSON.stringify({ ok: true, result: ['/sky', '/raid', '/almanac', '/top', '/help@bot', 'hello'].map((text, i) => ({ update_id: i + 1, message: { chat: { id: 7 }, text } })) }));
    }
    if (req.url.endsWith('/sendMessage')) { posts.telegram.push(JSON.parse(body)); return res.end('{"ok":true}'); }
    res.end('{}');
  });
}).listen(9911);
const rpc = async (method, params = []) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
const server = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: '8799', DB_PATH: process.argv[2], RPC_URL: RPC, TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_API_BASE: 'http://127.0.0.1:9911', DISCORD_WEBHOOK_URL: 'http://127.0.0.1:9911/hook', PUBLIC_SITE_URL: 'https://example.test' }, stdio: 'ignore', detached: true });
const API = 'http://127.0.0.1:8799/api';
for (let i = 0; i < 40; i++) { try { if ((await fetch(API + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
await new Promise((r) => setTimeout(r, 15000));
const health = await (await fetch(API + '/health')).json();
check('server follows the real rounds', health.frontier > 1000, health.frontier);
const replies = posts.telegram.filter((m) => !/^(Nightfall|Daybreak|He just woke)/.test(m.text));
check('fresh database stays quiet in channels', replies.length === posts.telegram.length, posts.telegram.length);
check('telegram answers every command', replies.length === 5, `${replies.length}: ` + replies.map((m) => m.text.split('\n')[0].slice(0, 40)).join(' | '));
check('telegram ignores plain chat', !posts.telegram.some((m) => /hello/.test(m.text)));
const chronicle = await (await fetch(API + '/chronicle')).json();
check('the story has entries', chronicle.entries.length > 0, chronicle.entries[0]?.text);

// Naming, with a real signature from a wallet that really owns the Squeek on the fork.
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const account = privateKeyToAccount(generatePrivateKey());
const nft = parseAbi(['function ownerOf(uint256) view returns (address)', 'function transferFrom(address,address,uint256)']);
let tokenId = 0n, from = null;
for (let id = 1n; id < 80n && !from; id++) { try { const o = await pub.readContract({ address: NFT, abi: nft, functionName: 'ownerOf', args: [id] }); const code = await pub.getCode({ address: o }); if (!code || code === '0x') { tokenId = id; from = o; } } catch {} }
await rpc('anvil_setBalance', [from, '0x56BC75E2D63100000']);
const moved = await createWalletClient({ chain: sepolia, transport: http(RPC) }).writeContract({ address: NFT, abi: nft, functionName: 'transferFrom', args: [from, account.address, tokenId], account: from });
await pub.waitForTransactionReceipt({ hash: moved });
const message = (name, nonce) => `Name Squeek #${tokenId} "${name}" on Squeekverse.\nThis signature costs nothing and moves nothing.\nNonce: ${nonce}`;
const nonce = async () => (await (await fetch(API + '/squeeks/nonce')).json()).nonce;
const post = (body) => fetch(`${API}/squeeks/${tokenId}/name`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
let n = await nonce();
const sig = await account.signMessage({ message: message('Bigus Cheeks', n) });
const good = await post({ name: 'Bigus Cheeks', address: account.address, nonce: n, signature: sig });
check('holder can name their Squeek', good.status === 200, JSON.stringify(await good.json()));
const again = await post({ name: 'Bigus Cheeks', address: account.address, nonce: n, signature: sig });
check('a signature cannot be replayed', again.status === 400, again.status);
const stranger = privateKeyToAccount(generatePrivateKey()); n = await nonce();
const bad = await post({ name: 'Thief', address: stranger.address, nonce: n, signature: await stranger.signMessage({ message: message('Thief', n) }) });
check('a stranger cannot name it', bad.status === 403, bad.status);
n = await nonce();
const forged = await post({ name: 'Thief', address: account.address, nonce: n, signature: await stranger.signMessage({ message: message('Thief', n) }) });
check('a forged signature fails', forged.status === 401, forged.status);
const names = await (await fetch(API + '/squeeks/names')).json();
check('the name shows in the hall', names.names.some((x) => x.name === 'Bigus Cheeks'));
try { process.kill(-server.pid); } catch {}
console.log(results.filter(Boolean).length + '/' + results.length + ' passed, discord posts seen: ' + posts.discord.length);
process.exit(results.every(Boolean) ? 0 : 1);
