# Move United - Cross-Chain Atomic Swap Protocol

<div align="center">

![Logo](https://github.com/arjanjohan/1inch-fusion-move-contracts/blob/master/assets/new_logo.png)
<h4 align="center">
  <a href="contracts/aptos/README.md">Smart Contracts</a> |
  <a href="tests/main.spec.ts">E2E Tests</a>
</h4>
</div>

Move United is a comprehensive cross-chain swap protocol that enables secure asset transfers between any EVM and Aptos blockchain. The protocol uses a combination of hashlock/timelock mechanisms and Dutch auctions to ensure atomic cross-chain swaps. This is the Aptos implementation of the [1inch Fusion Plus](https://github.com/1inch/cross-chain-swap) protocol.

For the Aptos Move smart contracts documentation, please see the [contracts/aptos/README.md](contracts/aptos/README.md) in this repository.

## 🏗️ Project Overview

This project implements the [1inch Fusion Plus](https://github.com/1inch/cross-chain-swap) protocol for Aptos, extending cross-chain swap capabilities to the Move ecosystem. The protocol consists of:

- **Existing Ethereum Smart Contracts**: EscrowFactory and Resolver contracts for source chain operations
- **New Aptos Move Modules**: Dutch auctions, fusion orders, escrow, hashlock, and timelock modules
- **Integration Tests**: End-to-end cross-chain swap testing between Ethereum and Aptos

## Requirements

Before you begin, you need to install the following tools:

- [Node.js (>= v18.17)](https://nodejs.org/en/download/)
- [pnpm](https://pnpm.io/installation)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for Ethereum smart contracts)
- [Aptos CLI](https://aptos.dev/tools/aptos-cli/)

## Quickstart

1. **Install dependencies**
```bash
pnpm install
```

2. **Deploy Aptos Contracts**
The contracts are live on testnet, but if you want to deploy your own instance use these commands:
```bash
cd contracts/aptos
aptos init --profile fusion_plus
aptos move compile
aptos move publish --profile fusion_plus --named-addresses fusion_plus=YOUR_ACCOUNT_ADDRESS
```

3. **Deploy USDT Contract**
A simple token contract to mint some FungibleAssets for testing.
```bash
cd contracts/usdt-aptos
aptos init --profile aptos_usdt
aptos move compile
aptos move publish --profile aptos_usdt --named-addresses fusion_plus=YOUR_ACCOUNT_ADDRESS
```

4. **Configure Environment**
```bash
# Set up your environment variables in tests/aptos/setup.ts
export SRC_CHAIN_RPC=YOUR_ETH_FORK_URL
export DST_CHAIN_RPC=YOUR_ETH_FORK_URL
```

5. **Run Tests**
```bash
pnpm test
```

## 🔄 Cross-Chain Swap Flow

### ETH → APT Flow (Dutch Auction)
1. **User creates Dutch auction** on Aptos with decaying price
2. **Resolver fills auction** by deploying destination escrow
3. **Resolver creates source escrow** on Ethereum using SDK
4. **Resolver withdraws** from both escrows using shared secret
5. **Resolver withdraws source escrow** on Ethereum to resolver account
6. **Resolver withdraws destination escrow** on Aptos to user account

### APT → ETH Flow (Fusion Order)
1. **User creates fusion order** on Aptos with resolver whitelist
2. **Resolver accepts order** by deploying source escrow
3. **Resolver creates destination escrow** on Ethereum
4. **Resolver withdraws source escrow** on Aptos to resolver account
5. **Resolver withdraws destination escrow** on Ethereum to user account

## 🧪 Testing

### Test Results
```
 PASS  tests/main.spec.ts (101.171 s)
  Resolving example
    ETH -> APT Fill
      ✓ should swap Ethereum USDC -> Aptos USDT. Single fill only (14677 ms)
      ✓ should swap Ethereum USDC -> Aptos USDT. Single fill after decreased (20144 ms)
      ✓ should swap Ethereum USDC -> Aptos USDT. Multiple fills. Fill 100% (13984 ms)
      ✓ should swap Ethereum USDC -> Aptos USDT. Multiple fills. Fill 50% (13965 ms)
    APT -> ETH Fill
      ✓ should swap Aptos USDT -> Ethereum USDC. Single fill only (13865 ms)
    Cancel
      ✓ should cancel swap Ethereum USDC -> Aptos USDT (17681 ms)

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
```


## 🧪 Testing

### Local Accounts

The tests use the following accounts for local testing:

#### EVM
```
(0) 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" Owner of EscrowFactory
(1) 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" User
(2) 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" Resolver
```
#### APTOS
```
(0) ed25519-priv-0xb2ff597cbff60622a6984341f91a732399eb2e08cc9e9a29b4621c36eb537cd8: "0x5f28002a709921a3bad09df582cdd99a7cab3ec300e99c88fbf50a354e62973b" Fusion
(1) ed25519-priv-0xadf44a11ae912a9a811a784627f709f7b0d31c7328fe8795840140c6595c4536: "0xd7722b8d2a024a318284288409557f6f14ff9b34026949de11ed2dd671475c92" USDT
(2) ed25519-priv-0x141d138b003e1049f285eb2e05ec18f537d8fb61e5bc873263b688b1dd85f10c: "0x38edf36a736e0d284fdf504a5e6fccfe229240aaf0bd7f5eec4504bfbf291028" Resolver
(3) ed25519-priv-0x13e2b05956b9297849c722bff496bc2a068a709b685fc758234a23a8bddfea95: "0x2709c26cf4a2596f10aed0b6533be35a70090372793c348c317ca2ce8c66f0d3" User
```

### Public RPC Endpoints

| Chain    | URL                                       |
|----------|-------------------------------------------|
| Ethereum | https://eth.merkle.io                     |
| BSC      | wss://bsc-rpc.publicnode.com              |
| Aptos    | https://fullnode.testnet.aptoslabs.com    |
| Movement | https://faucet.testnet.movementinfra.xyz/ |

## Next Steps

The Move United implementation is complete with all core Fusion+ functionality. However, several enhancements are planned:

- **Frontend integration** - Aptos needs to be integrated in the 1inch frontend
- **Sponsored Transactions** - Gasless experience on Aptos by using  sponsored transactions. More details [here](https://aptos.dev/build/guides/sponsored-transactions).
- **1inch SDK Integration** - Currently the 1inch SDK does not support Aptos


## Hackathon bounties

### Extend Fusion+ to Aptos

This submission is an implementation of 1inch Fusion+ built with Aptos Move. One of the main differences between Move and EVM is that everything in Move is owned, unlike EVM where contracts can transfer user funds with prior approval. This means that the resolver cannot directly transfer the user's funds to the escrow on behalf of the user.

I solved this ownership challenge by implementing a two-step process: users first deposit funds via the `fusion_order.move` module into a `FusionOrder` object, that only the user and the `Escrow` module can interact with. The resolver can then withdraw with these pre-deposited funds when creating the escrow (only via the `Escrow` module). This maintains Move's security model while enabling the Fusion+ workflow.

Until the resolver picks up the order, the user retains full control and can withdraw their funds from the `FusionOrder` at any time, effectively cancelling their order. This provides users with the same flexibility as the EVM version while respecting Move's ownership principles. Optionally, a user can allow a resolver to cancel a stale `FusionOrder` on his behalf by defining a timestamp. This will cost the user his safety deposit, but ensures his stale order will be returned to him after the timestamp.

Besides this, my implementation closely follows the EVM version's architecture, with everything divided into separate modules for clarity and readability: `fusion_order.move` handles order creation on source chain, `escrow.move` manages asset with a timelock and hashlock, and `dutch_auction.move` manages price discovery for destination chain.

- [Deployed smart contracts on Aptos Testnet](https://explorer.aptoslabs.com/account/0x0e6067afa8c1ca1b0cc486ec2a33ef65c3d8678b67ce9f1e4995fddae63cd25b/modules/packages/fusion_plus?network=testnet)
- [Resolver transactions on Aptos Testnet](https://explorer.aptoslabs.com/account/0x55bb788452c5b9489c13c39a67e3588b068b4ae69141de7d250aa0c6b1160842?network=testnet)
- [EVM transactions on Tenderly](https://virtual.mainnet.eu.rpc.tenderly.co/7a11fb86-a4e6-4390-8fdd-d5e99903eb5d)

### Extend Fusion+ to Any Other Chain
Since Movement uses the same smart contract language (although a differnt version), I also deployed the contracts to Movement Network. In [a separate branch](https://github.com/arjanjohan/1inch-fusion-move-contracts/tree/movement) the store the Movement specific `Move.toml` changes and some syntax modifications to work with the older Move 1 language version..

- [Deployed smart contracts on Movement Testnet](https://explorer.movementnetwork.xyz/account/0x0e6067afa8c1ca1b0cc486ec2a33ef65c3d8678b67ce9f1e4995fddae63cd25b/modules/packages/fusion_plus?network=bardock+testnet)
- [Resolver transactions on Movement Testnet](https://explorer.movementnetwork.xyz/account/0x55bb788452c5b9489c13c39a67e3588b068b4ae69141de7d250aa0c6b1160842?network=bardock+testnet)

## Links

- [Smart Contracts README.md](contracts/aptos/README.md)
- [E2E Tests](tests/main.spec.ts)
- [Aptos E2E Configuration](tests/aptos/setup.ts)
- [Deployed smart contracts on Aptos Testnet](https://explorer.aptoslabs.com/account/0x0e6067afa8c1ca1b0cc486ec2a33ef65c3d8678b67ce9f1e4995fddae63cd25b/modules/packages/fusion_plus?network=testnet)
- [Resolver transactions on Aptos Testnet](https://explorer.aptoslabs.com/account/0x55bb788452c5b9489c13c39a67e3588b068b4ae69141de7d250aa0c6b1160842?network=testnet)
- [EVM transactions on Tenderly](https://virtual.mainnet.eu.rpc.tenderly.co/7a11fb86-a4e6-4390-8fdd-d5e99903eb5d)
- [Deployed smart contracts on Movement Testnet](https://explorer.movementnetwork.xyz/account/0x0e6067afa8c1ca1b0cc486ec2a33ef65c3d8678b67ce9f1e4995fddae63cd25b/modules/packages/fusion_plus?network=bardock+testnet)
- [Resolver transactions on Movement Testnet](https://explorer.movementnetwork.xyz/account/0x55bb788452c5b9489c13c39a67e3588b068b4ae69141de7d250aa0c6b1160842?network=bardock+testnet)

## Team

Built during the 1inch & ETHGlobal Unite DeFi hackathon by:

<div>
  <img src="contracts/aptos/assets/milady.jpg" alt="Logo" width="120" height="120" style="border-radius: 50%; object-fit: cover; ">

  - [arjanjohan](https://x.com/arjanjohan/)
</div>
