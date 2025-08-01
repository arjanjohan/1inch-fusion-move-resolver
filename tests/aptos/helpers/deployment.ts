import { Aptos } from '@aptos-labs/ts-sdk'
import { ACCOUNTS, createAptosClient, NETWORK_CONFIG } from '../setup'
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

export class DeploymentHelper {
    private client: Aptos
    private __dirname: string

    constructor() {
        this.client = createAptosClient()
        this.__dirname = dirname(fileURLToPath(import.meta.url))
    }

    // Check if Fusion contracts are deployed
    async isFusionDeployed(): Promise<boolean> {
        try {
            // Try to call a view function from the fusion package
            const response = await this.client.view({
                payload: {
                    function: `${ACCOUNTS.FUSION.address}::escrow::safety_deposit_metadata`,
                    typeArguments: [],
                    functionArguments: []
                }
            });
            console.log('✅ Fusion contracts are already deployed')
            console.log('🔍 Safety deposit amount:', response[0])
            return true
        } catch (error) {
            console.log('❌ Fusion contracts not deployed')
            console.log('🔍 Error details:', error)
            return false
        }
    }

    // Check if USDT contract is deployed
    async isUsdtDeployed(): Promise<boolean> {
        try {
            // Try to call a view function from the USDT contract
            const response = await this.client.view({
                payload: {
                    function: `${ACCOUNTS.USDT.address}::usdt::metadata`,
                    typeArguments: [],
                    functionArguments: []
                }
            });
            console.log('✅ USDT contract is already deployed')
            console.log('🔍 USDT metadata:', response[0])
            return true
        } catch (error) {
            console.log('❌ USDT contract not deployed')
            console.log('🔍 Error details:', error)
            return false
        }
    }

    // Deploy Fusion contracts
    async deployFusion(): Promise<void> {
        console.log('🚀 Deploying Fusion contracts...')
        try {
            const projectRoot = join(this.__dirname, '../../..')
            execSync('bash scripts/deploy-fusion.sh', {
                cwd: projectRoot,
                stdio: 'inherit'
            })
            console.log('✅ Fusion contracts deployed successfully')
        } catch (error) {
            console.error('❌ Failed to deploy Fusion contracts:', error)
            throw error
        }
    }

    // Deploy USDT contract
    async deployUsdt(): Promise<void> {
        console.log('🚀 Deploying USDT contract...')
        try {
            const projectRoot = join(this.__dirname, '../../..')
            execSync('bash scripts/deploy-usdt-local.sh', {
                cwd: projectRoot,
                stdio: 'inherit'
            })
            console.log('✅ USDT contract deployed successfully')
        } catch (error) {
            console.error('❌ Failed to deploy USDT contract:', error)
            throw error
        }
    }

    // Check and deploy all contracts if needed
    async ensureContractsDeployed(): Promise<void> {
        console.log('🔍 Checking contract deployment status...')
        console.log('🔍 Fusion address:', ACCOUNTS.FUSION.address)
        console.log('🔍 USDT address:', ACCOUNTS.USDT.address)

        const [fusionDeployed, usdtDeployed] = await Promise.all([
            this.isFusionDeployed(),
            this.isUsdtDeployed()
        ])

        const deployments: Promise<void>[] = []

        if (!fusionDeployed) {
            deployments.push(this.deployFusion())
        }

        if (!usdtDeployed) {
            deployments.push(this.deployUsdt())
        }

        if (deployments.length > 0) {
            console.log(`📦 Deploying ${deployments.length} contract(s)...`)
            await Promise.all(deployments)
            console.log('✅ All contracts deployed successfully')
        } else {
            console.log('✅ All contracts are already deployed')
        }
    }
}