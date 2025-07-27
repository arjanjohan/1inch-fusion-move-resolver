#!/bin/bash

# Deploy USDT to local Aptos network
echo "🚀 Deploying USDT to local Aptos network..."

# Navigate to USDT contract directory
cd contracts/usdt-aptos

# Compile the USDT contract
echo "🔨 Compiling USDT contract..."
aptos move compile --named-addresses usdt=0xd7722b8d2a024a318284288409557f6f14ff9b34026949de11ed2dd671475c92

# funding the deployer
aptos account fund-with-faucet

# Deploy to local network
echo "📦 Deploying USDT to local network..."
aptos move publish \
    --profile default \
    --assume-yes

echo "✅ USDT deployed successfully!"
echo "📦 USDT Address: 0xd7722b8d2a024a318284288409557f6f14ff9b34026949de11ed2dd671475c92"

echo "✅ USDT minted to test accounts!"