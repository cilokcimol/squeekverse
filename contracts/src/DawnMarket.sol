// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISqueekCore} from "./ISqueekCore.sol";

/// @title DawnMarket
/// @notice A parimutuel SQK market on one question: in which window does the hamster's next
///         active round fall? Nobody reports the answer. `resolve` reads it from SqueekCore.
/// @dev Testnet software with no owner, no fee and no upgrade path. Betting closes before the
///      first round of the market starts, so nobody can bet on a round they have watched.
contract DawnMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Window ends, in rounds counted from `startRound`. The fifth outcome means "no active round
    /// in any window".
    uint64 public constant WINDOW_1 = 3;
    uint64 public constant WINDOW_2 = 6;
    uint64 public constant WINDOW_3 = 12;
    uint64 public constant WINDOW_4 = 24;
    uint8 public constant OUTCOMES = 5;
    uint8 public constant UNRESOLVED = type(uint8).max;
    /// A new market starts at least this many rounds ahead, which leaves time to bet.
    uint64 public constant LEAD_ROUNDS = 2;

    struct Market {
        uint64 startRound;
        uint8 winner;
        bool refunding;
        uint256 total;
    }

    ISqueekCore public immutable core;
    IERC20 public immutable sqk;
    uint64 public immutable genesisTimestamp;
    uint64 public immutable roundDuration;

    /// @dev Market ids are their `startRound`.
    mapping(uint64 => Market) private _markets;
    mapping(uint64 => uint256[OUTCOMES]) private _pools;
    mapping(uint64 => mapping(address => uint256[OUTCOMES])) private _stakes;
    mapping(uint64 => mapping(address => bool)) public claimed;

    event MarketOpened(uint64 indexed startRound, address indexed opener);
    event BetPlaced(uint64 indexed startRound, address indexed bettor, uint8 indexed outcome, uint256 amount);
    event MarketResolved(uint64 indexed startRound, uint8 winner, bool refunding, uint64 firstActiveRound);
    event Claimed(uint64 indexed startRound, address indexed bettor, uint256 amount);

    error UnknownMarket();
    error MarketExists();
    error StartTooSoon();
    error BettingClosed();
    error InvalidOutcome();
    error ZeroAmount();
    error AlreadyResolved();
    error NotSettledYet();
    error NotResolved();
    error AlreadyClaimed();
    error NothingToClaim();

    constructor(ISqueekCore core_, IERC20 sqk_) {
        core = core_;
        sqk = sqk_;
        ISqueekCore.CoreConfiguration memory config = core_.configuration();
        genesisTimestamp = config.genesisTimestamp;
        roundDuration = config.roundDuration;
    }

    /// @notice The round in progress by wall clock, as SqueekCore's docs define it.
    function currentRound() public view returns (uint64) {
        if (block.timestamp < genesisTimestamp) return 0;
        return uint64((block.timestamp - genesisTimestamp) / roundDuration) + 1;
    }

    function roundStartTime(uint64 round) public view returns (uint256) {
        return genesisTimestamp + uint256(round - 1) * roundDuration;
    }

    function endRound(uint64 startRound) public pure returns (uint64) {
        return startRound + WINDOW_4 - 1;
    }

    function outcomeFor(uint64 startRound, uint64 activeRound) public pure returns (uint8) {
        uint64 offset = activeRound - startRound;
        if (offset < WINDOW_1) return 0;
        if (offset < WINDOW_2) return 1;
        if (offset < WINDOW_3) return 2;
        return 3;
    }

    function market(uint64 startRound) external view returns (Market memory info, uint256[OUTCOMES] memory pools) {
        info = _markets[startRound];
        if (info.startRound == 0) revert UnknownMarket();
        pools = _pools[startRound];
    }

    function stakesOf(uint64 startRound, address bettor) external view returns (uint256[OUTCOMES] memory) {
        return _stakes[startRound][bettor];
    }

    function open(uint64 startRound) external {
        if (_markets[startRound].startRound != 0) revert MarketExists();
        if (startRound < currentRound() + LEAD_ROUNDS) revert StartTooSoon();
        _markets[startRound] = Market({startRound: startRound, winner: UNRESOLVED, refunding: false, total: 0});
        emit MarketOpened(startRound, msg.sender);
    }

    function bet(uint64 startRound, uint8 outcome, uint256 amount) external nonReentrant {
        Market storage info = _markets[startRound];
        if (info.startRound == 0) revert UnknownMarket();
        if (block.timestamp >= roundStartTime(startRound)) revert BettingClosed();
        if (outcome >= OUTCOMES) revert InvalidOutcome();
        if (amount == 0) revert ZeroAmount();
        info.total += amount;
        _pools[startRound][outcome] += amount;
        _stakes[startRound][msg.sender][outcome] += amount;
        sqk.safeTransferFrom(msg.sender, address(this), amount);
        emit BetPlaced(startRound, msg.sender, outcome, amount);
    }

    /// @notice Anyone can settle a market once SqueekCore has certified enough rounds.
    /// @dev `roundPage` lists active rounds only, so its first record is the next active round.
    ///      A page may stop early, but it never skips an active round it has certified past.
    function resolve(uint64 startRound) external {
        Market storage info = _markets[startRound];
        if (info.startRound == 0) revert UnknownMarket();
        if (info.winner != UNRESOLVED) revert AlreadyResolved();

        ISqueekCore.CoreState memory coreState = core.state();
        uint64 last = endRound(startRound);
        uint64 through = coreState.settledThroughRound < last ? coreState.settledThroughRound : last;
        if (through < startRound) revert NotSettledYet();

        ISqueekCore.RoundPage memory page = core.roundPage(startRound - 1, through, 1);
        uint8 winner;
        uint64 firstActive;
        if (page.rounds.length > 0) {
            firstActive = page.rounds[0].roundId;
            winner = outcomeFor(startRound, firstActive);
        } else {
            if (page.certifiedThroughRound < last) revert NotSettledYet();
            winner = OUTCOMES - 1;
        }
        info.winner = winner;
        info.refunding = _pools[startRound][winner] == 0;
        emit MarketResolved(startRound, winner, info.refunding, firstActive);
    }

    function claimable(uint64 startRound, address bettor) public view returns (uint256) {
        Market storage info = _markets[startRound];
        if (info.winner == UNRESOLVED || info.startRound == 0 || claimed[startRound][bettor]) return 0;
        uint256[OUTCOMES] storage stakes = _stakes[startRound][bettor];
        if (info.refunding) {
            uint256 sum;
            for (uint8 i; i < OUTCOMES; i++) sum += stakes[i];
            return sum;
        }
        return (stakes[info.winner] * info.total) / _pools[startRound][info.winner];
    }

    function claim(uint64 startRound) external nonReentrant returns (uint256 amount) {
        Market storage info = _markets[startRound];
        if (info.startRound == 0) revert UnknownMarket();
        if (info.winner == UNRESOLVED) revert NotResolved();
        if (claimed[startRound][msg.sender]) revert AlreadyClaimed();
        amount = claimable(startRound, msg.sender);
        if (amount == 0) revert NothingToClaim();
        claimed[startRound][msg.sender] = true;
        sqk.safeTransfer(msg.sender, amount);
        emit Claimed(startRound, msg.sender, amount);
    }
}
