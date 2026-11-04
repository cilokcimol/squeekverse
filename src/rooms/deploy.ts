import { type Address, type Hex } from 'viem';
import { LIVE } from '../../shared/chain';
import { deployment, explain, setLocalDeployment } from '../lib/contracts';
import { client } from '../lib/store';
import { connect, ensureSepolia, short, wallet, sepoliaBalance } from '../lib/wallet';
import { esc, type Room } from './ui';

type Artifact = { abi: any; bytecode: Hex };

/** One-time setup for the site owner. It deploys Squeekverse's three contracts from their own wallet. */
export const deployRoom: Room = async (el) => {
  const artifacts = await (await fetch('./contracts.json')).json() as Record<string, Artifact>;
  const dep = await deployment();
  const found: Record<string, string | null> = { dawnMarket: dep.dawnMarket, sunflower: dep.sunflower, seedSwap: dep.seedSwap };
  let message = '';
  let balance = '';
  const plan: [string, string, readonly Address[]][] = [
    ['dawnMarket', 'DawnMarket', [LIVE.core, LIVE.token]],
    ['sunflower', 'Sunflower', [LIVE.core]],
    ['seedSwap', 'SeedSwap', [LIVE.squeeks, LIVE.token]],
  ];
  const paint = () => {
    const done = plan.every(([key]) => found[key]);
    el.innerHTML = `
      <header><h2>Site setup</h2><p>For the site owner. This deploys Squeekverse's three contracts to Sepolia from your own wallet. It needs a little free Sepolia ETH, no real money, and you sign each one in your wallet.</p></header>
      <section class="stack">
        ${wallet.address ? `<p class="small">${short(wallet.address)}, ${esc(balance)} Sepolia ETH</p>` : '<button class="stamp" data-connect>Connect wallet</button>'}
        <table><tbody>${plan.map(([key, name]) => `<tr><td>${name}</td><td class="r small">${found[key] ? esc(short(found[key]!)) : 'Not deployed'}</td></tr>`).join('')}</tbody></table>
        ${wallet.address && !done ? '<button class="stamp" data-go>Deploy what is missing</button>' : ''}
        ${message ? `<p class="note warm" role="status">${esc(message)}</p>` : ''}
        ${done ? `<p class="note">All three are live. Send these addresses to whoever maintains the site so they ship in <code>deployment.json</code>. Until then they only work in this browser.</p><input type="text" readonly aria-label="Deployment" value='${esc(JSON.stringify({ dawnMarket: found.dawnMarket, sunflower: found.sunflower, seedSwap: found.seedSwap }))}'/>` : ''}
      </section>`;
    el.querySelector('[data-connect]')?.addEventListener('click', async () => { try { await connect(); balance = await sepoliaBalance(wallet.address!); } catch (e) { message = explain(e); } paint(); });
    el.querySelector('[data-go]')?.addEventListener('click', async () => {
      try {
        await ensureSepolia();
        const fromBlock = Number(await client.getBlockNumber());
        for (const [key, name, args] of plan) {
          if (found[key]) continue;
          message = `Sign ${name} in your wallet.`; paint();
          const hash = await wallet.walletClient!.deployContract({ abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args: [...args], account: wallet.address!, chain: wallet.walletClient!.chain });
          message = `Waiting for ${name} to confirm.`; paint();
          const receipt = await client.waitForTransactionReceipt({ hash, timeout: 240_000 });
          found[key] = receipt.contractAddress!;
          setLocalDeployment({ [key]: receipt.contractAddress, fromBlock } as any);
        }
        message = 'Done.';
      } catch (e) { message = explain(e); }
      paint();
    });
  };
  if (wallet.address) balance = await sepoliaBalance(wallet.address).catch(() => '');
  paint();
};
