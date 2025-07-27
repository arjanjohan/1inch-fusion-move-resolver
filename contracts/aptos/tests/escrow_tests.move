module fusion_plus::escrow_tests {
    use std::option::{Self};
    use std::string::utf8;
    use std::hash;
    use std::debug;
    use std::signer;
    use aptos_framework::account;
    use aptos_framework::fungible_asset::{Self, Metadata, MintRef};
    use aptos_framework::object::{Self, Object};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;
    use fusion_plus::escrow::{Self, Escrow};
    use fusion_plus::fusion_order::{Self, FusionOrder};
    use fusion_plus::common;
    use fusion_plus::constants;
    use fusion_plus::resolver_registry;
    use fusion_plus::timelock::{Self, Timelock};
    use fusion_plus::hashlock::{Self, HashLock};

    // Test accounts
    const OWNER: address = @0x1;
    const RECIPIENT: address = @0x2;
    const RESOLVER: address = @0x3;
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

        let owner = common::initialize_account_with_fa(OWNER);
        let recipient = common::initialize_account_with_fa(RECIPIENT);
        let resolver = common::initialize_account_with_fa(RESOLVER);

        let (metadata, mint_ref) = common::create_test_token(&owner, b"Test Token");

        // Mint assets to accounts
        common::mint_fa(&mint_ref, MINT_AMOUNT, OWNER);
        common::mint_fa(&mint_ref, MINT_AMOUNT, RECIPIENT);
        common::mint_fa(&mint_ref, MINT_AMOUNT, RESOLVER);

        // Initialize modules
        resolver_registry::init_module_for_test(&fusion_signer);

        (owner, recipient, resolver, metadata, mint_ref)
    }

    #[test]
    fun test_create_escrow_from_order() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();

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
        assert!(escrow::get_from(escrow) == OWNER, 0);
        assert!(escrow::get_to(escrow) == RESOLVER, 0);
        assert!(escrow::get_resolver(escrow) == RESOLVER, 0);
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
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();

        // Record initial balances
        let initial_resolver_main_balance = primary_fungible_store::balance(
            RESOLVER,
            metadata
        );
        let initial_resolver_safety_deposit_balance = primary_fungible_store::balance(
            RESOLVER,
            constants::get_safety_deposit_metadata()
        );

        // Create escrow directly from resolver
        let escrow = escrow::new_from_resolver(
            &resolver,
            RECIPIENT,
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
        assert!(escrow::get_from(escrow) == RESOLVER, 0);
        assert!(escrow::get_to(escrow) == RECIPIENT, 0);
        assert!(escrow::get_resolver(escrow) == RESOLVER, 0);
        assert!(escrow::get_chain_id(escrow) == CHAIN_ID, 0);

        // Verify resolver's balances decreased
        let final_resolver_main_balance = primary_fungible_store::balance(
            RESOLVER,
            metadata
        );
        let final_resolver_safety_deposit_balance = primary_fungible_store::balance(
            RESOLVER,
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
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();

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
        assert!(escrow::get_from(escrow1) == OWNER, 0);
        assert!(escrow::get_from(escrow2) == OWNER, 0);
        assert!(escrow::get_to(escrow1) == RESOLVER, 0);
        assert!(escrow::get_to(escrow2) == RESOLVER, 0);
    }

    #[test]
    fun test_create_escrow_from_resolver_different_recipients() {
        let (recipient1, recipient2, resolver, metadata, mint_ref) = setup_test();

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
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();

        let large_amount = 1000000000000; // 1M tokens

        // Mint large amount to resolver
        common::mint_fa(&mint_ref, large_amount, RESOLVER);

        // Record initial balance
        let initial_resolver_balance = primary_fungible_store::balance(
            RESOLVER,
            metadata
        );

        // Create escrow with large amount
        let escrow = escrow::new_from_resolver(
            &resolver,
            RECIPIENT,
            metadata,
            large_amount,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        // Verify escrow properties
        assert!(escrow::get_amount(escrow) == large_amount, 0);
        assert!(escrow::get_from(escrow) == RESOLVER, 0);
        assert!(escrow::get_to(escrow) == RECIPIENT, 0);

        // Verify resolver's balance decreased
        let final_resolver_balance = primary_fungible_store::balance(
            RESOLVER,
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
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();

        let escrow = escrow::new_from_resolver(
            &resolver,
            RECIPIENT,
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
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();

        let escrow = escrow::new_from_resolver(
            &resolver,
            RECIPIENT,
            metadata,
            ASSET_AMOUNT,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        let timelock = escrow::get_timelock(escrow);

        let (finality_duration, exclusive_duration, private_cancellation_duration) = timelock::get_durations(&timelock);

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
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();

        // Record initial safety deposit balance
        let initial_resolver_safety_deposit_balance = primary_fungible_store::balance(
            RESOLVER,
            constants::get_safety_deposit_metadata()
        );

        let escrow = escrow::new_from_resolver(
            &resolver,
            RECIPIENT,
            metadata,
            ASSET_AMOUNT,
            CHAIN_ID,
            hash::sha3_256(TEST_SECRET)
        );

        let escrow_address = object::object_address(&escrow);

        // Verify resolver's safety deposit balance decreased
        let final_resolver_safety_deposit_balance = primary_fungible_store::balance(
            RESOLVER,
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
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();

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
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();

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
            RECIPIENT,
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
        assert!(escrow::get_from(escrow_from_order) == OWNER, 0); // From original owner
        assert!(escrow::get_from(escrow_from_resolver) == RESOLVER, 0); // From resolver

        assert!(escrow::get_to(escrow_from_order) == RESOLVER, 0); // To resolver
        assert!(escrow::get_to(escrow_from_resolver) == RECIPIENT, 0); // To recipient
    }
}
