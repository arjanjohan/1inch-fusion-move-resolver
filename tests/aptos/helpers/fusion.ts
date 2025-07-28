// Aggregator class that combines all helper modules
// This maintains backward compatibility while organizing code into separate modules

import { EscrowHelper } from './escrow'
import { HashlockHelper } from './hashlock'
import { FusionOrderHelper } from './fusion-order'
import { ResolverRegistryHelper } from './resolver-registry'
import { TimelockHelper } from './timelock'

export class FusionHelper {
    public escrow: EscrowHelper
    public hashlock: HashlockHelper
    public fusionOrder: FusionOrderHelper
    public resolverRegistry: ResolverRegistryHelper
    public timelock: TimelockHelper

    constructor() {
        this.escrow = new EscrowHelper()
        this.hashlock = new HashlockHelper()
        this.fusionOrder = new FusionOrderHelper()
        this.resolverRegistry = new ResolverRegistryHelper()
        this.timelock = new TimelockHelper()
    }

    // Backward compatibility methods - delegate to appropriate helpers
    async createOrder(user: any, asset: string, amount: bigint, chain_id: bigint, hash: Uint8Array) {
        return this.fusionOrder.createOrder(user, asset, amount, chain_id, hash)
    }

    async createEscrowFromOrder(resolver: any, fusionOrder: string) {
        return this.escrow.createEscrowFromOrder(resolver, fusionOrder)
    }

    async createEscrowFromResolver(resolver: any, recipient_address: string, asset: string, amount: bigint, chain_id: bigint, hash: Uint8Array) {
        return this.escrow.createEscrowFromResolver(resolver, recipient_address, asset, amount, chain_id, hash)
    }

    async createHashFromSecret(secret: Uint8Array) {
        return this.hashlock.createHashFromSecret(secret)
    }

    async verifySecret(escrowAddress: string, secret: string | Uint8Array) {
        return this.escrow.verifySecret(escrowAddress, secret)
    }

    async withdrawFromEscrow(resolver: any, escrowAddress: string, secret: string | Uint8Array) {
        return this.escrow.withdrawFromEscrow(resolver, escrowAddress, secret)
    }

    async registerResolver(admin: any, resolverAddress: string) {
        return this.resolverRegistry.registerResolver(admin, resolverAddress)
    }

    async isResolverActive(resolverAddress: string) {
        return this.resolverRegistry.isResolverActive(resolverAddress)
    }

    async getOrder(orderId: string) {
        return this.fusionOrder.getOrder(orderId)
    }

    async cancelOrder(user: any, orderId: string) {
        return this.fusionOrder.cancelOrder(user, orderId)
    }
}