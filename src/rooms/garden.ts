import { parseEventLogs, type Address } from 'viem';
import { STAGES, stageOf, sunflowerSvg } from '../../shared/sunflower';
import { deployment, explain, flowerAbi } from '../lib/contracts';
import { client, history, live, loadHistory } from '../lib/store';
import { connect, onWallet, send, short, wallet } from '../lib/wallet';
import { esc, fmt, type Room } from './ui';

const dataUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export const gardenRoom: Room = async (el) => {
  await loadHistory();
  const dep = await deployment();
  let mine: { id: bigint; svg: string; light: bigint }[] = [];
  let message = '';
  let preview = 24000;

  const load = async () => {
    if (!dep.sunflower || !wallet.address) return;
    const latest = await client.getBlockNumber();
    const from = dep.fromBlock ? BigInt(dep.fromBlock) : latest - 40000n;
    const logs = await client.getContractEvents({ address: dep.sunflower, abi: flowerAbi, eventName: 'Planted', args: { gardener: wallet.address as Address }, fromBlock: from < 0n ? 0n : from }).catch(() => []);
    void parseEventLogs;
    const list = await Promise.all(logs.slice(-12).map(async (log) => {
      const id = log.args.tokenId!;
      const [svg, light] = await Promise.all([
        client.readContract({ address: dep.sunflower!, abi: flowerAbi, functionName: 'svgOf', args: [id] }),
        client.readContract({ address: dep.sunflower!, abi: flowerAbi, functionName: 'lightReceived', args: [id] }),
      ]);
      return { id, svg, light };
    }).map((read) => read.catch(() => null)));
    mine = list.filter((f): f is NonNullable<typeof f> => f !== null);
  };

  const paint = () => {
    el.innerHTML = `
      <header><h2>The greenhouse</h2><p>Plant a sunflower on Sepolia for free. This NFT changes with the hamster, and its art is drawn onchain whenever someone looks at it.</p></header>
      <section>
        ${dep.sunflower ? `<div class="row">${wallet.address ? `<button class="stamp" data-plant>Plant a sunflower</button><span class="small soft">${short(wallet.address)}</span>` : '<button class="stamp" data-connect>Connect wallet to plant</button>'}</div>` : '<p class="note warm">The Sunflower contract is written and tested but not deployed yet. It goes live when the site owner signs the deployment. You can see how it grows below.</p>'}
        ${message ? `<p class="note warm" role="status" style="margin-top:10px">${esc(message)}</p>` : ''}
      </section>
      ${mine.length ? `<section><h3>Your flowers</h3><div class="gallery">${mine.map((f) => `<figure><img alt="Sunflower ${f.id}, ${esc(STAGES[stageOf(Number(f.light))][1])}" src="${dataUri(f.svg)}"/><figcaption>#${f.id}, ${fmt(Number(f.light))} light, ${esc(STAGES[stageOf(Number(f.light))][1])}</figcaption></figure>`).join('')}</div></section>` : ''}
      <section><h3>How one grows</h3>
        <ul class="small" style="padding-left:18px;margin:0 0 12px">
          <li>Distance: his settled work fills the head, one floret at a time.</li>
          <li>Time: it adds a leaf for every day on the wheel.</li>
          <li>Round results: its sky is day only if his newest settled round had work.</li>
        </ul>
        <figure style="margin:0;max-width:300px"><img data-preview alt="" style="width:100%;border-radius:12px;display:block" src="${dataUri(sunflowerSvg(preview, 7, live.sky !== 'night'))}"/></figure>
        <label class="small" style="display:block;margin-top:10px"><span data-label>${fmt(preview)} work of light: ${STAGES[stageOf(preview)][1]}</span><input type="range" data-slide min="0" max="100000" step="400" value="${preview}"/></label>
        <p class="small soft" style="margin-top:6px">At his recent pace of about ${fmt(recentWork())} work a day, a flower planted today reaches full head in about ${fmt(Math.max(1, 40000 / Math.max(1, recentWork())))} days. That is only an estimate, because he sets the schedule.</p>
      </section>`;
    el.querySelector('[data-connect]')?.addEventListener('click', async () => { try { await connect(); await load(); message = ''; } catch (e) { message = explain(e); } paint(); });
    el.querySelector('[data-plant]')?.addEventListener('click', async () => {
      message = 'Check your wallet.'; paint();
      try { await send({ address: dep.sunflower!, abi: flowerAbi, functionName: 'plant' }); message = 'Planted. It starts growing on the next settled work.'; await load(); setTimeout(() => { void load().then(paint); }, 9000); }
      catch (e) { message = explain(e); }
      paint();
    });
    el.querySelector<HTMLInputElement>('[data-slide]')!.addEventListener('input', (e) => {
      preview = Number((e.target as HTMLInputElement).value);
      el.querySelector<HTMLImageElement>('[data-preview]')!.src = dataUri(sunflowerSvg(preview, 7, live.sky !== 'night'));
      el.querySelector('[data-label]')!.textContent = `${fmt(preview)} work of light: ${STAGES[stageOf(preview)][1]}`;
    });
  };
  const recentWork = () => {
    const week = history.active.filter((r) => r.round > history.frontier - 1008).reduce((a, r) => a + r.work, 0);
    return week ? week / 7 : Math.max(1, live.work / 9);
  };
  await load().catch(() => {});
  paint();
  return onWallet(() => { void load().then(paint); }) as unknown as () => void;
};
