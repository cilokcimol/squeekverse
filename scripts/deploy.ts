/** Deploys Squeekverse's three contracts to Sepolia from the key in .env and records them in public/deployment.json. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, formatEther, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { LIVE, RPC_URLS } from '../shared/chain';

const key = readFileSync('.env', 'utf8').match(/DEPLOYER_KEY=(0x\w+)/)?.[1] as Hex;
if (!key) throw new Error('Run scripts/new-wallet.mjs first');
const account = privateKeyToAccount(key);
const rpc = process.env.RPC_URL ?? RPC_URLS[0];
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ chain: sepolia, transport: http(rpc), account });
if (await pub.getChainId() !== 11155111) throw new Error('Not Sepolia');
const balance = await pub.getBalance({ address: account.address });
console.log('deployer', account.address, formatEther(balance), 'ETH');
if (balance === 0n) throw new Error('The deployer has no Sepolia ETH yet');

const artifacts = JSON.parse(readFileSync('public/contracts.json', 'utf8')) as Record<string, { abi: any; bytecode: Hex }>;
const fromBlock = Number(await pub.getBlockNumber());
const only = process.env.ONLY;
const out: Record<string, unknown> = only ? JSON.parse(readFileSync('public/deployment.json', 'utf8')) : { network: 'sepolia', fromBlock, core: LIVE.core, squeeks: LIVE.squeeks, token: LIVE.token };
const plan: [string, string, readonly string[]][] = [['dawnMarket', 'DawnMarket', [LIVE.core, LIVE.token]], ['sunflower', 'Sunflower', [LIVE.core]], ['seedSwap', 'SeedSwap', [LIVE.squeeks, LIVE.token]]];
for (const [slot, name, args] of plan) {
  if (only && only !== slot) continue;
  const hash = await wallet.deployContract({ abi: artifacts[name].abi, bytecode: artifacts[name].bytecode, args: [...args] });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`${name} failed: ${hash}`);
  out[slot] = receipt.contractAddress;
  out[`${slot}Tx`] = hash;
  console.log(name, receipt.contractAddress, 'gas', receipt.gasUsed.toString());
}
writeFileSync('public/deployment.json', `${JSON.stringify(out, null, 2)}\n`);
console.log('remaining', formatEther(await pub.getBalance({ address: account.address })));
