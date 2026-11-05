# Squeekverse

A tiny planet whose sun only rises when a real hamster runs. Built on [Squeekchain](https://squeekchain.com) for the Genesis Code lane. An independent community project, not an official product. Everything onchain runs on the Sepolia test network, where tokens have no monetary value.

The wheel really sets the world. Its sensor drives the planet's spin and the speed of the sun, and about 83% of settled rounds so far have no work at all, so night is the normal state here. Day comes when he decides.

## What you can do

**Night shift.** A 3D survival game. Hold your lantern over 18 sunflowers through a 75 second night. The wave is seeded from the current round and the newest settled data hash, so everyone in a round faces the same night. While he is really running, your lantern charges faster and throws a wider circle.

**Call the dawn.** Pick the round he wakes or stops, against the Almanac, a small statistical model retrained on every settled round. Its walk forward test result is shown on the page as measured. It remembers each player and greets them by their record.

**The raid.** A weekly boss whose health is real kilometres, sized from his pace the week before. Only his distance can hurt it. Crews compete on shift score. A bot posts sunrises to Discord and answers `/sky`, `/raid`, `/almanac` and `/top` in Telegram.

**The Almanac.** A living story with one entry for each real day and night. Each running session also presses a flower: one floret per magnet pass, with petals showing his pace through the run.

**Greenhouse.** `Sunflower` is a free NFT drawn fully onchain. Settled work fills its head over about nine days of real running, it adds a leaf for each day on the wheel, and its sky is day only when his newest settled round had work.

**Dawn market.** `DawnMarket` is a parimutuel SQK market on when his next active round lands. Nobody reports the result. `resolve` reads it from SqueekCore.

**Deep night.** A harder shift for wallets that hold a Squeek. The level of their best Squeek widens the lantern.

**The barn.** Claim, stake, unstake, deposit, withdraw and merge, all signed in your own wallet. Name your Squeeks and show them in the hall. `SeedSwap` trades Squeeks between holders in one transaction.

**Radio mast.** The stream, a second screen with block progress, round timer and milestones, and an OBS overlay builder with a transparent background.

## Contracts on Sepolia

| Contract | Address |
| --- | --- |
| DawnMarket | `0x4879838503c962f328fbbb4e57d1e624560cd0d9` |
| Sunflower | `0xa88d17fb28540e2eee74abee22f43864d3fedb7e` |
| SeedSwap | `0x1ea3dc865dd62dbe99568999a1b348308d25ea68` |

None of them has an owner, a fee or an upgrade path. They read the live Squeekchain deployment, whose addresses are in `shared/chain.ts`. Those match `api.squeekchain.com` and the official app at `sepolia.squeekchain.com`. The record in the Squeekchain docs still lists an earlier deployment, and the staking functions are taken from the official app because the docs have not published them yet.

## Run it

```sh
npm install
npm run dev        # the site
npm run server     # the shared server, on port 8787
npm test           # game and model logic
npm run build
```

The site is a static export in `dist/`, so it runs from IPFS with no server. Without a server, scores and calls stay on the player's device. To share them, host the server and build with `VITE_API_URL` set to its address.

The server is one Node process with SQLite (`Dockerfile`, `render.yaml`). All of these are optional: `TELEGRAM_BOT_TOKEN`, `DISCORD_WEBHOOK_URL`, `LLM_API_KEY` for model written Almanac lines, `PUBLIC_SITE_URL`, `DB_PATH`. On hosts without a persistent disk the shared data resets when the server restarts.

## Tests

```sh
npm test
cd contracts && forge test --no-match-contract ForkTest
forge test --match-contract ForkTest --fork-url <sepolia rpc>
```

`tests/e2e.mjs` drives the real site in a browser against a local fork of Sepolia: claim, stake, unstake, merge, withdraw, plant, bet, offer and cancel. `tests/sim.mjs` plays whole shifts to check the game's balance.

## Limits

Shift scores come from the player's browser, so they are capped and bounds checked on the server but not proven. They are worth bragging rights only. Seeds have no value and cannot leave the game.

squeekchain-project: 99fdf3de-b452-46fc-a121-6dea88aa6f18
