import { Aptos, Account } from '@aptos-labs/ts-sdk'
import { ACCOUNTS, createAptosClient } from '../setup'

export class FusionHelper {
    private client: Aptos
    private fusionAddress: string

    constructor() {
        this.client = createAptosClient()
        this.fusionAddress = ACCOUNTS.FUSION.address
    }

    // Create a fusion order and return both tx hash and order address
    async createOrder(
        user: Account,
        asset: string,
        amount: bigint,
        chain_id: bigint,
        hash: Uint8Array
    ): Promise<{ txHash: string; orderAddress: string }> {
        try {
            console.log('🔧 AVH hash =', hash)
            const transaction = await this.client.transaction.build.simple({
                sender: user.accountAddress,
                data: {
                    function: `${this.fusionAddress}::fusion_order::new_entry`,
                    typeArguments: [],
                    functionArguments: [
                        asset,
                        amount,
                        chain_id,
                        hash
                    ]
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

    // Create escrow from fusion order
    async createEscrowFromOrder(
        resolver: Account,
        fusionOrder: string
    ): Promise<{ txHash: string; escrowAddress: string }> {
        try {
            console.log('🔧 Creating escrow from fusion order:', fusionOrder);
            const transaction = await this.client.transaction.build.simple({
                sender: resolver.accountAddress,
                data: {
                    function: `${this.fusionAddress}::escrow::new_from_order_entry`,
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

    // Create escrow from fusion order
    async createEscrowFromResolver(
        resolver: Account,
        recipient_address: string,
        asset: string,
        amount: bigint,
        chain_id: bigint,
        hash: Uint8Array
    ): Promise<{ txHash: string; escrowAddress: string }> {
        try {
            console.log('🔧 Creating escrow from resolver:', resolver.accountAddress.toString());


            const transaction = await this.client.transaction.build.simple({
                sender: resolver.accountAddress,
                data: {
                    function: `${this.fusionAddress}::escrow::new_from_resolver_entry`,
                    typeArguments: [],
                    functionArguments: [recipient_address, asset, amount, chain_id, hash]
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

    // Get order details
    async createHashFromSecret(
        secret: Uint8Array
    ): Promise<any> {
        try {
            // Convert to bytes if it's a string
            const secretBytes = typeof secret === 'string'
                ? new Uint8Array(Buffer.from(secret, 'hex'))
                : secret;

            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::hashlock::create_hash_for_test`,
                    typeArguments: [],
                    functionArguments: [Array.from(secretBytes)]
                }
            });
            console.log('AVH HASH_RAW =', response)
            return response[0];
        } catch (error) {
            console.log(`Error getting order: ${error}`);
            return null;
        }
    }

    // Get order details
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
            console.log(`Error getting order: ${error}`);
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
            console.log('🔧 Withdrawing from escrow:', escrowAddress);
            // Convert to bytes if it's a string
            const secretBytes = typeof secret === 'string'
                ? new Uint8Array(Buffer.from(secret.startsWith('0x') ? secret.slice(2) : secret, 'hex'))
                : secret;

            const transaction = await this.client.transaction.build.simple({
                sender: resolver.accountAddress,
                data: {
                    function: `${this.fusionAddress}::escrow::withdraw`,
                    typeArguments: [],
                    functionArguments: [escrowAddress, Array.from(secretBytes)]
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

    // Register resolver in the registry
    async registerResolver(
        admin: Account,
        resolverAddress: string
    ): Promise<string> {
        try {
            console.log('🔧 Registering resolver:', resolverAddress);
            const transaction = await this.client.transaction.build.simple({
                sender: admin.accountAddress,
                data: {
                    function: `${this.fusionAddress}::resolver_registry::register_resolver`,
                    typeArguments: [],
                    functionArguments: [resolverAddress]
                },
            });

            const adminSignature = await this.client.transaction.sign({
                signer: admin,
                transaction,
            });

            const submitResponse = await this.client.transaction.submit.simple({
                transaction,
                senderAuthenticator: adminSignature,
            });

            await this.client.waitForTransaction({ transactionHash: submitResponse.hash });
            return submitResponse.hash;
        } catch (error) {
            console.log(`Error registering resolver: ${error}`);
            throw error;
        }
    }

    // Check if resolver is active
    async isResolverActive(resolverAddress: string): Promise<boolean> {
        try {
            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::resolver_registry::is_active_resolver`,
                    typeArguments: [],
                    functionArguments: [resolverAddress]
                }
            });
            return response[0] as boolean;
        } catch (error) {
            console.log(`Error checking resolver status: ${error}`);
            return false;
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

    // Cancel order
    async cancelOrder(
        user: Account,
        orderId: string
    ): Promise<string> {
        try {
            const transaction = await this.client.transaction.build.simple({
                sender: user.accountAddress,
                data: {
                    function: `${this.fusionAddress}::fusion_order::cancel_order`,
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
}