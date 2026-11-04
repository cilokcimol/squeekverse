import { parseAbi } from 'viem';

export const marketAbi = parseAbi([
  'function currentRound() view returns (uint64)',
  'function market(uint64) view returns ((uint64 startRound, uint8 winner, bool refunding, uint256 total) info, uint256[5] pools)',
  'function stakesOf(uint64, address) view returns (uint256[5])',
  'function claimable(uint64, address) view returns (uint256)',
  'function open(uint64)', 'function bet(uint64, uint8, uint256)', 'function resolve(uint64)', 'function claim(uint64) returns (uint256)',
  'error UnknownMarket()', 'error MarketExists()', 'error StartTooSoon()', 'error BettingClosed()', 'error InvalidOutcome()', 'error ZeroAmount()', 'error AlreadyResolved()', 'error NotSettledYet()', 'error NotResolved()', 'error AlreadyClaimed()', 'error NothingToClaim()',
]);
export const erc20Abi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function allowance(address, address) view returns (uint256)', 'function approve(address, uint256) returns (bool)']);
export const flowerAbi = parseAbi([
  'function plant() returns (uint256)', 'function svgOf(uint256) view returns (string)', 'function stage(uint256) view returns (uint8)', 'function lightReceived(uint256) view returns (uint256)', 'function totalPlanted() view returns (uint256)', 'function ownerOf(uint256) view returns (address)',
  'event Planted(uint256 indexed tokenId, address indexed gardener, uint64 workAtPlanting, uint64 roundAtPlanting)',
]);
export const swapAbi = parseAbi([
  'function make(uint256 giveSqueek, uint256 askSqueek, uint96 askSqk, address taker) returns (uint256)', 'function cancel(uint256)', 'function fill(uint256)', 'function offerCount() view returns (uint256)',
  'function offers(uint256) view returns (address maker, uint96 askSqk, address taker, uint256 giveSqueek, uint256 askSqueek, bool open)',
  'error EmptyAsk()', 'error OfferClosed()', 'error NotMaker()', 'error NotAllowedTaker()',
]);
export const nftAbi = parseAbi(['function ownerOf(uint256) view returns (address)', 'function getApproved(uint256) view returns (address)', 'function isApprovedForAll(address, address) view returns (bool)', 'function setApprovalForAll(address, bool)', 'function balanceOf(address) view returns (uint256)', 'function merge(uint256 survivor, uint256 donor)', 'function mergesOpen() view returns (bool)']);
/** Staking functions as the official app at sepolia.squeekchain.com calls them. */
export const stakingAbi = parseAbi([
  'function claim(address account) returns (uint256 amount)', 'function claimAndStake() returns (uint256 amount)', 'function claimable(address account) view returns (uint256)',
  'function deposit(address collection, uint256[] tokenIds)', 'function withdraw(address collection, uint256[] tokenIds)', 'function mergeDeposited(address collection, uint256 survivor, uint256 donor)',
  'function stake(uint256 amount)', 'function unstake(uint256 amount, uint256 maxFee, uint64 deadline) returns (uint256 net)', 'function quoteUnstake(address account, uint256 amount) view returns (uint256 fee, uint256 net)',
  'function stakeOf(address account) view returns (uint256 principal, uint256 freshPrincipal, uint64 freshUntilRound)', 'function accountPower(address account) view returns (uint256 nftPower, uint256 sqkPower)', 'function depositor(address collection, uint256 tokenId) view returns (address)', 'function setClaimRecipient(address recipient)', 'function claimRecipient(address account) view returns (address)',
]);

