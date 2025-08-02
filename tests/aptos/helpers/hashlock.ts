import { Aptos } from '@aptos-labs/ts-sdk'
import { ACCOUNTS, createAptosClient } from '../setup'

export class HashlockHelper {
    private client: Aptos
    private fusionAddress: string

    constructor() {
        this.client = createAptosClient()
        this.fusionAddress = ACCOUNTS.FUSION.address
    }

    // Create hash from secret for testing
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
            return response[0];
        } catch (error) {
            console.log(`Error creating hash from secret: ${error}`);
            return null;
        }
    }
}