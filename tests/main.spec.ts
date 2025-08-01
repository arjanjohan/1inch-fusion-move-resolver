import 'dotenv/config'
import {expect, jest} from '@jest/globals'

import {createServer, CreateServerReturnType} from 'prool'
import {anvil} from 'prool/instances'

import Sdk from '@1inch/cross-chain-sdk'
import {
    computeAddress,
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
import { Aptos, Network, AptosConfig, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk'
import { FungibleAssetsHelper } from './aptos/helpers/fungible-assets'
import { EscrowHelper } from './aptos/helpers/escrow'
import { HashlockHelper } from './aptos/helpers/hashlock'
import { FusionOrderHelper } from './aptos/helpers/fusion-order'
import { DutchAuctionHelper } from './aptos/helpers/dutch-auction'
import { TimelockHelper } from './aptos/helpers/timelock'
import { DeploymentHelper } from './aptos/helpers/deployment'

const {Address} = Sdk

jest.setTimeout(1000 * 60)

const userPk = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const resolverPk = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'

// Aptos account configuration
const APTOS_ACCOUNTS = {
    FUSION: {
        address: '0x5f28002a709921a3bad09df582cdd99a7cab3ec300e99c88fbf50a354e62973b',
        privateKey: 'ed25519-priv-0xb2ff597cbff60622a6984341f91a732399eb2e08cc9e9a29b4621c36eb537cd8',
        name: 'Fusion'
    },
    USDT: {
        address: '0xd7722b8d2a024a318284288409557f6f14ff9b34026949de11ed2dd671475c92',
        privateKey: 'ed25519-priv-0xadf44a11ae912a9a811a784627f709f7b0d31c7328fe8795840140c6595c4536',
        name: 'USDT'
    },
    RESOLVER: {
        address: '0x38edf36a736e0d284fdf504a5e6fccfe229240aaf0bd7f5eec4504bfbf291028',
        privateKey: 'ed25519-priv-0x141d138b003e1049f285eb2e05ec18f537d8fb61e5bc873263b688b1dd85f10c',
        name: 'Resolver'
    },
    USER: {
        address: '0x2709c26cf4a2596f10aed0b6533be35a70090372793c348c317ca2ce8c66f0d3',
        privateKey: 'ed25519-priv-0x13e2b05956b9297849c722bff496bc2a068a709b685fc758234a23a8bddfea95',
        name: 'User'
    }
}

// Aptos network configuration
const APTOS_NETWORK_CONFIG = {
    network: Network.LOCAL
}

// Helper to create Aptos client
function createAptosClient() {
    const aptosConfig = new AptosConfig({
        network: APTOS_NETWORK_CONFIG.network,
    });
    return new Aptos(aptosConfig)
}

// Helper to create account from private key
function createAptosAccount(privateKey: string): Account {
    const ed25519PrivateKey = new Ed25519PrivateKey(privateKey);
    return Account.fromPrivateKey({ privateKey: ed25519PrivateKey });
}

// eslint-disable-next-line max-lines-per-function
describe('Resolving example', () => {
    const srcChainId = config.chain.source.chainId
    const dstChainId = config.chain.destination.chainId

    type Chain = {
        node?: CreateServerReturnType | undefined
        provider: JsonRpcProvider
        escrowFactory: string
        resolver: string
    }

    let src: Chain
    let dst: Chain

    let srcChainUser: Wallet
    let dstChainUser: Wallet
    let srcChainResolver: Wallet
    let dstChainResolver: Wallet

    let srcFactory: EscrowFactory
    let dstFactory: EscrowFactory
    let srcResolverContract: Wallet
    let dstResolverContract: Wallet

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
        // For Aptos, we need to actually wait since we can't modify time
        await new Promise(resolve => setTimeout(resolve, t * 1000))
    }

    beforeAll(async () => {
        ;[src, dst] = await Promise.all([initChain(config.chain.source), initChain(config.chain.destination)])

        srcChainUser = new Wallet(userPk, src.provider)
        dstChainUser = new Wallet(userPk, dst.provider)
        srcChainResolver = new Wallet(resolverPk, src.provider)
        dstChainResolver = new Wallet(resolverPk, dst.provider)

        srcFactory = new EscrowFactory(src.provider, src.escrowFactory)
        dstFactory = new EscrowFactory(dst.provider, dst.escrowFactory)
        // get 1000 USDC for user in SRC chain and approve to LOP
        await srcChainUser.topUpFromDonor(
            config.chain.source.tokens.USDC.address,
            config.chain.source.tokens.USDC.donor,
            parseUnits('1000', 6)
        )
        await srcChainUser.approveToken(
            config.chain.source.tokens.USDC.address,
            config.chain.source.limitOrderProtocol,
            MaxUint256
        )

        // get 2000 USDC for resolver in DST chain
        srcResolverContract = await Wallet.fromAddress(src.resolver, src.provider)
        dstResolverContract = await Wallet.fromAddress(dst.resolver, dst.provider)
        await dstResolverContract.topUpFromDonor(
            config.chain.destination.tokens.USDC.address,
            config.chain.destination.tokens.USDC.donor,
            parseUnits('2000', 6)
        )
        // top up contract for approve
        await dstChainResolver.transfer(dst.resolver, parseEther('1'))
        await dstResolverContract.unlimitedApprove(config.chain.destination.tokens.USDC.address, dst.escrowFactory)

        srcTimestamp = BigInt((await src.provider.getBlock('latest'))!.timestamp)

        // Initialize Aptos
        aptosClient = createAptosClient()

        // Check and deploy contracts if needed
        const deploymentHelper = new DeploymentHelper()
        await deploymentHelper.ensureContractsDeployed()

        // Initialize Aptos helpers
        fungibleHelper = new FungibleAssetsHelper()
        escrowHelper = new EscrowHelper()
        hashlockHelper = new HashlockHelper()
        fusionOrderHelper = new FusionOrderHelper()
        dutchAuctionHelper = new DutchAuctionHelper()
        timelockHelper = new TimelockHelper()
        usdtMetadata = await fungibleHelper.getUsdtMetadata()

        // Create Aptos accounts
        aptosUserAccount = createAptosAccount(APTOS_ACCOUNTS.USER.privateKey)
        aptosResolverAccount = createAptosAccount(APTOS_ACCOUNTS.RESOLVER.privateKey)

        console.log('🔧 Fauceting APT to Aptos accounts...')
        await aptosClient.faucet.fundAccount({
            accountAddress: aptosUserAccount.accountAddress.toString(),
            amount: 100_000_000 // 1 APT
        });
        await aptosClient.faucet.fundAccount({
            accountAddress: aptosResolverAccount.accountAddress.toString(),
            amount: 100_000_000 // 1 APT
        });

        console.log('🔧 Migrating APT to FungibleStore for Aptos accounts...')
        await fungibleHelper.migrateAptosCoinToFungibleStore(aptosUserAccount)
        await fungibleHelper.migrateAptosCoinToFungibleStore(aptosResolverAccount)

        // Faucet USDT to resolver
        console.log('🪙 Fauceting USDT to Aptos resolver account...')
        const usdtAccount = createAptosAccount(APTOS_ACCOUNTS.USDT.privateKey)
        await fungibleHelper.faucetToAddress(
            usdtAccount,
            APTOS_ACCOUNTS.RESOLVER.address,
            BigInt(1000_000_000) // 1000 USDT
        );
    })

    async function getBalances(
        srcToken: string,
        dstToken: string
    ): Promise<{src: {user: bigint; resolver: bigint}; dst: {user: bigint; resolver: bigint}}> {
        return {
            src: {
                user: await srcChainUser.tokenBalance(srcToken),
                resolver: await srcResolverContract.tokenBalance(srcToken)
            },
            dst: {
                user: await dstChainUser.tokenBalance(dstToken),
                resolver: await dstResolverContract.tokenBalance(dstToken)
            }
        }
    }

    afterAll(async () => {
        src.provider.destroy()
        dst.provider.destroy()
        await Promise.all([src.node?.stop(), dst.node?.stop()])
    })

    // eslint-disable-next-line max-lines-per-function
    describe('Fill', () => {
        it('should swap Ethereum USDC -> Aptos USDT. Single fill only', async () => {
            const initialBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                config.chain.destination.tokens.USDC.address
            )

            // Create secret for cross-chain swap
            const secret = uint8ArrayToHex(randomBytes(32)) // note: use crypto secure random number in real world
            const secretBytes = new Uint8Array(Buffer.from(secret.startsWith('0x') ? secret.slice(2) : secret, 'hex'))

            // Create hash from secret for Aptos
            const secretHash = await hashlockHelper.createHashFromSecret(secretBytes)
            const secretHashBytes = new Uint8Array(Buffer.from(secretHash.startsWith('0x') ? secretHash.slice(2) : secretHash, 'hex'))

            // Create SDK order for ETH side with real source chain values and dummy destination values
            const sdkOrder = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory), // Real ETH escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()), // Real ETH maker
                    makingAmount: parseUnits('100', 6), // 100 USDC (6 decimals)
                    takingAmount: parseUnits('99', 6), // 99 USDT (6 decimals)
                    makerAsset: new Address(config.chain.source.tokens.USDC.address), // Real ETH USDC
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
                    dstChainId: 100, // Dummy APT chain ID
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
                            address: new Address(src.resolver), // Real ETH resolver
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
            const signature = await srcChainUser.signOrder(srcChainId, sdkOrder)
            const orderHash = sdkOrder.getOrderHash(srcChainId)

            // Resolver fills order on source chain (ETH)
            const resolverContract = new Resolver(src.resolver, dst.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash} on ETH`)

            const fillAmount = sdkOrder.makingAmount
            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await srcChainResolver.send(
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

            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)
            console.log(`[${srcChainId}]`, `ETH Src escrow event: ${srcEscrowEvent}`)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))
            console.log(`[${srcChainId}]`, `ETH Src immutables: ${dstImmutables}`)

            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
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
                safety_deposit_amount
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
            const {txHash: resolverWithdrawHash} = await srcChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ETH escrow to ${src.resolver} in tx ${resolverWithdrawHash}`
            )

            const resultBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                config.chain.destination.tokens.USDC.address
            )

            // Verify the cross-chain swap worked
            console.log('🎉 Complete ETH → APT swap flow test completed!')

            // Verify that the user transferred funds to resolver on ETH
            expect(initialBalances.src.user - resultBalances.src.user).toBe(sdkOrder.makingAmount)
            expect(resultBalances.src.resolver - initialBalances.src.resolver).toBe(sdkOrder.makingAmount)
        })

        it('should swap Ethereum USDC -> Aptos USDT. Multiple fills. Fill 100%', async () => {
            const initialBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                config.chain.destination.tokens.USDC.address
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
                new Address(src.escrowFactory), // Real ETH escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()), // Real ETH maker
                    makingAmount: parseUnits('100', 6), // 100 USDC (6 decimals)
                    takingAmount: parseUnits('99', 6), // 99 USDT (6 decimals)
                    makerAsset: new Address(config.chain.source.tokens.USDC.address), // Real ETH USDC
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
                    dstChainId: 100, // Dummy APT chain ID
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
                            address: new Address(src.resolver), // Real ETH resolver
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
            const signature = await srcChainUser.signOrder(srcChainId, sdkOrder)
            const orderHash = sdkOrder.getOrderHash(srcChainId)

            // Resolver fills order on source chain (ETH)
            const resolverContract = new Resolver(src.resolver, dst.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash} on ETH`)

            const fillAmount = sdkOrder.makingAmount
            const idx = secrets.length - 1// last index to fulfill

            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await srcChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    sdkOrder,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(sdkOrder.extension)
                        .setInteraction(
                            new Sdk.EscrowFactory(new Address(src.escrowFactory)).getMultipleFillInteraction(
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

            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)
            console.log(`[${srcChainId}]`, `ETH Src escrow event: ${srcEscrowEvent}`)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))
            console.log(`[${srcChainId}]`, `ETH Src immutables: ${dstImmutables}`)

            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
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
                safety_deposit_amount
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
            const {txHash: resolverWithdrawHash} = await srcChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secrets[idx], srcEscrowEvent[0])
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ETH escrow to ${src.resolver} in tx ${resolverWithdrawHash}`
            )

            const resultBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                config.chain.destination.tokens.USDC.address
            )

            // Verify the cross-chain swap worked
            console.log('🎉 Complete ETH → APT swap flow test completed!')

            // Verify that the user transferred funds to resolver on ETH
            expect(initialBalances.src.user - resultBalances.src.user).toBe(sdkOrder.makingAmount)
            expect(resultBalances.src.resolver - initialBalances.src.resolver).toBe(sdkOrder.makingAmount)
        })

        it('should swap Ethereum USDC -> Aptos USDT. Multiple fills. Fill 50%', async () => {
            const initialBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                config.chain.destination.tokens.USDC.address
            )

            // Create secret for cross-chain swap
            const secrets = Array.from({length: 11}).map(() => uint8ArrayToHex(randomBytes(32))) // note: use crypto secure random number in the real world
            const secretHashes = secrets.map((s) => Sdk.HashLock.hashSecret(s))
            const leaves = Sdk.HashLock.getMerkleLeaves(secrets)

            // Create SDK order for ETH side with real source chain values and dummy destination values
            const sdkOrder = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory), // Real ETH escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()), // Real ETH maker
                    makingAmount: parseUnits('100', 6), // 100 USDC (6 decimals)
                    takingAmount: parseUnits('99', 6), // 99 USDT (6 decimals)
                    makerAsset: new Address(config.chain.source.tokens.USDC.address), // Real ETH USDC
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
                    dstChainId: 100, // Dummy APT chain ID
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
                            address: new Address(src.resolver), // Real ETH resolver
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
            const signature = await srcChainUser.signOrder(srcChainId, sdkOrder)
            const orderHash = sdkOrder.getOrderHash(srcChainId)

            // Resolver fills order on source chain (ETH) - 50% fill
            const resolverContract = new Resolver(src.resolver, dst.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash} on ETH with 50% fill`)

            const fillAmount = sdkOrder.makingAmount / 2n
            const idx = Number((BigInt(secrets.length - 1) * (fillAmount - 1n)) / sdkOrder.makingAmount)
            console.log(`[${srcChainId}]`, ` AVH Filling order ${orderHash} with fill amount ${fillAmount} and idx ${idx}`)


            // Create hash from secret for Aptos
            const secretHash = secretHashes[idx]
            const secretHashBytes = new Uint8Array(Buffer.from(secretHash.startsWith('0x') ? secretHash.slice(2) : secretHash, 'hex'))


            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await srcChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    sdkOrder,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(sdkOrder.extension)
                        .setInteraction(
                            new Sdk.EscrowFactory(new Address(src.escrowFactory)).getMultipleFillInteraction(
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

            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)
            console.log(`[${srcChainId}]`, `ETH Src escrow event: ${srcEscrowEvent}`)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))
            console.log(`[${srcChainId}]`, `ETH Src immutables: ${dstImmutables}`)

            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
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
                safety_deposit_amount
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
            const {txHash: resolverWithdrawHash} = await srcChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secrets[idx], srcEscrowEvent[0])
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ETH escrow to ${src.resolver} in tx ${resolverWithdrawHash}`
            )

            const resultBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                config.chain.destination.tokens.USDC.address
            )

            // Verify the cross-chain swap worked
            console.log('🎉 Complete ETH → APT swap flow test completed!')

            // Verify that the user transferred funds to resolver on ETH (50% fill)
            expect(initialBalances.src.user - resultBalances.src.user).toBe(fillAmount)
            expect(resultBalances.src.resolver - initialBalances.src.resolver).toBe(fillAmount)
        })

    })

    describe('Cancel', () => {
        it('should cancel swap Ethereum USDC -> Aptos USDT', async () => {
            const initialBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                config.chain.destination.tokens.USDC.address
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
                new Address(src.escrowFactory), // Real ETH escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()), // Real ETH maker
                    makingAmount: parseUnits('100', 6), // 100 USDC (6 decimals)
                    takingAmount: parseUnits('99', 6), // 99 USDT (6 decimals)
                    makerAsset: new Address(config.chain.source.tokens.USDC.address), // Real ETH USDC
                    takerAsset: new Address('0x0000000000000000000000000000000000000000') // Dummy APT USDT
                },
                {
                    hashLock: Sdk.HashLock.forMultipleFills(leaves),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 0n, // no finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 0n, // no finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId, // Real ETH chain ID
                    dstChainId: 100, // Dummy APT chain ID
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
                            address: new Address(src.resolver), // Real ETH resolver
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
            const signature = await srcChainUser.signOrder(srcChainId, sdkOrder)
            const orderHash = sdkOrder.getOrderHash(srcChainId)

            // Resolver fills order on source chain (ETH)
            const resolverContract = new Resolver(src.resolver, dst.resolver)

            console.log(`[${srcChainId}]`, `Filling order ${orderHash} on ETH`)

            const fillAmount = sdkOrder.makingAmount
            const idx = secrets.length - 1 // last index to fulfill

            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await srcChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    sdkOrder,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(sdkOrder.extension)
                        .setInteraction(
                            new Sdk.EscrowFactory(new Address(src.escrowFactory)).getMultipleFillInteraction(
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

            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)
            console.log(`[${srcChainId}]`, `ETH Src escrow event: ${srcEscrowEvent}`)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))
            console.log(`[${srcChainId}]`, `ETH Src immutables: ${dstImmutables}`)

            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // Create Dutch auction on Aptos (destination chain) - USER creates this
            console.log('📝 Creating Dutch auction on Aptos...')
            const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
            const hashes = [secretHashBytes] // Single hash for full fill
            const makerAsset = usdtMetadata // USDT metadata address
            const resolver_whitelist = [APTOS_ACCOUNTS.RESOLVER.address] // Only this resolver can fill
            const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
            const finality_duration = BigInt(2) // 2 seconds - no finality lock for cancel test
            const exclusive_duration = BigInt(2) // 2 seconds - no finality lock for cancel test
            const private_cancellation_duration = BigInt(2) // 2 seconds - no finality lock for cancel test
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
                safety_deposit_amount
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
                private_cancellation_duration
            );

            console.log(`✅ Escrow created! Escrow address: ${escrowResult.escrowAddress}`)
            expect(escrowResult.escrowAddress).toBeDefined()
            expect(escrowResult.escrowAddress).not.toBe('')

            // Wait for cancellation time (10 seconds)
            await increaseTime(10)

            // Cancel Aptos escrow (user does not share secret)
            console.log('❌ Cancelling Aptos escrow...')
            const aptosCancelTxHash = await escrowHelper.cancelEscrow(
                aptosResolverAccount,
                escrowResult.escrowAddress
            );

            console.log(`✅ Aptos cancellation successful! Transaction: ${aptosCancelTxHash}`)
            expect(aptosCancelTxHash).toBeDefined()

            // Cancel ETH escrow (user does not share secret)
            console.log(`[${srcChainId}]`, `Cancelling ETH escrow ${srcEscrowAddress}`)
            const {txHash: cancelSrcEscrow} = await srcChainResolver.send(
                resolverContract.cancel('src', srcEscrowAddress, srcEscrowEvent[0])
            )
            console.log(`[${srcChainId}]`, `Cancelled ETH escrow ${srcEscrowAddress} in tx ${cancelSrcEscrow}`)

            const resultBalances = await getBalances(
                config.chain.source.tokens.USDC.address,
                config.chain.destination.tokens.USDC.address
            )

            // Verify that balances are unchanged (cancellation successful)
            expect(initialBalances).toEqual(resultBalances)
        })
    })
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
    console.log(`[${cnf.chainId}]`, `Resolver contract deployed to`, resolver)

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
