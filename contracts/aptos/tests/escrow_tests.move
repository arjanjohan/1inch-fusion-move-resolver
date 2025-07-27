#[test_only]
module fusion_plus::escrow_tests {
    use std::hash;
    use std::signer;
    use aptos_framework::account;
    use aptos_framework::fungible_asset::{Metadata, MintRef};
    use aptos_framework::object::{Self, Object};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;
    use fusion_plus::escrow::{Self, Escrow};
    use fusion_plus::fusion_order::{Self, FusionOrder};
    use fusion_plus::common;
    use fusion_plus::constants;
    use fusion_plus::resolver_registry;
    use fusion_plus::timelock::{Self};
    use fusion_plus::hashlock::{Self};

    // Test accounts
    const CHAIN_ID: u64 = 20;

    // Test amounts
    const MINT_AMOUNT: u64 = 100000000; // 100 token
    const ASSET_AMOUNT: u64 = 1000000; // 1 token

    // Test secrets and hashes
    const TEST_SECRET: vector<u8> = b"my secret";
    const WRONG_SECRET: vector<u8> = b"wrong secret";

    fun setup_test(): (signer, signer, signer, Object<Metadata>, MintRef) {
        timestamp::set_time_has_started_for_testing(
            &account::create_signer_for_test(@aptos_framework)
        );
        let fusion_signer = account::create_account_for_test(@fusion_plus);

        let account_1 = common::initialize_account_with_fa(@0x201);
        let account_2 = common::initialize_account_with_fa(@0x202);
        let account_3 = common::initialize_account_with_fa(@0x203);

        let (metadata, mint_ref) = common::create_test_token(&fusion_signer, b"Test Token");

        // Mint assets to accounts
        common::mint_fa(&mint_ref, MINT_AMOUNT, signer::address_of(&account_1));
        common::mint_fa(&mint_ref, MINT_AMOUNT, signer::address_of(&account_2));
        common::mint_fa(&mint_ref, MINT_AMOUNT, signer::address_of(&account_3));

        // Initialize modules
        resolver_registry::init_module_for_test(&fusion_signer);

        (account_1, account_2, account_3, metadata, mint_ref)
    }

    #[test]
    fun test_create_escrow_from_order() {
        let (owner, _, resolver, metadata, _) = setup_test();

        // Create a fusion order first
        let fusion_order = fusion_order::new(
            &owner,
            metadata,
            ASSET_AMOUNT,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        let fusion_order_address = object::object_address(&fusion_order);

        // Verify fusion order exists
        assert!(object::object_exists<FusionOrder>(fusion_order_address) == true, 0);

        // Create escrow from fusion order
        let escrow = escrow::new_from_order(&resolver, fusion_order);

        let escrow_address = object::object_address(&escrow);

        // Verify fusion order is deleted
        assert!(object::object_exists<FusionOrder>(fusion_order_address) == false, 0);

        // Verify escrow is created
        assert!(object::object_exists<Escrow>(escrow_address) == true, 0);

        // Verify escrow properties
        assert!(escrow::get_metadata(escrow) == metadata, 0);
        assert!(escrow::get_amount(escrow) == ASSET_AMOUNT, 0);
        assert!(escrow::get_from(escrow) == signer::address_of(&owner), 0);
        assert!(escrow::get_to(escrow) == signer::address_of(&resolver), 0);
        assert!(escrow::get_resolver(escrow) == signer::address_of(&resolver), 0);
        assert!(escrow::get_chain_id(escrow) == CHAIN_ID, 0);

        // Verify assets are in escrow
        let escrow_main_balance = primary_fungible_store::balance(
            escrow_address,
            metadata
        );
        assert!(escrow_main_balance == ASSET_AMOUNT, 0);

        let escrow_safety_deposit_balance = primary_fungible_store::balance(
            escrow_address,
            constants::get_safety_deposit_metadata()
        );
        assert!(escrow_safety_deposit_balance == constants::get_safety_deposit_amount(), 0);
    }

    #[test]
    fun test_create_escrow_from_resolver() {
        let (_, recipient, resolver, metadata, _) = setup_test();

        // Record initial balances
        let initial_resolver_main_balance = primary_fungible_store::balance(
            signer::address_of(&resolver),
            metadata
        );
        let initial_resolver_safety_deposit_balance = primary_fungible_store::balance(
            signer::address_of(&resolver),
            constants::get_safety_deposit_metadata()
        );

        // Create escrow directly from resolver
        let escrow = escrow::new_from_resolver(
            &resolver,
            signer::address_of(&recipient),
            metadata,
            ASSET_AMOUNT,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        let escrow_address = object::object_address(&escrow);

        // Verify escrow is created
        assert!(object::object_exists<Escrow>(escrow_address) == true, 0);

        // Verify escrow properties
        assert!(escrow::get_metadata(escrow) == metadata, 0);
        assert!(escrow::get_amount(escrow) == ASSET_AMOUNT, 0);
        assert!(escrow::get_from(escrow) == signer::address_of(&resolver), 0);
        assert!(escrow::get_to(escrow) == signer::address_of(&recipient), 0);
        assert!(escrow::get_resolver(escrow) == signer::address_of(&resolver), 0);
        assert!(escrow::get_chain_id(escrow) == CHAIN_ID, 0);

        // Verify resolver's balances decreased
        let final_resolver_main_balance = primary_fungible_store::balance(
            signer::address_of(&resolver),
            metadata
        );
        let final_resolver_safety_deposit_balance = primary_fungible_store::balance(
            signer::address_of(&resolver),
            constants::get_safety_deposit_metadata()
        );

        assert!(final_resolver_main_balance == initial_resolver_main_balance - ASSET_AMOUNT, 0);
        assert!(final_resolver_safety_deposit_balance == initial_resolver_safety_deposit_balance - constants::get_safety_deposit_amount(), 0);

        // Verify assets are in escrow
        let escrow_main_balance = primary_fungible_store::balance(
            escrow_address,
            metadata
        );
        assert!(escrow_main_balance == ASSET_AMOUNT, 0);

        let escrow_safety_deposit_balance = primary_fungible_store::balance(
            escrow_address,
            constants::get_safety_deposit_metadata()
        );
        assert!(escrow_safety_deposit_balance == constants::get_safety_deposit_amount(), 0);
    }

    #[test]
    fun test_create_escrow_from_order_multiple_orders() {
        let (owner, _, resolver, metadata, _) = setup_test();

        // Create multiple fusion orders
        let fusion_order1 = fusion_order::new(
            &owner,
            metadata,
            ASSET_AMOUNT,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        let fusion_order2 = fusion_order::new(
            &owner,
            metadata,
            ASSET_AMOUNT * 2,
            CHAIN_ID,
            hash::sha3_256(WRONG_SECRET)
        );

        // Convert both to escrow
        let escrow1 = escrow::new_from_order(&resolver, fusion_order1);
        let escrow2 = escrow::new_from_order(&resolver, fusion_order2);

        let escrow1_address = object::object_address(&escrow1);
        let escrow2_address = object::object_address(&escrow2);

        // Verify both escrows exist
        assert!(object::object_exists<Escrow>(escrow1_address) == true, 0);
        assert!(object::object_exists<Escrow>(escrow2_address) == true, 0);

        // Verify escrow properties
        assert!(escrow::get_amount(escrow1) == ASSET_AMOUNT, 0);
        assert!(escrow::get_amount(escrow2) == ASSET_AMOUNT * 2, 0);
        assert!(escrow::get_from(escrow1) == signer::address_of(&owner), 0);
        assert!(escrow::get_from(escrow2) == signer::address_of(&owner), 0);
        assert!(escrow::get_to(escrow1) == signer::address_of(&resolver), 0);
        assert!(escrow::get_to(escrow2) == signer::address_of(&resolver), 0);
    }

    #[test]
    fun test_create_escrow_from_resolver_different_recipients() {
        let (recipient1, recipient2, resolver, metadata, _) = setup_test();

        // Create escrows with different recipients
        let escrow1 = escrow::new_from_resolver(
            &resolver,
            signer::address_of(&recipient1),
            metadata,
            ASSET_AMOUNT,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        let escrow2 = escrow::new_from_resolver(
            &resolver,
            signer::address_of(&recipient2),
            metadata,
            ASSET_AMOUNT * 2,
            CHAIN_ID,
            hash::sha3_256(WRONG_SECRET)
        );

        // Verify escrow properties
        assert!(escrow::get_to(escrow1) == signer::address_of(&recipient1), 0);
        assert!(escrow::get_to(escrow2) == signer::address_of(&recipient2), 0);
        assert!(escrow::get_amount(escrow1) == ASSET_AMOUNT, 0);
        assert!(escrow::get_amount(escrow2) == ASSET_AMOUNT * 2, 0);
    }

    #[test]
    fun test_create_escrow_large_amount() {
        let (_, recipient, resolver, metadata, mint_ref) = setup_test();

        let large_amount = 1000000000000; // 1M tokens

        // Mint large amount to resolver
        common::mint_fa(&mint_ref, large_amount, signer::address_of(&resolver));

        // Record initial balance
        let initial_resolver_balance = primary_fungible_store::balance(
            signer::address_of(&resolver),
            metadata
        );

        // Create escrow with large amount
        let escrow = escrow::new_from_resolver(
            &resolver,
            signer::address_of(&recipient),
            metadata,
            large_amount,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        // Verify escrow properties
        assert!(escrow::get_amount(escrow) == large_amount, 0);
        assert!(escrow::get_from(escrow) == signer::address_of(&resolver), 0);
        assert!(escrow::get_to(escrow) == signer::address_of(&recipient), 0);

        // Verify resolver's balance decreased
        let final_resolver_balance = primary_fungible_store::balance(
            signer::address_of(&resolver),
            metadata
        );
        assert!(final_resolver_balance == initial_resolver_balance - large_amount, 0);

        // Verify escrow has the assets
        let escrow_address = object::object_address(&escrow);
        let escrow_balance = primary_fungible_store::balance(
            escrow_address,
            metadata
        );
        assert!(escrow_balance == large_amount, 0);
    }

    #[test]
    fun test_escrow_timelock_and_hashlock() {
        let (_, recipient, resolver, metadata, _) = setup_test();

        let escrow = escrow::new_from_resolver(
            &resolver,
            signer::address_of(&recipient),
            metadata,
            ASSET_AMOUNT,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        // Verify timelock is active
        let timelock = escrow::get_timelock(escrow);
        assert!(timelock::is_in_finality_phase(&timelock) == true, 0);

        // Verify hashlock is created with correct hash
        let hashlock = escrow::get_hashlock(escrow);
        assert!(hashlock::verify_hashlock(&hashlock, TEST_SECRET) == true, 0);
        assert!(hashlock::verify_hashlock(&hashlock, WRONG_SECRET) == false, 0);
    }

    #[test]
    fun test_escrow_phase_transitions() {
        let (_, recipient, resolver, metadata, _) = setup_test();

        let escrow = escrow::new_from_resolver(
            &resolver,
            signer::address_of(&recipient),
            metadata,
            ASSET_AMOUNT,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        let timelock = escrow::get_timelock(escrow);

        let (finality_duration, _, _) = timelock::get_durations(&timelock);

        // Initially in finality phase
        assert!(timelock::is_in_finality_phase(&timelock) == true, 0);
        assert!(timelock::is_in_exclusive_phase(&timelock) == false, 0);
        assert!(timelock::is_in_private_cancellation_phase(&timelock) == false, 0);
        assert!(timelock::is_in_public_cancellation_phase(&timelock) == false, 0);

        // Fast forward to exclusive phase
        timestamp::update_global_time_for_test_secs(timelock::get_created_at(&timelock) + finality_duration + 1);

        assert!(timelock::is_in_finality_phase(&timelock) == false, 0);
        assert!(timelock::is_in_exclusive_phase(&timelock) == true, 0);
        assert!(timelock::is_in_private_cancellation_phase(&timelock) == false, 0);
        assert!(timelock::is_in_public_cancellation_phase(&timelock) == false, 0);
    }

    #[test]
    fun test_escrow_safety_deposit_handling() {
        let (_, recipient, resolver, metadata, _) = setup_test();

        // Record initial safety deposit balance
        let initial_resolver_safety_deposit_balance = primary_fungible_store::balance(
            signer::address_of(&resolver),
            constants::get_safety_deposit_metadata()
        );

        let escrow = escrow::new_from_resolver(
            &resolver,
            signer::address_of(&recipient),
            metadata,
            ASSET_AMOUNT,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        let escrow_address = object::object_address(&escrow);

        // Verify resolver's safety deposit balance decreased
        let final_resolver_safety_deposit_balance = primary_fungible_store::balance(
            signer::address_of(&resolver),
            constants::get_safety_deposit_metadata()
        );
        assert!(final_resolver_safety_deposit_balance == initial_resolver_safety_deposit_balance - constants::get_safety_deposit_amount(), 0);

        // Verify escrow has safety deposit
        let escrow_safety_deposit_balance = primary_fungible_store::balance(
            escrow_address,
            constants::get_safety_deposit_metadata()
        );
        assert!(escrow_safety_deposit_balance == constants::get_safety_deposit_amount(), 0);
    }

    #[test]
    fun test_escrow_object_lifecycle() {
        let (owner, _, resolver, metadata, _) = setup_test();

        // Create fusion order
        let fusion_order = fusion_order::new(
            &owner,
            metadata,
            ASSET_AMOUNT,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        let fusion_order_address = object::object_address(&fusion_order);

        // Verify fusion order exists
        assert!(object::object_exists<FusionOrder>(fusion_order_address) == true, 0);

        // Convert to escrow
        let escrow = escrow::new_from_order(&resolver, fusion_order);

        let escrow_address = object::object_address(&escrow);

        // Verify fusion order is deleted and escrow is created
        assert!(object::object_exists<FusionOrder>(fusion_order_address) == false, 0);
        assert!(object::object_exists<Escrow>(escrow_address) == true, 0);

        // Verify escrow controller exists
        assert!(object::object_exists<escrow::EscrowController>(escrow_address) == true, 0);
    }

    #[test]
    fun test_escrow_from_order_vs_from_resolver_comparison() {
        let (owner, recipient, resolver, metadata, _) = setup_test();

        // Create escrow from order
        let fusion_order = fusion_order::new(
            &owner,
            metadata,
            ASSET_AMOUNT,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        let escrow_from_order = escrow::new_from_order(&resolver, fusion_order);

        // Create escrow from resolver
        let escrow_from_resolver = escrow::new_from_resolver(
            &resolver,
            signer::address_of(&recipient),
            metadata,
            ASSET_AMOUNT,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        // Compare properties
        assert!(escrow::get_amount(escrow_from_order) == escrow::get_amount(escrow_from_resolver), 0);
        assert!(escrow::get_chain_id(escrow_from_order) == escrow::get_chain_id(escrow_from_resolver), 0);
        assert!(escrow::get_resolver(escrow_from_order) == escrow::get_resolver(escrow_from_resolver), 0);

        // Key differences
        assert!(escrow::get_from(escrow_from_order) == signer::address_of(&owner), 0); // From original owner
        assert!(escrow::get_from(escrow_from_resolver) == signer::address_of(&resolver), 0); // From resolver

        assert!(escrow::get_to(escrow_from_order) == signer::address_of(&resolver), 0); // To resolver
        assert!(escrow::get_to(escrow_from_resolver) == signer::address_of(&recipient), 0); // To recipient
    }
}
