#!/bin/bash

# Aptos Contract Deployment Script
# Usage: ./scripts/deploy-aptos.sh [network] [profile]

set -e

PROFILE=${2:-default}

echo "🚀 Deploying Aptos contracts to $NETWORK..."

# Check if aptos CLI is installed
if ! command -v aptos &> /dev/null; then
    echo "❌ Aptos CLI not found. Please install it first:"
    echo "curl -fsSL \"https://aptos.dev/scripts/install_cli.py\" | python3"
    exit 1
fi

# Navigate to contracts directory
cd contracts/aptos

# Compile the contracts
echo "🔨 Compiling contracts..."
aptos move compile



echo "👤 Deploying from account: $ACCOUNT_ADDRESS"

# Fund the account if needed
echo "💰 Funding account..."
aptos account fund-with-faucet --profile $PROFILE

# Publish the package
echo "�� Publishing package..."
aptos move publish \
    --profile $PROFILE \
    --assume-yes

# echo "✅ Deployment completed successfully!"
# echo "�� Package Address: $ACCOUNT_ADDRESS"

# # Save deployment info
# DEPLOYMENT_INFO=$(cat <<EOF
# {
#   "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
#   "packageAddress": "$ACCOUNT_ADDRESS",
#   "modules": [
#     "fusion_order",
#     "escrow",
#     "resolver_registry",
#     "timelock",
#     "hashlock",
#     "constants"
#   ],
#   "deployer": "$ACCOUNT_ADDRESS"
# }
# EOF
# )

# echo "$DEPLOYMENT_INFO" > ../../deployment-info.json
# echo "📄 Deployment info saved to: deployment-info.json"

# # Update config.ts with deployed address
# cd ../..
# node -e "
# const fs = require('fs');
# const configPath = './tests/config.ts';
# let content = fs.readFileSync(configPath, 'utf8');
# content = content.replace(/fusionPackageAddress: '.*'/, \"fusionPackageAddress: '$ACCOUNT_ADDRESS'\");
# fs.writeFileSync(configPath, content);
# console.log('✅ Updated config.ts with deployed package address');
# "

echo "🎉 Deployment and configuration update completed!"