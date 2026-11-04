/**
 * Everything that names the live Squeekchain deployment lives here.
 *
 * These addresses match both api.squeekchain.com and the official app at sepolia.squeekchain.com.
 * The record in the Squeekchain docs still lists an earlier deployment that stopped settling.
 */
export const API = 'https://api.squeekchain.com';
export const DOCS = 'https://docs.squeekchain.com';
export const SEPOLIA_ID = 11155111;
export const RPC_URLS = ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.drpc.org'];
export const EXPLORER = 'https://eth-sepolia.blockscout.com';

export const LIVE = {
  core: '0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44',
  token: '0x5501e1fa81be1c3f49225fa7668da0245d07db60',
  squeeks: '0xcb98349c134ab983da5bfd80527dfe2552bdb70f',
  mining: '0xcd46990f8349057335289ef282c276204b6cdc62',
  staking: '0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f',
  launch: '0x1ff6485abfbb2d183cd673d78e1ab31c098e04dd',
} as const;

export const GENESIS_TIMESTAMP = 1793022600;
export const ROUND_SECONDS = 600;

export const STREAM_ID = '1AxRnZDwQoZxl';
export const STREAM_URL = `https://x.com/i/broadcasts/${STREAM_ID}`;
export const STREAM_STATE_URL = 'https://media.squeekchain.com/live/current.json';
export const streamEmbed = (id: string) => `https://studio.x.com/embed/broadcast/${id}?dnt=true`;
export const STREAM_CAPTION = 'Squeekchain Sepolia Test';

/** The round in progress at a given time: floor((t - genesis) / 600) + 1, per the SqueekCore docs. */
export function roundAt(unixSeconds: number, genesis = GENESIS_TIMESTAMP): number {
  if (unixSeconds < genesis) return 0;
  return Math.floor((unixSeconds - genesis) / ROUND_SECONDS) + 1;
}

export function roundStart(round: number, genesis = GENESIS_TIMESTAMP): number {
  return genesis + (round - 1) * ROUND_SECONDS;
}

export const coreAbi = [
  { type: 'function', name: 'state', stateMutability: 'view', inputs: [], outputs: [{ type: 'tuple', components: [
    { name: 'settledThroughRound', type: 'uint64' }, { name: 'cumulativeWork', type: 'uint64' }, { name: 'cumulativeBlockUnits', type: 'uint96' },
    { name: 'blockHeight', type: 'uint64' }, { name: 'blockProgress', type: 'uint96' }, { name: 'workPerThousandBlocks', type: 'uint32' },
    { name: 'authorizationNonce', type: 'uint256' }, { name: 'paused', type: 'bool' } ] }] },
  { type: 'function', name: 'roundPage', stateMutability: 'view', inputs: [{ name: 'afterRound', type: 'uint64' }, { name: 'throughRound', type: 'uint64' }, { name: 'maxRecords', type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'certifiedThroughRound', type: 'uint64' },
      { name: 'start', type: 'tuple', components: [{ name: 'cumulativeWork', type: 'uint64' }, { name: 'cumulativeBlockUnits', type: 'uint96' }, { name: 'workPerThousandBlocks', type: 'uint32' }] },
      { name: 'end', type: 'tuple', components: [{ name: 'cumulativeWork', type: 'uint64' }, { name: 'cumulativeBlockUnits', type: 'uint96' }, { name: 'workPerThousandBlocks', type: 'uint32' }] },
      { name: 'rounds', type: 'tuple[]', components: [{ name: 'roundId', type: 'uint64' }, { name: 'cumulativeWork', type: 'uint64' }, { name: 'cumulativeBlockUnits', type: 'uint96' }, { name: 'workPerThousandBlocks', type: 'uint32' }, { name: 'dataHash', type: 'bytes32' }] },
    ] }] },
] as const;
