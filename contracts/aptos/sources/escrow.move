module fusion_plus::escrow {
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
    use fusion_plus::constants;
    use fusion_plus::fusion_order::{Self, FusionOrder};

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

    // - - - - EVENTS - - - -

    #[resource_group_member(group = ObjectGroup)]
    /// Controller for managing the lifecycle of a LockedAsset.
    ///
    /// @param extend_ref The extend_ref of the locked asset, used to generate signer for the locked asset.
    /// @param delete_ref The delete ref of the locked asset, used to delete the locked asset.
    struct EscrowController has key {
        extend_ref: ExtendRef,
        delete_ref: DeleteRef
    }

    /// An Escrow Object that contains a the assets that are being escrowed.
    /// The object can be stored in other structs because it has the `store` ability.
    ///
    /// @param metadata The metadata of the asset.
    /// @param escrow_id The ID of the escrow this asset belongs to.
    /// @param timelock_id The ID of the timelock governing this asset.
    /// @param owner The creator address of the wrapped asset.
    /// @param recipient The recipient address of the wrapped asset.
    /// @param resolver The optional resolver address of the wrapped asset.
    /// @param chain_id Chain ID where this asset originated.
    /// @param timelock The timelock controlling the asset phases.
    /// @param hashlock The hashlock protecting the asset.
    struct Escrow has key, store {
        metadata: Object<Metadata>,
        amount: u64,
        from: address,
        to: address,
        resolver: address,
        chain_id: u64,
        timelock: Timelock,
        hashlock: HashLock
    }

    public fun new_from_order(
        resolver: &signer, fusion_order: Object<FusionOrder>
    ): Object<Escrow> {
        let owner_address = fusion_order::get_owner(fusion_order);
        let resolver_address = signer::address_of(resolver);
        let chain_id = fusion_order::get_chain_id(fusion_order);
        let hash = fusion_order::get_hash(fusion_order);
        let (asset, safety_deposit_asset) =
            fusion_order::resolver_accept_order(resolver, fusion_order);
        new_internal(
            resolver,
            asset,
            safety_deposit_asset,
            owner_address, //from
            resolver_address, //to
            resolver_address, //resolver
            chain_id,
            hash
        )
    }

    public fun new_from_resolver(
        resolver: &signer,
        recipient_address: address,
        metadata: Object<Metadata>,
        amount: u64,
        chain_id: u64,
        hash: vector<u8>
    ): Object<Escrow> {
        let resolver_address = signer::address_of(resolver);
        let asset = primary_fungible_store::withdraw(resolver, metadata, amount);

        let safety_deposit_asset =
            primary_fungible_store::withdraw(
                resolver,
                constants::get_safety_deposit_metadata(),
                constants::get_safety_deposit_amount()
            );
        new_internal(
            resolver,
            asset,
            safety_deposit_asset,
            resolver_address, // from
            recipient_address, // to
            resolver_address, // resolver
            chain_id,
            hash
        )
    }

    fun new_internal(
        signer: &signer,
        asset: FungibleAsset,
        safety_deposit_asset: FungibleAsset,
        from: address,
        to: address,
        resolver: address,
        chain_id: u64,
        hash: vector<u8>
    ): Object<Escrow> {

        // Create the object and LockedAsset
        let constructor_ref = object::create_object_from_account(signer);
        let object_signer = object::generate_signer(&constructor_ref);
        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let delete_ref = object::generate_delete_ref(&constructor_ref);

        // Create the controller
        move_to(
            &object_signer,
            EscrowController { extend_ref, delete_ref }
        );

        let timelock = timelock::new();
        let hashlock = hashlock::create_hashlock(hash);

        let metadata = fungible_asset::metadata_from_asset(&asset);
        let amount = fungible_asset::amount(&asset);

        // Create the LockedAsset
        let escrow_obj = Escrow {
            metadata,
            amount,
            from,
            to,
            resolver,
            chain_id,
            timelock,
            hashlock
        };

        move_to(&object_signer, escrow_obj);

        let object_address = signer::address_of(&object_signer);

        // Store the asset in the escrow primary store
        primary_fungible_store::ensure_primary_store_exists(object_address, metadata);
        primary_fungible_store::deposit(object_address, asset);

        primary_fungible_store::deposit(object_address, safety_deposit_asset);

        object::object_from_constructor_ref(&constructor_ref)

    }

    // - - - - GETTER FUNCTIONS - - - -

    public fun get_metadata(escrow: Object<Escrow>): Object<Metadata> acquires Escrow {
        let escrow_ref = borrow_escrow(&escrow);
        escrow_ref.metadata
    }

    public fun get_amount(escrow: Object<Escrow>): u64 acquires Escrow {
        let escrow_ref = borrow_escrow(&escrow);
        escrow_ref.amount
    }

    public fun get_from(escrow: Object<Escrow>): address acquires Escrow {
        let escrow_ref = borrow_escrow(&escrow);
        escrow_ref.from
    }

    public fun get_to(escrow: Object<Escrow>): address acquires Escrow {
        let escrow_ref = borrow_escrow(&escrow);
        escrow_ref.to
    }

    public fun get_resolver(escrow: Object<Escrow>): address acquires Escrow {
        let escrow_ref = borrow_escrow(&escrow);
        escrow_ref.resolver
    }

    public fun get_chain_id(escrow: Object<Escrow>): u64 acquires Escrow {
        let escrow_ref = borrow_escrow(&escrow);
        escrow_ref.chain_id
    }

    public fun get_timelock(escrow: Object<Escrow>): Timelock acquires Escrow {
        let escrow_ref = borrow_escrow(&escrow);
        escrow_ref.timelock
    }

    public fun get_hashlock(escrow: Object<Escrow>): HashLock acquires Escrow {
        let escrow_ref = borrow_escrow(&escrow);
        escrow_ref.hashlock
    }

    // - - - - BORROW FUNCTIONS - - - -

    inline fun borrow_escrow(
        escrow_obj: &Object<Escrow>
    ): &Escrow acquires Escrow {
        borrow_global<Escrow>(object::object_address(escrow_obj))
    }

    inline fun borrow_escrow_mut(
        escrow_obj: &Object<Escrow>
    ): &mut Escrow acquires Escrow {
        borrow_global_mut<Escrow>(object::object_address(escrow_obj))
    }

    inline fun borrow_escrow_controller(
        escrow_obj: &Object<Escrow>
    ): &EscrowController acquires EscrowController {
        borrow_global<EscrowController>(object::object_address(escrow_obj))
    }

    inline fun borrow_escrow_controller_mut(
        escrow_obj: &Object<Escrow>
    ): &mut EscrowController acquires EscrowController {
        borrow_global_mut<EscrowController>(object::object_address(escrow_obj))
    }
}
