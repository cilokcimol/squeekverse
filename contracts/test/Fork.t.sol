// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {DawnMarket} from "../src/DawnMarket.sol";
import {Sunflower} from "../src/Sunflower.sol";
import {SeedSwap} from "../src/SeedSwap.sol";
import {ISqueekCore} from "../src/ISqueekCore.sol";

/// Runs against the live Sepolia contracts: forge test --match-contract Fork --fork-url <rpc>
contract ForkTest is Test {
    ISqueekCore constant core = ISqueekCore(0x980B4424c007CAf7a1f3670B48c8EaEf7EbC3d44);
    IERC20 constant sqk = IERC20(0x5501E1Fa81Be1c3F49225fa7668DA0245d07Db60);
    IERC721 constant squeeks = IERC721(0xCB98349c134aB983dA5BfD80527dfe2552bDB70F);
    address a = address(0xA11CE); address b = address(0xB0B);

    function _on() internal view returns (bool) { return block.chainid == 11155111; }

    function test_marketSettlesFromRealRounds() public {
        if (!_on()) return;
        ISqueekCore.CoreState memory s = core.state();
        uint64 start = s.settledThroughRound - 300;
        // Rewind the clock to just before that round, then let the market read what really happened.
        ISqueekCore.CoreConfiguration memory cfg = core.configuration();
        DawnMarket m = new DawnMarket(core, sqk);
        vm.warp(uint256(cfg.genesisTimestamp) + uint256(start - 4) * 600);
        assertEq(m.currentRound(), start - 3);
        m.open(start);
        deal(address(sqk), a, 100e18); deal(address(sqk), b, 100e18);
        vm.startPrank(a); sqk.approve(address(m), 100e18); m.bet(start, 0, 40e18); vm.stopPrank();
        vm.startPrank(b); sqk.approve(address(m), 100e18); m.bet(start, 3, 60e18); vm.stopPrank();
        vm.warp(uint256(cfg.genesisTimestamp) + uint256(start + 40) * 600);
        m.resolve(start);
        (DawnMarket.Market memory info, ) = m.market(start);
        ISqueekCore.RoundPage memory page = core.roundPage(start - 1, start + 23, 1);
        uint8 expected = page.rounds.length > 0 ? m.outcomeFor(start, page.rounds[0].roundId) : 4;
        assertEq(info.winner, expected);
        emit log_named_uint("real winner window", info.winner);
    }

    function test_sunflowerDrawsFromRealCore() public {
        if (!_on()) return;
        Sunflower f = new Sunflower(core);
        vm.prank(a); uint256 id = f.plant();
        assertEq(f.lightReceived(id), 0);
        assertGt(bytes(f.tokenURI(id)).length, 300);
    }

    function test_swapMovesRealSqueeks() public {
        if (!_on()) return;
        SeedSwap sw = new SeedSwap(squeeks, sqk);
        address owner1 = squeeks.ownerOf(1);
        vm.assume(owner1.code.length == 0);
        deal(address(sqk), b, 50e18);
        vm.prank(owner1); squeeks.setApprovalForAll(address(sw), true);
        vm.prank(owner1); uint256 id = sw.make(1, 0, 5e18, address(0));
        assertEq(squeeks.ownerOf(1), address(sw));
        vm.startPrank(b); sqk.approve(address(sw), 5e18); sw.fill(id); vm.stopPrank();
        assertEq(squeeks.ownerOf(1), b);
        assertEq(sqk.balanceOf(b), 45e18);
    }
}
