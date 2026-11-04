/** Reads the live deployment back and runs a first plant and market open from the deployer wallet. */
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { roundAt, RPC_URLS } from '../shared/chain';
import { flowerAbi, marketAbi, swapAbi } from '../src/lib/abis';

const d = JSON.parse(readFileSync('public/deployment.json', 'utf8'));
const account = privateKeyToAccount(readFileSync('.env', 'utf8').match(/DEPLOYER_KEY=(0x\w+)/)![1] as Hex);
const pub = createPublicClient({ chain: sepolia, transport: http(RPC_URLS[0]) });
const wallet = createWalletClient({ chain: sepolia, transport: http(RPC_URLS[0]), account });
console.log('market round', await pub.readContract({ address: d.dawnMarket, abi: marketAbi, functionName: 'currentRound' }), 'wall clock', roundAt(Date.now() / 1000));
let offers: bigint | string = 'node lagging'; for (let i = 0; i < 8; i++) { try { offers = await pub.readContract({ address: d.seedSwap, abi: swapAbi, functionName: 'offerCount' }); break; } catch { await new Promise((r) => setTimeout(r, 4000)); } }
console.log('offers', offers);
const planted = await wallet.writeContract({ address: d.sunflower, abi: flowerAbi, functionName: 'plant' });
console.log('plant', (await pub.waitForTransactionReceipt({ hash: planted })).status);
const total = await pub.readContract({ address: d.sunflower, abi: flowerAbi, functionName: 'totalPlanted' });
console.log('planted', total, 'svg bytes', (await pub.readContract({ address: d.sunflower, abi: flowerAbi, functionName: 'svgOf', args: [total] })).length);
const step = 6; const start = (Math.floor((roundAt(Date.now() / 1000) + 2) / step) + 1) * step;
const opened = await wallet.writeContract({ address: d.dawnMarket, abi: marketAbi, functionName: 'open', args: [BigInt(start)] });
console.log('open', start, (await pub.waitForTransactionReceipt({ hash: opened })).status);
const [info] = await pub.readContract({ address: d.dawnMarket, abi: marketAbi, functionName: 'market', args: [BigInt(start)] });
console.log('market', info);
