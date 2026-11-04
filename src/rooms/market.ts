import { formatUnits, parseUnits } from 'viem';
import { LIVE, roundAt, roundStart } from '../../shared/chain';
import { deployment, erc20Abi, explain, marketAbi } from '../lib/contracts';
import { client, currentForecast, loadHistory } from '../lib/store';
import { connect, onWallet, send, short, wallet } from '../lib/wallet';
import { esc, fmt, sqk, type Room } from './ui';

const OUTCOMES = ['In rounds 1 to 3', 'In rounds 4 to 6', 'In rounds 7 to 12', 'In rounds 13 to 24', 'Not in 24 rounds'];
const STEP = 6; // A market opens every hour, so liquidity gathers in one place.

export const marketRoom: Room = async (el) => {
  await loadHistory();
  const dep = await deployment();
  const now = roundAt(Date.now() / 1000);
  const nextStart = (Math.floor((now + 2) / STEP) + 1) * STEP;
  const starts = [nextStart, nextStart - STEP, nextStart - STEP * 2, nextStart - STEP * 4, nextStart - STEP * 8];
  let selected = nextStart;
  let message = '';
  let balance: bigint | null = null;
  const data = new Map<number, { info: { startRound: bigint; winner: number; refunding: boolean; total: bigint }; pools: readonly bigint[]; mine: readonly bigint[]; claimable: bigint } | null>();

  const load = async () => {
    if (!dep.dawnMarket) return;
    await Promise.all(starts.map(async (start) => {
      try {
        const [info, pools] = await client.readContract({ address: dep.dawnMarket!, abi: marketAbi, functionName: 'market', args: [BigInt(start)] });
        const [mine, claimable] = wallet.address ? await Promise.all([
          client.readContract({ address: dep.dawnMarket!, abi: marketAbi, functionName: 'stakesOf', args: [BigInt(start), wallet.address] }),
          client.readContract({ address: dep.dawnMarket!, abi: marketAbi, functionName: 'claimable', args: [BigInt(start), wallet.address] }),
        ]) : [[0n, 0n, 0n, 0n, 0n], 0n] as const;
        data.set(start, { info, pools, mine, claimable });
      } catch { data.set(start, null); }
    }));
    if (wallet.address) balance = await client.readContract({ address: LIVE.token, abi: erc20Abi, functionName: 'balanceOf', args: [wallet.address] });
  };

  /** What the Almanac thinks of each outcome, as a pointer before you bet. */
  const almanacOdds = (start: number) => {
    const f = currentForecast();
    if (!f || f.kind !== 'dawn') return null;
    const offset = start - f.fromRound;
    const sum = (a: number, b: number) => f.probabilities.slice(Math.max(0, a + offset), Math.max(0, b + offset)).reduce((x, y) => x + y, 0);
    return [sum(0, 3), sum(3, 6), sum(6, 12), sum(12, 18)];
  };

  const paint = () => {
    const m = data.get(selected);
    const closed = Date.now() / 1000 >= roundStart(selected);
    const odds = almanacOdds(selected);
    const total = m ? m.info.total : 0n;
    el.innerHTML = `
      <header><h2>Dawn market</h2><p>Bet test SQK on when the hamster's next active round lands. Nobody reports the result: the contract reads it from SqueekCore. Testnet SQK has no monetary value.</p></header>
      ${!dep.dawnMarket ? `<section><p class="note warm">The market contract is written and tested but not deployed yet. It goes live when the site owner signs the deployment.</p></section>` : ''}
      <section>
        <div class="row">${starts.slice(0, 3).map((s) => `<button class="stamp ${s === selected ? '' : 'quiet'}" data-start="${s}">Round ${s}</button>`).join('')}</div>
        <p class="small soft" style="margin-top:10px">Market for round ${selected} ${closed ? 'has closed for betting' : `takes bets until ${new Date(roundStart(selected) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}.</p>
      </section>
      <section>
        <table><thead><tr><th>He runs next</th>${odds ? '<th class="r">Almanac</th>' : ''}<th class="r">Pool, SQK</th>${m && wallet.address ? '<th class="r">Yours</th>' : ''}</tr></thead>
        <tbody>${OUTCOMES.map((label, i) => `<tr ${m && m.info.winner === i ? 'style="font-weight:700"' : ''}><td><label class="row"><input type="radio" name="o" value="${i}" ${i === 0 ? 'checked' : ''}/> ${label}${m && m.info.winner === i ? ', won' : ''}</label></td>${odds ? `<td class="r">${i < 4 ? `${Math.round(odds[i] * 100)}%` : ''}</td>` : ''}<td class="r">${m ? sqk(m.pools[i]) : 0}</td>${m && wallet.address ? `<td class="r">${sqk(m.mine[i])}</td>` : ''}</tr>`).join('')}</tbody></table>
        <p class="small soft" style="margin-top:6px">Total ${sqk(total)} SQK. Winners split the whole pool. If nobody backed the winner, everyone gets their stake back. No fee.</p>
      </section>
      <section class="stack">
        ${!wallet.address ? '<button class="stamp" data-connect>Connect wallet</button>' : `<p class="small">${short(wallet.address)}${balance !== null ? `, ${sqk(balance)} SQK` : ''}</p>`}
        ${dep.dawnMarket && wallet.address ? `
          ${!m && !closed ? '<button class="stamp" data-open>Open this market</button>' : ''}
          ${m && !closed ? `<label class="small">Amount of SQK<input type="number" min="0" step="any" data-amount value="10"/></label><button class="stamp" data-bet>Place bet</button>` : ''}
          ${m && closed && m.info.winner === 255 ? '<button class="stamp" data-resolve>Settle from SqueekCore</button>' : ''}
          ${m && m.claimable > 0n ? `<button class="stamp" data-claim>Collect ${sqk(m.claimable)} SQK</button>` : ''}` : ''}
        ${message ? `<p class="note warm" role="status">${esc(message)}</p>` : ''}
      </section>`;
    el.querySelectorAll<HTMLButtonElement>('[data-start]').forEach((b) => b.addEventListener('click', () => { selected = Number(b.dataset.start); message = ''; paint(); }));
    const act = async (fn: () => Promise<unknown>, done: string) => { message = 'Check your wallet.'; paint(); try { await fn(); message = done; await load(); } catch (e) { message = explain(e); } paint(); };
    el.querySelector('[data-connect]')?.addEventListener('click', async () => { try { await connect(); await load(); } catch (e) { message = explain(e); } paint(); });
    el.querySelector('[data-open]')?.addEventListener('click', () => act(() => send({ address: dep.dawnMarket!, abi: marketAbi, functionName: 'open', args: [BigInt(selected)] }), 'Market opened.'));
    el.querySelector('[data-resolve]')?.addEventListener('click', () => act(() => send({ address: dep.dawnMarket!, abi: marketAbi, functionName: 'resolve', args: [BigInt(selected)] }), 'Settled from SqueekCore.'));
    el.querySelector('[data-claim]')?.addEventListener('click', () => act(() => send({ address: dep.dawnMarket!, abi: marketAbi, functionName: 'claim', args: [BigInt(selected)] }), 'Collected.'));
    el.querySelector('[data-bet]')?.addEventListener('click', () => {
      const outcome = Number(el.querySelector<HTMLInputElement>('input[name=o]:checked')?.value ?? 0);
      const amount = parseUnits(el.querySelector<HTMLInputElement>('[data-amount]')!.value || '0', 18);
      if (amount <= 0n) { message = 'Enter an amount above zero.'; paint(); return; }
      void act(async () => {
        const allowance = await client.readContract({ address: LIVE.token, abi: erc20Abi, functionName: 'allowance', args: [wallet.address!, dep.dawnMarket!] });
        if (allowance < amount) await send({ address: LIVE.token, abi: erc20Abi, functionName: 'approve', args: [dep.dawnMarket!, amount] });
        await send({ address: dep.dawnMarket!, abi: marketAbi, functionName: 'bet', args: [BigInt(selected), outcome, amount] });
      }, `Bet placed: ${formatUnits(amount, 18)} SQK.`);
    });
  };
  await load().catch(() => {});
  paint();
  void fmt;
  return onWallet(() => { void load().then(paint); }) as unknown as () => void;
};
