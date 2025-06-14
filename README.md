# NadFlip

[https://nadflip.com](https://nadflip.com)
NadFlip is a decentralized coinflip game deployed on the Monad Testnet. It features fair randomness using Pyth Entropy, a growing jackpot pool, live player stats, and a responsive frontend interface. This project is intended for demonstration and testing purposes only.

## Features

- Verifiable randomness through [Pyth Entropy](https://docs.pyth.network/entropy)
- Jackpot win triggered by rolling exactly 888
- Player statistics and recent flip history
- Responsive frontend with multi-wallet support via Reown AppKit
- Transparent fee structure and open smart contract logic

## How it works

Players place a bet and guess whether the roll will be high (≥500) or low (<500). When a player submits a flip:
1. A portion of the bet (currently 0.8%) is added to the jackpot pool.
2. A small dev fee (0.2%) is deducted.
3. A request is sent to Pyth Entropy for a random number.
4. Once the random number is returned, the outcome is determined.
5. If the player guessed correctly, they receive a payout based on the bet amount.
6. If the result is exactly 888, the player also receives the full jackpot.

All events are recorded on-chain and visible through the frontend UI.

## Contracts

The main contract is `NadflipPyth.sol`, located in the `contracts/` directory.  
It handles bet validation, RNG interaction, payout logic, jackpot tracking, and player stats.

Deployed address (Monad Testnet):  
[0x5E447c5588C551E9959CEc493a40b52768B3d8AE](https://testnet.monadscan.com/address/0x5e447c5588c551e9959cec493a40b52768b3d8ae)

## Frontend

The frontend is a static dApp built with vanilla JavaScript, HTML, and Reown AppKit for wallet connectivity. It includes:

- Live update of flip history and stats
- Support for WalletConnect and MetaMask

Testnet site:  
[https://nadflip.com](https://nadflip.com)

## Development

This project is licensed under the GNU AGPL v3.  
If you use or modify this project in any deployed environment, the full source code must be made available under the same license.

## License

This repository is licensed under the GNU Affero General Public License v3.0.
