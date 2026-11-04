// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {DawnMarket} from "../src/DawnMarket.sol";
import {Sunflower} from "../src/Sunflower.sol";
import {SeedSwap} from "../src/SeedSwap.sol";
import {MockCore, MockSQK, MockSqueeks} from "./Mocks.sol";

contract DawnMarketTest is Test {
    MockCore core; MockSQK sqk; DawnMarket m;
    address a = address(0xA); address b = address(0xB); address c = address(0xC);
    uint64 constant S = 110; // market start round

    function setUp() public {
        vm.warp(1_000_000 + 100 * 600); // wall clock inside round 101
        core = new MockCore(1_000_000);
        core.settle(100, 0);
        sqk = new MockSQK();
        m = new DawnMarket(core, sqk);
        for (uint i; i < 3; i++) { address u = [a, b, c][i]; sqk.mint(u, 1000e18); vm.prank(u); sqk.approve(address(m), type(uint256).max); }
        m.open(S);
    }

    function test_currentRoundMatchesDocsFormula() public view { assertEq(m.currentRound(), 101); }

    function test_openRejectsMarketThatStartsTooSoon() public {
        vm.expectRevert(DawnMarket.StartTooSoon.selector); m.open(102);
    }

    function test_openRejectsDuplicate() public {
        vm.expectRevert(DawnMarket.MarketExists.selector); m.open(S);
    }

    function test_bettingClosesWhenTheFirstRoundStarts() public {
        vm.warp(m.roundStartTime(S));
        vm.prank(a); vm.expectRevert(DawnMarket.BettingClosed.selector); m.bet(S, 0, 1e18);
    }

    function test_resolveWaitsForSettlement() public {
        vm.expectRevert(DawnMarket.NotSettledYet.selector); m.resolve(S);
    }

    function test_winnerSplitsWholePool() public {
        vm.prank(a); m.bet(S, 1, 30e18);
        vm.prank(b); m.bet(S, 1, 10e18);
        vm.prank(c); m.bet(S, 0, 60e18);
        core.addActive(S + 4); // falls in window 1 (offset 3..5)
        core.settle(S + 4, 50);
        m.resolve(S);
        (DawnMarket.Market memory info, ) = m.market(S);
        assertEq(info.winner, 1); assertFalse(info.refunding);
        vm.prank(a); assertEq(m.claim(S), 75e18);
        vm.prank(b); assertEq(m.claim(S), 25e18);
        vm.prank(c); vm.expectRevert(DawnMarket.NothingToClaim.selector); m.claim(S);
        assertEq(sqk.balanceOf(address(m)), 0);
    }

    function test_cannotClaimTwice() public {
        vm.prank(a); m.bet(S, 0, 1e18);
        core.addActive(S); core.settle(S, 1); m.resolve(S);
        vm.prank(a); m.claim(S);
        vm.prank(a); vm.expectRevert(DawnMarket.AlreadyClaimed.selector); m.claim(S);
    }

    function test_noActiveRoundNeedsWholeRangeCertified() public {
        vm.prank(a); m.bet(S, 4, 5e18);
        core.settle(S + 22, 0);
        vm.expectRevert(DawnMarket.NotSettledYet.selector); m.resolve(S);
        core.settle(S + 23, 0);
        m.resolve(S);
        (DawnMarket.Market memory info, ) = m.market(S);
        assertEq(info.winner, 4);
        vm.prank(a); assertEq(m.claim(S), 5e18);
    }

    function test_activeRoundBeforeStartIsIgnored() public {
        core.addActive(S - 1); core.addActive(S + 13); core.settle(S + 13, 1);
        m.resolve(S);
        (DawnMarket.Market memory info, ) = m.market(S);
        assertEq(info.winner, 3);
    }

    function test_refundWhenNobodyBackedTheWinner() public {
        vm.prank(a); m.bet(S, 1, 7e18); vm.prank(a); m.bet(S, 2, 3e18);
        vm.prank(b); m.bet(S, 3, 4e18);
        core.addActive(S); core.settle(S, 1); m.resolve(S);
        vm.prank(a); assertEq(m.claim(S), 10e18);
        vm.prank(b); assertEq(m.claim(S), 4e18);
    }

    function testFuzz_paysNeverExceedPool(uint96 x, uint96 y, uint8 offset) public {
        x = uint96(bound(x, 1, 500e18)); y = uint96(bound(y, 1, 500e18)); uint64 off = uint64(bound(offset, 0, 23));
        uint8 o = m.outcomeFor(S, S + off);
        vm.prank(a); m.bet(S, 0, x); vm.prank(b); m.bet(S, o, y);
        core.addActive(S + off); core.settle(S + off, 1); m.resolve(S);
        uint256 total = uint256(x) + y;
        uint256 pa = m.claimable(S, a); uint256 pb = m.claimable(S, b);
        assertLe(pa + pb, total);
    }
}

contract SunflowerTest is Test {
    MockCore core; Sunflower s; address a = address(0xA);
    function setUp() public { core = new MockCore(1); core.settle(10, 1000); s = new Sunflower(core); }

    function test_growsOnlyOnWorkAfterPlanting() public {
        vm.prank(a); uint256 id = s.plant();
        assertEq(s.lightReceived(id), 0); assertEq(s.stage(id), 0);
        core.settle(11, 4500); assertEq(s.stage(id), 2); assertEq(s.florets(id), 11);
        core.settle(12, 1000000); assertEq(s.stage(id), 5); assertEq(s.florets(id), s.MAX_FLORETS());
    }

    function test_tokenUriRendersAtEveryStage() public {
        vm.prank(a); uint256 id = s.plant();
        uint64[6] memory steps = [uint64(0), 100, 2000, 10000, 40000, 93200];
        uint64 prev;
        for (uint i; i < 6; i++) {
            core.settle(uint64(11 + i), steps[i] - prev); prev = steps[i];
            string memory uri = s.tokenURI(id);
            assertGt(bytes(uri).length, 200);
            assertEq(s.stage(id), i);
        }
    }

    function test_skyFollowsTheNewestRound() public {
        vm.prank(a); uint256 id = s.plant();
        assertFalse(s.sunIsUp());
        core.addActive(11); core.settle(11, 500);
        assertTrue(s.sunIsUp());
        assertTrue(bytes(s.svgOf(id)).length > 0);
        core.settle(12, 0);
        assertFalse(s.sunIsUp());
    }

    function test_addsALeafForEachDayOnTheWheel() public {
        vm.prank(a); uint256 id = s.plant();
        assertEq(s.leaves(id), 0);
        core.settle(10 + 144, 0); assertEq(s.leaves(id), 1); assertEq(s.roundsOnWheel(id), 144);
        core.settle(10 + 144 * 5, 0); assertEq(s.leaves(id), 5);
        core.settle(10 + 144 * 40, 0); assertEq(s.leaves(id), s.MAX_LEAVES());
    }

    function test_reverseForUnknownToken() public { vm.expectRevert(); s.tokenURI(99); }
}

contract SeedSwapTest is Test {
    MockSqueeks n; MockSQK sqk; SeedSwap sw; address a = address(0xA); address b = address(0xB); address e = address(0xE);
    function setUp() public {
        n = new MockSqueeks(); sqk = new MockSQK(); sw = new SeedSwap(n, sqk);
        n.mint(a, 1); n.mint(b, 2); sqk.mint(b, 100e18);
        vm.prank(a); n.setApprovalForAll(address(sw), true);
        vm.startPrank(b); n.setApprovalForAll(address(sw), true); sqk.approve(address(sw), type(uint256).max); vm.stopPrank();
    }
    function test_swapSqueekAndSqkAtomically() public {
        vm.prank(a); uint256 id = sw.make(1, 2, 5e18, address(0));
        assertEq(n.ownerOf(1), address(sw));
        vm.prank(b); sw.fill(id);
        assertEq(n.ownerOf(1), b); assertEq(n.ownerOf(2), a); assertEq(sqk.balanceOf(a), 5e18);
    }
    function test_emptyAskRejected() public { vm.prank(a); vm.expectRevert(SeedSwap.EmptyAsk.selector); sw.make(1, 0, 0, address(0)); }
    function test_onlyNamedTakerCanFill() public {
        vm.prank(a); uint256 id = sw.make(1, 0, 5e18, b);
        vm.prank(e); vm.expectRevert(SeedSwap.NotAllowedTaker.selector); sw.fill(id);
    }
    function test_cancelReturnsSqueekAndClosesOffer() public {
        vm.prank(a); uint256 id = sw.make(1, 0, 5e18, address(0));
        vm.prank(b); vm.expectRevert(SeedSwap.NotMaker.selector); sw.cancel(id);
        vm.prank(a); sw.cancel(id); assertEq(n.ownerOf(1), a);
        vm.prank(b); vm.expectRevert(SeedSwap.OfferClosed.selector); sw.fill(id);
    }
    function test_fillRevertsWholeWhenTakerLacksAskedSqueek() public {
        n.mint(a, 3);
        vm.prank(a); uint256 id = sw.make(1, 3, 0, address(0));
        vm.prank(b); vm.expectRevert(); sw.fill(id);
        assertEq(n.ownerOf(1), address(sw));
    }
}
