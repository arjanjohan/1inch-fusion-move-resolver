import 'dotenv/config'
import { expect, jest } from '@jest/globals'
import { Aptos, Account } from '@aptos-labs/ts-sdk'

import { createServer, CreateServerReturnType } from 'prool'
import { anvil } from 'prool/instances'

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
import { uint8ArrayToHex, UINT_40_MAX } from '@1inch/byte-utils'
import assert from 'node:assert'
import { ChainConfig, config } from './config'
import { Wallet } from './wallet'
import { Resolver } from './resolver'
import { EscrowFactory } from './escrow-factory'
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

const { Address } = Sdk

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
        console.log(`🕒 Increasing time by ${t} seconds`)
        await new Promise(resolve => setTimeout(resolve, t * 1000))
    }

    beforeAll(async () => {

        const startTime = Date.now()


        evm = await initChain(config.chain.evm)

        evmChainUser = new Wallet(userPk, evm.provider)
        evmChainResolver = new Wallet(resolverPk, evm.provider)
        evmFactory = new EscrowFactory(evm.provider, evm.escrowFactory)

        await evmChainUser.topUpFromDonor(
            config.chain.evm.tokens.USDC.address,
            config.chain.evm.tokens.USDC.donor,
            parseUnits('1000', 6)
        )

        await evmChainUser.approveToken(
            config.chain.evm.tokens.USDC.address,
            config.chain.evm.limitOrderProtocol,
            MaxUint256
        )
        evmResolverContract = await Wallet.fromAddress(evm.resolver, evm.provider)
        await evmResolverContract.topUpFromDonor(
            config.chain.evm.tokens.USDC.address,
            config.chain.evm.tokens.USDC.donor,
            parseUnits('2000', 6)
        )
        await evmChainResolver.transfer(evm.resolver, parseEther('1'))
        await evmResolverContract.unlimitedApprove(config.chain.evm.tokens.USDC.address, evm.escrowFactory)

        srcTimestamp = BigInt((await evm.provider.getBlock('latest'))!.timestamp)

        aptosClient = createAptosClient()

        const deploymentHelper = new DeploymentHelper()
        await deploymentHelper.ensureContractsDeployed()

        fungibleHelper = new FungibleAssetsHelper()
        escrowHelper = new EscrowHelper()
        hashlockHelper = new HashlockHelper()
        fusionOrderHelper = new FusionOrderHelper()
        dutchAuctionHelper = new DutchAuctionHelper()
        timelockHelper = new TimelockHelper()
        usdtMetadata = await fungibleHelper.getUsdtMetadata()


        aptosUserAccount = createAccount(APTOS_ACCOUNTS.USER.privateKey)
        aptosResolverAccount = createAccount(APTOS_ACCOUNTS.RESOLVER.privateKey)

        const network = aptosClient.config.network
        // console.log(`🌐 Aptos network: ${network}`)

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

        // console.log('🔧 Migrating APT to FungibleStore...')
        // await fungibleHelper.migrateAptosCoinToFungibleStore(aptosUserAccount)
        // await fungibleHelper.migrateAptosCoinToFungibleStore(aptosResolverAccount)

        const usdtAccount = createAccount(APTOS_ACCOUNTS.USDT.privateKey)
        await fungibleHelper.faucetToAddress(
            usdtAccount,
            APTOS_ACCOUNTS.RESOLVER.address,
            BigInt(2000_000_000) // 1000 USDT
        );

        await fungibleHelper.faucetToAddress(
            usdtAccount,
            APTOS_ACCOUNTS.USER.address,
            BigInt(100_000_000) // 1000 USDT
        );

        // console.log(`🎉 beforeAll completed in ${Date.now() - startTime}ms`)
    })

    async function getBalances(
        evmToken: string,
        dstToken: string
    ): Promise<{ evm: { user: bigint; resolver: bigint } }> {
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

            // Get initial Aptos balances
            const initialAptosUserBalance = await fungibleHelper.getBalance(aptosUserAccount.accountAddress.toString(), usdtMetadata)
            const initialAptosResolverBalance = await fungibleHelper.getBalance(aptosResolverAccount.accountAddress.toString(), usdtMetadata)

            // Create secret for cross-chain swap
            const secret = uint8ArrayToHex(randomBytes(32)) // note: use crypto secure random number in real world
            const secretBytes = new Uint8Array(Buffer.from(secret.startsWith('0x') ? secret.slice(2) : secret, 'hex'))

            // Create hash from secret for Aptos
            const secretHash = await hashlockHelper.createHashFromSecret(secretBytes)
            const secretHashBytes = new Uint8Array(Buffer.from(secretHash.startsWith('0x') ? secretHash.slice(2) : secretHash, 'hex'))

            let withdrawalPhase = 10n
            let publicWithdrawalPhase = 100n
            let privateCancellationPhase = 101n
            let publicCancellationPhase = 102n

            let makingAmount = parseUnits('100', 6)
            let takingAmount = parseUnits('99', 6)

            // Create SDK order for ETH side with real source chain values and dummy destination values
            const sdkOrder = Sdk.CrossChainOrder.new(
                new Address(evm.escrowFactory), // Real ETH escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await evmChainUser.getAddress()), // Real ETH maker
                    makingAmount: makingAmount, // 100 USDC (6 decimals)
                    takingAmount: takingAmount, // 99 USDT (6 decimals)
                    makerAsset: new Address(config.chain.evm.tokens.USDC.address), // Real ETH USDC
                    takerAsset: new Address('0x0000000000000000000000000000000000000000') // Dummy APT USDT
                },
                {
                    hashLock: Sdk.HashLock.forSingleFill(secret),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: withdrawalPhase,
                        srcPublicWithdrawal: publicWithdrawalPhase,
                        srcCancellation: privateCancellationPhase,
                        srcPublicCancellation: publicCancellationPhase,
                        dstWithdrawal: withdrawalPhase,
                        dstPublicWithdrawal: publicWithdrawalPhase,
                        dstCancellation: privateCancellationPhase
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

            // Create Dutch auction on Aptos (destination chain) - USER creates this
            console.log('📝 Creating Dutch auction on Aptos...')
            const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
            const hashes = [secretHashBytes] // Single hash for full fill
            const makerAsset = usdtMetadata // USDT metadata address
            const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
            const finality_duration = withdrawalPhase
            const exclusive_duration = withdrawalPhase - finality_duration
            const public_withdrawal_duration = publicWithdrawalPhase - exclusive_duration
            const private_cancellation_duration = privateCancellationPhase - public_withdrawal_duration
            const starting_amount = takingAmount
            const ending_amount = takingAmount / 2n
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

            console.log(`[APT]`, `Dutch auction created in tx ${auctionResult.auctionAddress}`)
            expect(auctionResult.auctionAddress).toBeDefined()
            expect(auctionResult.auctionAddress).not.toBe('')

            // RESOLVER fills the Dutch auction
            console.log('🔒 Creating escrow from Dutch auction...')
            console.log(`   - Resolver paying: ${Number(ending_amount) / 1_000_000} USDT`)
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


            // Resolver fills order on source chain (ETH)
            const resolverContract = new Resolver(evm.resolver, evm.resolver)

            console.log(`[ETH]`, `Creating escrow from order ${orderHash} for ${Number(sdkOrder.makingAmount) / 1_000_000} USDC`)
            console.log(`   - User paying: ${Number(sdkOrder.makingAmount) / 1_000_000} USDC`)

            const fillAmount = sdkOrder.makingAmount
            const { txHash: orderFillHash, blockHash: srcDeployBlock } = await evmChainResolver.send(
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

            console.log(`[ETH]`, `Escrow created in tx ${orderFillHash}`)

            const srcEscrowEvent = await evmFactory.getSrcDeployEvent(srcDeployBlock)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            const ESCROW_SRC_IMPLEMENTATION = await evmFactory.getSourceImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // Wait for the escrow to be processed (10 seconds to match finality_duration)
            await increaseTime(11)

            // Withdraw from Aptos escrow using the secret
            console.log(`[APT]`, `Withdrawing ${Number(sdkOrder.takingAmount) / 1_000_000} USDT from Aptos escrow`)
            const aptosWithdrawTxHash = await escrowHelper.withdrawFromEscrow(
                aptosResolverAccount,
                escrowResult.escrowAddress,
                secret
            );

            console.log(`[APT]`, `Withdrawal successful in tx ${aptosWithdrawTxHash}`)
            expect(aptosWithdrawTxHash).toBeDefined()

            // Withdraw from ETH escrow using the secret
            console.log(`[ETH]`, `Withdrawing ${Number(sdkOrder.makingAmount) / 1_000_000} USDC from ETH escrow`)
            const { txHash: resolverWithdrawHash } = await evmChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(`[ETH]`, `Withdrawal successful in tx ${resolverWithdrawHash}`)

            const resultBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Verify the cross-chain swap worked
            console.log('🎉 Complete ETH → APT swap flow test completed!')

            // Verify that the user transferred funds to resolver on ETH
            expect(initialBalances.evm.user - resultBalances.evm.user).toBe(sdkOrder.makingAmount)
            expect(resultBalances.evm.resolver - initialBalances.evm.resolver).toBe(sdkOrder.makingAmount)

            // Verify Aptos balances
            const finalAptosUserBalance = await fungibleHelper.getBalance(aptosUserAccount.accountAddress.toString(), usdtMetadata)
            const finalAptosResolverBalance = await fungibleHelper.getBalance(aptosResolverAccount.accountAddress.toString(), usdtMetadata)

            // Verify that the resolver received USDT on Aptos (amount should match the swap)
            expect(initialAptosResolverBalance - finalAptosResolverBalance).toBe(BigInt(sdkOrder.takingAmount))
            // Verify that the user's USDT balance decreased (they paid for the swap)
            expect(finalAptosUserBalance - initialAptosUserBalance).toBe(BigInt(sdkOrder.takingAmount))

            // Log the final amounts for clarity
            console.log(`💰 Final amounts:`)
            console.log(`   - Resolver received: ${Number(sdkOrder.makingAmount) / 1_000_000} USDC on Ethereum`)
            console.log(`   - User received: ${Number(finalAptosUserBalance - initialAptosUserBalance) / 1_000_000} USDT on Aptos`)
        })

        it('should swap Ethereum USDC -> Aptos USDT. Single fill after decreased', async () => {
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

            // Create hash from secret for Aptos
            const secretHash = await hashlockHelper.createHashFromSecret(secretBytes)
            const secretHashBytes = new Uint8Array(Buffer.from(secretHash.startsWith('0x') ? secretHash.slice(2) : secretHash, 'hex'))

            let withdrawalPhase = 10n
            let publicWithdrawalPhase = 100n
            let privateCancellationPhase = 101n
            let publicCancellationPhase = 102n

            let makingAmount = parseUnits('100', 6)
            let takingAmount = parseUnits('100', 6)

            // Create SDK order for ETH side with real source chain values and dummy destination values
            const sdkOrder = Sdk.CrossChainOrder.new(
                new Address(evm.escrowFactory), // Real ETH escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await evmChainUser.getAddress()), // Real ETH maker
                    makingAmount: makingAmount, // 100 USDC (6 decimals)
                    takingAmount: takingAmount, // 100 USDT (6 decimals)
                    makerAsset: new Address(config.chain.evm.tokens.USDC.address), // Real ETH USDC
                    takerAsset: new Address('0x0000000000000000000000000000000000000000') // Dummy APT USDT
                },
                {
                    hashLock: Sdk.HashLock.forSingleFill(secret),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: withdrawalPhase,
                        srcPublicWithdrawal: publicWithdrawalPhase,
                        srcCancellation: privateCancellationPhase,
                        srcPublicCancellation: publicCancellationPhase,
                        dstWithdrawal: withdrawalPhase,
                        dstPublicWithdrawal: publicWithdrawalPhase,
                        dstCancellation: privateCancellationPhase
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


            // Create Dutch auction on Aptos (destination chain) - USER creates this
            console.log('📝 Creating Dutch auction on Aptos...')
            const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
            const hashes = [secretHashBytes] // Single hash for full fill
            const makerAsset = usdtMetadata // USDT metadata address
            const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
            const finality_duration = withdrawalPhase
            const exclusive_duration = withdrawalPhase - finality_duration
            const public_withdrawal_duration = publicWithdrawalPhase - exclusive_duration
            const private_cancellation_duration = privateCancellationPhase - public_withdrawal_duration
            const starting_amount = takingAmount
            const ending_amount = takingAmount - BigInt(1_000_000) // 99 USDT
            const auction_start_time = BigInt(Math.floor(Date.now() / 1000)) // Current time
            const decay_duration = BigInt(5) // 5 seconds decay
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

            console.log(`[APT]`, `Dutch auction created in tx ${auctionResult.auctionAddress}`)
            expect(auctionResult.auctionAddress).toBeDefined()
            expect(auctionResult.auctionAddress).not.toBe('')

            // Wait for the auction price to drop
            // Since we are testing on mainnet, ensure decay is 100% complete to accuratly predict the outcome
            console.log(`📉 Auction price before decay: ${Number(starting_amount) / 1_000_000} USDT`)
            console.log(`📉 Auction price after decay: ${Number(ending_amount) / 1_000_000} USDT`)
            console.log(`📉 Price decrease: ${Number(starting_amount - ending_amount) / 1_000_000} USDT (${((Number(starting_amount - ending_amount) / Number(starting_amount)) * 100).toFixed(2)}%)`)
            await increaseTime(6)

            // RESOLVER fills the Dutch auction
            console.log('🔒 Creating escrow from Dutch auction...')
            console.log(`   - Resolver paying: ${Number(ending_amount) / 1_000_000} USDT`)
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


            // Resolver fills order on source chain (ETH)
            const resolverContract = new Resolver(evm.resolver, evm.resolver)

            console.log(`[ETH]`, `Creating escrow from order ${orderHash} for ${Number(sdkOrder.makingAmount) / 1_000_000} USDC`)
            console.log(`   - User paying: ${Number(sdkOrder.makingAmount) / 1_000_000} USDC`)

            const fillAmount = sdkOrder.makingAmount
            const { txHash: orderFillHash, blockHash: srcDeployBlock } = await evmChainResolver.send(
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

            console.log(`[ETH]`, `Escrow created in tx ${orderFillHash}`)

            const srcEscrowEvent = await evmFactory.getSrcDeployEvent(srcDeployBlock)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            const ESCROW_SRC_IMPLEMENTATION = await evmFactory.getSourceImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // Wait for the escrow to be processed (10 seconds to match finality_duration)
            await increaseTime(11)

            // Withdraw from Aptos escrow using the secret
            console.log(`[APT]`, `Withdrawing ${Number(sdkOrder.takingAmount) / 1_000_000} USDT from Aptos escrow`)
            const aptosWithdrawTxHash = await escrowHelper.withdrawFromEscrow(
                aptosResolverAccount, // RESOLVER fills the auction
                escrowResult.escrowAddress,
                secret
            );

            console.log(`[APT]`, `Withdrawal successful in tx ${aptosWithdrawTxHash}`)
            expect(aptosWithdrawTxHash).toBeDefined()

            // Withdraw from ETH escrow using the secret
            console.log(`[ETH]`, `Withdrawing ${Number(sdkOrder.makingAmount) / 1_000_000} USDC from ETH escrow`)
            const { txHash: resolverWithdrawHash } = await evmChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(`[ETH]`, `Withdrawal successful in tx ${resolverWithdrawHash}`)

            const resultBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Verify the cross-chain swap worked
            console.log('🎉 Complete ETH → APT swap flow test completed!')

            // Verify that the user transferred funds to resolver on ETH
            expect(initialBalances.evm.user - resultBalances.evm.user).toBe(sdkOrder.makingAmount)
            expect(resultBalances.evm.resolver - initialBalances.evm.resolver).toBe(sdkOrder.makingAmount)

            // Verify Aptos balances
            const finalAptosUserBalance = await fungibleHelper.getBalance(aptosUserAccount.accountAddress.toString(), usdtMetadata)
            const finalAptosResolverBalance = await fungibleHelper.getBalance(aptosResolverAccount.accountAddress.toString(), usdtMetadata)

            // Verify that the resolver received USDT on Aptos (amount should match the swap)
            expect(initialAptosResolverBalance - finalAptosResolverBalance).toBe(BigInt(ending_amount))
            // Verify that the user's USDT balance decreased (they paid for the swap)
            expect(finalAptosUserBalance - initialAptosUserBalance).toBe(BigInt(ending_amount))

            // Log the final amounts for clarity
            console.log(`💰 Final amounts:`)
            console.log(`   - Resolver received: ${Number(sdkOrder.makingAmount) / 1_000_000} USDC on Ethereum`)
            console.log(`   - User received: ${Number(finalAptosUserBalance - initialAptosUserBalance) / 1_000_000} USDT on Aptos`)
            console.log(`   - Price decay saved: ${Number(starting_amount - ending_amount) / 1_000_000} USDT`)
        })

        it('should swap Ethereum USDC -> Aptos USDT. Multiple fills. Fill 100%', async () => {
            const initialBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Get initial Aptos balances
            const initialAptosUserBalance = await fungibleHelper.getBalance(aptosUserAccount.accountAddress.toString(), usdtMetadata)
            const initialAptosResolverBalance = await fungibleHelper.getBalance(aptosResolverAccount.accountAddress.toString(), usdtMetadata)

            // Create secret for cross-chain swap
            const secrets = Array.from({ length: 11 }).map(() => uint8ArrayToHex(randomBytes(32))) // note: use crypto secure random number in the real world
            const secretHashes = secrets.map((s) => Sdk.HashLock.hashSecret(s))
            const leaves = Sdk.HashLock.getMerkleLeaves(secrets)

            // Create hash from secret for Aptos
            const secretHash = secretHashes[secretHashes.length - 1]
            const secretHashBytes = new Uint8Array(Buffer.from(secretHash.startsWith('0x') ? secretHash.slice(2) : secretHash, 'hex'))

            let withdrawalPhase = 10n
            let publicWithdrawalPhase = 100n
            let privateCancellationPhase = 101n
            let publicCancellationPhase = 102n

            let makingAmount = parseUnits('100', 6)
            let takingAmount = parseUnits('99', 6)

            // Create SDK order for ETH side with real source chain values and dummy destination values
            const sdkOrder = Sdk.CrossChainOrder.new(
                new Address(evm.escrowFactory), // Real ETH escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await evmChainUser.getAddress()), // Real ETH maker
                    makingAmount: makingAmount, // 100 USDC (6 decimals)
                    takingAmount: takingAmount, // 99 USDT (6 decimals)
                    makerAsset: new Address(config.chain.evm.tokens.USDC.address), // Real ETH USDC
                    takerAsset: new Address('0x0000000000000000000000000000000000000000') // Dummy APT USDT
                },
                {
                    hashLock: Sdk.HashLock.forMultipleFills(leaves),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: withdrawalPhase,
                        srcPublicWithdrawal: publicWithdrawalPhase,
                        srcCancellation: privateCancellationPhase,
                        srcPublicCancellation: publicCancellationPhase,
                        dstWithdrawal: withdrawalPhase,
                        dstPublicWithdrawal: publicWithdrawalPhase,
                        dstCancellation: privateCancellationPhase
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


            // Create Dutch auction on Aptos (destination chain) - USER creates this
            console.log('📝 Creating Dutch auction on Aptos...')
            const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
            const hashes = [secretHashBytes] // Single hash for full fill
            const makerAsset = usdtMetadata // USDT metadata address
            const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
            const finality_duration = withdrawalPhase
            const exclusive_duration = withdrawalPhase - finality_duration
            const public_withdrawal_duration = publicWithdrawalPhase - exclusive_duration
            const private_cancellation_duration = privateCancellationPhase - public_withdrawal_duration
            const starting_amount = takingAmount
            const ending_amount = takingAmount / 2n
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

            console.log(`[APT]`, `Dutch auction created in tx ${auctionResult.auctionAddress}`)
            expect(auctionResult.auctionAddress).toBeDefined()
            expect(auctionResult.auctionAddress).not.toBe('')

            // RESOLVER fills the Dutch auction
            console.log(`[APT]`, '🔒 Creating escrow from Dutch auction...')
            const escrowResult = await escrowHelper.createEscrowFromAuctionSingleFill(
                aptosResolverAccount, // RESOLVER fills the auction
                auctionResult.auctionAddress,
                finality_duration,
                exclusive_duration,
                public_withdrawal_duration,
                private_cancellation_duration
            );

            console.log(`[APT]`, `✅ Escrow created! Escrow address: ${escrowResult.escrowAddress}`)
            expect(escrowResult.escrowAddress).toBeDefined()
            expect(escrowResult.escrowAddress).not.toBe('')

            console.log(`[ETH]`, `Creating escrow from order ${orderHash} for ${Number(sdkOrder.makingAmount) / 1_000_000} USDC`)
            console.log(`   - User paying: ${Number(sdkOrder.makingAmount) / 1_000_000} USDC`)

            const fillAmount = sdkOrder.makingAmount
            const idx = secrets.length - 1// last index to fulfill

            const { txHash: orderFillHash, blockHash: srcDeployBlock } = await evmChainResolver.send(
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

            console.log(`[ETH]`, `Escrow created in tx ${orderFillHash}`)

            const srcEscrowEvent = await evmFactory.getSrcDeployEvent(srcDeployBlock)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            const ESCROW_SRC_IMPLEMENTATION = await evmFactory.getSourceImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // Wait for the escrow to be processed (10 seconds to match finality_duration)
            await increaseTime(11)

            // Withdraw from Aptos escrow using the secret
            console.log(`[APT]`, `Withdrawing ${Number(sdkOrder.takingAmount) / 1_000_000} USDT from Aptos escrow`)
            const aptosWithdrawTxHash = await escrowHelper.withdrawFromEscrow(
                aptosResolverAccount,
                escrowResult.escrowAddress,
                secrets[idx]
            );

            console.log(`[APT]`, `Withdrawal successful in tx ${aptosWithdrawTxHash}`)
            expect(aptosWithdrawTxHash).toBeDefined()

            // Withdraw from ETH escrow using the secret
            console.log(`[ETH]`, `Withdrawing ${Number(sdkOrder.makingAmount) / 1_000_000} USDC from ETH escrow`)
            const { txHash: resolverWithdrawHash } = await evmChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secrets[idx], srcEscrowEvent[0])
            )
            console.log(`[ETH]`, `Withdrawal successful in tx ${resolverWithdrawHash}`)

            const resultBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Verify the cross-chain swap worked
            console.log('🎉 Complete ETH → APT swap flow test completed!')

            // Verify that the user transferred funds to resolver on ETH
            expect(initialBalances.evm.user - resultBalances.evm.user).toBe(sdkOrder.makingAmount)
            expect(resultBalances.evm.resolver - initialBalances.evm.resolver).toBe(sdkOrder.makingAmount)

            // Verify Aptos balances
            const finalAptosUserBalance = await fungibleHelper.getBalance(aptosUserAccount.accountAddress.toString(), usdtMetadata)
            const finalAptosResolverBalance = await fungibleHelper.getBalance(aptosResolverAccount.accountAddress.toString(), usdtMetadata)

            // Verify that the resolver received USDT on Aptos (amount should match the swap)
            expect(initialAptosResolverBalance - finalAptosResolverBalance).toBe(BigInt(sdkOrder.takingAmount))
            // Verify that the user's USDT balance decreased (they paid for the swap)
            expect(finalAptosUserBalance - initialAptosUserBalance).toBe(BigInt(sdkOrder.takingAmount))

            // Log the final amounts for clarity
            console.log(`💰 Final amounts:`)
            console.log(`   - Resolver received: ${Number(sdkOrder.makingAmount) / 1_000_000} USDC on Ethereum`)
            console.log(`   - User received: ${Number(finalAptosUserBalance - initialAptosUserBalance) / 1_000_000} USDT on Aptos`)
        })

        it('should swap Ethereum USDC -> Aptos USDT. Multiple fills. Fill 50%', async () => {
            const initialBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Get initial Aptos balances
            const initialAptosUserBalance = await fungibleHelper.getBalance(aptosUserAccount.accountAddress.toString(), usdtMetadata)
            const initialAptosResolverBalance = await fungibleHelper.getBalance(aptosResolverAccount.accountAddress.toString(), usdtMetadata)

            // Create secret for cross-chain swap
            const secrets = Array.from({ length: 11 }).map(() => uint8ArrayToHex(randomBytes(32))) // note: use crypto secure random number in the real world
            const secretHashes = secrets.map((s) => Sdk.HashLock.hashSecret(s))
            const leaves = Sdk.HashLock.getMerkleLeaves(secrets)

            let withdrawalPhase = 10n
            let publicWithdrawalPhase = 100n
            let privateCancellationPhase = 101n
            let publicCancellationPhase = 102n

            let makingAmount = parseUnits('100', 6)
            let takingAmount = parseUnits('99', 6)

            // Create SDK order for ETH side with real source chain values and dummy destination values
            const sdkOrder = Sdk.CrossChainOrder.new(
                new Address(evm.escrowFactory), // Real ETH escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await evmChainUser.getAddress()), // Real ETH maker
                    makingAmount: makingAmount, // 100 USDC (6 decimals)
                    takingAmount: takingAmount, // 99 USDT (6 decimals)
                    makerAsset: new Address(config.chain.evm.tokens.USDC.address), // Real ETH USDC
                    takerAsset: new Address('0x0000000000000000000000000000000000000000') // Dummy APT USDT
                },
                {
                    hashLock: Sdk.HashLock.forMultipleFills(leaves),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: withdrawalPhase,
                        srcPublicWithdrawal: publicWithdrawalPhase,
                        srcCancellation: privateCancellationPhase,
                        srcPublicCancellation: publicCancellationPhase,
                        dstWithdrawal: withdrawalPhase,
                        dstPublicWithdrawal: publicWithdrawalPhase,
                        dstCancellation: privateCancellationPhase
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


            // Create hash bytes for each secret hash
            const secretHashesBytes = secretHashes.map(hash =>
                new Uint8Array(Buffer.from(hash.startsWith('0x') ? hash.slice(2) : hash, 'hex'))
            )

            // Create Dutch auction on Aptos (destination chain) - USER creates this - 50% of the amount
            console.log('📝 Creating Dutch auction on Aptos...')
            const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
            const hashes = secretHashesBytes // Multiple hashes for partial fills
            const makerAsset = usdtMetadata // USDT metadata address
            const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
            const finality_duration = withdrawalPhase
            const exclusive_duration = withdrawalPhase - finality_duration
            const public_withdrawal_duration = publicWithdrawalPhase - exclusive_duration
            const private_cancellation_duration = privateCancellationPhase - public_withdrawal_duration
            const starting_amount = takingAmount
            const ending_amount = takingAmount / 2n
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

            console.log(`[APT]`, `Dutch auction created in tx ${auctionResult.auctionAddress}`)
            expect(auctionResult.auctionAddress).toBeDefined()
            expect(auctionResult.auctionAddress).not.toBe('')

            const fillAmount = sdkOrder.makingAmount / 2n
            const idx = Number((BigInt(secrets.length - 1) * (fillAmount - 1n)) / sdkOrder.makingAmount)

            // RESOLVER fills the Dutch auction
            console.log('🔒 Creating escrow from Dutch auction...')
            const escrowResult = await escrowHelper.createEscrowFromAuctionPartialFill(
                aptosResolverAccount, // RESOLVER fills the auction
                auctionResult.auctionAddress,
                idx,
                finality_duration,
                exclusive_duration,
                public_withdrawal_duration,
                private_cancellation_duration
            );

            console.log(`✅ Escrow created! Escrow address: ${escrowResult.escrowAddress}`)
            expect(escrowResult.escrowAddress).toBeDefined()
            expect(escrowResult.escrowAddress).not.toBe('')

            // Resolver fills order on source chain (ETH) - 50% fill
            const resolverContract = new Resolver(evm.resolver, evm.resolver)

            // Create signature for SDK order
            const signature = await evmChainUser.signOrder(srcChainId, sdkOrder)
            const orderHash = sdkOrder.getOrderHash(srcChainId)


            console.log(`[ETH]`, `Creating escrow from order ${orderHash} for ${Number(sdkOrder.makingAmount) / 1_000_000} USDC`)
            console.log(`   - User paying: ${Number(sdkOrder.makingAmount) / 1_000_000} USDC`)

            const { txHash: orderFillHash, blockHash: srcDeployBlock } = await evmChainResolver.send(
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

            console.log(`[ETH]`, `Escrow created in tx ${orderFillHash}`)

            const srcEscrowEvent = await evmFactory.getSrcDeployEvent(srcDeployBlock)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            const ESCROW_SRC_IMPLEMENTATION = await evmFactory.getSourceImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // Wait for the escrow to be processed (10 seconds to match finality_duration)
            await increaseTime(11)

            // Withdraw from Aptos escrow using the secret
            console.log(`[APT]`, `Withdrawing ${Number(sdkOrder.takingAmount) / 1_000_000} USDT from Aptos escrow`)
            const aptosWithdrawTxHash = await escrowHelper.withdrawFromEscrow(
                aptosResolverAccount,
                escrowResult.escrowAddress,
                secrets[idx]
            );

            console.log(`[APT]`, `Withdrawal successful in tx ${aptosWithdrawTxHash}`)
            expect(aptosWithdrawTxHash).toBeDefined()

            // Withdraw from ETH escrow using the secret
            console.log(`[ETH]`, `Withdrawing ${Number(sdkOrder.makingAmount) / 1_000_000} USDC from ETH escrow`)
            const { txHash: resolverWithdrawHash } = await evmChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secrets[idx], srcEscrowEvent[0])
            )
            console.log(`[ETH]`, `Withdrawal successful in tx ${resolverWithdrawHash}`)

            const resultBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Verify the cross-chain swap worked
            console.log('🎉 Complete ETH → APT swap flow test completed!')

            // Verify that the user transferred funds to resolver on ETH (50% fill)
            expect(initialBalances.evm.user - resultBalances.evm.user).toBe(fillAmount)
            expect(resultBalances.evm.resolver - initialBalances.evm.resolver).toBe(fillAmount)

            // Verify Aptos balances
            const finalAptosUserBalance = await fungibleHelper.getBalance(aptosUserAccount.accountAddress.toString(), usdtMetadata)
            const finalAptosResolverBalance = await fungibleHelper.getBalance(aptosResolverAccount.accountAddress.toString(), usdtMetadata)

            // Verify that the resolver received USDT on Aptos (amount should match the swap)
            expect(initialAptosResolverBalance - finalAptosResolverBalance).toBe(BigInt(sdkOrder.takingAmount / 2n))
            // Verify that the user's USDT balance decreased (they paid for the swap)
            expect(finalAptosUserBalance - initialAptosUserBalance).toBe(BigInt(sdkOrder.takingAmount / 2n))
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

            let withdrawalPhase = 10n
            let publicWithdrawalPhase = 100n
            let privateCancellationPhase = 101n
            let publicCancellationPhase = 102n

            let makingAmount = parseUnits('99', 6)
            let takingAmount = parseUnits('100', 6)

            // Create SDK order for ETH side with dummy source chain values and real destination values
            const sdkOrder = Sdk.CrossChainOrder.new(
                new Address('0x0000000000000000000000000000000000000000'), // Dummy APT escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address('0x0000000000000000000000000000000000000000'), // Dummy APT maker
                    makingAmount: makingAmount, // 99 USDT (6 decimals) - APT side
                    takingAmount: takingAmount, // 100 USDC (6 decimals) - ETH side
                    makerAsset: new Address('0x0000000000000000000000000000000000000000'), // Dummy APT USDT
                    takerAsset: new Address(config.chain.evm.tokens.USDC.address) // Real ETH USDC
                },
                {
                    hashLock: Sdk.HashLock.forSingleFill(secret),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: withdrawalPhase,
                        srcPublicWithdrawal: publicWithdrawalPhase,
                        srcCancellation: privateCancellationPhase,
                        srcPublicCancellation: publicCancellationPhase,
                        dstWithdrawal: withdrawalPhase,
                        dstPublicWithdrawal: publicWithdrawalPhase,
                        dstCancellation: privateCancellationPhase
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
            const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
            const finality_duration = withdrawalPhase
            const exclusive_duration = withdrawalPhase - finality_duration
            const public_withdrawal_duration = publicWithdrawalPhase - exclusive_duration
            const private_cancellation_duration = privateCancellationPhase - public_withdrawal_duration
            const amount = makingAmount

            const fusionOrderResult = await fusionOrderHelper.createOrder(
                aptosUserAccount, // USER creates the fusion order
                order_hash,
                [secretHashBytes], // Single hash for full fill
                makerAsset, // metadata
                amount,
                [APTOS_ACCOUNTS.RESOLVER.address], // resolver whitelist
                safety_deposit_amount,
                finality_duration,
                exclusive_duration,
                public_withdrawal_duration,
                private_cancellation_duration
            );

            console.log(`✅ Fusion order created! Order address: ${fusionOrderResult.orderAddress}`)
            console.log(`   - User transferring: ${Number(amount) / 1_000_000} USDT`)

            expect(fusionOrderResult.orderAddress).toBeDefined()
            expect(fusionOrderResult.orderAddress).not.toBe('')

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

            console.log(`[${dstChainId}]`, `Creating escrow from order ${orderHash} for ${Number(dstImmutables.amount) / 1_000_000} USDC`)
            console.log(`   - Resolver paying: ${Number(dstImmutables.amount) / 1_000_000} USDC`)
            const { txHash: dstDepositHash, blockTimestamp: dstDeployedAt } = await evmChainResolver.send(
                resolverContract.deployDst(dstImmutables)
            )

            console.log(`[${dstChainId}]`, `Escrow created in tx ${dstDepositHash}`)

            const ESCROW_DST_IMPLEMENTATION = await evmFactory.getDestinationImpl()

            const dstEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getDstEscrowAddress(
                dstImmutablesBase,
                dstComplement,
                dstDeployedAt,
                new Address(resolverContract.dstAddress),
                ESCROW_DST_IMPLEMENTATION
            )


            // RESOLVER fills the fusion order on Aptos (source chain)
            console.log('🔒 Creating escrow from fusion order on Aptos...')
            console.log(`   - Resolver paying: ${Number(amount) / 1_000_000} USDT`)
            const escrowResult = await escrowHelper.createEscrowFromOrderSingleFill(
                aptosResolverAccount, // RESOLVER fills the fusion order
                fusionOrderResult.orderAddress
            );

            console.log(`[APT]`, `Escrow created in tx ${escrowResult.escrowAddress}`)
            expect(escrowResult.escrowAddress).toBeDefined()
            expect(escrowResult.escrowAddress).not.toBe('')

            // Wait for the escrow to be processed (10 seconds to match finality_duration)
            await increaseTime(11)

            // User shares key after validation of dst escrow deployment
            console.log(`[${dstChainId}]`, `Withdrawing ${Number(sdkOrder.takingAmount) / 1_000_000} USDC from ETH escrow`)

            await evmChainResolver.send(
                resolverContract.withdraw('dst', dstEscrowAddress, secret, dstImmutables.withDeployedAt(dstDeployedAt))
            )
            const resultBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Withdraw from Aptos escrow using the secret
            console.log(`[APT]`, `Withdrawing ${Number(sdkOrder.takingAmount) / 1_000_000} USDT from Aptos escrow`)
            const aptosWithdrawTxHash = await escrowHelper.withdrawFromEscrow(
                aptosResolverAccount,
                escrowResult.escrowAddress,
                secret
            );

            console.log(`[APT]`, `Withdrawal successful in tx ${aptosWithdrawTxHash}`)
            expect(aptosWithdrawTxHash).toBeDefined()

            // Verify the cross-chain swap worked
            console.log('🎉 APT → ETH swap completed successfully!')

            // Verify that the resolver transferred funds to user on ETH
            expect(resultBalances.evm.user - initialBalances.evm.user).toBe(sdkOrder.takingAmount)
            expect(initialBalances.evm.resolver - resultBalances.evm.resolver).toBe(sdkOrder.takingAmount)

            // Verify Aptos balances
            const finalAptosUserBalance = await fungibleHelper.getBalance(aptosUserAccount.accountAddress.toString(), usdtMetadata)
            const finalAptosResolverBalance = await fungibleHelper.getBalance(aptosResolverAccount.accountAddress.toString(), usdtMetadata)

            // Verify that the resolver received USDT on Aptos (amount should match the swap)
            expect(finalAptosResolverBalance - initialAptosResolverBalance).toBe(BigInt(sdkOrder.makingAmount))
            // Verify that the user's USDT balance decreased (they paid for the swap)
            expect(initialAptosUserBalance - finalAptosUserBalance).toBe(BigInt(sdkOrder.makingAmount))

            // Log the final amounts for clarity
            console.log(`💰 Final amounts:`)
            console.log(`   - User received: ${Number(sdkOrder.takingAmount) / 1_000_000} USDC on Ethereum`)
            console.log(`   - Resolver received: ${Number(finalAptosResolverBalance - initialAptosResolverBalance) / 1_000_000} USDT on Aptos`)
        })

    })

    // eslint-disable-next-line max-lines-per-function
    describe('Cancel', () => {
        it('should cancel swap Ethereum USDC -> Aptos USDT', async () => {

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

            let withdrawalPhase = 1n
            let publicWithdrawalPhase = 10n
            let privateCancellationPhase = 11n
            let publicCancellationPhase = 12n

            let makingAmount = parseUnits('100', 6)
            let takingAmount = parseUnits('99', 6)

            // Create SDK order for ETH side with real source chain values and dummy destination values
            const sdkOrder = Sdk.CrossChainOrder.new(
                new Address(evm.escrowFactory), // Real ETH escrow factory
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await evmChainUser.getAddress()), // Real ETH maker
                    makingAmount: makingAmount, // 100 USDC (6 decimals)
                    takingAmount: takingAmount, // 99 USDT (6 decimals)
                    makerAsset: new Address(config.chain.evm.tokens.USDC.address), // Real ETH USDC
                    takerAsset: new Address('0x0000000000000000000000000000000000000000') // Dummy APT USDT
                },
                {
                    hashLock: Sdk.HashLock.forSingleFill(secret),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: withdrawalPhase,
                        srcPublicWithdrawal: publicWithdrawalPhase,
                        srcCancellation: privateCancellationPhase,
                        srcPublicCancellation: publicCancellationPhase,
                        dstWithdrawal: withdrawalPhase,
                        dstPublicWithdrawal: publicWithdrawalPhase,
                        dstCancellation: privateCancellationPhase
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


            // Create Dutch auction on Aptos (destination chain) - USER creates this
            console.log('📝 Creating Dutch auction on Aptos...')
            const order_hash = new Uint8Array(Buffer.from('order_hash_123', 'utf8'))
            const hashes = [secretHashBytes] // Single hash for full fill
            const makerAsset = usdtMetadata // USDT metadata address
            const safety_deposit_amount = BigInt(10_000) // 0.0001 APT (8 decimals)
            const finality_duration = withdrawalPhase
            const exclusive_duration = withdrawalPhase - finality_duration
            const public_withdrawal_duration = publicWithdrawalPhase - exclusive_duration
            const private_cancellation_duration = privateCancellationPhase - public_withdrawal_duration
            const starting_amount = takingAmount
            const ending_amount = takingAmount / 2n
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


            // Resolver fills order on source chain (ETH)
            const resolverContract = new Resolver(evm.resolver, evm.resolver)

            console.log(`[ETH]`, `Creating escrow from order ${orderHash} for ${Number(sdkOrder.makingAmount) / 1_000_000} USDC`)
            console.log(`   - User paying: ${Number(sdkOrder.makingAmount) / 1_000_000} USDC`)

            const fillAmount = sdkOrder.makingAmount
            const { txHash: orderFillHash, blockHash: srcDeployBlock } = await evmChainResolver.send(
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

            console.log(`[ETH]`, `Escrow created in tx ${orderFillHash}`)

            const srcEscrowEvent = await evmFactory.getSrcDeployEvent(srcDeployBlock)

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            const ESCROW_SRC_IMPLEMENTATION = await evmFactory.getSourceImpl()

            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // Wait for cancellation time (10 seconds)
            await increaseTime(15)

            // Cancel Aptos escrow (user does not share secret)
            console.log('❌ Cancelling Aptos escrow...')
            const aptosCancelTxHash = await escrowHelper.cancelEscrow(
                aptosResolverAccount,
                escrowResult.escrowAddress
            );

            console.log(`✅ Aptos cancellation successful! Transaction: ${aptosCancelTxHash}`)
            expect(aptosCancelTxHash).toBeDefined()

            // Cancel ETH escrow (user does not share secret)
            console.log(`[ETH]`, `Cancelling ETH escrow ${srcEscrowAddress}`)
            const { txHash: cancelSrcEscrow } = await evmChainResolver.send(
                resolverContract.cancel('src', srcEscrowAddress, srcEscrowEvent[0])
            )
            console.log(`[ETH]`, `Cancelled ETH escrow ${srcEscrowAddress} in tx ${cancelSrcEscrow}`)

            const resultBalances = await getBalances(
                config.chain.evm.tokens.USDC.address,
                config.chain.evm.tokens.USDC.address
            )

            // Verify that balances are unchanged (cancellation successful)
            expect(initialBalances).toEqual(resultBalances)
        })
    })
})

async function initChain(
    cnf: ChainConfig
): Promise<{ node?: CreateServerReturnType; provider: JsonRpcProvider; escrowFactory: string; resolver: string }> {
    const { node, provider } = await getProvider(cnf)
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
    return { node: node, provider, resolver, escrowFactory }
}

async function getProvider(cnf: ChainConfig): Promise<{ node?: CreateServerReturnType; provider: JsonRpcProvider }> {
    if (!cnf.createFork) {
        return {
            provider: new JsonRpcProvider(cnf.url, cnf.chainId, {
                cacheTimeout: -1,
                staticNetwork: true
            })
        }
    }

    const node = createServer({
        instance: anvil({ forkUrl: cnf.url, chainId: cnf.chainId }),
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
    json: { abi: any; bytecode: any },
    params: unknown[],
    provider: JsonRpcProvider,
    deployer: SignerWallet
): Promise<string> {
    const deployed = await new ContractFactory(json.abi, json.bytecode, deployer).deploy(...params)
    await deployed.waitForDeployment()

    return await deployed.getAddress()
}
