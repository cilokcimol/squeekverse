// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ISqueekCore} from "../src/ISqueekCore.sol";

contract MockSQK is ERC20("Squeek", "SQK") { function mint(address to, uint256 a) external { _mint(to, a); } }
contract MockSqueeks is ERC721("Squeek", "SQUEEK") { function mint(address to, uint256 id) external { _mint(to, id); } }

/// Behaves like SqueekCore's roundPage: active rounds only, may stop short at the record budget.
contract MockCore is ISqueekCore {
    uint64 public frontier;
    uint64 public work;
    uint64[] public activeRounds;
    uint64 public immutable genesis;
    constructor(uint64 g) { genesis = g; }
    function settle(uint64 through, uint64 addedWork) external { frontier = through; work += addedWork; }
    function addActive(uint64 r) external { activeRounds.push(r); }
    function state() external view returns (CoreState memory s) { s.settledThroughRound = frontier; s.cumulativeWork = work; }
    function configuration() external view returns (CoreConfiguration memory c) { c.genesisTimestamp = genesis; c.roundDuration = 600; }
    function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords) external view returns (RoundPage memory p) {
        require(throughRound <= frontier && throughRound >= afterRound, "bounds");
        uint256 n;
        for (uint256 i; i < activeRounds.length; i++) if (activeRounds[i] > afterRound && activeRounds[i] <= throughRound) n++;
        uint256 take = n < maxRecords ? n : maxRecords;
        p.rounds = new RoundCheckpoint[](take);
        uint256 k; p.certifiedThroughRound = throughRound;
        for (uint256 i; i < activeRounds.length; i++) {
            if (activeRounds[i] > afterRound && activeRounds[i] <= throughRound) {
                if (k == take) { p.certifiedThroughRound = activeRounds[i] - 1; break; }
                p.rounds[k++].roundId = activeRounds[i];
            }
        }
    }
}
