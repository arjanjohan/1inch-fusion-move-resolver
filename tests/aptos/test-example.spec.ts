import {keccak256} from 'ethers'

import { expect, jest } from '@jest/globals'
import { Aptos, Network, AptosConfig, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk'
import { ACCOUNTS, createAccount, NETWORK_CONFIG } from './setup'
import { FungibleAssetsHelper } from './helpers/fungible-assets'
import { EscrowHelper } from './helpers/escrow'
import { HashlockHelper } from './helpers/hashlock'
import { FusionOrderHelper } from './helpers/fusion-order'
import { ResolverRegistryHelper } from './helpers/resolver-registry'
import { DeploymentHelper } from './helpers/deployment'

jest.setTimeout(1000 * 60)

describe('Aptos Cross-Chain Swap', () => {
    let fungibleHelper: FungibleAssetsHelper
    let escrowHelper: EscrowHelper
    let hashlockHelper: HashlockHelper
    let fusionOrderHelper: FusionOrderHelper
    let resolverRegistryHelper: ResolverRegistryHelper
    let userAccount: Account
    let resolverAccount: Account
    let client: Aptos

    let usdtMetadata: string

    beforeAll(async () => {
        // Initialize Aptos client
        const aptosConfig = new AptosConfig({
            network: NETWORK_CONFIG.network,
            // fullnode: NETWORK_CONFIG.rpcUrl,
            // faucet: NETWORK_CONFIG.faucetUrl,
        });
        client = new Aptos(aptosConfig)

        // Check and deploy contracts if needed
        const deploymentHelper = new DeploymentHelper()
        await deploymentHelper.ensureContractsDeployed()

        // Initialize helpers
        fungibleHelper = new FungibleAssetsHelper()
        escrowHelper = new EscrowHelper()
        hashlockHelper = new HashlockHelper()
        fusionOrderHelper = new FusionOrderHelper()
        resolverRegistryHelper = new ResolverRegistryHelper()
        usdtMetadata = await fungibleHelper.getUsdtMetadata()

        // Create accounts (you'll need to provide private keys)
        userAccount = createAccount(ACCOUNTS.USER.privateKey)
        resolverAccount = createAccount(ACCOUNTS.RESOLVER.privateKey)

        console.log('🔧 Fauceting APT to accounts...')
        await client.faucet.fundAccount({
            accountAddress: userAccount.accountAddress.toString(),
            amount: 100_000_000 // 1 APT
        });
        await client.faucet.fundAccount({
            accountAddress: resolverAccount.accountAddress.toString(),
            amount: 100_000_000 // 1 APT
        });

        console.log('🔧 Migrating APT to FungibleStore for accounts...')
            await fungibleHelper.migrateAptosCoinToFungibleStore(
                userAccount
            )
            await fungibleHelper.migrateAptosCoinToFungibleStore(
                resolverAccount
            )
    })

    it('should faucet tokens to user and check USDT balances', async () => {
        // First, faucet some APT to the user account
        console.log('🔧 Fauceting APT to user at address', ACCOUNTS.USER.address)
        console.log('🔧 Fauceting APT to user at address', userAccount.accountAddress.toString())
        await client.faucet.fundAccount({
            accountAddress: userAccount.accountAddress.toString(),
            amount: 100_000_000 // 1 APT
        });

        // Check APT balance using primary_fungible_store
        const aptBalance = await fungibleHelper.getBalance(
            userAccount.accountAddress.toString(),
            '0xa' // APT metadata address
        )
        console.log(`User APT balance: ${aptBalance}`)
        // if (aptBalance === BigInt(0)) {
        //     console.log('🔧 Migrating APT to FungibleStore...')
        //     await fungibleHelper.migrateAptosCoinToFungibleStore(
        //         userAccount
        //     )
        // }
        expect(aptBalance).toBeGreaterThan(BigInt(0))

        // Faucet USDT to the user using the USDT metadata address
        console.log('🪙 Fauceting USDT to user account...')
        const usdtAccount = createAccount(ACCOUNTS.USDT.privateKey)
        await fungibleHelper.faucetToAddress(
            usdtAccount,
            userAccount.accountAddress.toString(),
            BigInt(1000_000_000) // 1000 USDT (6 decimals)
        );

        console.log('🪙 USDT metadata:', usdtMetadata)

        // Check USDT balance using the USDT metadata address
        const usdtBalance = await fungibleHelper.getBalance(
            userAccount.accountAddress.toString(),
            usdtMetadata
        )

        console.log(`User USDT balance: ${usdtBalance}`)
        expect(usdtBalance).toBeGreaterThan(BigInt(0))
    })

    it('should create a simple fusion order', async () => {
        // Faucet APT to user account
        console.log('🔧 Fauceting APT to user account...')
        await client.faucet.fundAccount({
            accountAddress: userAccount.accountAddress.toString(),
            amount: 100_000_000 // 1 APT (8 decimals)
        });


        // Faucet USDT to resolver using the USDT metadata address
        console.log('🪙 Fauceting USDT to resolver account...')
        const usdtAccount = createAccount(ACCOUNTS.USDT.privateKey)
        await fungibleHelper.faucetToAddress(
            usdtAccount,
            ACCOUNTS.RESOLVER.address,
            BigInt(1000_000_000) // 1000 USDT
        );

        // Create a simple fusion order using metadata addresses
        console.log('📝 Creating fusion order...')
        const makerAsset = usdtMetadata // USDT metadata address
        const takerAsset = '0xa' // APT metadata address
        const makerAmount = BigInt(1_000_000) // 1 USDT
        const takerAmount = BigInt(10_000_000) // 10 APT
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour from now

        const chain_id = BigInt(1)
        const secret = '0x1234567890'
        const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
        const hash = new Uint8Array(Buffer.from(keccak256(secret).slice(2), 'hex'))
        const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
        const finality_duration = BigInt(5) // 5 seconds
        const exclusive_duration = BigInt(5) // 5 seconds
        const private_cancellation_duration = BigInt(5) // 5 seconds

        const orderResult = await fusionOrderHelper.createOrder(
            userAccount,
            order_hash,
            hash,
            makerAsset,
            makerAmount,
            safety_deposit_amount,
            finality_duration,
            exclusive_duration,
            private_cancellation_duration
        );

        console.log(`✅ Fusion order created! Transaction: ${orderResult.txHash}`)
        console.log(`📦 Order address: ${orderResult.orderAddress}`)
        expect(orderResult.txHash).toBeDefined()
        expect(orderResult.orderAddress).toBeDefined()
        expect(orderResult.orderAddress).not.toBe('')

        console.log('🎉 Fusion order creation test completed!')
    })

    it('should create escrow from order and withdraw', async () => {
        // Check if resolver is active
        let isActive = await resolverRegistryHelper.isResolverActive(ACCOUNTS.RESOLVER.address)

        if (!isActive) {
            // First, register the resolver using the FUSION account
            console.log('🔧 Registering resolver in registry...')
            const fusionAccount = createAccount(ACCOUNTS.FUSION.privateKey)
            await resolverRegistryHelper.registerResolver(
                fusionAccount,
                ACCOUNTS.RESOLVER.address
            );
        }

        isActive = await resolverRegistryHelper.isResolverActive(ACCOUNTS.RESOLVER.address)
        console.log(`🔧 Resolver active status: ${isActive}`)
        expect(isActive).toBe(true)

        // Create a fusion order first
        console.log('📝 Creating fusion order for escrow test...')
        const makerAsset = usdtMetadata // USDT metadata address
        const makerAmount = BigInt(1_000_000) // 1 USDT
        const chain_id = BigInt(1)
        const secret = '0x1234567890'
        const secretBytes = new Uint8Array(Buffer.from(secret.startsWith('0x') ? secret.slice(2) : secret, 'hex'))
        const secretHash = await hashlockHelper.createHashFromSecret(secretBytes)
        const secretHashBytes = new Uint8Array(Buffer.from(secretHash.startsWith('0x') ? secretHash.slice(2) : secretHash, 'hex'))
        const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
        const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
        const finality_duration = BigInt(5) // 5 seconds
        const exclusive_duration = BigInt(5) // 5 seconds
        const private_cancellation_duration = BigInt(5) // 5 seconds

        const orderResult = await fusionOrderHelper.createOrder(
            userAccount,
            order_hash,
            secretHashBytes,
            makerAsset,
            makerAmount,
            safety_deposit_amount,
            finality_duration,
            exclusive_duration,
            private_cancellation_duration
        );

        console.log(`✅ Fusion order created! Order address: ${orderResult.orderAddress}`)
        expect(orderResult.orderAddress).toBeDefined()
        expect(orderResult.orderAddress).not.toBe('')


        // Create escrow from the fusion order
        console.log('🔒 Creating escrow from fusion order...')
        const escrowResult = await escrowHelper.createEscrowFromOrder(
            resolverAccount,
            orderResult.orderAddress
        );

        console.log(`✅ Escrow created! Escrow address: ${escrowResult.escrowAddress}`)
        expect(escrowResult.escrowAddress).toBeDefined()
        expect(escrowResult.escrowAddress).not.toBe('')

        // Wait for the escrow to be processed
        await new Promise(resolve => setTimeout(resolve, 6000));

        // Withdraw from escrow using the secret
        console.log('💰 Withdrawing from escrow...')
        const withdrawTxHash = await escrowHelper.withdrawFromEscrow(
            resolverAccount,
            escrowResult.escrowAddress,
            secret
        );

        console.log(`✅ Withdrawal successful! Transaction: ${withdrawTxHash}`)
        expect(withdrawTxHash).toBeDefined()

        console.log('🎉 Complete escrow flow test completed!')
    })


    it('should create escrow from resolver', async () => {
        // Check if resolver is active
        let isActive = await resolverRegistryHelper.isResolverActive(ACCOUNTS.RESOLVER.address)

        if (!isActive) {
            // First, register the resolver using the FUSION account
            console.log('🔧 Registering resolver in registry...')
            const fusionAccount = createAccount(ACCOUNTS.FUSION.privateKey)
            await resolverRegistryHelper.registerResolver(
                fusionAccount,
                ACCOUNTS.RESOLVER.address
            );
        }

        isActive = await resolverRegistryHelper.isResolverActive(ACCOUNTS.RESOLVER.address)
        console.log(`🔧 Resolver active status: ${isActive}`)
        expect(isActive).toBe(true)

        // Create a fusion order first
        console.log('📝 Creating fusion order for escrow test...')
        const makerAsset = usdtMetadata // USDT metadata address
        const makerAmount = BigInt(1_000_000) // 1 USDT
        const chain_id = BigInt(1)
        const secret = '0x1234567890'
        const secretBytes = new Uint8Array(Buffer.from(secret.startsWith('0x') ? secret.slice(2) : secret, 'hex'))
        const secretHash = await hashlockHelper.createHashFromSecret(secretBytes)
        const secretHashBytes = new Uint8Array(Buffer.from(secretHash.startsWith('0x') ? secretHash.slice(2) : secretHash, 'hex'))
        const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
        const taker = userAccount.accountAddress.toString()
        const safety_deposit_amount = BigInt(10_000) // 0.0001 APT
        const finality_duration = BigInt(5) // 5 seconds
        const exclusive_duration = BigInt(5) // 5 seconds
        const private_cancellation_duration = BigInt(5) // 5 seconds

        const escrowResult = await escrowHelper.createEscrowFromResolver(
            resolverAccount,
            order_hash,
            secretHashBytes,
            taker,
            makerAsset,
            makerAmount,
            safety_deposit_amount,
            finality_duration,
            exclusive_duration,
            private_cancellation_duration
        );


        console.log(`✅ Escrow created! Escrow address: ${escrowResult.escrowAddress}`)
        expect(escrowResult.escrowAddress).toBeDefined()
        expect(escrowResult.escrowAddress).not.toBe('')

        // Verify the secret before withdrawing
        console.log('🔍 Verifying secret before withdrawal...')
        const isSecretValid = await escrowHelper.verifySecret(
            escrowResult.escrowAddress,
            secretBytes
        );

        console.log(`🔍 Secret verification result: ${isSecretValid}`)
        expect(isSecretValid).toBe(true)

        // wait for 10 seconds before withdrawing
        await new Promise(resolve => setTimeout(resolve, 6000));

        // Withdraw from escrow using the secret
        console.log('💰 Withdrawing from escrow...')
        const withdrawTxHash = await escrowHelper.withdrawFromEscrow(
            resolverAccount,
            escrowResult.escrowAddress,
            secretBytes
        );

        console.log(`✅ Withdrawal successful! Transaction: ${withdrawTxHash}`)
        expect(withdrawTxHash).toBeDefined()

        console.log('🎉 Complete escrow flow test completed!')
    })
})