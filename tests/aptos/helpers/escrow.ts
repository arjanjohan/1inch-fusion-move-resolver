import { Aptos, Account } from '@aptos-labs/ts-sdk'
import { ACCOUNTS, createAptosClient } from '../setup'

export class EscrowHelper {
    private client: Aptos
    private fusionAddress: string

    constructor() {
        this.client = createAptosClient()
        this.fusionAddress = ACCOUNTS.FUSION.address
    }

    // Create escrow from fusion order (single fill)
    async createEscrowFromOrderSingleFill(
        resolver: Account,
        fusionOrder: string
    ): Promise<{ txHash: string; escrowAddress: string }> {
        try {
            console.log('🔧 Creating escrow from fusion order (single fill):', fusionOrder);
            const transaction = await this.client.transaction.build.simple({
                sender: resolver.accountAddress,
                data: {
                    function: `${this.fusionAddress}::router::deploy_source_single_fill`,
                    typeArguments: [],
                    functionArguments: [fusionOrder]
                },
            });

            const resolverSignature = await this.client.transaction.sign({
                signer: resolver,
                transaction,
            });

            const submitResponse = await this.client.transaction.submit.simple({
                transaction,
                senderAuthenticator: resolverSignature,
            });

            const txResult = await this.client.waitForTransaction({ transactionHash: submitResponse.hash });

            // Extract escrow address from events
            const escrowAddress = this.extractEscrowAddressFromEvents(txResult);

            return {
                txHash: submitResponse.hash,
                escrowAddress: escrowAddress
            };
        } catch (error) {
            console.log(`Error creating escrow from order: ${error}`);
            throw error;
        }
    }

    // Create escrow from fusion order (partial fill)
    async createEscrowFromOrderPartialFill(
        resolver: Account,
        fusionOrder: string,
        segment: number
    ): Promise<{ txHash: string; escrowAddress: string }> {
        try {
            console.log('🔧 Creating escrow from fusion order (partial fill):', fusionOrder, 'segment:', segment);
            const transaction = await this.client.transaction.build.simple({
                sender: resolver.accountAddress,
                data: {
                    function: `${this.fusionAddress}::router::deploy_source_partial_fill`,
                    typeArguments: [],
                    functionArguments: [fusionOrder, segment]
                },
            });

            const resolverSignature = await this.client.transaction.sign({
                signer: resolver,
                transaction,
            });

            const submitResponse = await this.client.transaction.submit.simple({
                transaction,
                senderAuthenticator: resolverSignature,
            });

            const txResult = await this.client.waitForTransaction({ transactionHash: submitResponse.hash });

            // Extract escrow address from events
            const escrowAddress = this.extractEscrowAddressFromEvents(txResult);

            return {
                txHash: submitResponse.hash,
                escrowAddress: escrowAddress
            };
        } catch (error) {
            console.log(`Error creating escrow from order: ${error}`);
            throw error;
        }
    }

    // Create escrow from Dutch auction (single fill)
    async createEscrowFromAuctionSingleFill(
        resolver: Account,
        auction: string,
        finality_duration: bigint,
        exclusive_duration: bigint,
        private_cancellation_duration: bigint
    ): Promise<{ txHash: string; escrowAddress: string }> {
        try {
            console.log('🔧 Creating escrow from auction (single fill):', auction);
            const transaction = await this.client.transaction.build.simple({
                sender: resolver.accountAddress,
                data: {
                    function: `${this.fusionAddress}::router::deploy_destination_single_fill`,
                    typeArguments: [],
                    functionArguments: [
                        auction,
                        finality_duration,
                        exclusive_duration,
                        private_cancellation_duration
                    ]
                },
            });

            const resolverSignature = await this.client.transaction.sign({
                signer: resolver,
                transaction,
            });

            const submitResponse = await this.client.transaction.submit.simple({
                transaction,
                senderAuthenticator: resolverSignature,
            });

            const txResult = await this.client.waitForTransaction({ transactionHash: submitResponse.hash });

            // Extract escrow address from events
            const escrowAddress = this.extractEscrowAddressFromEvents(txResult);

            return {
                txHash: submitResponse.hash,
                escrowAddress: escrowAddress
            };
        } catch (error) {
            console.log(`Error creating escrow from auction: ${error}`);
            throw error;
        }
    }

    // Create escrow from Dutch auction (partial fill)
    async createEscrowFromAuctionPartialFill(
        resolver: Account,
        auction: string,
        segment: number,
        finality_duration: bigint,
        exclusive_duration: bigint,
        private_cancellation_duration: bigint
    ): Promise<{ txHash: string; escrowAddress: string }> {
        try {
            console.log('🔧 Creating escrow from auction (partial fill):', auction, 'segment:', segment);
            const transaction = await this.client.transaction.build.simple({
                sender: resolver.accountAddress,
                data: {
                    function: `${this.fusionAddress}::router::deploy_destination_partial_fill`,
                    typeArguments: [],
                    functionArguments: [
                        auction,
                        segment,
                        finality_duration,
                        exclusive_duration,
                        private_cancellation_duration
                    ]
                },
            });

            const resolverSignature = await this.client.transaction.sign({
                signer: resolver,
                transaction,
            });

            const submitResponse = await this.client.transaction.submit.simple({
                transaction,
                senderAuthenticator: resolverSignature,
            });

            const txResult = await this.client.waitForTransaction({ transactionHash: submitResponse.hash });

            // Extract escrow address from events
            const escrowAddress = this.extractEscrowAddressFromEvents(txResult);

            return {
                txHash: submitResponse.hash,
                escrowAddress: escrowAddress
            };
        } catch (error) {
            console.log(`Error creating escrow from auction: ${error}`);
            throw error;
        }
    }

    // Legacy function for backward compatibility
    async createEscrowFromOrder(
        resolver: Account,
        fusionOrder: string
    ): Promise<{ txHash: string; escrowAddress: string }> {
        return this.createEscrowFromOrderSingleFill(resolver, fusionOrder);
    }

    // Legacy function for backward compatibility
    async createEscrowFromResolver(
        resolver: Account,
        order_hash: Uint8Array,
        hash: Uint8Array,
        taker: string,
        metadata: string,
        amount: bigint,
        safety_deposit_amount: bigint,
        finality_duration: bigint,
        exclusive_duration: bigint,
        private_cancellation_duration: bigint
    ): Promise<{ txHash: string; escrowAddress: string }> {
        // This function is deprecated - use createEscrowFromAuctionSingleFill instead
        throw new Error('createEscrowFromResolver is deprecated. Use createEscrowFromAuctionSingleFill instead.');
    }

    // Verify secret in escrow
    async verifySecret(
        escrowAddress: string,
        secret: string | Uint8Array
    ): Promise<any> {
        try {
            // Convert to bytes if it's a string
            const secretBytes = typeof secret === 'string'
                ? new Uint8Array(Buffer.from(secret.startsWith('0x') ? secret.slice(2) : secret, 'hex'))
                : secret;

            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::escrow::verify_secret`,
                    typeArguments: [],
                    functionArguments: [escrowAddress, Array.from(secretBytes)]
                }
            });
            console.log('🔍 Secret verification result:', response);
            return response[0];
        } catch (error) {
            console.log(`Error verifying secret: ${error}`);
            return null;
        }
    }

    // Withdraw from escrow using secret
    async withdrawFromEscrow(
        resolver: Account,
        escrowAddress: string,
        secret: string | Uint8Array
    ): Promise<string> {
        try {
            console.log('💰 Withdrawing from escrow:', escrowAddress);

            // Convert secret to bytes if it's a string
            let secretBytes: Uint8Array;
            if (typeof secret === 'string') {
                secretBytes = new Uint8Array(Buffer.from(secret.startsWith('0x') ? secret.slice(2) : secret, 'hex'));
            } else {
                secretBytes = secret;
            }

            const transaction = await this.client.transaction.build.simple({
                sender: resolver.accountAddress,
                data: {
                    function: `${this.fusionAddress}::router::escrow_withdraw`,
                    typeArguments: [],
                    functionArguments: [escrowAddress, secretBytes]
                },
            });

            const resolverSignature = await this.client.transaction.sign({
                signer: resolver,
                transaction,
            });

            const submitResponse = await this.client.transaction.submit.simple({
                transaction,
                senderAuthenticator: resolverSignature,
            });

            await this.client.waitForTransaction({ transactionHash: submitResponse.hash });

            return submitResponse.hash;
        } catch (error) {
            console.log(`Error withdrawing from escrow: ${error}`);
            throw error;
        }
    }

    // Cancel escrow (when user doesn't share secret)
    async cancelEscrow(
        resolver: Account,
        escrowAddress: string
    ): Promise<string> {
        try {
            console.log('❌ Cancelling escrow:', escrowAddress);

            const transaction = await this.client.transaction.build.simple({
                sender: resolver.accountAddress,
                data: {
                    function: `${this.fusionAddress}::router::escrow_recovery`,
                    typeArguments: [],
                    functionArguments: [escrowAddress]
                },
            });

            const resolverSignature = await this.client.transaction.sign({
                signer: resolver,
                transaction,
            });

            const submitResponse = await this.client.transaction.submit.simple({
                transaction,
                senderAuthenticator: resolverSignature,
            });

            await this.client.waitForTransaction({ transactionHash: submitResponse.hash });

            return submitResponse.hash;
        } catch (error) {
            console.log(`Error cancelling escrow: ${error}`);
            throw error;
        }
    }

    // Extract escrow address from transaction events
    private extractEscrowAddressFromEvents(txResult: any): string {
        try {
            const events = txResult.events || [];

            for (const event of events) {
                // Look for EscrowCreatedEvent
                if (event.type && event.type.includes('escrow::EscrowCreatedEvent')) {

                    // The escrow address should be in the event data
                    if (event.data && event.data.escrow) {

                        // If escrow is an object, it might have an inner property
                        if (typeof event.data.escrow === 'object' && event.data.escrow.inner) {
                            return event.data.escrow.inner;
                        }

                        // If escrow is a string, return it directly
                        if (typeof event.data.escrow === 'string') {
                            return event.data.escrow;
                        }

                        // If escrow is an object, try to find the address in its properties
                        if (typeof event.data.escrow === 'object') {
                            for (const [key, value] of Object.entries(event.data.escrow)) {
                                if (typeof value === 'string' && value.startsWith('0x') && value.length === 66) {
                                    return value;
                                }
                            }
                        }
                    }
                }
            }

            console.log('⚠️ No EscrowCreatedEvent found in transaction');
            console.log('📋 Available events:', events);
            return '';
        } catch (error) {
            console.log(`Error extracting escrow address: ${error}`);
            return '';
        }
    }
}