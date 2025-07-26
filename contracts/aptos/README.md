# Cross-Chain Atomic Swap Protocol

A secure cross-chain atomic swap protocol built on Aptos that enables trustless asset swaps across different blockchains. This is the Aptos implementation of the [1inch Fusion Plus](https://github.com/1inch/cross-chain-swap) protocol.

## Overview

The protocol enables secure cross-chain swaps through a combination of hacklocked and timelocked escrows. It consists of several key components:

### Core Components

1. **Locked Assets (`locked_asset.move`)**
   - Escrow mechanism for locking assets
   - Timelock-based phase management
   - Hashlock-based secret verification
   - Asset withdrawal and cancellation logic

2. **Fusion Orders (`fusion_order.move`)**
   - Cross-chain order management
   - Escrow creation and management
   - Integration with resolver registry

3. **Resolver Registry (`resolver_registry.move`)**
   - Resolver registration and status management
   - Access control for resolvers
   - Admin functions for resolver management

### Timelock Phases

![Timelocks](../timelocks.png)

1. **Finality Phase**
   - Initial period where settings can be modified
   - Recipient can be set or updated

2. **Exclusive Phase**
   - Only intended recipient can claim assets
   - Requires valid secret for withdrawal

3. **Cancellation Phase**
   - Owner can cancel and reclaim assets
   - Requires no prior withdrawal

4. **Public Phase**
   - Anyone with the correct secret can claim
   - Anyone can cancel if not claimed

## Project Structure

```
aptos-contracts/
├── sources/                # Move smart contracts
│   ├── locked_asset.move  # Asset escrow and locking
│   ├── fusion_order.move  # Order management
│   ├── resolver_registry.move # Resolver management
│   ├── timelock.move      # Phase management
│   └── hashlock.move      # Secret verification
├── tests/                 # Contract tests
└── Move.toml             # Project configuration
```

## Requirements

Before you begin, you need to install the following tools:

- [Aptos CLI](https://aptos.dev/tools/aptos-cli/)
- [Move Prover](https://aptos.dev/tools/install-move-prover/)

## Quickstart

1. Build the project:
```bash
aptos move compile
```

2. Run tests:
```bash
aptos move test
```

3. Deploy the contracts:
```bash
aptos move publish --named-addresses fusion_plus=YOUR_ACCOUNT_ADDRESS
```

## Usage

<!-- TODO: Replace this with user friendly scripts -->


## TODO

- Implement Aptos as destination chain
- Implement Aptos as source chain
- Partial fills
- Full test coverage

## Team

Built during the 1inch & ETHGlobal Unite DeFi hackathon by:
- [arjanjohan](https://x.com/arjanjohan/)
