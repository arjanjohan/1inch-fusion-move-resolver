import { Aptos, Account } from '@aptos-labs/ts-sdk'
import { ACCOUNTS, createAptosClient } from '../setup'

export class DutchAuctionHelper {
    private client: Aptos
    private fusionAddress: string

    constructor() {
        this.client = createAptosClient()
        this.fusionAddress = ACCOUNTS.FUSION.address
    }

    // Create a Dutch auction and return both tx hash and auction address
    async createAuction(
        user: Account,
        order_hash: Uint8Array,
        hashes: Uint8Array[],
        metadata: string,
        starting_amount: bigint,
        ending_amount: bigint,
        auction_start_time: bigint,
        auction_end_time: bigint,
        decay_duration: bigint,
        safety_deposit_amount: bigint
    ): Promise<{ txHash: string; auctionAddress: string }> {
        try {
            console.log('🔧 Creating Dutch auction with order_hash:', order_hash);
            console.log('🔧 Creating Dutch auction with hashes:', hashes.length);

            const functionArguments = [
                Array.from(order_hash),
                hashes.map(hash => Array.from(hash)),
                metadata,
                starting_amount,
                ending_amount,
                auction_start_time,
                auction_end_time,
                decay_duration,
                safety_deposit_amount
            ];

            const transaction = await this.client.transaction.build.simple({
                sender: user.accountAddress,
                data: {
                    function: `${this.fusionAddress}::router::create_auction`,
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

            // Extract auction address from events
            const auctionAddress = this.extractAuctionAddressFromEvents(txResult);

            return {
                txHash: submitResponse.hash,
                auctionAddress: auctionAddress
            };
        } catch (error) {
            console.log(`Error creating Dutch auction: ${error}`);
            throw error;
        }
    }

    // Cancel auction
    async cancelAuction(
        user: Account,
        auctionId: string
    ): Promise<string> {
        try {
            const transaction = await this.client.transaction.build.simple({
                sender: user.accountAddress,
                data: {
                    function: `${this.fusionAddress}::router::cancel_auction`,
                    typeArguments: [],
                    functionArguments: [auctionId]
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
            console.log(`Error canceling auction: ${error}`);
            throw error;
        }
    }

    // Get current auction amount
    async getCurrentAmount(auctionId: string): Promise<bigint> {
        try {
            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::dutch_auction::get_current_amount`,
                    typeArguments: [],
                    functionArguments: [auctionId]
                }
            });
            return BigInt(response[0] as string);
        } catch (error) {
            console.log(`Error getting current amount: ${error}`);
            return BigInt(0);
        }
    }

    // Check if auction has started
    async hasStarted(auctionId: string): Promise<boolean> {
        try {
            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::dutch_auction::has_started`,
                    typeArguments: [],
                    functionArguments: [auctionId]
                }
            });
            return response[0] as boolean;
        } catch (error) {
            console.log(`Error checking if auction has started: ${error}`);
            return false;
        }
    }

    // Check if auction has ended
    async hasEnded(auctionId: string): Promise<boolean> {
        try {
            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::dutch_auction::has_ended`,
                    typeArguments: [],
                    functionArguments: [auctionId]
                }
            });
            return response[0] as boolean;
        } catch (error) {
            console.log(`Error checking if auction has ended: ${error}`);
            return false;
        }
    }

    // Get auction details
    async getAuctionDetails(auctionId: string): Promise<any> {
        try {
            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::dutch_auction::get_order_hash`,
                    typeArguments: [],
                    functionArguments: [auctionId]
                }
            });
            return response[0];
        } catch (error) {
            console.log(`Error getting auction details: ${error}`);
            return null;
        }
    }

    // Extract auction address from transaction events
    private extractAuctionAddressFromEvents(txResult: any): string {
        try {
            const events = txResult.events || [];

            for (const event of events) {
                // Look for DutchAuctionCreatedEvent
                if (event.type && event.type.includes('dutch_auction::DutchAuctionCreatedEvent')) {
                    console.log('📝 Found DutchAuctionCreatedEvent:', event);

                    // The auction field contains the auction address
                    if (event.data && event.data.auction) {
                        console.log('📦 Auction object:', event.data.auction);

                        // If auction is an object, it might have an inner property
                        if (typeof event.data.auction === 'object' && event.data.auction.inner) {
                            console.log(`📦 Found auction address in auction.inner: ${event.data.auction.inner}`);
                            return event.data.auction.inner;
                        }

                        // If auction is a string, return it directly
                        if (typeof event.data.auction === 'string') {
                            console.log(`📦 Found auction address in auction: ${event.data.auction}`);
                            return event.data.auction;
                        }

                        // If auction is an object, try to find the address in its properties
                        if (typeof event.data.auction === 'object') {
                            for (const [key, value] of Object.entries(event.data.auction)) {
                                if (typeof value === 'string' && value.startsWith('0x') && value.length === 66) {
                                    console.log(`📦 Found auction address in auction.${key}: ${value}`);
                                    return value;
                                }
                            }
                        }
                    }
                }
            }

            console.log('⚠️ No DutchAuctionCreatedEvent found in transaction');
            console.log('📋 Available events:', events);
            return '';
        } catch (error) {
            console.log(`Error extracting auction address: ${error}`);
            return '';
        }
    }
}