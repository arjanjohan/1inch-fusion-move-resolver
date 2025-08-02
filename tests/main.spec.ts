import 'dotenv/config'
import {expect, jest} from '@jest/globals'
import { Aptos, Account } from '@aptos-labs/ts-sdk'

import {createServer, CreateServerReturnType} from 'prool'
import {anvil} from 'prool/instances'

import Sdk from '@1inch/cross-chain-sdk'
import {
    computeAddress,
    Contract,
    ContractFactory,
    JsonRpcProvider,
    MaxUint256,
    parseEther,
    parseUnits,
    randomBytes,
    Wallet as SignerWallet
} from 'ethers'
import {uint8ArrayToHex, UINT_40_MAX} from '@1inch/byte-utils'
import assert from 'node:assert'
import {ChainConfig, config} from './config'
import {Wallet} from './wallet'
import {Resolver} from './resolver'
import {EscrowFactory} from './escrow-factory'
import factoryContract from '../dist/contracts/TestEscrowFactory.sol/TestEscrowFactory.json'
import resolverContract from '../dist/contracts/Resolver.sol/Resolver.json'

// Aptos imports
import { ACCOUNTS as APTOS_ACCOUNTS, createAptosClient, createAccount } from './aptos/setup'
import { FungibleAssetsHelper } from './aptos/helpers/fungible-assets'
import { EscrowHelper } from './aptos/helpers/escrow'
import { HashlockHelper } from './aptos/helpers/hashlock'
import { FusionOrderHelper } from './aptos/helpers/fusion-order'
import { DutchAuctionHelper } from './aptos/helpers/dutch-auction'
import { TimelockHelper } from './aptos/helpers/timelock'
import { DeploymentHelper } from './aptos/helpers/deployment'

const {Address} = Sdk

jest.setTimeout(1000 * 160) // 1 minute

const userPk = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const resolverPk = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'



// eslint-disable-next-line max-lines-per-function
describe('Resolving example', () => {
    const srcChainId = config.chain.evm.chainId
    const dstChainId = config.chain.evm.chainId
    const aptosChainId = Sdk.NetworkEnum.GNOSIS // Dummy field

    type Chain = {
        node?: CreateServerReturnType | undefined
        provider: JsonRpcProvider
        escrowFactory: string
        resolver: string
    }

    let evm: Chain

    let evmChainUser: Wallet
    let evmChainResolver: Wallet

    let evmFactory: EscrowFactory
    let evmResolverContract: Wallet

    let srcTimestamp: bigint

    // Aptos variables
    let aptosClient: Aptos
    let aptosUserAccount: Account
    let aptosResolverAccount: Account
    let fungibleHelper: FungibleAssetsHelper
    let escrowHelper: EscrowHelper
    let hashlockHelper: HashlockHelper
    let fusionOrderHelper: FusionOrderHelper
    let dutchAuctionHelper: DutchAuctionHelper
    let timelockHelper: TimelockHelper
    let usdtMetadata: string

    async function increaseTime(t: number): Promise<void> {
        // await Promise.all([src, dst].map((chain) => chain.provider.send('evm_increaseTime', [t])))
        // For Aptos, we need to actually wait since we can't modify time
        await new Promise(resolve => setTimeout(resolve, t * 1000))
    }

    beforeAll(async () => {
        console.log('🚀 Starting beforeAll setup...')
        const startTime = Date.now()

        console.log('⏱️  Initializing EVM chain...')
        const evmStartTime = Date.now()
        evm = await initChain(config.chain.evm)
        console.log(`✅ EVM chain initialized in ${Date.now() - evmStartTime}ms`)

        console.log('👤 Creating EVM wallets...')
        evmChainUser = new Wallet(userPk, evm.provider)
        evmChainResolver = new Wallet(resolverPk, evm.provider)
        evmFactory = new EscrowFactory(evm.provider, evm.escrowFactory)
        console.log('✅ EVM wallets created')

        console.log('💰 Topping up USDC for user...')
        const topUpStartTime = Date.now()
        await evmChainUser.topUpFromDonor(
            config.chain.evm.tokens.USDC.address,
            config.chain.evm.tokens.USDC.donor,
            parseUnits('1000', 6)
        )
        console.log(`✅ User USDC topped up in ${Date.now() - topUpStartTime}ms`)

        console.log('🔐 Approving USDC for LOP...')
        const approveStartTime = Date.now()
        await evmChainUser.approveToken(
            config.chain.evm.tokens.USDC.address,
            config.chain.evm.limitOrderProtocol,
            MaxUint256
        )
        console.log(`✅ USDC approved in ${Date.now() - approveStartTime}ms`)

        console.log('🏗️  Setting up resolver contract...')
        const resolverStartTime = Date.now()
        evmResolverContract = await Wallet.fromAddress(evm.resolver, evm.provider)
        await evmResolverContract.topUpFromDonor(
            config.chain.evm.tokens.USDC.address,
            config.chain.evm.tokens.USDC.donor,
            parseUnits('2000', 6)
        )
        await evmChainResolver.transfer(evm.resolver, parseEther('1'))
        await evmResolverContract.unlimitedApprove(config.chain.evm.tokens.USDC.address, evm.escrowFactory)
        console.log(`✅ Resolver contract setup in ${Date.now() - resolverStartTime}ms`)

        console.log('⏰ Getting latest block timestamp...')
        const timestampStartTime = Date.now()
        srcTimestamp = BigInt((await evm.provider.getBlock('latest'))!.timestamp)
        console.log(`✅ Timestamp obtained in ${Date.now() - timestampStartTime}ms`)

        console.log('🔧 Initializing Aptos client...')
        const aptosStartTime = Date.now()
        aptosClient = createAptosClient()
        console.log(`✅ Aptos client initialized in ${Date.now() - aptosStartTime}ms`)

        console.log('📦 Checking and deploying contracts...')
        const deployStartTime = Date.now()
        const deploymentHelper = new DeploymentHelper()
        await deploymentHelper.ensureContractsDeployed()
        console.log(`✅ Contracts deployed in ${Date.now() - deployStartTime}ms`)

        console.log('🛠️  Initializing Aptos helpers...')
        const helpersStartTime = Date.now()
        fungibleHelper = new FungibleAssetsHelper()
        escrowHelper = new EscrowHelper()
        hashlockHelper = new HashlockHelper()
        fusionOrderHelper = new FusionOrderHelper()
        dutchAuctionHelper = new DutchAuctionHelper()
        timelockHelper = new TimelockHelper()
        usdtMetadata = await fungibleHelper.getUsdtMetadata()
        console.log(`✅ Aptos helpers initialized in ${Date.now() - helpersStartTime}ms`)

        console.log('👤 Creating Aptos accounts...')
        const accountsStartTime = Date.now()
        aptosUserAccount = createAccount(APTOS_ACCOUNTS.USER.privateKey)
        aptosResolverAccount = createAccount(APTOS_ACCOUNTS.RESOLVER.privateKey)
        console.log(`✅ Aptos accounts created in ${Date.now() - accountsStartTime}ms`)

        const network = aptosClient.config.network
        console.log(`🌐 Aptos network: ${network}`)

        if (network === 'local') {
            console.log('🔧 Fauceting APT to Aptos accounts...')
            const faucetStartTime = Date.now()
            await aptosClient.faucet.fundAccount({
                accountAddress: aptosUserAccount.accountAddress.toString(),
                amount: 100_000_000 // 1 APT
            });
            await aptosClient.faucet.fundAccount({
                accountAddress: aptosResolverAccount.accountAddress.toString(),
                amount: 100_000_000 // 1 APT
            });
            console.log(`✅ APT fauceted in ${Date.now() - faucetStartTime}ms`)
        }

        console.log('🔧 Migrating APT to FungibleStore...')
        const migrateStartTime = Date.now()
        await fungibleHelper.migrateAptosCoinToFungibleStore(aptosUserAccount)
        await fungibleHelper.migrateAptosCoinToFungibleStore(aptosResolverAccount)
        console.log(`✅ APT migrated in ${Date.now() - migrateStartTime}ms`)

        console.log('🪙 Fauceting USDT to Aptos resolver account...')
        const usdtResolverStartTime = Date.now()
        const usdtAccount = createAccount(APTOS_ACCOUNTS.USDT.privateKey)
        await fungibleHelper.faucetToAddress(
            usdtAccount,
            APTOS_ACCOUNTS.RESOLVER.address,
            BigInt(2000_000_000) // 1000 USDT
        );
        console.log(`✅ USDT fauceted to resolver in ${Date.now() - usdtResolverStartTime}ms`)

        console.log('🪙 Fauceting USDT to Aptos User account...')
        const usdtUserStartTime = Date.now()
        await fungibleHelper.faucetToAddress(
            usdtAccount,
            APTOS_ACCOUNTS.USER.address,
            BigInt(100_000_000) // 1000 USDT
        );
        console.log(`✅ USDT fauceted to user in ${Date.now() - usdtUserStartTime}ms`)

        console.log(`🎉 beforeAll completed in ${Date.now() - startTime}ms`)
    })

    async function getBalances(
        evmToken: string,
        dstToken: string
    ): Promise<{evm: {user: bigint; resolver: bigint}}> {
        return {
            evm: {
                user: await evmChainUser.tokenBalance(evmToken),
                resolver: await evmResolverContract.tokenBalance(evmToken)
            }
        }
    }



    afterAll(async () => {
        evm.provider.destroy()
        await Promise.all([evm.node?.stop()])
    })

    // eslint-disable-next-line max-lines-per-function
    describe('ETH -> APT Fill', () => {
        it('should swap Ethereum USDC -> Aptos USDT. Single fill only', async () => {
            const initialBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Create secret for cross-chain swap
            const secret = uint8ArrayToHex(randomBytes(32)) // note: use crypto secure random number in real world
            const secretBytes = new Uint8Array(Buffer.from(secret.startsWith('0x') ? secret.slice(2) : secret, 'hex'))

            // Create hash from secret for Aptos
            const secretHash = await hashlockHelper.createHashFromSecret(secretBytes)
            const secretHashBytes = new Uint8Array(Buffer.from(secretHash.startsWith('0x') ? secretHash.slice(2) : secretHash, 'hex'))

            // Create SDK order for ETH side with real source chain values and dummy destination values
            const sdkOrder = Sdk.CrossChainOrder.new(
                new Address(evm.escrowFactory), // Real ETH escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await evmChainUser.getAddress()), // Real ETH maker
                    makingAmount: parseUnits('100', 6), // 100 USDC (6 decimals)
                    takingAmount: parseUnits('99', 6), // 99 USDT (6 decimals)
                    makerAsset: new Address(config.chain.evm.tokens.USDC.address), // Real ETH USDC
                    takerAsset: new Address('0x0000000000000000000000000000000000000000') // Dummy APT USDT
                },
                {
                    hashLock: Sdk.HashLock.forSingleFill(secret),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10sec finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10sec finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId, // Real ETH chain ID
                    dstChainId: aptosChainId, // Dummy APT chain ID
                    srcSafetyDeposit: parseEther('0.001'), // Real ETH safety deposit
                    dstSafetyDeposit: parseEther('0.001') // Dummy APT safety deposit
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: srcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(evm.resolver), // Real ETH resolver
                            allowFrom: 0n
                        }
                    ],
                    resolvingStartTime: 0n
                },
                {
                    nonce: Sdk.randBigInt(UINT_40_MAX),
                    allowPartialFills: false,
                    allowMultipleFills: false
                }
            )

            // Create signature for SDK order
            const signature = await evmChainUser.signOrder(srcChainId, sdkOrder)
            const orderHash = sdkOrder.getOrderHash(srcChainId)

            // Resolver fills order on source chain (ETH)
            const resolverContract = new Resolver(evm.resolver, evm.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash} on ETH`)

            const fillAmount = sdkOrder.makingAmount
            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await evmChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    sdkOrder,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(sdkOrder.extension)
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(sdkOrder.takingAmount),
                    fillAmount
                )
            )

            console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)

            const srcEscrowEvent = await evmFactory.getSrcDeployEvent(srcDeployBlock)
            console.log(`[${srcChainId}]`, `ETH Src escrow event: ${srcEscrowEvent}`)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))
            console.log(`[${srcChainId}]`, `ETH Src immutables: ${dstImmutables}`)

            const ESCROW_SRC_IMPLEMENTATION = await evmFactory.getSourceImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // Create Dutch auction on Aptos (destination chain) - USER creates this
            console.log('📝 Creating Dutch auction on Aptos...')
            const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
            const hashes = [secretHashBytes] // Single hash for full fill
            const makerAsset = usdtMetadata // USDT metadata address
            const makerAmount = BigInt(99_000_000) // 99 USDT (6 decimals)
            const resolver_whitelist = [APTOS_ACCOUNTS.RESOLVER.address] // Only this resolver can fill
            const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
            const finality_duration = BigInt(10) // 10 seconds - matches SDK dstWithdrawal
            const exclusive_duration = BigInt(10) // 10 seconds - matches SDK dstWithdrawal
            const public_withdrawal_duration = BigInt(10) // 10 seconds - matches SDK dstWithdrawal
            const private_cancellation_duration = BigInt(10) // 10 seconds - matches SDK dstWithdrawal
            const starting_amount = BigInt(99_000_000) // Starting amount (99 USDT)
            const ending_amount = BigInt(49_500_000) // Ending amount (49.5 USDT)
            const auction_start_time = BigInt(Math.floor(Date.now() / 1000)) // Current time
            const decay_duration = BigInt(120) // 2 minutes decay
            const auction_end_time = auction_start_time + decay_duration + BigInt(60) // End time after decay duration

            const auctionResult = await dutchAuctionHelper.createAuction(
                aptosUserAccount, // USER creates the auction
                order_hash,
                hashes,
                makerAsset, // metadata
                starting_amount,
                ending_amount,
                auction_start_time,
                auction_end_time,
                decay_duration,
                safety_deposit_amount,
                [APTOS_ACCOUNTS.RESOLVER.address] // resolver whitelist
            );

            console.log(`✅ Dutch auction created! Auction address: ${auctionResult.auctionAddress}`)
            expect(auctionResult.auctionAddress).toBeDefined()
            expect(auctionResult.auctionAddress).not.toBe('')

            // RESOLVER fills the Dutch auction
            console.log('🔒 Creating escrow from Dutch auction...')
            const escrowResult = await escrowHelper.createEscrowFromAuctionSingleFill(
                aptosResolverAccount, // RESOLVER fills the auction
                auctionResult.auctionAddress,
                finality_duration,
                exclusive_duration,
                public_withdrawal_duration,
                private_cancellation_duration
            );

            console.log(`✅ Escrow created! Escrow address: ${escrowResult.escrowAddress}`)
            expect(escrowResult.escrowAddress).toBeDefined()
            expect(escrowResult.escrowAddress).not.toBe('')

            // Wait for the escrow to be processed (10 seconds to match finality_duration)
            await increaseTime(11)

            // Withdraw from Aptos escrow using the secret
            console.log('💰 Withdrawing from Aptos escrow...')
            const aptosWithdrawTxHash = await escrowHelper.withdrawFromEscrow(
                aptosResolverAccount,
                escrowResult.escrowAddress,
                secret
            );

            console.log(`✅ Aptos withdrawal successful! Transaction: ${aptosWithdrawTxHash}`)
            expect(aptosWithdrawTxHash).toBeDefined()

            // Withdraw from ETH escrow using the secret
            console.log(`[${srcChainId}]`, `Withdrawing funds for resolver from ETH escrow`)
            const {txHash: resolverWithdrawHash} = await evmChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ETH escrow to ${evm.resolver} in tx ${resolverWithdrawHash}`
            )

            const resultBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Verify the cross-chain swap worked
            console.log('🎉 Complete ETH → APT swap flow test completed!')

            // Verify that the user transferred funds to resolver on ETH
            expect(initialBalances.evm.user - resultBalances.evm.user).toBe(sdkOrder.makingAmount)
            expect(resultBalances.evm.resolver - initialBalances.evm.resolver).toBe(sdkOrder.makingAmount)
        })

        it('should swap Ethereum USDC -> Aptos USDT. Multiple fills. Fill 100%', async () => {
            const initialBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Create secret for cross-chain swap
            const secrets = Array.from({length: 11}).map(() => uint8ArrayToHex(randomBytes(32))) // note: use crypto secure random number in the real world
            const secretHashes = secrets.map((s) => Sdk.HashLock.hashSecret(s))
            const leaves = Sdk.HashLock.getMerkleLeaves(secrets)

            // Create hash from secret for Aptos
            const secretHash = secretHashes[secretHashes.length - 1]
            const secretHashBytes = new Uint8Array(Buffer.from(secretHash.startsWith('0x') ? secretHash.slice(2) : secretHash, 'hex'))

            // Create SDK order for ETH side with real source chain values and dummy destination values
            const sdkOrder = Sdk.CrossChainOrder.new(
                new Address(evm.escrowFactory), // Real ETH escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await evmChainUser.getAddress()), // Real ETH maker
                    makingAmount: parseUnits('100', 6), // 100 USDC (6 decimals)
                    takingAmount: parseUnits('99', 6), // 99 USDT (6 decimals)
                    makerAsset: new Address(config.chain.evm.tokens.USDC.address), // Real ETH USDC
                    takerAsset: new Address('0x0000000000000000000000000000000000000000') // Dummy APT USDT
                },
                {
                    hashLock: Sdk.HashLock.forMultipleFills(leaves),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10sec finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10sec finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId, // Real ETH chain ID
                    dstChainId: aptosChainId, // Dummy APT chain ID
                    srcSafetyDeposit: parseEther('0.001'), // Real ETH safety deposit
                    dstSafetyDeposit: parseEther('0.001') // Dummy APT safety deposit
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: srcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(evm.resolver), // Real ETH resolver
                            allowFrom: 0n
                        }
                    ],
                    resolvingStartTime: 0n
                },
                {
                    nonce: Sdk.randBigInt(UINT_40_MAX),
                    allowPartialFills: true,
                    allowMultipleFills: true
                }
            )

            // Create signature for SDK order
            const signature = await evmChainUser.signOrder(srcChainId, sdkOrder)
            const orderHash = sdkOrder.getOrderHash(srcChainId)

            // Resolver fills order on source chain (ETH)
            const resolverContract = new Resolver(evm.resolver, evm.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash} on ETH`)

            const fillAmount = sdkOrder.makingAmount
            const idx = secrets.length - 1// last index to fulfill

            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await evmChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    sdkOrder,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(sdkOrder.extension)
                        .setInteraction(
                            new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getMultipleFillInteraction(
                                Sdk.HashLock.getProof(leaves, idx),
                                idx,
                                secretHashes[idx]
                            )
                        )
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(sdkOrder.takingAmount),
                    fillAmount,
                    Sdk.HashLock.fromString(secretHashes[idx])
                )
            )

            console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)

            const srcEscrowEvent = await evmFactory.getSrcDeployEvent(srcDeployBlock)
            console.log(`[${srcChainId}]`, `ETH Src escrow event: ${srcEscrowEvent}`)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))
            console.log(`[${srcChainId}]`, `ETH Src immutables: ${dstImmutables}`)

            const ESCROW_SRC_IMPLEMENTATION = await evmFactory.getSourceImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // Create Dutch auction on Aptos (destination chain) - USER creates this
            console.log('📝 Creating Dutch auction on Aptos...')
            const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
            const hashes = [secretHashBytes] // Single hash for full fill
            const makerAsset = usdtMetadata // USDT metadata address
            const makerAmount = BigInt(99_000_000) // 99 USDT (6 decimals)
            const resolver_whitelist = [APTOS_ACCOUNTS.RESOLVER.address] // Only this resolver can fill
            const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
            const finality_duration = BigInt(10) // 10 seconds - matches SDK dstWithdrawal
            const exclusive_duration = BigInt(10) // 10 seconds - matches SDK dstWithdrawal
            const public_withdrawal_duration = BigInt(10) // 10 seconds - matches SDK dstWithdrawal
            const private_cancellation_duration = BigInt(10) // 10 seconds - matches SDK dstWithdrawal
            const starting_amount = BigInt(99_000_000) // Starting amount (99 USDT)
            const ending_amount = BigInt(49_500_000) // Ending amount (49.5 USDT)
            const auction_start_time = BigInt(Math.floor(Date.now() / 1000)) // Current time
            const decay_duration = BigInt(120) // 2 minutes decay
            const auction_end_time = auction_start_time + decay_duration + BigInt(60) // End time after decay duration

            const auctionResult = await dutchAuctionHelper.createAuction(
                aptosUserAccount, // USER creates the auction
                order_hash,
                hashes,
                makerAsset, // metadata
                starting_amount,
                ending_amount,
                auction_start_time,
                auction_end_time,
                decay_duration,
                safety_deposit_amount,
                [APTOS_ACCOUNTS.RESOLVER.address] // resolver whitelist
            );

            console.log(`✅ Dutch auction created! Auction address: ${auctionResult.auctionAddress}`)
            expect(auctionResult.auctionAddress).toBeDefined()
            expect(auctionResult.auctionAddress).not.toBe('')

            // RESOLVER fills the Dutch auction
            console.log('🔒 Creating escrow from Dutch auction...')
            const escrowResult = await escrowHelper.createEscrowFromAuctionSingleFill(
                aptosResolverAccount, // RESOLVER fills the auction
                auctionResult.auctionAddress,
                finality_duration,
                exclusive_duration,
                public_withdrawal_duration,
                private_cancellation_duration
            );

            console.log(`✅ Escrow created! Escrow address: ${escrowResult.escrowAddress}`)
            expect(escrowResult.escrowAddress).toBeDefined()
            expect(escrowResult.escrowAddress).not.toBe('')

            // Wait for the escrow to be processed (10 seconds to match finality_duration)
            await increaseTime(11)

            // Withdraw from Aptos escrow using the secret
            console.log('💰 Withdrawing from Aptos escrow...')
            const aptosWithdrawTxHash = await escrowHelper.withdrawFromEscrow(
                aptosResolverAccount,
                escrowResult.escrowAddress,
                secrets[idx]
            );

            console.log(`✅ Aptos withdrawal successful! Transaction: ${aptosWithdrawTxHash}`)
            expect(aptosWithdrawTxHash).toBeDefined()

            // Withdraw from ETH escrow using the secret
            console.log(`[${srcChainId}]`, `Withdrawing funds for resolver from ETH escrow`)
            const {txHash: resolverWithdrawHash} = await evmChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secrets[idx], srcEscrowEvent[0])
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ETH escrow to ${evm.resolver} in tx ${resolverWithdrawHash}`
            )

            const resultBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Verify the cross-chain swap worked
            console.log('🎉 Complete ETH → APT swap flow test completed!')

            // Verify that the user transferred funds to resolver on ETH
            expect(initialBalances.evm.user - resultBalances.evm.user).toBe(sdkOrder.makingAmount)
            expect(resultBalances.evm.resolver - initialBalances.evm.resolver).toBe(sdkOrder.makingAmount)
        })

        it('should swap Ethereum USDC -> Aptos USDT. Multiple fills. Fill 50%', async () => {
            const initialBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Create secret for cross-chain swap
            const secrets = Array.from({length: 11}).map(() => uint8ArrayToHex(randomBytes(32))) // note: use crypto secure random number in the real world
            const secretHashes = secrets.map((s) => Sdk.HashLock.hashSecret(s))
            const leaves = Sdk.HashLock.getMerkleLeaves(secrets)

            // Create SDK order for ETH side with real source chain values and dummy destination values
            const sdkOrder = Sdk.CrossChainOrder.new(
                new Address(evm.escrowFactory), // Real ETH escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await evmChainUser.getAddress()), // Real ETH maker
                    makingAmount: parseUnits('100', 6), // 100 USDC (6 decimals)
                    takingAmount: parseUnits('99', 6), // 99 USDT (6 decimals)
                    makerAsset: new Address(config.chain.evm.tokens.USDC.address), // Real ETH USDC
                    takerAsset: new Address('0x0000000000000000000000000000000000000000') // Dummy APT USDT
                },
                {
                    hashLock: Sdk.HashLock.forMultipleFills(leaves),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10sec finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10sec finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId, // Real ETH chain ID
                    dstChainId: aptosChainId, // Dummy APT chain ID
                    srcSafetyDeposit: parseEther('0.001'), // Real ETH safety deposit
                    dstSafetyDeposit: parseEther('0.001') // Dummy APT safety deposit
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: srcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(evm.resolver), // Real ETH resolver
                            allowFrom: 0n
                        }
                    ],
                    resolvingStartTime: 0n
                },
                {
                    nonce: Sdk.randBigInt(UINT_40_MAX),
                    allowPartialFills: true,
                    allowMultipleFills: true
                }
            )

            // Create signature for SDK order
            const signature = await evmChainUser.signOrder(srcChainId, sdkOrder)
            const orderHash = sdkOrder.getOrderHash(srcChainId)

            // Resolver fills order on source chain (ETH) - 50% fill
            const resolverContract = new Resolver(evm.resolver, evm.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash} on ETH with 50% fill`)

            const fillAmount = sdkOrder.makingAmount / 2n
            const idx = Number((BigInt(secrets.length - 1) * (fillAmount - 1n)) / sdkOrder.makingAmount)
            console.log(`[${srcChainId}]`, ` Filling order ${orderHash} with fill amount ${fillAmount} and idx ${idx}`)


            // Create hash from secret for Aptos
            const secretHash = secretHashes[idx]
            const secretHashBytes = new Uint8Array(Buffer.from(secretHash.startsWith('0x') ? secretHash.slice(2) : secretHash, 'hex'))


            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await evmChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    sdkOrder,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(sdkOrder.extension)
                        .setInteraction(
                            new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getMultipleFillInteraction(
                                Sdk.HashLock.getProof(leaves, idx),
                                idx,
                                secretHashes[idx]
                            )
                        )
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(sdkOrder.takingAmount),
                    fillAmount,
                    Sdk.HashLock.fromString(secretHashes[idx])
                )
            )

            console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)

            const srcEscrowEvent = await evmFactory.getSrcDeployEvent(srcDeployBlock)
            console.log(`[${srcChainId}]`, `ETH Src escrow event: ${srcEscrowEvent}`)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))
            console.log(`[${srcChainId}]`, `ETH Src immutables: ${dstImmutables}`)

            const ESCROW_SRC_IMPLEMENTATION = await evmFactory.getSourceImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // Create Dutch auction on Aptos (destination chain) - USER creates this - 50% of the amount
            console.log('📝 Creating Dutch auction on Aptos...')
            const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
            const hashes = [secretHashBytes] // Single hash for partial fill
            const makerAsset = usdtMetadata // USDT metadata address
            const resolver_whitelist = [APTOS_ACCOUNTS.RESOLVER.address] // Only this resolver can fill
            const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
            const finality_duration = BigInt(10) // 10 seconds - matches SDK dstWithdrawal
            const exclusive_duration = BigInt(10) // 10 seconds - matches SDK dstWithdrawal
            const public_withdrawal_duration = BigInt(10) // 10 seconds - matches SDK dstWithdrawal
            const private_cancellation_duration = BigInt(10) // 10 seconds - matches SDK dstWithdrawal
            const starting_amount = BigInt(49_500_000) // Starting amount (49.5 USDT - 50% of 99 USDT)
            const ending_amount = BigInt(24_750_000) // Ending amount (24.75 USDT - 50% of 49.5 USDT)
            const auction_start_time = BigInt(Math.floor(Date.now() / 1000)) // Current time
            const decay_duration = BigInt(120) // 2 minutes decay
            const auction_end_time = auction_start_time + decay_duration + BigInt(60) // End time after decay duration

            const auctionResult = await dutchAuctionHelper.createAuction(
                aptosUserAccount, // USER creates the auction
                order_hash,
                hashes,
                makerAsset, // metadata
                starting_amount,
                ending_amount,
                auction_start_time,
                auction_end_time,
                decay_duration,
                safety_deposit_amount,
                [APTOS_ACCOUNTS.RESOLVER.address] // resolver whitelist
            );

            console.log(`✅ Dutch auction created! Auction address: ${auctionResult.auctionAddress}`)
            expect(auctionResult.auctionAddress).toBeDefined()
            expect(auctionResult.auctionAddress).not.toBe('')

            // RESOLVER fills the Dutch auction
            console.log('🔒 Creating escrow from Dutch auction...')
            const escrowResult = await escrowHelper.createEscrowFromAuctionSingleFill(
                aptosResolverAccount, // RESOLVER fills the auction
                auctionResult.auctionAddress,
                finality_duration,
                exclusive_duration,
                public_withdrawal_duration,
                private_cancellation_duration
            );

            console.log(`✅ Escrow created! Escrow address: ${escrowResult.escrowAddress}`)
            expect(escrowResult.escrowAddress).toBeDefined()
            expect(escrowResult.escrowAddress).not.toBe('')

            // Wait for the escrow to be processed (10 seconds to match finality_duration)
            await increaseTime(11)

            // Withdraw from Aptos escrow using the secret
            console.log('💰 Withdrawing from Aptos escrow...')
            const aptosWithdrawTxHash = await escrowHelper.withdrawFromEscrow(
                aptosResolverAccount,
                escrowResult.escrowAddress,
                secrets[idx]
            );

            console.log(`✅ Aptos withdrawal successful! Transaction: ${aptosWithdrawTxHash}`)
            expect(aptosWithdrawTxHash).toBeDefined()

            // Withdraw from ETH escrow using the secret
            console.log(`[${srcChainId}]`, `Withdrawing funds for resolver from ETH escrow`)
            const {txHash: resolverWithdrawHash} = await evmChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secrets[idx], srcEscrowEvent[0])
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ETH escrow to ${evm.resolver} in tx ${resolverWithdrawHash}`
            )

            const resultBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Verify the cross-chain swap worked
            console.log('🎉 Complete ETH → APT swap flow test completed!')

            // Verify that the user transferred funds to resolver on ETH (50% fill)
            expect(initialBalances.evm.user - resultBalances.evm.user).toBe(fillAmount)
            expect(resultBalances.evm.resolver - initialBalances.evm.resolver).toBe(fillAmount)
        })

    })

    // eslint-disable-next-line max-lines-per-function
    describe('APT -> ETH Fill', () => {
        it('should swap Aptos USDT -> Ethereum USDC. Single fill only', async () => {
            const initialBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Get initial Aptos balances
            const initialAptosUserBalance = await fungibleHelper.getBalance(aptosUserAccount.accountAddress.toString(), usdtMetadata)
            const initialAptosResolverBalance = await fungibleHelper.getBalance(aptosResolverAccount.accountAddress.toString(), usdtMetadata)

            // Create secret for cross-chain swap
            const secret = uint8ArrayToHex(randomBytes(32)) // note: use crypto secure random number in real world
            const secretBytes = new Uint8Array(Buffer.from(secret.startsWith('0x') ? secret.slice(2) : secret, 'hex'))

            // Adjust hash from secret for Aptos
            const secretHash = await hashlockHelper.createHashFromSecret(secretBytes)
            const secretHashBytes = new Uint8Array(Buffer.from(secretHash.startsWith('0x') ? secretHash.slice(2) : secretHash, 'hex'))

            // Create SDK order for ETH side with dummy source chain values and real destination values
            const sdkOrder = Sdk.CrossChainOrder.new(
                new Address('0x0000000000000000000000000000000000000000'), // Dummy APT escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address('0x0000000000000000000000000000000000000000'), // Dummy APT maker
                    makingAmount: parseUnits('99', 6), // 99 USDT (6 decimals) - APT side
                    takingAmount: parseUnits('100', 6), // 100 USDC (6 decimals) - ETH side
                    makerAsset: new Address('0x0000000000000000000000000000000000000000'), // Dummy APT USDT
                    takerAsset: new Address(config.chain.evm.tokens.USDC.address) // Real ETH USDC
                },
                {
                    hashLock: Sdk.HashLock.forSingleFill(secret),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10sec finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10sec finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId: aptosChainId, // Dummy APT chain ID
                    dstChainId, // Real ETH chain ID
                    srcSafetyDeposit: parseEther('0.001'), // Dummy APT safety deposit
                    dstSafetyDeposit: parseEther('0.001') // Real ETH safety deposit
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: srcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address('0x0000000000000000000000000000000000000000'), // Dummy APT resolver
                            allowFrom: 0n
                        }
                    ],
                    resolvingStartTime: 0n
                },
                {
                    nonce: Sdk.randBigInt(UINT_40_MAX),
                    allowPartialFills: false,
                    allowMultipleFills: false
                }
            )

            // Create fusion order on Aptos (source chain) - USER creates this
            console.log('📝 Creating fusion order on Aptos (source chain)...')
            const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
            const hashes = [secretHashBytes] // Single hash for full fill
            const makerAsset = usdtMetadata // USDT metadata address
            const resolver_whitelist = [APTOS_ACCOUNTS.RESOLVER.address] // Only this resolver can fill
            const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
            const finality_duration = BigInt(10) // 10 seconds - matches SDK srcWithdrawal
            const exclusive_duration = BigInt(10) // 10 seconds - matches SDK srcWithdrawal
            const public_withdrawal_duration = BigInt(10) // 10 seconds - matches SDK srcWithdrawal
            const private_cancellation_duration = BigInt(10) // 10 seconds - matches SDK srcWithdrawal
            const amount = BigInt(99_000_000) // 99 USDT (6 decimals)

            const fusionOrderResult = await fusionOrderHelper.createOrder(
                aptosUserAccount, // USER creates the fusion order
                order_hash,
                [secretHashBytes], // Single hash for full fill
                makerAsset, // metadata
                amount,
                resolver_whitelist,
                safety_deposit_amount,
                finality_duration,
                exclusive_duration,
                public_withdrawal_duration,
                private_cancellation_duration
            );

            console.log(`✅ Fusion order created! Order address: ${fusionOrderResult.orderAddress}`)
            expect(fusionOrderResult.orderAddress).toBeDefined()
            expect(fusionOrderResult.orderAddress).not.toBe('')

            // RESOLVER fills the fusion order on Aptos (source chain)
            console.log('🔒 Creating escrow from fusion order on Aptos...')
            const escrowResult = await escrowHelper.createEscrowFromOrderSingleFill(
                aptosResolverAccount, // RESOLVER fills the fusion order
                fusionOrderResult.orderAddress
            );

            console.log(`✅ Escrow created! Escrow address: ${escrowResult.escrowAddress}`)
            expect(escrowResult.escrowAddress).toBeDefined()
            expect(escrowResult.escrowAddress).not.toBe('')

            // Wait for the escrow to be processed (10 seconds to match finality_duration)
            await increaseTime(11)

            // Resolver fills order on destination chain (ETH)
            const resolverContract = new Resolver(evm.resolver, evm.resolver)

            console.log(`[${dstChainId}]`, `Filling order on ETH (destination chain)`)

            const orderHash = sdkOrder.getOrderHash(srcChainId)
            // Create dst immutables for ETH side
            const dstImmutablesBase = Sdk.Immutables.new({
                orderHash: sdkOrder.getOrderHash(dstChainId), // Dummy APT chain ID
                hashLock: Sdk.HashLock.forSingleFill(secret),
                maker: new Address(await evmChainUser.getAddress()), // ETH maker
                taker: new Address(resolverContract.dstAddress), // ETH taker
                token: new Address(config.chain.evm.tokens.USDC.address), // ETH USDC
                amount: sdkOrder.makingAmount, // ETH taking amount
                safetyDeposit: parseEther('0.001'), // Real ETH safety deposit
                timeLocks: Sdk.TimeLocks.new({
                    srcWithdrawal: 10n,
                    srcPublicWithdrawal: 120n,
                    srcCancellation: 121n,
                    srcPublicCancellation: 122n,
                    dstWithdrawal: 10n,
                    dstPublicWithdrawal: 100n,
                    dstCancellation: 101n
                })
            })

            const dstComplement = Sdk.DstImmutablesComplement.new({
                maker: new Address(await evmChainUser.getAddress()), // ETH maker
                amount: sdkOrder.takingAmount, // ETH making amount
                token: new Address(config.chain.evm.tokens.USDC.address), // ETH USDC
                safetyDeposit: parseEther('0.001') // Real ETH safety deposit
            })

            const currentBlock = await evm.provider.getBlock('latest')
            const currentTime = currentBlock?.timestamp || 0

            const dstImmutables = dstImmutablesBase
                .withComplement(dstComplement)
                .withTaker(new Address(resolverContract.dstAddress))
                .withDeployedAt(BigInt(currentTime))

            console.log(`[${dstChainId}]`, `Depositing ${dstImmutables.amount} for order ${orderHash}`)
            const {txHash: dstDepositHash, blockTimestamp: dstDeployedAt} = await evmChainResolver.send(
                resolverContract.deployDst(dstImmutables)
            )

            console.log(`[${dstChainId}]`, `Created dst deposit for order ${orderHash} in tx ${dstDepositHash}`)

            const ESCROW_DST_IMPLEMENTATION = await evmFactory.getDestinationImpl()

            const dstEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getDstEscrowAddress(
                dstImmutablesBase,
                dstComplement,
                dstDeployedAt,
                new Address(resolverContract.dstAddress),
                ESCROW_DST_IMPLEMENTATION
            )

            // Log dst escrow address
            console.log(`🏦 DST Escrow Address: ${dstEscrowAddress}`)

            // Check balance in dst escrow address
            const dstEscrowBalance = await evm.provider.getBalance(dstEscrowAddress.toString())
            console.log(`💰 DST Escrow ETH Balance: ${dstEscrowBalance}`)

            await increaseTime(11)
            // User shares key after validation of dst escrow deployment
            console.log(`[${dstChainId}]`, `Withdrawing funds for user from ${dstEscrowAddress}`)

            await evmChainResolver.send(
                resolverContract.withdraw('dst', dstEscrowAddress, secret, dstImmutables.withDeployedAt(dstDeployedAt))
            )
            const resultBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Withdraw from Aptos escrow using the secret
            console.log('💰 Withdrawing from Aptos escrow...')
            const aptosWithdrawTxHash = await escrowHelper.withdrawFromEscrow(
                aptosResolverAccount,
                escrowResult.escrowAddress,
                secret
            );

            console.log(`✅ Aptos withdrawal successful! Transaction: ${aptosWithdrawTxHash}`)
            expect(aptosWithdrawTxHash).toBeDefined()

            // Verify the cross-chain swap worked
            console.log('🎉 Complete APT → ETH swap flow test completed!')

            // Verify that the resolver transferred funds to user on ETH
            expect(resultBalances.evm.user - initialBalances.evm.user).toBe(sdkOrder.takingAmount)
            expect(initialBalances.evm.resolver - resultBalances.evm.resolver).toBe(sdkOrder.takingAmount)

            // Verify Aptos balances
            const finalAptosUserBalance = await fungibleHelper.getBalance(aptosUserAccount.accountAddress.toString(), usdtMetadata)
            const finalAptosResolverBalance = await fungibleHelper.getBalance(aptosResolverAccount.accountAddress.toString(), usdtMetadata)

            // Verify that the user received USDT on Aptos (amount should match the swap)
            expect(initialAptosUserBalance - finalAptosUserBalance).toBe(BigInt(99_000_000)) // 99 USDT (6 decimals)
            // Verify that the resolver's USDT balance decreased (they paid for the swap)
            expect(finalAptosResolverBalance - initialAptosResolverBalance).toBe(BigInt(99_000_000)) // 99 USDT (6 decimals)
        })

    })

    // describe('Cancel', () => {
    //     it('should cancel swap Ethereum USDC -> Aptos USDT', async () => {
    //         const initialBalances = await getBalances(
    //             config.chain.evm.tokens.USDC.address,
    //             config.chain.evm.tokens.USDC.address
    //         )

    //         // Create secret for cross-chain swap
    //         const secrets = Array.from({length: 11}).map(() => uint8ArrayToHex(randomBytes(32))) // note: use crypto secure random number in the real world
    //         const secretHashes = secrets.map((s) => Sdk.HashLock.hashSecret(s))
    //         const leaves = Sdk.HashLock.getMerkleLeaves(secrets)

    //         // Create hash from secret for Aptos
    //         const secretHash = secretHashes[secretHashes.length - 1]
    //         const secretHashBytes = new Uint8Array(Buffer.from(secretHash.startsWith('0x') ? secretHash.slice(2) : secretHash, 'hex'))

    //         // Create SDK order for ETH side with real source chain values and dummy destination values
    //         const sdkOrder = Sdk.CrossChainOrder.new(
    //             new Address(evm.escrowFactory), // Real ETH escrow factory
    //             {
    //                 salt: Sdk.randBigInt(1000n),
    //                 maker: new Address(await evmChainUser.getAddress()), // Real ETH maker
    //                 makingAmount: parseUnits('100', 6), // 100 USDC (6 decimals)
    //                 takingAmount: parseUnits('99', 6), // 99 USDT (6 decimals)
    //                 makerAsset: new Address(config.chain.evm.tokens.USDC.address), // Real ETH USDC
    //                 takerAsset: new Address('0x0000000000000000000000000000000000000000') // Dummy APT USDT
    //             },
    //             {
    //                 hashLock: Sdk.HashLock.forMultipleFills(leaves),
    //                 timeLocks: Sdk.TimeLocks.new({
    //                     srcWithdrawal: 0n, // no finality lock for test
    //                     srcPublicWithdrawal: 120n, // 2m for private withdrawal
    //                     srcCancellation: 121n, // 1sec public withdrawal
    //                     srcPublicCancellation: 122n, // 1sec private cancellation
    //                     dstWithdrawal: 0n, // no finality lock for test
    //                     dstPublicWithdrawal: 100n, // 100sec private withdrawal
    //                     dstCancellation: 101n // 1sec public withdrawal
    //                 }),
    //                 srcChainId, // Real ETH chain ID
    //                 dstChainId: aptosChainId, // Dummy APT chain ID
    //                 srcSafetyDeposit: parseEther('0.001'), // Real ETH safety deposit
    //                 dstSafetyDeposit: parseEther('0.001') // Dummy APT safety deposit
    //             },
    //             {
    //                 auction: new Sdk.AuctionDetails({
    //                     initialRateBump: 0,
    //                     points: [],
    //                     duration: 120n,
    //                     startTime: srcTimestamp
    //                 }),
    //                 whitelist: [
    //                     {
    //                         address: new Address(evm.resolver), // Real ETH resolver
    //                         allowFrom: 0n
    //                     }
    //                 ],
    //                 resolvingStartTime: 0n
    //             },
    //             {
    //                 nonce: Sdk.randBigInt(UINT_40_MAX),
    //                 allowPartialFills: false,
    //                 allowMultipleFills: false
    //             }
    //         )

    //         // Create signature for SDK order
    //         const signature = await evmChainUser.signOrder(srcChainId, sdkOrder)
    //         const orderHash = sdkOrder.getOrderHash(srcChainId)

    //         // Resolver fills order on source chain (ETH)
    //         const resolverContract = new Resolver(evm.resolver, evm.resolver)

    //         console.log(`[${srcChainId}]`, `Filling order ${orderHash} on ETH`)

    //         const fillAmount = sdkOrder.makingAmount
    //         const idx = secrets.length - 1 // last index to fulfill

    //         const {txHash: orderFillHash, blockHash: srcDeployBlock} = await evmChainResolver.send(
    //             resolverContract.deploySrc(
    //                 srcChainId,
    //                 sdkOrder,
    //                 signature,
    //                 Sdk.TakerTraits.default()
    //                     .setExtension(sdkOrder.extension)
    //                     .setInteraction(
    //                         new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getMultipleFillInteraction(
    //                             Sdk.HashLock.getProof(leaves, idx),
    //                             idx,
    //                             secretHashes[idx]
    //                         )
    //                     )
    //                     .setAmountMode(Sdk.AmountMode.maker)
    //                     .setAmountThreshold(sdkOrder.takingAmount),
    //                 fillAmount,
    //                 Sdk.HashLock.fromString(secretHashes[idx])
    //             )
    //         )

    //         console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)

    //         const srcEscrowEvent = await evmFactory.getSrcDeployEvent(srcDeployBlock)
    //         console.log(`[${srcChainId}]`, `ETH Src escrow event: ${srcEscrowEvent}`)

    //         const dstImmutables = srcEscrowEvent[0]
    //             .withComplement(srcEscrowEvent[1])
    //             .withTaker(new Address(resolverContract.dstAddress))
    //         console.log(`[${srcChainId}]`, `ETH Src immutables: ${dstImmutables}`)

    //         const ESCROW_SRC_IMPLEMENTATION = await evmFactory.getSourceImpl()

    //         const srcEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getSrcEscrowAddress(
    //             srcEscrowEvent[0],
    //             ESCROW_SRC_IMPLEMENTATION
    //         )

    //         // Create Dutch auction on Aptos (destination chain) - USER creates this
    //         console.log('📝 Creating Dutch auction on Aptos...')
    //         const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
    //         const hashes = [secretHashBytes] // Single hash for full fill
    //         const makerAsset = usdtMetadata // USDT metadata address
    //         const resolver_whitelist = [APTOS_ACCOUNTS.RESOLVER.address] // Only this resolver can fill
    //         const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
    //         const finality_duration = BigInt(2) // 2 seconds - no finality lock for cancel test
    //         const exclusive_duration = BigInt(2) // 2 seconds - no finality lock for cancel test
    //         const public_withdrawal_duration = BigInt(2) // 2 seconds - no finality lock for cancel test
    //         const private_cancellation_duration = BigInt(2) // 2 seconds - no finality lock for cancel test
    //         const starting_amount = BigInt(99_000_000) // Starting amount (99 USDT)
    //         const ending_amount = BigInt(49_500_000) // Ending amount (49.5 USDT)
    //         const auction_start_time = BigInt(Math.floor(Date.now() / 1000)) // Current time
    //         const decay_duration = BigInt(120) // 2 minutes decay
    //         const auction_end_time = auction_start_time + decay_duration + BigInt(60) // End time after decay duration

    //         const auctionResult = await dutchAuctionHelper.createAuction(
    //             aptosUserAccount, // USER creates the auction
    //             order_hash,
    //             hashes,
    //             makerAsset, // metadata
    //             starting_amount,
    //             ending_amount,
    //             auction_start_time,
    //             auction_end_time,
    //             decay_duration,
    //             safety_deposit_amount,
    //             [APTOS_ACCOUNTS.RESOLVER.address] // resolver whitelist
    //         );

    //         console.log(`✅ Dutch auction created! Auction address: ${auctionResult.auctionAddress}`)
    //         expect(auctionResult.auctionAddress).toBeDefined()
    //         expect(auctionResult.auctionAddress).not.toBe('')

    //         // RESOLVER fills the Dutch auction
    //         console.log('🔒 Creating escrow from Dutch auction...')
    //         const escrowResult = await escrowHelper.createEscrowFromAuctionSingleFill(
    //             aptosResolverAccount, // RESOLVER fills the auction
    //             auctionResult.auctionAddress,
    //             finality_duration,
    //             exclusive_duration,
    //             public_withdrawal_duration,
    //             private_cancellation_duration
    //         );

    //         console.log(`✅ Escrow created! Escrow address: ${escrowResult.escrowAddress}`)
    //         expect(escrowResult.escrowAddress).toBeDefined()
    //         expect(escrowResult.escrowAddress).not.toBe('')

    //         // Wait for cancellation time (10 seconds)
    //         await increaseTime(10)

    //         // Cancel Aptos escrow (user does not share secret)
    //         console.log('❌ Cancelling Aptos escrow...')
    //         const aptosCancelTxHash = await escrowHelper.cancelEscrow(
    //             aptosResolverAccount,
    //             escrowResult.escrowAddress
    //         );

    //         console.log(`✅ Aptos cancellation successful! Transaction: ${aptosCancelTxHash}`)
    //         expect(aptosCancelTxHash).toBeDefined()

    //         // Cancel ETH escrow (user does not share secret)
    //         console.log(`[${srcChainId}]`, `Cancelling ETH escrow ${srcEscrowAddress}`)
    //         const {txHash: cancelSrcEscrow} = await evmChainResolver.send(
    //             resolverContract.cancel('src', srcEscrowAddress, srcEscrowEvent[0])
    //         )
    //         console.log(`[${srcChainId}]`, `Cancelled ETH escrow ${srcEscrowAddress} in tx ${cancelSrcEscrow}`)

    //         const resultBalances = await getBalances(
    //             config.chain.evm.tokens.USDC.address,
    //             config.chain.evm.tokens.USDC.address
    //         )

    //         // Verify that balances are unchanged (cancellation successful)
    //         expect(initialBalances).toEqual(resultBalances)
    //     })
    // })
})

async function initChain(
    cnf: ChainConfig
): Promise<{node?: CreateServerReturnType; provider: JsonRpcProvider; escrowFactory: string; resolver: string}> {
    const {node, provider} = await getProvider(cnf)
    const deployer = new SignerWallet(cnf.ownerPrivateKey, provider)

    // deploy EscrowFactory
    const escrowFactory = await deploy(
        factoryContract,
        [
            cnf.limitOrderProtocol,
            cnf.wrappedNative, // feeToken,
            Address.fromBigInt(0n).toString(), // accessToken,
            deployer.address, // owner
            60 * 30, // src rescue delay
            60 * 30 // dst rescue delay
        ],
        provider,
        deployer
    )
    console.log(`[${cnf.chainId}]`, `Escrow factory contract deployed to`, escrowFactory)

    // deploy Resolver contract
    const resolver = await deploy(
        resolverContract,
        [
            escrowFactory,
            cnf.limitOrderProtocol,
            computeAddress(resolverPk) // resolver as owner of contract
        ],
        provider,
        deployer
    )
    return {node: node, provider, resolver, escrowFactory}
}

async function getProvider(cnf: ChainConfig): Promise<{node?: CreateServerReturnType; provider: JsonRpcProvider}> {
    if (!cnf.createFork) {
        return {
            provider: new JsonRpcProvider(cnf.url, cnf.chainId, {
                cacheTimeout: -1,
                staticNetwork: true
            })
        }
    }

    const node = createServer({
        instance: anvil({forkUrl: cnf.url, chainId: cnf.chainId}),
        limit: 1
    })
    await node.start()

    const address = node.address()
    assert(address)

    const provider = new JsonRpcProvider(`http://[${address.address}]:${address.port}/1`, cnf.chainId, {
        cacheTimeout: -1,
        staticNetwork: true
    })

    return {
        provider,
        node
    }
}

/**
 * Deploy contract and return its address
 */
async function deploy(
    json: {abi: any; bytecode: any},
    params: unknown[],
    provider: JsonRpcProvider,
    deployer: SignerWallet
): Promise<string> {
    const deployed = await new ContractFactory(json.abi, json.bytecode, deployer).deploy(...params)
    await deployed.waitForDeployment()

    return await deployed.getAddress()
}
