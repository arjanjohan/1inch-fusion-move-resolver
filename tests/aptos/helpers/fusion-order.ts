import { Aptos, Account } from '@aptos-labs/ts-sdk'
import { ACCOUNTS, createAptosClient } from '../setup'

export class FusionOrderHelper {
    private client: Aptos
    private fusionAddress: string

    constructor() {
        this.client = createAptosClient()
        this.fusionAddress = ACCOUNTS.FUSION.address
    }

    // Create a fusion order and return both tx hash and order address
    async createOrder(
        user: Account,
        order_hash: Uint8Array,
        hashes: Uint8Array[],
        metadata: string,
        amount: bigint,
        resolver_whitelist: string[],
        safety_deposit_amount: bigint,
        finality_duration: bigint,
        exclusive_duration: bigint,
        public_withdrawal_duration: bigint,
        private_cancellation_duration: bigint,
        auto_cancel_after?: bigint
    ): Promise<{ txHash: string; orderAddress: string }> {
        try {
            console.log('🔧 Creating fusion order with order_hash:', order_hash);
            console.log('🔧 Creating fusion order with hashes:', hashes.length);

            const functionArguments = [
                order_hash,
                hashes.map(hash => Array.from(hash)),
                metadata,
                amount,
                safety_deposit_amount,
                resolver_whitelist,
                finality_duration,
                exclusive_duration,
                public_withdrawal_duration,
                private_cancellation_duration,
                auto_cancel_after ? [auto_cancel_after] : undefined
            ];

            const transaction = await this.client.transaction.build.simple({
                sender: user.accountAddress,
                data: {
                    function: `${this.fusionAddress}::router::create_fusion_order`,
                    typeArguments: [],
                    functionArguments
                },
            });

            const userSignature = await this.client.transaction.sign({
                signer: user,
                transaction,
            });

            const submitResponse = await this.client.transaction.submit.simple({
                transaction,
                senderAuthenticator: userSignature,
            });

            const txResult = await this.client.waitForTransaction({ transactionHash: submitResponse.hash });

            // Extract order address from events
            const orderAddress = this.extractOrderAddressFromEvents(txResult);

            return {
                txHash: submitResponse.hash,
                orderAddress: orderAddress
            };
        } catch (error) {
            console.log(`Error creating fusion order: ${error}`);
            throw error;
        }
    }

    // Cancel order
    async cancelOrder(
        user: Account,
        orderId: string
    ): Promise<string> {
        try {
            const transaction = await this.client.transaction.build.simple({
                sender: user.accountAddress,
                data: {
                    function: `${this.fusionAddress}::router::cancel_fusion_order`,
                    typeArguments: [],
                    functionArguments: [orderId]
                },
            });

            const userSignature = await this.client.transaction.sign({
                signer: user,
                transaction,
            });

            const submitResponse = await this.client.transaction.submit.simple({
                transaction,
                senderAuthenticator: userSignature,
            });

            await this.client.waitForTransaction({ transactionHash: submitResponse.hash });
            return submitResponse.hash;
        } catch (error) {
            console.log(`Error canceling order: ${error}`);
            throw error;
        }
    }

    // Get order details
    async getOrder(orderId: string): Promise<any> {
        try {
            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::fusion_order::get_order`,
                    typeArguments: [],
                    functionArguments: [orderId]
                }
            });
            return response[0];
        } catch (error) {
            console.log(`Error getting order: ${error}`);
            return null;
        }
    }

    // Extract order address from transaction events
    private extractOrderAddressFromEvents(txResult: any): string {
        try {
            // Look for events from the fusion_order module
            const events = txResult.events || [];

            for (const event of events) {
                // Check if this is a fusion order creation event
                if (event.type && event.type.includes('fusion_order::FusionOrderCreatedEvent')) {
                    console.log('📝 Found FusionOrderCreatedEvent:', event);

                    // The fusion_order field contains the order address
                    if (event.data && event.data.fusion_order) {
                        console.log('📦 Fusion order object:', event.data.fusion_order);

                        // If fusion_order is an object, it might have an inner property
                        if (typeof event.data.fusion_order === 'object' && event.data.fusion_order.inner) {
                            console.log(`📦 Found order address in fusion_order.inner: ${event.data.fusion_order.inner}`);
                            return event.data.fusion_order.inner;
                        }

                        // If fusion_order is a string, return it directly
                        if (typeof event.data.fusion_order === 'string') {
                            console.log(`📦 Found order address in fusion_order: ${event.data.fusion_order}`);
                            return event.data.fusion_order;
                        }

                        // If fusion_order is an object, try to find the address in its properties
                        if (typeof event.data.fusion_order === 'object') {
                            for (const [key, value] of Object.entries(event.data.fusion_order)) {
                                if (typeof value === 'string' && value.startsWith('0x') && value.length === 66) {
                                    console.log(`📦 Found order address in fusion_order.${key}: ${value}`);
                                    return value;
                                }
                            }
                        }
                    }
                }
            }

            console.log('⚠️ No FusionOrderCreatedEvent found in transaction');
            console.log('📋 Available events:', events);
            return '';
        } catch (error) {
            console.log(`Error extracting order address: ${error}`);
            return '';
        }
    }

    // Helper function to get safety deposit metadata
    private safety_deposit_metadata(): string {
        return '0xa'; // APT metadata address
    }
}