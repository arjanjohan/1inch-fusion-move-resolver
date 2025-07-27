module fusion_plus::constants {

    use std::option::{Self, Option};
    use std::signer;
    use std::debug;
    use aptos_framework::event::{Self};
    use aptos_framework::fungible_asset::{Self, FungibleAsset, Metadata};
    use aptos_framework::object::{Self, Object, ExtendRef, DeleteRef, ObjectGroup};
    use aptos_framework::primary_fungible_store;

    use fusion_plus::hashlock::{Self, HashLock};
    use fusion_plus::timelock::{Self, Timelock};
    use fusion_plus::resolver_registry;

    // - - - - CONSTANTS - - - -

    const DEFAULT_SAFETY_DEPOSIT_METADATA_ADDRESS: address = @0xa;
    const DEFAULT_SAFETY_DEPOSIT_AMOUNT: u64 = 100_000;

    const DEFAULT_FINALITY_DURATION: u64 = 60 * 60 * 24 * 30; // 30 days
    const DEFAULT_EXCLUSIVE_DURATION: u64 = 60 * 60 * 24 * 30; // 30 days
    const DEFAULT_PRIVATE_CANCELLATION_DURATION: u64 = 60 * 60 * 24 * 30; // 30 days

    public fun get_safety_deposit_metadata(): Object<Metadata> {
        object::address_to_object(DEFAULT_SAFETY_DEPOSIT_METADATA_ADDRESS)
    }

    public fun get_safety_deposit_amount(): u64 {
        DEFAULT_SAFETY_DEPOSIT_AMOUNT
    }

    public fun get_finality_duration(): u64 {
        DEFAULT_FINALITY_DURATION
    }

    public fun get_exclusive_duration(): u64 {
        DEFAULT_EXCLUSIVE_DURATION
    }

    public fun get_private_cancellation_duration(): u64 {
        DEFAULT_PRIVATE_CANCELLATION_DURATION
    }
}
