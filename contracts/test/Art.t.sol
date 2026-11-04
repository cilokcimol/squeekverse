// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {Sunflower} from "../src/Sunflower.sol";
import {MockCore} from "./Mocks.sol";

/// Writes every growth stage to disk so the art can be looked at: forge test --match-contract ArtDump --ffi is not needed.
contract ArtDump is Test {
    function test_dump() public {
        MockCore core = new MockCore(1); core.settle(1, 1000);
        Sunflower s = new Sunflower(core);
        vm.prevrandao(bytes32(uint256(123456789)));
        vm.prank(address(0xA)); uint256 id = s.plant();
        uint64[6] memory steps = [uint64(0), 900, 5000, 24000, 60000, 100000];
        uint64 prev;
        for (uint256 i; i < 6; i++) {
            core.settle(uint64(2 + i * 300), steps[i] - prev); prev = steps[i]; if (i % 2 == 1) { core.addActive(uint64(2 + i * 300)); }
            vm.writeFile(string.concat(vm.envString("ART_DIR"), "/s", vm.toString(i), ".svg"), s.svgOf(id));
        }
    }
}
