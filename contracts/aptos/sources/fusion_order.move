module fusion_plus::fusion_order {

    use std::option::{Self, Option};
    use std::signer;
    use std::debug;
    use aptos_framework::event::{Self};
    use aptos_framework::fungible_asset::{Self, FungibleAsset, Metadata};
    use aptos_framework::object::{Self, Object, ExtendRef, DeleteRef, ObjectGroup};
    use aptos_framework::primary_fungible_store;

    use fusion_plus::constants;
    use fusion_plus::resolver_registry;
    use fusion_plus::escrow::{Self, Escrow};

    // - - - - ERROR CODES - - - -

    /// Invalid amount
    const EINVALID_AMOUNT: u64 = 1;
    /// Insufficient balance
    const EINSUFFICIENT_BALANCE: u64 = 2;
    /// Invalid caller
    const EINVALID_CALLER: u64 = 3;
    /// Object does not exist
    const EOBJECT_DOES_NOT_EXIST: u64 = 4;
    /// Invalid resolver
    const EINVALID_RESOLVER: u64 = 5;

    // - - - - STRUCTS - - - -

    #[resource_group_member(group = ObjectGroup)]
    /// Controller for managing the lifecycle of a LockedAsset.
    ///
    /// @param extend_ref The extend_ref of the locked asset, used to generate signer for the locked asset.
    /// @param delete_ref The delete ref of the locked asset, used to delete the locked asset.
    struct FusionOrderController has key {
        extend_ref: ExtendRef,
        delete_ref: DeleteRef
    }

    struct FusionOrder has key, store {
        owner: address,
        metadata: Object<Metadata>,
        amount: u64,
        safety_deposit_metadata: Object<Metadata>,
        safety_deposit_amount: u64,
        chain_id: u64,
        hash: vector<u8>
    }

    public fun new(
        signer: &signer,
        metadata: Object<Metadata>,
        amount: u64,
        chain_id: u64,
        hash: vector<u8>
    ): Object<FusionOrder> {

        let signer_address = signer::address_of(signer);

        let safety_deposit_metadata = constants::get_safety_deposit_metadata();
        let safety_deposit_amount = constants::get_safety_deposit_amount();

        // Validate inputs
        assert!(amount > 0, EINVALID_AMOUNT);
        assert!(safety_deposit_amount > 0, EINVALID_AMOUNT);
        assert!(
            primary_fungible_store::balance(signer_address, metadata) >= amount,
            EINSUFFICIENT_BALANCE
        );
        assert!(
            primary_fungible_store::balance(signer_address, safety_deposit_metadata)
                >= safety_deposit_amount,
            EINSUFFICIENT_BALANCE
        );

        // Create an object and FusionOrder
        let constructor_ref = object::create_object_from_account(signer);
        let object_signer = object::generate_signer(&constructor_ref);
        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let delete_ref = object::generate_delete_ref(&constructor_ref);

        // Create the controller
        move_to(
            &object_signer,
            FusionOrderController { extend_ref, delete_ref }
        );

        // Create the FusionOrder
        let fusion_order = FusionOrder {
            owner: signer_address,
            metadata,
            amount,
            safety_deposit_metadata,
            safety_deposit_amount,
            chain_id,
            hash
        };

        move_to(&object_signer, fusion_order);

        let object_address = signer::address_of(&object_signer);

        // Store the asset in the locked_asset primary store
        primary_fungible_store::ensure_primary_store_exists(object_address, metadata);
        primary_fungible_store::transfer(signer, metadata, object_address, amount);

        // Transfer the safety deposit amount to locked_asset primary store
        primary_fungible_store::transfer(
            signer,
            safety_deposit_metadata,
            object_address,
            safety_deposit_amount
        );

        object::object_from_constructor_ref(&constructor_ref)

    }

    public fun cancel(
        signer: &signer, fusion_order: Object<FusionOrder>
    ) acquires FusionOrder, FusionOrderController {
        let signer_address = signer::address_of(signer);
        let object_address = object::object_address(&fusion_order);

        assert!(
            object::object_exists<FusionOrder>(object_address),
            EOBJECT_DOES_NOT_EXIST
        );

        let fusion_order_ref = borrow_fusion_order_mut(&fusion_order);
        let controller = borrow_fusion_order_controller_mut(&fusion_order);

        assert!(
            signer_address == fusion_order_ref.owner
                && fusion_order_ref.owner == signer_address,
            EINVALID_CALLER
        );

        let FusionOrderController { extend_ref, delete_ref } = move_from(object_address);

        let object_signer = object::generate_signer_for_extending(&extend_ref);

        primary_fungible_store::transfer(
            &object_signer,
            fusion_order_ref.metadata,
            signer_address,
            fusion_order_ref.amount
        );

        primary_fungible_store::transfer(
            &object_signer,
            fusion_order_ref.safety_deposit_metadata,
            signer_address,
            fusion_order_ref.safety_deposit_amount
        );

        object::delete(delete_ref);

    }

    // TODO: Add mechanism to prevent withdrawals from other modules
    public fun resolver_accept_order(
        signer: &signer, fusion_order: Object<FusionOrder>
    ): (FungibleAsset, FungibleAsset) acquires FusionOrder, FusionOrderController {
        let signer_address = signer::address_of(signer);
        let object_address = object::object_address(&fusion_order);

        assert!(
            object::object_exists<FusionOrder>(object_address),
            EOBJECT_DOES_NOT_EXIST
        );

        let fusion_order_ref = borrow_fusion_order_mut(&fusion_order);
        let controller = borrow_fusion_order_controller_mut(&fusion_order);

        assert!(
            resolver_registry::is_active_resolver(signer_address), EINVALID_RESOLVER
        );

        let FusionOrderController { extend_ref, delete_ref } = move_from(object_address);

        let object_signer = object::generate_signer_for_extending(&extend_ref);

        let asset =
            primary_fungible_store::withdraw(
                &object_signer,
                fusion_order_ref.metadata,
                fusion_order_ref.amount
            );

        let safety_deposit_asset =
            primary_fungible_store::withdraw(
                &object_signer,
                constants::get_safety_deposit_metadata(),
                constants::get_safety_deposit_amount()
            );

        object::delete(delete_ref);

        (asset, safety_deposit_asset)

    }

    // - - - - GETTER FUNCTIONS - - - -

    public fun get_owner(fusion_order: Object<FusionOrder>): address acquires FusionOrder {
        let fusion_order_ref = borrow_fusion_order(&fusion_order);
        fusion_order_ref.owner
    }

    public fun get_metadata(
        fusion_order: Object<FusionOrder>
    ): Object<Metadata> acquires FusionOrder {
        let fusion_order_ref = borrow_fusion_order(&fusion_order);
        fusion_order_ref.metadata
    }

    public fun get_amount(fusion_order: Object<FusionOrder>): u64 acquires FusionOrder {
        let fusion_order_ref = borrow_fusion_order(&fusion_order);
        fusion_order_ref.amount
    }

    public fun get_safety_deposit_metadata(
        fusion_order: Object<FusionOrder>
    ): Object<Metadata> acquires FusionOrder {
        let fusion_order_ref = borrow_fusion_order(&fusion_order);
        fusion_order_ref.safety_deposit_metadata
    }

    public fun get_safety_deposit_amount(
        fusion_order: Object<FusionOrder>
    ): u64 acquires FusionOrder {
        let fusion_order_ref = borrow_fusion_order(&fusion_order);
        fusion_order_ref.safety_deposit_amount
    }

    public fun get_chain_id(fusion_order: Object<FusionOrder>): u64 acquires FusionOrder {
        let fusion_order_ref = borrow_fusion_order(&fusion_order);
        fusion_order_ref.chain_id
    }

    public fun get_hash(fusion_order: Object<FusionOrder>): vector<u8> acquires FusionOrder {
        let fusion_order_ref = borrow_fusion_order(&fusion_order);
        fusion_order_ref.hash
    }

    // - - - - BORROW FUNCTIONS - - - -

    inline fun borrow_fusion_order_controller_mut(
        fusion_order_obj: &Object<FusionOrder>
    ): &FusionOrderController acquires FusionOrderController {
        borrow_global_mut<FusionOrderController>(object::object_address(fusion_order_obj))
    }

    inline fun borrow_fusion_order(
        fusion_order_obj: &Object<FusionOrder>
    ): &FusionOrder acquires FusionOrder {
        borrow_global<FusionOrder>(object::object_address(fusion_order_obj))
    }

    inline fun borrow_fusion_order_mut(
        fusion_order_obj: &Object<FusionOrder>
    ): &mut FusionOrder acquires FusionOrder {
        borrow_global_mut<FusionOrder>(object::object_address(fusion_order_obj))
    }

    // - - - - TEST FUNCTIONS - - - -

    #[test_only]
    public fun delete_for_test(
        fusion_order: Object<FusionOrder>
    ) acquires FusionOrder, FusionOrderController {
        let object_address = object::object_address(&fusion_order);
        let FusionOrderController { extend_ref, delete_ref } = move_from(object_address);
        let object_signer = object::generate_signer_for_extending(&extend_ref);

        let fusion_order_ref = borrow_fusion_order_mut(&fusion_order);

        let burn_address = @0x0;
        primary_fungible_store::transfer(
            &object_signer,
            fusion_order_ref.metadata,
            burn_address,
            fusion_order_ref.amount
        );

        primary_fungible_store::transfer(
            &object_signer,
            fusion_order_ref.safety_deposit_metadata,
            burn_address,
            fusion_order_ref.safety_deposit_amount
        );
        object::delete(delete_ref);
    }
}
