/** Squeekverse's own Sepolia contracts. Addresses come from deployment.json once they are deployed. */
import type { Address } from 'viem';
import { LIVE } from '../../shared/chain';

export interface Deployment { dawnMarket: Address | null; sunflower: Address | null; seedSwap: Address | null; fromBlock: number; core: string; squeeks: string; token: string }

const empty: Deployment = { dawnMarket: null, sunflower: null, seedSwap: null, fromBlock: 0, core: LIVE.core, squeeks: LIVE.squeeks, token: LIVE.token };
let cache: Deployment | null = null;

export async function deployment(): Promise<Deployment> {
  if (cache) return cache;
  try {
    const local = localStorage.getItem('sw.deployment');
    if (local) return (cache = { ...empty, ...JSON.parse(local) });
  } catch { /* private window */ }
  try {
    const res = await fetch('./deployment.json');
    cache = res.ok ? { ...empty, ...await res.json() } : empty;
  } catch { cache = empty; }
  return cache!;
}
export function setLocalDeployment(d: Partial<Deployment>) {
  cache = { ...(cache ?? empty), ...d };
  try { localStorage.setItem('sw.deployment', JSON.stringify(cache)); } catch { /* private window */ }
}

export { marketAbi, erc20Abi, flowerAbi, swapAbi, nftAbi, stakingAbi } from './abis';

/** Plain words for a failed call, using the contract's own error names. */
export function explain(error: unknown): string {
  const text = String((error as { shortMessage?: string; message?: string })?.shortMessage ?? (error as Error)?.message ?? error);
  const map: Record<string, string> = {
    InvalidUnstake: 'New stake stays locked for a while. Try again once it matures.', '0x280cf628': 'New stake stays locked for a while. Try again once it matures.', FeeLimitExceeded: 'The exit fee rose while you were deciding. Check the new fee and try again.', DeadlineExpired: 'That took too long. Try again.', EmergencyPaused: 'Staking is paused by Squeekchain right now.',
    '0x82b42900': 'The contract says this wallet does not own one of these Squeeks.', Unauthorized: 'The contract says this wallet does not own one of these Squeeks.',
    StartTooSoon: 'That market starts too soon. Try the next one.', BettingClosed: 'Betting closed when the first round started.', NotSettledYet: 'SqueekCore has not settled enough rounds to answer yet.',
    AlreadyResolved: 'This market is already settled.', NothingToClaim: 'You have nothing to collect from this market.', AlreadyClaimed: 'You already collected this one.', NotAllowedTaker: 'This offer is reserved for another wallet.',
    OfferClosed: 'This offer has closed.', ERC721InsufficientApproval: 'Approve the Squeek first.', ERC20InsufficientBalance: 'Not enough SQK in this wallet.', 'User rejected': 'You cancelled in your wallet. Nothing was sent.', 'User denied': 'You cancelled in your wallet. Nothing was sent.', 'insufficient funds': 'This wallet has no Sepolia ETH for the network fee.',
  };
  for (const [key, value] of Object.entries(map)) if (text.includes(key)) return value;
  return text.slice(0, 200);
}
