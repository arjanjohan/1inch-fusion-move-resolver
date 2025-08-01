import { Aptos } from '@aptos-labs/ts-sdk'
import { ACCOUNTS, createAptosClient } from '../setup'

export class TimelockHelper {
    private client: Aptos
    private fusionAddress: string

    constructor() {
        this.client = createAptosClient()
        this.fusionAddress = ACCOUNTS.FUSION.address
    }

    // Get current phase of a timelock
    async getPhase(timelock: any): Promise<number> {
        try {
            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::timelock::get_phase`,
                    typeArguments: [],
                    functionArguments: [timelock]
                }
            });
            return response[0] as number;
        } catch (error) {
            console.log(`Error getting timelock phase: ${error}`);
            return 0;
        }
    }

    // Check if timelock is in exclusive phase
    async isInExclusivePhase(timelock: any): Promise<boolean> {
        try {
            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::timelock::is_in_exclusive_phase`,
                    typeArguments: [],
                    functionArguments: [timelock]
                }
            });
            return response[0] as boolean;
        } catch (error) {
            console.log(`Error checking exclusive phase: ${error}`);
            return false;
        }
    }

    // Check if timelock is in private cancellation phase
    async isInPrivateCancellationPhase(timelock: any): Promise<boolean> {
        try {
            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::timelock::is_in_private_cancellation_phase`,
                    typeArguments: [],
                    functionArguments: [timelock]
                }
            });
            return response[0] as boolean;
        } catch (error) {
            console.log(`Error checking private cancellation phase: ${error}`);
            return false;
        }
    }

    // Check if timelock is in public cancellation phase
    async isInPublicCancellationPhase(timelock: any): Promise<boolean> {
        try {
            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::timelock::is_in_public_cancellation_phase`,
                    typeArguments: [],
                    functionArguments: [timelock]
                }
            });
            return response[0] as boolean;
        } catch (error) {
            console.log(`Error checking public cancellation phase: ${error}`);
            return false;
        }
    }

    // Get remaining time in current phase
    async getRemainingTime(timelock: any): Promise<bigint> {
        try {
            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::timelock::get_remaining_time`,
                    typeArguments: [],
                    functionArguments: [timelock]
                }
            });
            return BigInt(response[0] as string);
        } catch (error) {
            console.log(`Error getting remaining time: ${error}`);
            return BigInt(0);
        }
    }

    // Get timelock durations
    async getDurations(timelock: any): Promise<{finality: bigint, exclusive: bigint, private_cancellation: bigint}> {
        try {
            const response = await this.client.view({
                payload: {
                    function: `${this.fusionAddress}::timelock::get_durations`,
                    typeArguments: [],
                    functionArguments: [timelock]
                }
            });
            return {
                finality: BigInt(response[0] as string),
                exclusive: BigInt(response[1] as string),
                private_cancellation: BigInt(response[2] as string)
            };
        } catch (error) {
            console.log(`Error getting timelock durations: ${error}`);
            return {
                finality: BigInt(0),
                exclusive: BigInt(0),
                private_cancellation: BigInt(0)
            };
        }
    }
}