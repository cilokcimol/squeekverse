// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ISqueekCore} from "./ISqueekCore.sol";

/// @title Sunflower
/// @notice Plant one for free. It grows only on work the hamster settles after you planted it.
///         The art is drawn onchain each time it is read, so nothing needs a keeper or an update.
contract Sunflower is ERC721 {
    using Strings for uint256;

    /// One floret per this many work units of light, up to MAX_FLORETS. He settles about 10,000 work
    /// on a typical day, so a flower takes around nine days of real running to fill its head.
    uint256 public constant WORK_PER_FLORET = 400;
    uint256 public constant MAX_FLORETS = 233;
    /// Rounds in a day, and one leaf for each day planted, up to MAX_LEAVES.
    uint256 public constant ROUNDS_PER_LEAF = 144;
    uint256 public constant MAX_LEAVES = 12;
    /// Measured from Squeekchain's own totals: about 878 mm of running per work unit.
    uint256 public constant MM_PER_WORK = 878;

    struct Planting {
        uint64 workAtPlanting;
        uint64 roundAtPlanting;
        bytes32 seed;
    }

    ISqueekCore public immutable core;
    uint256 public totalPlanted;
    mapping(uint256 => Planting) public plantings;

    event Planted(uint256 indexed tokenId, address indexed gardener, uint64 workAtPlanting, uint64 roundAtPlanting);

    constructor(ISqueekCore core_) ERC721("Squeekverse Sunflower", "SUNFLOWER") {
        core = core_;
    }

    function plant() external returns (uint256 tokenId) {
        ISqueekCore.CoreState memory coreState = core.state();
        tokenId = ++totalPlanted;
        plantings[tokenId] = Planting({
            workAtPlanting: coreState.cumulativeWork,
            roundAtPlanting: coreState.settledThroughRound,
            seed: keccak256(abi.encode(block.prevrandao, msg.sender, tokenId))
        });
        _safeMint(msg.sender, tokenId);
        emit Planted(tokenId, msg.sender, coreState.cumulativeWork, coreState.settledThroughRound);
    }

    /// @notice Work units settled since this flower was planted.
    function lightReceived(uint256 tokenId) public view returns (uint256) {
        _requireOwned(tokenId);
        return core.state().cumulativeWork - plantings[tokenId].workAtPlanting;
    }

    /// @notice Rounds settled since planting: the flower's time on the wheel.
    function roundsOnWheel(uint256 tokenId) public view returns (uint256) {
        _requireOwned(tokenId);
        return core.state().settledThroughRound - plantings[tokenId].roundAtPlanting;
    }

    function leaves(uint256 tokenId) public view returns (uint256) {
        uint256 count = roundsOnWheel(tokenId) / ROUNDS_PER_LEAF;
        return count > MAX_LEAVES ? MAX_LEAVES : count;
    }

    /// @notice True when the newest settled round had work. The flower's sky follows this result.
    function sunIsUp() public view returns (bool) {
        uint64 settled = core.state().settledThroughRound;
        if (settled == 0) return false;
        return core.roundPage(settled - 1, settled, 1).rounds.length > 0;
    }

    function florets(uint256 tokenId) public view returns (uint256) {
        uint256 count = lightReceived(tokenId) / WORK_PER_FLORET;
        return count > MAX_FLORETS ? MAX_FLORETS : count;
    }

    /// @return 0 seed, 1 sprout, 2 bud, 3 bloom, 4 full head, 5 heavy with seed.
    function stage(uint256 tokenId) public view returns (uint8) {
        uint256 light = lightReceived(tokenId);
        if (light < 100) return 0;
        if (light < 2000) return 1;
        if (light < 10000) return 2;
        if (light < 40000) return 3;
        if (light < 93200) return 4;
        return 5;
    }

    function stageName(uint8 value) public pure returns (string memory) {
        if (value == 0) return "Seed";
        if (value == 1) return "Sprout";
        if (value == 2) return "Bud";
        if (value == 3) return "Bloom";
        if (value == 4) return "Full head";
        return "Heavy with seed";
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        uint256 light = lightReceived(tokenId);
        uint8 currentStage = stage(tokenId);
        string memory image = Base64.encode(bytes(_svg(tokenId, light, currentStage)));
        bytes memory json = abi.encodePacked(
            '{"name":"Sunflower #', tokenId.toString(),
            '","description":"Grown by a real hamster. Its head fills with work settled on SqueekCore after planting, it adds a leaf for each day on the wheel, and its sky follows his newest round.","image":"data:image/svg+xml;base64,',
            image,
            '","attributes":[{"trait_type":"Stage","value":"', stageName(currentStage),
            '"},{"trait_type":"Sky","value":"', sunIsUp() ? "Day" : "Night",
            '"},{"display_type":"number","trait_type":"Light received","value":', light.toString(),
            '},{"display_type":"number","trait_type":"Metres run","value":', ((light * MM_PER_WORK) / 1000).toString(),
            '},{"display_type":"number","trait_type":"Days on the wheel","value":', (roundsOnWheel(tokenId) / ROUNDS_PER_LEAF).toString(),
            '},{"display_type":"number","trait_type":"Florets","value":', florets(tokenId).toString(),
            '},{"display_type":"number","trait_type":"Planted after round","value":', uint256(plantings[tokenId].roundAtPlanting).toString(),
            "}]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    function svgOf(uint256 tokenId) external view returns (string memory) {
        return _svg(tokenId, lightReceived(tokenId), stage(tokenId));
    }

    function _svg(uint256 tokenId, uint256 light, uint8 currentStage) private view returns (string memory) {
        bytes32 seed = plantings[tokenId].seed;
        uint256 hue = uint256(seed) % 16 + 30; // always a sunflower yellow, each one its own
        bool night = !sunIsUp();
        string memory sky = night ? "#1a1440" : string.concat("hsl(", (200 + uint256(seed >> 8) % 40).toString(), ",70%,62%)");
        uint256 stemTop = 300 - 26 * uint256(currentStage);

        bytes memory art = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="', sky,
            '"/><path d="M0 330q200-44 400 0v70H0z" fill="#2f8f5b"/><path d="M200 340Q', (190 + uint256(seed >> 16) % 20).toString(), " 300 200 ", stemTop.toString(),
            '" stroke="#1f6b43" stroke-width="9" fill="none" stroke-linecap="round"/>'
        );
        uint256 leafCount = leaves(tokenId);
        for (uint256 i; i < leafCount; i++) {
            uint256 y = 330 - ((i + 1) * (330 - stemTop)) / (MAX_LEAVES + 2);
            art = abi.encodePacked(art, '<ellipse cx="', (i % 2 == 0 ? uint256(213) : uint256(187)).toString(), '" cy="', y.toString(), '" rx="14" ry="5" fill="#2f8f5b" transform="rotate(', (i % 2 == 0 ? "-25 " : "25 "), (i % 2 == 0 ? uint256(213) : uint256(187)).toString(), " ", y.toString(), ')"/>');
        }
        if (currentStage == 0) {
            art = abi.encodePacked(art, '<ellipse cx="200" cy="334" rx="11" ry="7" fill="#3a2a1c"/>');
        } else {
            art = abi.encodePacked(art, _head(seed, stemTop, currentStage, florets(tokenId), hue));
        }
        return string(abi.encodePacked(art, "</svg>"));
    }

    function _head(bytes32 seed, uint256 cy, uint8 currentStage, uint256 count, uint256 hue) private pure returns (bytes memory out) {
        uint256 petals = currentStage < 2 ? 0 : 13 + uint256(seed >> 32) % 13;
        uint256 radius = 18 + 12 * uint256(currentStage);
        out = abi.encodePacked('<g transform="translate(200 ', cy.toString(), ')">');
        string memory petalColor = string.concat("hsl(", (hue + 4).toString(), ",96%,56%)");
        for (uint256 i; i < petals; i++) {
            uint256 turn = (i * 3600) / petals;
            out = abi.encodePacked(
                out,
                '<ellipse cx="0" cy="-', (radius + 16).toString(), '" rx="9" ry="22" fill="', petalColor,
                '" transform="rotate(', (turn / 10).toString(), ".", (turn % 10).toString(), ')"/>'
            );
        }
        out = abi.encodePacked(out, '<circle r="', radius.toString(), '" fill="#3a2a1c"/>');
        // Golden-angle spiral, with radius proportional to sqrt(i) and sine taken from a small table.
        uint256 spacing = (radius * 100) / 16;
        for (uint256 i = 1; i <= count; i++) {
            uint256 angle = (i * 13750) % 36000; // hundredths of a degree
            uint256 r = (spacing * _sqrt(i * 100)) / 1000;
            (int256 sx, int256 sy) = _unit(angle);
            int256 x = sx * int256(r); // hundredths of a unit, because the sine is scaled to 100
            int256 y = sy * int256(r);
            out = abi.encodePacked(
                out, '<circle cx="', _signedHundredths(x), '" cy="', _signedHundredths(y),
                '" r="2.2" fill="hsl(', (hue - 8).toString(), ',92%,', (48 + (i * 3) % 30).toString(), '%)"/>'
            );
        }
        out = abi.encodePacked(out, "</g>");
    }

    function _sqrt(uint256 value) private pure returns (uint256 root) {
        root = value;
        uint256 next = (value + 1) / 2;
        while (next < root) {
            root = next;
            next = (value / next + next) / 2;
        }
    }

    /// @dev Bhaskara I's sine approximation, scaled to 100. Close enough for a drawing.
    function _unit(uint256 hundredths) private pure returns (int256 x, int256 y) {
        y = _sin(hundredths);
        x = _sin((hundredths + 9000) % 36000);
    }

    function _sin(uint256 hundredths) private pure returns (int256) {
        bool negative = hundredths >= 18000;
        int256 d = int256(negative ? hundredths - 18000 : hundredths) / 100;
        int256 value = (400 * d * (180 - d)) / (40500 - d * (180 - d));
        return negative ? -value : value;
    }

    function _signedHundredths(int256 value) private pure returns (string memory) {
        uint256 magnitude = uint256(value < 0 ? -value : value);
        return string.concat(value < 0 ? "-" : "", (magnitude / 100).toString(), ".", _two(magnitude % 100));
    }

    function _two(uint256 value) private pure returns (string memory) {
        return value < 10 ? string.concat("0", value.toString()) : value.toString();
    }
}
