// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SeedSwap
/// @notice Holder-to-holder trades of Squeeks. A maker escrows one Squeek and asks for another
///         Squeek, an SQK amount, or both. The swap settles in one transaction or not at all.
///         No owner, no fee, no upgrade path.
contract SeedSwap is ERC721Holder, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Offer {
        address maker;
        uint96 askSqk;
        address taker; // zero means anyone
        uint256 giveSqueek;
        uint256 askSqueek; // zero means none; Squeek ids start at 1
        bool open;
    }

    IERC721 public immutable squeeks;
    IERC20 public immutable sqk;
    uint256 public offerCount;
    mapping(uint256 => Offer) public offers;

    event OfferMade(uint256 indexed id, address indexed maker, uint256 indexed giveSqueek, uint256 askSqueek, uint96 askSqk, address taker);
    event OfferCancelled(uint256 indexed id);
    event OfferFilled(uint256 indexed id, address indexed taker);

    error EmptyAsk();
    error OfferClosed();
    error NotMaker();
    error NotAllowedTaker();

    constructor(IERC721 squeeks_, IERC20 sqk_) {
        squeeks = squeeks_;
        sqk = sqk_;
    }

    /// @notice Needs `approve` on the Squeek first.
    function make(uint256 giveSqueek, uint256 askSqueek, uint96 askSqk, address taker) external nonReentrant returns (uint256 id) {
        if (askSqueek == 0 && askSqk == 0) revert EmptyAsk();
        id = ++offerCount;
        offers[id] = Offer({maker: msg.sender, askSqk: askSqk, taker: taker, giveSqueek: giveSqueek, askSqueek: askSqueek, open: true});
        squeeks.safeTransferFrom(msg.sender, address(this), giveSqueek);
        emit OfferMade(id, msg.sender, giveSqueek, askSqueek, askSqk, taker);
    }

    function cancel(uint256 id) external nonReentrant {
        Offer storage offer = offers[id];
        if (!offer.open) revert OfferClosed();
        if (offer.maker != msg.sender) revert NotMaker();
        offer.open = false;
        squeeks.safeTransferFrom(address(this), msg.sender, offer.giveSqueek);
        emit OfferCancelled(id);
    }

    /// @notice Needs approval for whatever the offer asks for.
    function fill(uint256 id) external nonReentrant {
        Offer storage offer = offers[id];
        if (!offer.open) revert OfferClosed();
        if (offer.taker != address(0) && offer.taker != msg.sender) revert NotAllowedTaker();
        offer.open = false;
        if (offer.askSqk > 0) sqk.safeTransferFrom(msg.sender, offer.maker, offer.askSqk);
        if (offer.askSqueek != 0) squeeks.safeTransferFrom(msg.sender, offer.maker, offer.askSqueek);
        squeeks.safeTransferFrom(address(this), msg.sender, offer.giveSqueek);
        emit OfferFilled(id, msg.sender);
    }
}
