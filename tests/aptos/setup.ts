import { Aptos, Network, AptosConfig, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk'

// Account configuration with environment variables for private keys
export const ACCOUNTS = {
    FUSION: {
        address: '0x0e6067afa8c1ca1b0cc486ec2a33ef65c3d8678b67ce9f1e4995fddae63cd25b',
        privateKey: process.env.APTOS_FUSION_PRIVATE_KEY || 'ed25519-priv-0xb2ff597cbff60622a6984341f91a732399eb2e08cc9e9a29b4621c36eb537cd8',
        name: 'Fusion'
    },
    USDT: {
        address: '0xa21b820d1b61280cc272d38d55a99df1f440febf7b72709e5927e49afd006b96',
        privateKey: process.env.APTOS_USDT_PRIVATE_KEY || 'ed25519-priv-0xadf44a11ae912a9a811a784627f709f7b0d31c7328fe8795840140c6595c4536',
        name: 'USDT'
    },
    USER: {
        address: '0x8a4a02a3a707fdf7f81ee9ece1e02db3aa1888c6283a12f4abf9d81cc8275a60',
        privateKey: process.env.APTOS_USER_PRIVATE_KEY || 'ed25519-priv-0x13e2b05956b9297849c722bff496bc2a068a709b685fc758234a23a8bddfea95',
        name: 'User'
    },
    RESOLVER: {
        address: '0x55bb788452c5b9489c13c39a67e3588b068b4ae69141de7d250aa0c6b1160842',
        privateKey: process.env.APTOS_RESOLVER_PRIVATE_KEY || 'ed25519-priv-0x141d138b003e1049f285eb2e05ec18f537d8fb61e5bc873263b688b1dd85f10c',
        name: 'Resolver'
    }
}

export const LOCAL_NETWORK_CONFIG = {
    network: Network.LOCAL,
    rpcUrl: 'http://127.0.0.1:8080',
    faucetUrl: 'http://127.0.0.1:8081'
}
// Network configuration
export const APTOS_CONFIG = {
    network: Network.TESTNET,
}

export const MOVEMENT_CONFIG = {
    network: Network.CUSTOM,
    restUrl: 'https://full.testnet.movementinfra.xyz/v1',
}

// Helper to create Aptos client
export function createAptosClient() {
    const aptosConfig = new AptosConfig({
        network: APTOS_CONFIG.network,
        // fullnode: MOVEMENT_CONFIG.restUrl,
    });
    return new Aptos(aptosConfig)
}

// Helper to create account from private key
export function createAccount(privateKey: string): Account {
    const ed25519PrivateKey = new Ed25519PrivateKey(privateKey);
    return Account.fromPrivateKey({ privateKey: ed25519PrivateKey });
}