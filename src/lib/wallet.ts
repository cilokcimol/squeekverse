/**
 * Wallet connection through the browser wallet itself. This site never sees a key or a seed
 * phrase: every transaction is simulated, shown and then signed in the wallet.
 */
import { createWalletClient, custom, formatEther, type Address, type Hash, type WalletClient } from 'viem';
import { sepolia } from 'viem/chains';
import { SEPOLIA_ID } from '../../shared/chain';
import { client } from './store';

interface Eip1193 { request(args: { method: string; params?: unknown }): Promise<any>; on?(e: string, fn: (...a: any[]) => void): void }
interface Announced { info: { name: string; rdns: string; icon: string; uuid: string }; provider: Eip1193 }

const announced: Announced[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e) => { const d = (e as CustomEvent).detail as Announced; if (!announced.some((a) => a.info.uuid === d.info.uuid)) announced.push(d); });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export const wallet = { address: null as Address | null, provider: null as Eip1193 | null, walletClient: null as WalletClient | null, chainId: 0 };
const listeners = new Set<() => void>();
export const onWallet = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach((fn) => fn());

export const hasWallet = () => announced.length > 0 || Boolean((window as any).ethereum);

export async function connect(): Promise<Address> {
  const provider: Eip1193 | undefined = announced[0]?.provider ?? (window as any).ethereum;
  if (!provider) throw new Error('No browser wallet found. Install one such as MetaMask or Rabby, then reload this page.');
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as Address[];
  wallet.provider = provider;
  wallet.address = accounts[0];
  wallet.chainId = Number(await provider.request({ method: 'eth_chainId' }));
  wallet.walletClient = createWalletClient({ chain: sepolia, transport: custom(provider), account: accounts[0] });
  provider.on?.('accountsChanged', (a: Address[]) => { wallet.address = a[0] ?? null; if (a[0]) wallet.walletClient = createWalletClient({ chain: sepolia, transport: custom(provider), account: a[0] }); notify(); });
  provider.on?.('chainChanged', (id: string) => { wallet.chainId = Number(id); notify(); });
  notify();
  return accounts[0];
}

export async function ensureSepolia() {
  if (!wallet.provider) await connect();
  if (wallet.chainId === SEPOLIA_ID) return;
  try {
    await wallet.provider!.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${SEPOLIA_ID.toString(16)}` }] });
  } catch (e) {
    if ((e as { code?: number }).code === 4902) {
      await wallet.provider!.request({ method: 'wallet_addEthereumChain', params: [{ chainId: `0x${SEPOLIA_ID.toString(16)}`, chainName: 'Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'], blockExplorers: [{ name: 'Blockscout', url: 'https://eth-sepolia.blockscout.com' }] }] });
    } else throw e;
  }
  wallet.chainId = SEPOLIA_ID;
}

/** Simulate first so a call that would fail never reaches the wallet, then ask for a signature. */
export async function send(call: { address: Address; abi: any; functionName: string; args?: readonly unknown[] }): Promise<Hash> {
  await ensureSepolia();
  const { request } = await client.simulateContract({ ...call, account: wallet.address! } as any);
  // Merges and claims touch several contracts, so a tight estimate can run out of gas. Add a margin.
  const estimate = await client.estimateContractGas({ ...call, account: wallet.address! } as any);
  const hash = await wallet.walletClient!.writeContract({ ...request, gas: (estimate * 14n) / 10n, account: wallet.address!, chain: sepolia } as any);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== 'success') throw new Error(`The transaction was mined but failed: ${hash}`);
  // Public RPC nodes can trail each other by a block, so give reads a moment to catch up.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return hash;
}

export async function sign(message: string) {
  if (!wallet.address) await connect();
  return wallet.provider!.request({ method: 'personal_sign', params: [`0x${Array.from(new TextEncoder().encode(message)).map((b) => b.toString(16).padStart(2, '0')).join('')}`, wallet.address] }) as Promise<`0x${string}`>;
}

export async function sepoliaBalance(address: Address) { return formatEther(await client.getBalance({ address })); }
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
