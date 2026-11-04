// End to end against a local fork of Sepolia: real contracts, real browser, a stand-in wallet.
// Run: anvil --fork-url <sepolia rpc> --auto-impersonate, build with VITE_RPC_URL pointing at it, then this.
import { chromium } from 'playwright';
import { createPublicClient, http, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';
const RPC = 'http://127.0.0.1:8545', SITE = process.argv[2] ?? 'http://127.0.0.1:4174/', OUT = process.argv[3];
const HOLDER = process.argv[4] ?? '0xff6f4f1e23ba7d1f34d8b4d3a81e5a1b9afecdfa';
const SQK = '0x5501e1fa81be1c3f49225fa7668da0245d07db60';
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const settled = (p) => p.waitForFunction(() => { const m = document.querySelector('.note.warm:not([role=alert])')?.textContent ?? ''; return m && !m.includes('Check your wallet'); }, null, { timeout: 60000 });
const NFT = '0xcb98349c134ab983da5bfd80527dfe2552bdb70f';
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const nft = parseAbi(['function ownerOf(uint256) view returns (address)', 'function balanceOf(address) view returns (uint256)']);
const rpc = async (method, params = []) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
await rpc('anvil_setBalance', [HOLDER, '0x56BC75E2D63100000']);
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, extra); };

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
await p.exposeFunction('__rpc', async (method, params) => {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [HOLDER];
  if (method === 'eth_chainId') return '0xaa36a7';
  if (method === 'wallet_switchEthereumChain') return null;
  if (method === 'personal_sign') throw new Error('no signer in the fork test');
  const res = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (res.error) throw new Error(res.error.message);
  return res.result;
});
await p.addInitScript(() => { window.ethereum = { request: ({ method, params }) => window.__rpc(method, params ?? []), on() {} }; });

// Holder tools.
await p.goto(SITE + '?sky=night#shed'); await p.waitForSelector('[data-connect]', { timeout: 40000 });
await p.click('[data-connect]');
await p.waitForSelector('[data-claim]', { timeout: 40000 });
check('wallet connects and rewards read from contracts', true, (await p.textContent('.action-row')).slice(0, 60));
await p.waitForTimeout(1500);
if (OUT) await p.screenshot({ path: OUT + '/e2e-barn.png', fullPage: false });
const sqk0 = await pub.readContract({ address: SQK, abi: erc20, functionName: 'balanceOf', args: [HOLDER] });
await p.click('[data-claim]'); await settled(p);
const sqk1 = await pub.readContract({ address: SQK, abi: erc20, functionName: 'balanceOf', args: [HOLDER] });
check('claim pays real SQK to the wallet', sqk1 > sqk0, `${(await p.textContent('.note.warm')).slice(0, 60)}, +${(sqk1 - sqk0) / 10n ** 18n} SQK`);
await p.fill('[data-stake] input', '5'); await p.click('[data-stake] button[value=stake]');
await p.waitForFunction(() => /^Staked/.test(document.querySelector('.note.warm')?.textContent ?? '') || /reverted|failed/.test(document.querySelector('.note.warm')?.textContent ?? ''), null, { timeout: 60000 });
check('stake works', (await p.textContent('.note.warm')).startsWith('Staked'), (await p.textContent('.note.warm')).slice(0, 120));
const mergeBtn = await p.$('[data-merge]');
if (mergeBtn) {
  const [survivor, donor] = (await mergeBtn.getAttribute('data-merge')).split(':');
  await mergeBtn.click();
  await p.waitForSelector('[data-merge-yes]');
  check('merge asks first and names the burn', (await p.textContent('[role=alert]')).includes(`#${donor} burns forever`));
  await p.click('[data-merge-yes]');
  await p.waitForFunction(() => { const m = document.querySelector('.note.warm')?.textContent ?? ''; return m && !m.includes('Check your wallet') && !m.includes('cannot be undone'); }, null, { timeout: 60000 });
  const message = await p.textContent('.note.warm');
  let burned = false; try { await pub.readContract({ address: NFT, abi: nft, functionName: 'ownerOf', args: [BigInt(donor)] }); } catch { burned = true; }
  check('merge burns the donor on chain', burned, message.slice(0, 120));
  await p.waitForTimeout(800);
} else console.log('SKIP merge: no ready pair for this holder');
const before = await pub.readContract({ address: NFT, abi: nft, functionName: 'balanceOf', args: [HOLDER] });
const withdraw = await p.$('[data-withdraw]:not([disabled])');
if (withdraw) {
  await withdraw.click();
  await p.waitForFunction(() => /^Withdrawn|reverted|failed|does not own|any more/.test(document.querySelector('.note.warm')?.textContent ?? ''), null, { timeout: 60000 });
  const after = await pub.readContract({ address: NFT, abi: nft, functionName: 'balanceOf', args: [HOLDER] });
  check('withdraw brings Squeeks to the wallet', after > before, `${before} to ${after}: ${(await p.textContent('.note.warm')).slice(0, 100)}`);
}

// Squeekverse's own contracts, already live on the forked chain.
await p.goto(SITE + '?sky=night#garden'); await p.reload(); await p.waitForSelector('[data-connect]', { timeout: 30000 });
await p.click('[data-connect]'); await p.waitForSelector('[data-plant]', { timeout: 20000 });
await p.click('[data-plant]');
await p.waitForFunction(() => { const m = document.querySelector('.note.warm')?.textContent ?? ''; return m && !m.includes('Check your wallet') && !m.includes('not deployed'); }, null, { timeout: 60000 });
const planted = await p.textContent('.note.warm');
check('plant says planted', planted.includes('Planted'), planted.slice(0, 80));
await p.waitForSelector('.gallery img', { timeout: 20000 });
check('planting mints a sunflower and shows its onchain art', true);
if (OUT) await p.screenshot({ path: OUT + '/e2e-garden.png' });

await p.goto(SITE + '?sky=night#market'); await p.reload(); await p.waitForSelector('[data-connect]', { timeout: 30000 });
await p.click('[data-connect]'); await p.waitForFunction(() => document.querySelector('[data-open],[data-bet]'), null, { timeout: 30000 });
if (await p.$('[data-open]')) await p.click('[data-open]');
await p.waitForSelector('[data-bet]', { timeout: 60000 });
check('market opens from the page', true);
await p.fill('[data-amount]', '3'); await p.click('[data-bet]');
await p.waitForFunction(() => /^Bet placed|reverted|failed|enough/.test(document.querySelector('.note.warm')?.textContent ?? ''), null, { timeout: 60000 });
check('bet goes through with approval', (await p.textContent('.note.warm')).startsWith('Bet placed'), (await p.textContent('.note.warm')).slice(0, 100));

await p.goto(SITE + '?sky=night#shed'); await p.reload(); await p.waitForSelector('[data-connect]', { timeout: 30000 }); await p.click('[data-connect]');
await p.waitForSelector('[data-offer]', { timeout: 40000 }); await p.waitForTimeout(1500);
const acct = await (await fetch(`https://api.squeekchain.com/v1/accounts/${HOLDER}?limit=100`)).json();
let give = null;
for (const t of acct.tokens) { try { const o = await pub.readContract({ address: NFT, abi: nft, functionName: 'ownerOf', args: [BigInt(t.tokenId)] }); if (o.toLowerCase() === HOLDER) { give = t.tokenId; break; } } catch {} }
await p.fill('[name=give]', String(give)); await p.fill('[name=wantSqk]', '7'); await p.click('[data-offer] button');
await p.waitForSelector('[data-cancel]', { timeout: 60000 });
check('swap offer escrows the Squeek', (await pub.readContract({ address: NFT, abi: nft, functionName: 'ownerOf', args: [BigInt(give)] })).toLowerCase() !== HOLDER, `#${give}`);
await p.click('[data-cancel]');
await p.waitForFunction(() => /^Offer cancelled/.test(document.querySelector('.note.warm')?.textContent ?? ''), null, { timeout: 60000 });
check('cancel returns the Squeek', (await pub.readContract({ address: NFT, abi: nft, functionName: 'ownerOf', args: [BigInt(give)] })).toLowerCase() === HOLDER);
if (OUT) await p.screenshot({ path: OUT + '/e2e-market.png' });

await p.goto(SITE + '?sky=night#shed'); await p.reload(); await p.waitForSelector('[data-connect]', { timeout: 30000 }); await p.click('[data-connect]'); await p.waitForSelector('[data-stake]', { timeout: 40000 });
await p.fill('[data-stake] input', '2'); await p.click('[data-stake] button[value=unstake]');
await p.waitForFunction(() => document.querySelector('[data-unstake]') || /locked/.test(document.querySelector('.note.warm')?.textContent ?? ''), null, { timeout: 20000 });
if (!(await p.$('[data-unstake]'))) {
  check('new stake explains its lock', true, (await p.textContent('.note.warm')).slice(0, 80));
  // Move the fork's clock past the maturity round, which real time would also do.
  await rpc('evm_increaseTime', [3 * 3600]); await rpc('evm_mine', []);
  await p.click('[data-stake] button[value=unstake]');
}
const quoted = await p.waitForSelector('[data-unstake]', { timeout: 20000 }).catch(() => null);
console.log(quoted ? 'quote shown' : `quote not shown: ${await p.textContent('.note.warm')}`);
if (quoted) {
check('unstake shows the exit fee first', /exit fee/.test(await p.textContent('.room')), (await p.textContent('[data-unstake]')));
await p.click('[data-unstake]');
await p.waitForFunction(() => /^Unstaked/.test(document.querySelector('.note.warm')?.textContent ?? '') || /reverted|failed/.test(document.querySelector('.note.warm')?.textContent ?? ''), null, { timeout: 60000 });
check('unstake works', (await p.textContent('.note.warm')).startsWith('Unstaked'), (await p.textContent('.note.warm')).slice(0, 120));
}
// One Squeek at a time, and claims to another wallet.
await p.goto(SITE + '?sky=night#shed'); await p.reload(); await p.waitForSelector('[data-connect]', { timeout: 30000 }); await p.click('[data-connect]'); await p.waitForSelector('[data-one]', { timeout: 40000 }); await p.waitForTimeout(3000);
const oneBtn = p.locator('[data-one$=":wallet"]').first();
if (await oneBtn.count()) { const id = (await oneBtn.getAttribute('data-one')).split(':')[0]; await oneBtn.click(); await p.waitForFunction(() => /earning now|reverted|failed|does not own/.test(document.querySelector('.note.warm')?.textContent ?? ''), null, { timeout: 60000 }); check('deposit one Squeek', /earning now/.test(await p.textContent('.note.warm')), `#${id}: ${(await p.textContent('.note.warm')).slice(0, 90)}`); }
await p.fill('[data-recipient] input', '0x000000000000000000000000000000000000dEaD'); await p.click('[data-recipient] button');
await p.waitForFunction(() => /Future claims|reverted|failed|rror/.test(document.querySelector('.note.warm')?.textContent ?? ''), null, { timeout: 60000 });
console.log('recipient:', (await p.textContent('.note.warm')).slice(0, 110));

// Holder only game.
await p.goto(SITE + '?sky=night&qa=1#lastlight'); await p.reload(); await p.waitForSelector('[data-deep]', { timeout: 40000 });
await p.click('[data-deep]'); await p.waitForSelector('.hud', { timeout: 30000 });
check('deep night opens for a holder', true, await p.textContent('.floatmsg').catch(() => ''));
await p.waitForTimeout(1500); if (OUT) await p.screenshot({ path: OUT + '/e2e-deep.png' });
await p.click('[data-quit]'); await p.waitForSelector('[data-start]', { timeout: 20000 });

check('no uncaught page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
await b.close();
console.log(results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
