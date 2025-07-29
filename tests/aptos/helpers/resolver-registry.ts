import { Aptos, Account } from '@aptos-labs/ts-sdk'
import { ACCOUNTS, createAptosClient } from '../setup'

export class ResolverRegistryHelper {
    private client: Aptos
    private fusionAddress: string

    constructor() {
        this.client = createAptosClient()
        this.fusionAddress = ACCOUNTS.FUSION.address
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
}