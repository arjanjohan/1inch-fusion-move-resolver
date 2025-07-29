import { Aptos, Network, AptosConfig, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk'

// Real account configuration
export const ACCOUNTS = {
    FUSION: {
        address: '0x5f28002a709921a3bad09df582cdd99a7cab3ec300e99c88fbf50a354e62973b',
        privateKey: 'ed25519-priv-0xb2ff597cbff60622a6984341f91a732399eb2e08cc9e9a29b4621c36eb537cd8',
        name: 'Fusion'
    },
    USDT: {
        address: '0xd7722b8d2a024a318284288409557f6f14ff9b34026949de11ed2dd671475c92', // Default admin address
        privateKey: 'ed25519-priv-0xadf44a11ae912a9a811a784627f709f7b0d31c7328fe8795840140c6595c4536', // Please provide
        name: 'USDT'
    },
    RESOLVER: {
        address: '0x38edf36a736e0d284fdf504a5e6fccfe229240aaf0bd7f5eec4504bfbf291028',
        privateKey: 'ed25519-priv-0x141d138b003e1049f285eb2e05ec18f537d8fb61e5bc873263b688b1dd85f10c',
        name: 'Resolver'
    },
    USER: {
        address: '0x2709c26cf4a2596f10aed0b6533be35a70090372793c348c317ca2ce8c66f0d3',
        privateKey: 'ed25519-priv-0x13e2b05956b9297849c722bff496bc2a068a709b685fc758234a23a8bddfea95',
        name: 'User'
    }
}


// Network configuration
export const NETWORK_CONFIG = {
    // rpcUrl: 'http://127.0.0.1:8080',
    // faucetUrl: 'http://127.0.0.1:8081',
    network: Network.LOCAL
}

// Helper to create Aptos client
export function createAptosClient() {
    const aptosConfig = new AptosConfig({
        network: NETWORK_CONFIG.network,
        // fullnode: NETWORK_CONFIG.rpcUrl,
        // faucet: NETWORK_CONFIG.faucetUrl,
    });
    return new Aptos(aptosConfig)
}

// Helper to create account from private key
export function createAccount(privateKey: string): Account {
    const ed25519PrivateKey = new Ed25519PrivateKey(privateKey);
    return Account.fromPrivateKey({ privateKey: ed25519PrivateKey });
}