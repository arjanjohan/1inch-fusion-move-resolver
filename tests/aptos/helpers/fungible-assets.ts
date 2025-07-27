import { Aptos, Account } from '@aptos-labs/ts-sdk'
import { createAptosClient } from '../setup'
import { ACCOUNTS } from '../setup'


export class FungibleAssetsHelper {
    private client: Aptos
    private usdtAddress: string

    constructor() {
        this.client = createAptosClient()
        this.usdtAddress = ACCOUNTS.USDT.address
    }

    // Get balance using primary_fungible_store view function
    async getUsdtMetadata(): Promise<string> {
        try {
            const response = await this.client.view({
                payload: {
                    function:`${this.usdtAddress}::usdt::metadata`,
                    typeArguments: [],
                    functionArguments: []
                }
            });

            // Extract the inner value from the metadata object
            const metadata = response[0] as any;
            return metadata.inner || metadata;
        } catch (error) {
            console.log(`Error getting USDT metadata: ${error}`);
            return '';
        }
    }

    // Get balance using primary_fungible_store view function
    async getBalance(accountAddress: string, tokenAddress: string): Promise<bigint> {
        try {
            const response = await this.client.view({
                payload: {
                    function: '0x1::primary_fungible_store::balance',
                    typeArguments: ['0x1::object::ObjectCore'],
                    functionArguments: [accountAddress, tokenAddress]
                }
            });

            return BigInt(response[0] as string);
        } catch (error) {
            console.log(`Error getting balance: ${error}`);
            return BigInt(0);
        }
    }

    // Transfer tokens using primary_fungible_store
    async transferTokens(
        sender: Account,
        recipient: string,
        tokenAddress: string,
        amount: bigint
    ) {

        const transaction = await this.client.transaction.build.simple({
            sender: sender.accountAddress,
            data: {
                function: '0x1::primary_fungible_store::transfer',
                typeArguments: [],
                functionArguments: [recipient, tokenAddress, amount.toString()]
            },
        });

        const senderSignature = await this.client.transaction.sign({
            signer: sender,
            transaction,
        });

        const submitResponse = await this.client.transaction.submit.simple({
            transaction,
            senderAuthenticator: senderSignature,
        });

        await this.client.waitForTransaction({ transactionHash: submitResponse.hash });
        return submitResponse.hash;
    }

    // Mint tokens using USDT contract
    async mintTokens(
        admin: Account,
        recipient: string,
        amount: bigint
    ) {

        const transaction = await this.client.transaction.build.simple({
            sender: admin.accountAddress,
            data: {
                function: `${this.usdtAddress}::usdt::mint`,
                typeArguments: [],
                functionArguments: [recipient, amount.toString()]
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
    }

    // Faucet tokens using USDT contract
    async faucetToAddress(
        admin: Account,
        recipient: string,
        amount: bigint
    ) {

        const transaction = await this.client.transaction.build.simple({
            sender: admin.accountAddress,
            data: {
                function: `${this.usdtAddress}::usdt::faucet_to_address`,
                typeArguments: [],
                functionArguments: [recipient, amount.toString()]
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
    }
}