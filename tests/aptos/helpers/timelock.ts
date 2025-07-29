import { Aptos } from '@aptos-labs/ts-sdk'
import { ACCOUNTS, createAptosClient } from '../setup'

export class TimelockHelper {
    private client: Aptos
    private fusionAddress: string

    constructor() {
        this.client = createAptosClient()
        this.fusionAddress = ACCOUNTS.FUSION.address
    }

    // Future timelock functions can be added here
    // For example: get timelock phases, check current phase, etc.
}