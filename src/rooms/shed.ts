import { isAddress, parseUnits, type Address } from 'viem';
import { API, LIVE } from '../../shared/chain';
import { api, serverOnline } from '../lib/player';
import { deployment, explain, nftAbi, erc20Abi, stakingAbi, swapAbi } from '../lib/contracts';
import { client } from '../lib/store';
import { connect, hasWallet, onWallet, send, short, sign, wallet } from '../lib/wallet';
import { esc, fmt, sqk, type Room } from './ui';

interface Token { tokenId: string; custody: string; level: number; basePower: string; mergeState: string; nextMergeHeight: string }
interface Account { status: string; reason?: string; tokens?: Token[]; tokenCounts?: { staking: string; wallet: string }; rewards?: { claimableBaseUnits: string }; economy?: { coreBlockHeight: string } }

export const shedRoom: Room = async (el) => {
  const shared = await serverOnline();
  const dep = await deployment();
  let address: string = wallet.address ?? '';
  let account: Account | null = null;
  let names = new Map<number, string>();
  let message = '';
  let busy = false;
  let chain: { claimable: bigint; principal: bigint; fresh: bigint; freshUntil: number; sqk: bigint; nftPower: bigint; sqkPower: bigint } | null = null;
  let pendingMerge: { survivor: string; donor: string; level: number; custody: string } | null = null;
  let stakeAmount = '';
  let unstakeQuote: { amount: bigint; fee: bigint; net: bigint } | null = null;
  let offers: { id: bigint; maker: Address; askSqk: bigint; taker: Address; giveSqueek: bigint; askSqueek: bigint }[] = [];

  const loadOffers = async () => {
    if (!dep.seedSwap) return;
    const count = await client.readContract({ address: dep.seedSwap, abi: swapAbi, functionName: 'offerCount' });
    const list = [];
    for (let id = count; id > 0n && list.length < 12 && count - id < 60n; id--) {
      const [maker, askSqk, taker, giveSqueek, askSqueek, open] = await client.readContract({ address: dep.seedSwap, abi: swapAbi, functionName: 'offers', args: [id] });
      if (open) list.push({ id, maker, askSqk, taker, giveSqueek, askSqueek });
    }
    offers = list;
  };

  const lookup = async () => {
    if (!isAddress(address, { strict: false })) { account = null; return; }
    const res = await fetch(`${API}/v1/accounts/${address.toLowerCase()}?limit=100`);
    account = res.ok ? await res.json() as Account : { status: 'unavailable', reason: `HTTP ${res.status}` };
    await readChain();
  };

  /** Figures that lead to a transaction come from the contracts, not the API. */
  const readChain = async () => {
    if (!wallet.address) { chain = null; return; }
    const who = wallet.address;
    const read = (functionName: any, args: any) => client.readContract({ address: LIVE.staking, abi: stakingAbi, functionName, args } as any) as Promise<any>;
    const [claimable, stakeInfo, power, sqkBalance] = await Promise.all([read('claimable', [who]), read('stakeOf', [who]), read('accountPower', [who]), client.readContract({ address: LIVE.token, abi: erc20Abi, functionName: 'balanceOf', args: [who] })]);
    chain = { claimable, principal: stakeInfo[0], fresh: stakeInfo[1], freshUntil: Number(stakeInfo[2]), sqk: sqkBalance, nftPower: power[0], sqkPower: power[1] };
  };

  /** Pairs that can merge now. Both must be held the same way, in the wallet or in staking. */
  const pairs = () => {
    const ready = (account?.tokens ?? []).filter((t) => t.mergeState === 'ready');
    const groups = new Map<string, Token[]>();
    for (const t of ready) { const k = `${t.level}:${t.custody}`; groups.set(k, [...(groups.get(k) ?? []), t]); }
    return [...groups.values()].filter((l) => l.length >= 2).map((l) => ({ level: l[0].level, custody: l[0].custody, a: l[0], b: l[1], count: Math.floor(l.length / 2) }));
  };

  const paint = () => {
    const tokens = account?.tokens ?? [];
    const isMine = wallet.address && address.toLowerCase() === wallet.address.toLowerCase();
    const p = pairs();
    el.innerHTML = `
      <header><h2>The barn</h2><p>Squeek holders live here. Claim your SQK, stake, merge, name your Squeeks and swap with other holders. Your wallet signs everything, and nothing here can move a Squeek on its own.</p></header>
      <section><div class="row">
        <button class="stamp" data-connect>${wallet.address ? short(wallet.address) : 'Connect wallet'}</button>
        <form class="row" data-look style="flex:1 1 220px"><input type="text" aria-label="Wallet address" placeholder="Or paste any address" value="${esc(address)}" style="flex:1"/><button class="stamp quiet">Look</button></form>
      </div>
      ${message ? `<p class="note warm" role="status" style="margin-top:10px">${esc(message)}</p>` : ''}</section>
      ${account ? account.status !== 'available' ? `<section><p class="note">Squeekchain says this account's data is unavailable right now (${esc(account.reason ?? 'unknown')}). That means unknown, not empty. Try again shortly.</p></section>` : `
      <section><h3>${tokens.length ? `${tokens.length} Squeek${tokens.length > 1 ? 's' : ''}` : 'No Squeeks here'}</h3>
        ${account.rewards ? `<p class="small soft">Unclaimed: ${sqk(BigInt(account.rewards.claimableBaseUnits))} SQK.</p>` : ''}
        ${tokens.length ? `<div class="gallery" style="margin-top:10px">${tokens.slice(0, 24).map((t) => { const id = Number(t.tokenId); return `<div class="squeek-card" data-card="${id}"><img alt="Squeek ${id}" data-img="${id}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="/><b>${esc(names.get(id) ?? `Squeek #${id}`)}</b><span class="small soft">Level ${t.level}, ${t.custody === 'staking' ? 'staked' : 'in wallet'}, ${t.mergeState === 'ready' ? 'can merge' : t.mergeState.replace('_', ' ')}</span>${isMine && shared ? `<button class="link-button small" data-name="${id}" style="text-align:left">Give a name</button>` : ''}${isMine ? `<button class="link-button small" data-one="${id}:${t.custody}" style="text-align:left">${t.custody === 'staking' ? 'Withdraw this one' : 'Deposit this one'}</button>` : ''}</div>`; }).join('')}</div>` : '<p class="small soft">This wallet holds no Squeeks in this deployment.</p>'}
      </section>
      ${isMine && chain ? `<section><h3>Your rewards and stake</h3>
        <p class="small soft">Read from the contracts just now. Test SQK has no monetary value.</p>
        <div class="action-row"><div>${sqk(chain.claimable)} SQK to claim</div><div class="row"><button class="stamp quiet" data-claim ${chain.claimable ? '' : 'disabled'}>Claim</button><button class="stamp quiet" data-compound ${chain.claimable ? '' : 'disabled'}>Claim into stake</button></div></div>
        <div class="action-row"><div>${sqk(chain.principal)} SQK staked<br><span class="small soft">Power: ${sqk(chain.nftPower, 0)} from Squeeks, ${sqk(chain.sqkPower, 0)} from SQK.${chain.fresh > 0n ? ` ${sqk(chain.fresh)} SQK is new and matures after round ${chain.freshUntil}.` : ''}</span></div><span></span></div>
        <form class="row" data-stake style="margin-top:8px"><input type="number" min="0" step="any" name="amount" value="${esc(stakeAmount)}" aria-label="SQK amount" placeholder="SQK amount, you hold ${sqk(chain.sqk)}" style="flex:1 1 170px"/><button class="stamp quiet" name="go" value="stake">Stake</button><button class="stamp quiet" name="go" value="unstake" ${chain.principal ? '' : 'disabled'}>Unstake</button></form>
        <p class="small soft" style="margin-top:6px">SQK comes from claiming rewards, and from Squeeks you hold on the test network.</p>
        ${unstakeQuote ? `<div class="note warm" style="margin-top:10px"><p>Unstaking ${sqk(unstakeQuote.amount)} SQK costs an exit fee of ${sqk(unstakeQuote.fee)} SQK. You receive ${sqk(unstakeQuote.net)} SQK.</p><div class="row" style="margin-top:8px"><button class="stamp" data-unstake>Unstake and pay the fee</button><button class="stamp quiet" data-unstake-no>Keep it staked</button></div></div>` : ''}
      </section>
      <section><h3>Staking your Squeeks</h3>
        <p class="small">A Squeek earns SQK while deposited in staking. Depositing and withdrawing are free apart from the network fee.</p>
        <form class="row" data-recipient style="margin-top:10px"><input type="text" name="to" aria-label="Claims go to" placeholder="Send future claims to another wallet" style="flex:1 1 200px"/><button class="stamp quiet">Set</button></form>
        <div class="row" style="margin-top:10px"><button class="stamp quiet" data-deposit ${tokens.some((t) => t.custody === 'wallet') ? '' : 'disabled'}>Deposit all in wallet</button><button class="stamp quiet" data-withdraw ${tokens.some((t) => t.custody === 'staking') ? '' : 'disabled'}>Withdraw all from staking</button></div>
      </section>` : ''}
      <section><h3>Merge scout</h3>
        ${p.length ? `${p.map((x) => `<div class="action-row"><div class="small">Level ${x.level}, ${x.custody === 'staking' ? 'in staking' : 'in wallet'}: #${x.a.tokenId} keeps going and #${x.b.tokenId} burns.${x.count > 1 ? ` ${x.count} pairs in all.` : ''}</div>${isMine ? `<button class="stamp quiet" data-merge="${x.a.tokenId}:${x.b.tokenId}:${x.level}:${x.custody}">Merge</button>` : '<span></span>'}</div>`).join('')}` : '<p class="small soft">No pair is ready to merge. It takes two Squeeks of the same level, both past their cooldown and held the same way.</p>'}
        ${pendingMerge ? `<div class="note warm" role="alert" style="margin-top:10px"><p><b>This cannot be undone.</b> Squeek #${pendingMerge.donor} burns forever and #${pendingMerge.survivor} rises to level ${pendingMerge.level + 1}.</p><div class="row" style="margin-top:8px"><button class="stamp" data-merge-yes>Burn #${pendingMerge.donor} and merge</button><button class="stamp quiet" data-merge-no>Cancel</button></div></div>` : ''}
      </section>` : ''}
      ${account && !(account.tokens ?? []).length && wallet.address ? '<section><p class="small">Need test Squeeks? The official Sepolia app hands them out for free: <a href="https://sepolia.squeekchain.com" target="_blank" rel="noopener">sepolia.squeekchain.com</a>.</p></section>' : ''}
      ${names.size ? `<section><h3>The hall</h3><p class="small soft">Squeeks their holders have named.</p><div class="gallery" style="margin-top:10px" data-hall>${[...names.entries()].slice(0, 12).map(([id, name]) => `<figure><img alt="${esc(name)}" data-hall-img="${id}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="/><figcaption><b>${esc(name)}</b>, #${id}</figcaption></figure>`).join('')}</div></section>` : ''}
      <section><h3>Swap with a holder</h3>
        ${dep.seedSwap ? `<p class="small">Your Squeek waits in the swap contract until someone meets your ask. Both sides move in one transaction, or neither does.</p>
        ${offers.length ? `<table style="margin-top:10px"><thead><tr><th>Gives</th><th>Asks</th><th></th></tr></thead><tbody>${offers.map((o) => `<tr><td>#${o.giveSqueek}</td><td>${o.askSqueek ? `#${o.askSqueek}` : ''}${o.askSqueek && o.askSqk ? ' and ' : ''}${o.askSqk ? `${sqk(o.askSqk)} SQK` : ''}</td><td class="r">${wallet.address?.toLowerCase() === o.maker.toLowerCase() ? `<button class="link-button" data-cancel="${o.id}">Cancel</button>` : `<button class="link-button" data-fill="${o.id}">Take it</button>`}</td></tr>`).join('')}</tbody></table>` : '<p class="small soft" style="margin-top:8px">No open offers. Make the first one.</p>'}
        <form class="stack" data-offer style="margin-top:12px">
          <label class="small">Your Squeek number<input type="number" min="1" name="give" required/></label>
          <label class="small">Squeek you want, if any<input type="number" min="1" name="wantId"/></label>
          <label class="small">SQK you want, if any<input type="number" min="0" step="any" name="wantSqk"/></label>
          <button class="stamp" ${busy ? 'disabled' : ''}>${busy ? 'Waiting for the wallet' : 'Make offer'}</button></form>` : `<p class="small soft">The swap contract is written and tested but not deployed yet. It goes live when the site owner signs the deployment.</p>`}
      </section>`;
    bind();
    el.querySelectorAll<HTMLImageElement>('[data-hall-img]').forEach(async (img) => {
      try { const info = await (await fetch(`${API}/v1/squeeks/${img.dataset.hallImg}`)).json(); const src = info.metadata?.cardImageUrl ?? info.metadata?.imageDataUri; if (src && /^(https:|data:image\/)/.test(src)) img.src = src; } catch { /* the name still shows */ }
    });
    tokens.slice(0, 24).forEach(async (t) => {
      const img = el.querySelector<HTMLImageElement>(`[data-img="${t.tokenId}"]`);
      if (!img) return;
      try { const info = await (await fetch(`${API}/v1/squeeks/${t.tokenId}`)).json(); const src = info.metadata?.cardImageUrl ?? info.metadata?.imageDataUri; if (src && /^(https:|data:image\/)/.test(src)) img.src = src; } catch { /* the card keeps its name */ }
    });
  };

  const action = async (fn: () => Promise<unknown>, done: string) => {
    busy = true; message = 'Check your wallet.'; paint();
    try { await fn(); message = done; pendingMerge = null; unstakeQuote = null; await Promise.all([loadOffers(), lookup()]); }
    catch (e) { message = explain(e); }
    busy = false; paint();
  };

  const bind = () => {
    el.querySelector('[data-connect]')?.addEventListener('click', async () => {
      if (!hasWallet()) { message = 'No browser wallet found. Install one such as MetaMask or Rabby, then reload this page.'; paint(); return; }
      try { address = await connect(); await lookup(); message = ''; } catch (e) { message = explain(e); }
      paint();
    });
    el.querySelector('[data-look]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      address = (e.target as HTMLElement).querySelector('input')!.value.trim();
      if (!isAddress(address, { strict: false })) { message = 'That is not a wallet address. It should start with 0x and have 42 characters.'; account = null; }
      else { message = ''; await lookup(); }
      paint();
    });
    const nft = LIVE.squeeks as Address;
    const staking = LIVE.staking as Address;
    const ids = (custody: string) => (account?.tokens ?? []).filter((t) => t.custody === custody).map((t) => BigInt(t.tokenId)).sort((a, b) => (a < b ? -1 : 1));
    el.querySelector('[data-claim]')?.addEventListener('click', () => void action(() => send({ address: staking, abi: stakingAbi, functionName: 'claim', args: [wallet.address!] }), 'Claimed. The SQK is in your wallet.'));
    el.querySelector('[data-compound]')?.addEventListener('click', () => void action(() => send({ address: staking, abi: stakingAbi, functionName: 'claimAndStake' }), 'Claimed straight into your stake.'));
    el.querySelector('[data-deposit]')?.addEventListener('click', () => void action(async () => {
      const list = ids('wallet');
      // Ownership is read live, right before the transaction.
      const mine: bigint[] = [];
      for (const id of list) { const owner = await client.readContract({ address: nft, abi: nftAbi, functionName: 'ownerOf', args: [id] }).catch(() => null); if (owner?.toLowerCase() === wallet.address!.toLowerCase()) mine.push(id); }
      if (!mine.length) throw new Error('None of these Squeeks are in this wallet any more.');
      const approved = await client.readContract({ address: nft, abi: nftAbi, functionName: 'isApprovedForAll', args: [wallet.address!, staking] });
      if (!approved) await send({ address: nft, abi: nftAbi, functionName: 'setApprovalForAll', args: [staking, true] });
      await send({ address: staking, abi: stakingAbi, functionName: 'deposit', args: [nft, mine] });
    }, 'Deposited. These Squeeks are earning now.'));
    el.querySelectorAll<HTMLButtonElement>('[data-one]').forEach((b) => b.addEventListener('click', () => {
      const [raw, custody] = b.dataset.one!.split(':'); const id = BigInt(raw);
      void action(async () => {
        if (custody === 'staking') return send({ address: staking, abi: stakingAbi, functionName: 'withdraw', args: [nft, [id]] });
        const approved = await client.readContract({ address: nft, abi: nftAbi, functionName: 'isApprovedForAll', args: [wallet.address!, staking] });
        if (!approved) await send({ address: nft, abi: nftAbi, functionName: 'setApprovalForAll', args: [staking, true] });
        return send({ address: staking, abi: stakingAbi, functionName: 'deposit', args: [nft, [id]] });
      }, custody === 'staking' ? `Squeek #${raw} is back in your wallet.` : `Squeek #${raw} is earning now.`);
    }));
    el.querySelector('[data-recipient]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const to = String(new FormData(e.target as HTMLFormElement).get('to') ?? '').trim();
      if (!isAddress(to, { strict: false })) { message = 'That is not a wallet address. It should start with 0x and have 42 characters.'; paint(); return; }
      void action(() => send({ address: staking, abi: stakingAbi, functionName: 'setClaimRecipient', args: [to as Address] }), 'Future claims now go to that wallet.');
    });
    el.querySelector('[data-withdraw]')?.addEventListener('click', () => void action(async () => {
      // The API trails the chain by 12 blocks, so skip anything already merged or moved.
      const list: bigint[] = [];
      for (const id of ids('staking')) { const holder = await client.readContract({ address: staking, abi: stakingAbi, functionName: 'depositor', args: [nft, id] }); if (holder.toLowerCase() === wallet.address!.toLowerCase()) list.push(id); }
      if (!list.length) throw new Error('None of these Squeeks are in staking under this wallet any more.');
      await send({ address: staking, abi: stakingAbi, functionName: 'withdraw', args: [nft, list] });
    }, 'Withdrawn to your wallet.'));
    el.querySelectorAll<HTMLButtonElement>('[data-merge]').forEach((b) => b.addEventListener('click', () => { const [survivor, donor, level, custody] = b.dataset.merge!.split(':'); pendingMerge = { survivor, donor, level: Number(level), custody }; paint(); }));
    el.querySelector('[data-merge-no]')?.addEventListener('click', () => { pendingMerge = null; paint(); });
    el.querySelector('[data-merge-yes]')?.addEventListener('click', () => { const m = pendingMerge!; void action(() => m.custody === 'staking' ? send({ address: staking, abi: stakingAbi, functionName: 'mergeDeposited', args: [nft, BigInt(m.survivor), BigInt(m.donor)] }) : send({ address: nft, abi: nftAbi, functionName: 'merge', args: [BigInt(m.survivor), BigInt(m.donor)] }), `Merged. Squeek #${m.survivor} is level ${m.level + 1}.`); });
    el.querySelector('[data-stake] input')?.addEventListener('input', (e) => { stakeAmount = (e.target as HTMLInputElement).value; });
    el.querySelector('[data-stake]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const go = ((e as SubmitEvent).submitter as HTMLButtonElement)?.value;
      stakeAmount = String(new FormData(form).get('amount') || '');
      const amount = parseUnits(stakeAmount || '0', 18);
      if (amount <= 0n) { message = 'Enter an amount above zero.'; paint(); return; }
      if (go === 'unstake') {
        try { const [fee, net] = await client.readContract({ address: staking, abi: stakingAbi, functionName: 'quoteUnstake', args: [wallet.address!, amount] }); unstakeQuote = { amount, fee, net }; message = ''; }
        catch (err) { message = explain(err); unstakeQuote = null; }
        paint(); return;
      }
      void action(async () => {
        const allowance = await client.readContract({ address: LIVE.token, abi: erc20Abi, functionName: 'allowance', args: [wallet.address!, staking] });
        if (allowance < amount) await send({ address: LIVE.token, abi: erc20Abi, functionName: 'approve', args: [staking, amount] });
        await send({ address: staking, abi: stakingAbi, functionName: 'stake', args: [amount] });
      }, 'Staked.');
    });
    el.querySelector('[data-unstake-no]')?.addEventListener('click', () => { unstakeQuote = null; paint(); });
    el.querySelector('[data-unstake]')?.addEventListener('click', () => { const q = unstakeQuote!; void action(async () => { const block = await client.getBlock(); await send({ address: staking, abi: stakingAbi, functionName: 'unstake', args: [q.amount, q.fee + q.fee / 100n, block.timestamp + 900n] }); }, `Unstaked. ${sqk(q.net)} SQK is back in your wallet.`); });
    el.querySelectorAll<HTMLButtonElement>('[data-name]').forEach((b) => b.addEventListener('click', async () => {
      const tokenId = Number(b.dataset.name);
      const name = (prompt(`A name for Squeek #${tokenId}`) ?? '').trim();
      if (!name) return;
      try {
        const { nonce } = await api.get<{ nonce: string }>('/squeeks/nonce');
        const clean = name.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 24);
        const signature = await sign(`Name Squeek #${tokenId} "${clean}" on Squeekverse.\nThis signature costs nothing and moves nothing.\nNonce: ${nonce}`);
        await api.post(`/squeeks/${tokenId}/name`, { name: clean, address: wallet.address, signature, nonce });
        names.set(tokenId, clean); message = `Squeek #${tokenId} is now ${clean}.`;
      } catch (e) { message = explain(e); }
      paint();
    }));
    el.querySelector('[data-offer]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(e.target as HTMLFormElement);
      const give = BigInt(String(data.get('give') || 0)), wantId = BigInt(String(data.get('wantId') || 0));
      const wantSqk = parseUnits(String(data.get('wantSqk') || '0'), 18);
      if (!wantId && !wantSqk) { message = 'Ask for a Squeek, some SQK or both.'; paint(); return; }
      void action(async () => {
        if (!wallet.address) await connect();
        const approved = await client.readContract({ address: LIVE.squeeks, abi: nftAbi, functionName: 'isApprovedForAll', args: [wallet.address!, dep.seedSwap!] });
        if (!approved) await send({ address: LIVE.squeeks, abi: nftAbi, functionName: 'setApprovalForAll', args: [dep.seedSwap!, true] });
        await send({ address: dep.seedSwap!, abi: swapAbi, functionName: 'make', args: [give, wantId, wantSqk, '0x0000000000000000000000000000000000000000'] });
      }, 'Offer made. Your Squeek is waiting in the swap contract.');
    });
    el.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((b) => b.addEventListener('click', () => void action(() => send({ address: dep.seedSwap!, abi: swapAbi, functionName: 'cancel', args: [BigInt(b.dataset.cancel!)] }), 'Offer cancelled. Your Squeek is back.')));
    el.querySelectorAll<HTMLButtonElement>('[data-fill]').forEach((b) => b.addEventListener('click', () => void action(async () => {
      if (!wallet.address) await connect();
      const o = offers.find((x) => x.id === BigInt(b.dataset.fill!))!;
      if (o.askSqk) {
        const allowance = await client.readContract({ address: LIVE.token, abi: erc20Abi, functionName: 'allowance', args: [wallet.address!, dep.seedSwap!] });
        if (allowance < o.askSqk) await send({ address: LIVE.token, abi: erc20Abi, functionName: 'approve', args: [dep.seedSwap!, o.askSqk] });
      }
      if (o.askSqueek) await send({ address: LIVE.squeeks, abi: nftAbi, functionName: 'setApprovalForAll', args: [dep.seedSwap!, true] });
      await send({ address: dep.seedSwap!, abi: swapAbi, functionName: 'fill', args: [o.id] });
    }, 'Swap done. The Squeek is yours.')));
  };

  if (shared) { const list = await api.get<{ names: { tokenId: number; name: string }[] }>('/squeeks/names').catch(() => ({ names: [] })); names = new Map(list.names.map((n) => [n.tokenId, n.name])); }
  await Promise.all([lookup(), loadOffers().catch(() => {})]);
  paint();
  void fmt;
  return onWallet(() => { if (wallet.address) { address = wallet.address; void lookup().then(paint); } else paint(); }) as unknown as () => void;
};
