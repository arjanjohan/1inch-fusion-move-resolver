module fusion_plus::locked_asset {

    use std::option::{Self, Option};
    use std::signer;
    use std::debug;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::fungible_asset::{Self, FungibleAsset, Metadata};
    use aptos_framework::object::{Self, Object, ExtendRef, DeleteRef, ObjectGroup};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;

    use fusion_plus::hashlock::{Self, HashLock};
    use fusion_plus::timelock::{Self, Timelock};
    use fusion_plus::resolver_registry;

    // - - - - FRIEND FUNCTIONS - - - -

    friend fusion_plus::fusion_order;
    #[test_only]
    friend fusion_plus::locked_asset_tests;

    // - - - - ERROR CODES - - - -

    /// Invalid asset
    const EINVALID_ASSET: u64 = 1;
    /// Invalid duration
    const EINVALID_DURATION: u64 = 2;
    /// Invalid phase
    const EINVALID_PHASE: u64 = 3;
    /// Invalid recipient
    const EINVALID_RECIPIENT: u64 = 4;
    /// Invalid caller
    const EINVALID_CALLER: u64 = 5;
    /// Invalid chain
    const EINVALID_CHAIN: u64 = 7;
    /// Invalid owner
    const EINVALID_OWNER: u64 = 8;
    /// Invalid secret
    const EINVALID_SECRET: u64 = 9;
    /// Invalid resolver
    const EINVALID_RESOLVER: u64 = 10;
    /// Not admin
    const ENOT_ADMIN: u64 = 11;

    // - - - - CONSTANTS - - - -

    const DEFAULT_FINALITY_DURATION: u64 = 60 * 60 * 24 * 30; // 30 days
    const DEFAULT_EXCLUSIVE_DURATION: u64 = 60 * 60 * 24 * 30; // 30 days
    const DEFAULT_PRIVATE_CANCELLATION_DURATION: u64 = 60 * 60 * 24 * 30; // 30 days

    // - - - - EVENTS - - - -

    #[event]
    /// Event emitted when a new locked asset is created
    struct LockedAssetCreatedEvent has drop, store {
        metadata: Object<Metadata>,
        amount: u64,
        recipient: address,
        resolver: Option<address>,
        chain_id: u64,
    }

    #[event]
    /// Event emitted when a recipient is set for a locked asset
    struct ResolverSetEvent has drop, store {
        locked_asset: Object<LockedAsset>,
        resolver: address,
    }

    // #[event]
    // /// Event emitted when an asset is withdrawn
    // struct WithdrawEvent has drop, store {
    //     escrow_id: vector<u8>,
    //     recipient: address,
    //     amount: u64,
    //     withdrawn_at: u64,
    // }

    // #[event]
    // /// Event emitted when an asset is cancelled
    // struct CancelEvent has drop, store {
    //     escrow_id: vector<u8>,
    //     owner: address,
    //     amount: u64,
    //     cancelled_at: u64,
    // }

    #[resource_group_member(group = ObjectGroup)]
    /// Controller for managing the lifecycle of a LockedAsset.
    ///
    /// @param extend_ref The extend_ref of the locked asset, used to generate signer for the locked asset.
    /// @param delete_ref The delete ref of the locked asset, used to delete the locked asset.
    struct LockedAssetController has key {
        extend_ref: ExtendRef,
        delete_ref: DeleteRef,
    }

    struct GlobalConfig has key {
        finality_duration: u64,
        exclusive_duration: u64,
        private_cancellation_duration: u64,
    }

    /// A wrapper around a `FungibleAsset` stored as an object.
    /// The object can be stored in other structs because it has the `store` ability.
    ///
    /// @param metadata The metadata of the asset.
    /// @param escrow_id The ID of the escrow this asset belongs to.
    /// @param timelock_id The ID of the timelock governing this asset.
    /// @param recipient The optional recipient address of the wrapped asset.
    /// @param owner The original owner of the asset.
    /// @param chain_id Chain ID where this asset originated.
    /// @param timelock The timelock controlling the asset phases.
    /// @param hashlock The hashlock protecting the asset.
    struct LockedAsset has key, store {
        metadata: Object<Metadata>,
        amount: u64,
        // TODO: add safety_deposit_amount
        recipient: address,
        resolver: Option<address>,
        chain_id: u64,
        timelock: Option<Timelock>,
        hashlock: HashLock,
    }

    /// A view struct of the LockedAsset.
    struct LockedAssetView has drop {
        metadata: Object<Metadata>,
        amount: u64,
        recipient: Option<address>,
        resolver: Option<address>,
        chain_id: u64,
        timelock: Option<Timelock>,
        hashlock: HashLock,
    }

    fun init_module(owner: &signer) {
        let owner_addr = signer::address_of(owner);
        move_to(owner, GlobalConfig {
            finality_duration: DEFAULT_FINALITY_DURATION,
            exclusive_duration: DEFAULT_EXCLUSIVE_DURATION,
            private_cancellation_duration: DEFAULT_PRIVATE_CANCELLATION_DURATION,
        });
    }

    // Creates a new LockedAsset from a user. The order has not been picked up by the resolver yet, so this value is not set. The  hashlock is not initialized yet, meaning the user can withdraw and destroy this object at any point.
    public(friend) fun new_from_user(
        owner: &signer,
        asset: FungibleAsset,
        hash: vector<u8>,
        chain_id: u64
    ) : Object<LockedAsset> {

        let recipient = signer::address_of(owner);
        let resolver = option::none();
        let timelock = option::none();

        new_internal(
            owner,
            asset,
            recipient,
            resolver,
            hash,
            timelock,
            chain_id
        )
    }

    // Creates a new LockedAsset from a resolver.
    public(friend) fun new_from_resolver(
        owner: &signer,
        recipient: address,
        asset: FungibleAsset,
        hash: vector<u8>,
        chain_id: u64
    ) : Object<LockedAsset> acquires GlobalConfig {

        let resolver = signer::address_of(owner);

        let config = borrow_global<GlobalConfig>(@fusion_plus);
        let timelock = timelock::new(config.finality_duration, config.exclusive_duration, config.private_cancellation_duration);

        new_internal(
            owner,
            asset,
            recipient,
            option::some(resolver),
            hash,
            option::some(timelock),
            chain_id)
    }

    /// Creates a new LockedAsset with optional recipient and hashlock.
    /// This is the primary way to create a LockedAsset.
    ///
    /// @param owner The signer creating the asset.
    /// @param asset The fungible asset to lock.
    /// @param escrow_id Unique identifier for the escrow.
    /// @param timelock_id Unique identifier for the timelock.
    /// @param recipient Optional recipient address.
    /// @param hash The hash for the hashlock.
    /// @param chain_id Chain identifier.
    /// @param finality_duration Duration of finality phase in seconds.
    /// @param exclusive_duration Duration of exclusive phase in seconds.
    /// @param private_cancellation_duration Duration of private cancellation phase in seconds.
    ///
    /// @reverts EINVALID_ASSET if the asset amount is zero.
    /// @reverts EINVALID_DURATION if any duration is zero.
    /// @reverts EINVALID_CHAIN if chain_id is zero.
    fun new_internal(
        owner: &signer,
        asset: FungibleAsset,
        recipient: address,
        resolver: Option<address>,
        hash: vector<u8>,
        timelock: Option<Timelock>,
        chain_id: u64
    ): Object<LockedAsset> {
        // Validate inputs
        assert!(fungible_asset::amount(&asset) > 0, EINVALID_ASSET);
        assert!(chain_id > 0, EINVALID_CHAIN);

        let owner_addr = signer::address_of(owner);
        let metadata = fungible_asset::metadata_from_asset(&asset);
        let amount = fungible_asset::amount(&asset);

        // Create the object and LockedAsset
        let constructor_ref = object::create_object_from_account(owner); // TODO do we need owner to create obj?
        let object_signer = object::generate_signer(&constructor_ref);
        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let delete_ref = object::generate_delete_ref(&constructor_ref);

        // Create the controller
        move_to(&object_signer, LockedAssetController {
            extend_ref,
            delete_ref,
        });

        let hashlock = hashlock::create_hashlock(hash);

        // Create the LockedAsset
        let locked_asset = LockedAsset {
            metadata,
            amount,
            recipient,
            resolver,
            chain_id,
            timelock,
            hashlock,
        };

        move_to(&object_signer, locked_asset);

        let object_address = signer::address_of(&object_signer);

        // Store the asset in the primary store
        primary_fungible_store::ensure_primary_store_exists(
            object_address,
            metadata,
        );
        primary_fungible_store::deposit(
            object_address,
            asset
        );

        event::emit(
            LockedAssetCreatedEvent {
                metadata,
                amount,
                recipient,
                resolver,
                chain_id
            }
        );

        object::object_from_constructor_ref(&constructor_ref)
    }

    public(friend) fun set_resolver_and_initiate_timelock(
        signer: &signer,
        locked_asset: Object<LockedAsset>
    ) acquires LockedAsset {

        let resolver = signer::address_of(signer);
        assert!(resolver_registry::is_active_resolver(resolver), EINVALID_RESOLVER);

        let locked_asset_ref = borrow_locked_asset_mut(&locked_asset);
        locked_asset_ref.resolver = option::some(resolver);

        event::emit(
            ResolverSetEvent {
                locked_asset: locked_asset,
                resolver,
            }
        );
    }

    public(friend) fun withdraw_funds_on_source_chain(
        signer: &signer,
        locked_asset: Object<LockedAsset>,
        secret: vector<u8>
    ) acquires LockedAsset {
        let locked_asset_ref = borrow_locked_asset_mut(&locked_asset);
        let hashlock = locked_asset_ref.hashlock;

    }


    public(friend) fun withdraw_funds_on_destination_chain(
        signer: &signer,
        locked_asset: Object<LockedAsset>,
        secret: vector<u8>
    ) acquires LockedAsset {
        let locked_asset_ref = borrow_locked_asset_mut(&locked_asset);
        let hashlock = locked_asset_ref.hashlock;

    }

    // this function can only be called before the resolver picks up the order.
    public(friend) fun user_destroy_order(
        signer: &signer,
        locked_asset: Object<LockedAsset>
    ) acquires LockedAsset, LockedAssetController {
        let locked_asset_ref = borrow_locked_asset_mut(&locked_asset);

        let signer_address = signer::address_of(signer);

        assert!(signer_address == locked_asset_ref.recipient, EINVALID_CALLER);
        assert!(option::is_none(&locked_asset_ref.timelock), EINVALID_PHASE);
        assert!(option::is_none(&locked_asset_ref.resolver), EINVALID_PHASE);

        let LockedAssetController { extend_ref, delete_ref } = move_from(signer_address);

        let object_signer = object::generate_signer_for_extending(&extend_ref);

        primary_fungible_store::transfer(
            &object_signer,
            locked_asset_ref.metadata,
            locked_asset_ref.recipient,
            locked_asset_ref.amount
        );

        object::delete(delete_ref);
        // TODO: Do we need to ensure there are no lingering objects? primary stores that are not empty?
    }


    // - - - - ADMIN FUNCTIONS - - - -

    public fun set_timelock_durations(
        signer: &signer,
        finality_duration: u64,
        exclusive_duration: u64,
        private_cancellation_duration: u64,
    ) acquires GlobalConfig {
        assert!(signer::address_of(signer) == @fusion_plus, ENOT_ADMIN);

        timelock::is_finality_duration_valid(finality_duration);
        timelock::is_exclusive_duration_valid(exclusive_duration);
        timelock::is_private_cancellation_duration_valid(private_cancellation_duration);

        let config = borrow_global_mut<GlobalConfig>(@fusion_plus);

        config.finality_duration = finality_duration;
        config.exclusive_duration = exclusive_duration;
        config.private_cancellation_duration = private_cancellation_duration;
    }

    // ========== Helper Functions ==========

    inline fun borrow_locked_asset(locked_asset_obj: &Object<LockedAsset>): &LockedAsset acquires LockedAsset {
        borrow_global<LockedAsset>(object::object_address(locked_asset_obj))
    }

    inline fun borrow_locked_asset_mut(locked_asset_obj: &Object<LockedAsset>): &mut LockedAsset acquires LockedAsset {
        borrow_global_mut<LockedAsset>(object::object_address(locked_asset_obj))
    }

    inline fun borrow_locked_asset_controller(locked_asset_obj: &Object<LockedAsset>): &LockedAssetController acquires LockedAssetController {
        borrow_global<LockedAssetController>(object::object_address(locked_asset_obj))
    }

    inline fun borrow_locked_asset_controller_mut(locked_asset_obj: &Object<LockedAsset>): &mut LockedAssetController acquires LockedAssetController {
        borrow_global_mut<LockedAssetController>(object::object_address(locked_asset_obj))
    }

    // - - - - TEST FUNCTIONS - - - -

    // #[test_only]
    // public fun destroy_locked_asset_for_test(locked_asset: LockedAsset) {
    //     // TODO: Implement
    // }

}