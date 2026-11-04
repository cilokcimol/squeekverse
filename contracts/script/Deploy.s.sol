// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {DawnMarket} from "../src/DawnMarket.sol";
import {Sunflower} from "../src/Sunflower.sol";
import {SeedSwap} from "../src/SeedSwap.sol";
import {ISqueekCore} from "../src/ISqueekCore.sol";

contract Deploy is Script {
    function run() external {
        ISqueekCore core = ISqueekCore(vm.envAddress("SQUEEK_CORE"));
        IERC20 sqk = IERC20(vm.envAddress("SQK_TOKEN"));
        IERC721 squeeks = IERC721(vm.envAddress("SQUEEK_NFT"));
        vm.startBroadcast();
        new DawnMarket(core, sqk);
        new Sunflower(core);
        new SeedSwap(squeeks, sqk);
        vm.stopBroadcast();
    }
}
