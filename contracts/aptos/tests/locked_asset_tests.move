module fusion_plus::locked_asset_tests {
    use std::option::{Self};
    use std::string::utf8;
    use std::hash;
    use std::debug;
    use aptos_framework::account;
    use aptos_framework::fungible_asset::{Self, Metadata, MintRef};
    use aptos_framework::object::{Self, Object};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;
    use fusion_plus::locked_asset::{Self, LockedAsset};
    use fusion_plus::common;

    // Test accounts
    const OWNER: address = @0x1;
    const RECIPIENT: address = @0x2;
    const RESOLVER: address = @0x3;
    const CHAIN_ID: u64 = 20;

    // Test amounts
    const ASSET_AMOUNT: u64 = 1000000; // 1 token

    // Test secrets and hashes
    const TEST_SECRET: vector<u8> = b"my secret";
    const WRONG_SECRET: vector<u8> = b"wrong secret";

    fun setup_test(): (signer, signer, signer, Object<Metadata>, MintRef) {
        timestamp::set_time_has_started_for_testing(&account::create_signer_for_test(@aptos_framework));
        let fusion_signer = account::create_account_for_test(@fusion_plus);

        let owner = common::initialize_account_with_fa(OWNER);
        let recipient = common::initialize_account_with_fa(RECIPIENT);
        let resolver = common::initialize_account_with_fa(RESOLVER);

        let (metadata, mint_ref) = common::create_test_token(&owner, b"Test Token");

        locked_asset::init_module_for_test(&fusion_signer);

        (owner, recipient, resolver, metadata, mint_ref)
    }

    #[test]
    fun test_create_locked_asset_from_user() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();

        let asset = fungible_asset::mint(&mint_ref, ASSET_AMOUNT);

        let locked_asset = locked_asset::new_from_user(
            &recipient,
            asset,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );

        // Verify initial state
        assert!(locked_asset::is_timelock_active(locked_asset) == false, 0);
        assert!(locked_asset::get_recipient(locked_asset) == option::none(), 0);
        assert!(locked_asset::get_resolver(locked_asset) == option::none(), 0);
        assert!(locked_asset::get_metadata(locked_asset) == metadata, 0);
        assert!(locked_asset::get_amount(locked_asset) == ASSET_AMOUNT, 0);
        assert!(locked_asset::get_chain_id(locked_asset) == CHAIN_ID, 0);

        // Verify safety deposit amount is correct
        assert!(locked_asset::get_safety_deposit_amount(locked_asset) == locked_asset::safety_deposit_amount_for_test(), 0);
        assert!(locked_asset::get_safety_deposit_metadata(locked_asset) == locked_asset::safety_deposit_metadata_for_test(), 0);
    }

    #[test]
    fun test_user_destroy_order_happy_flow() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();

        let asset = fungible_asset::mint(&mint_ref, ASSET_AMOUNT);

        // Record initial balances
        let initial_main_balance = primary_fungible_store::balance(
            RECIPIENT,
            metadata
        );
        let initial_safety_deposit_balance = primary_fungible_store::balance(
            RECIPIENT,
            locked_asset::safety_deposit_metadata_for_test()
        );

        let locked_asset = locked_asset::new_from_user(
            &recipient,
            asset,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );

        let locked_asset_address = object::object_address(&locked_asset);

        // Verify initial state before destruction
        assert!(locked_asset::is_timelock_active(locked_asset) == false, 0);
        assert!(locked_asset::get_recipient(locked_asset) == option::none(), 0);
        assert!(locked_asset::get_resolver(locked_asset) == option::none(), 0);

        // Verify safety deposit was transferred to locked asset
        let safety_deposit_at_object = primary_fungible_store::balance(
            locked_asset_address,
            locked_asset::safety_deposit_metadata_for_test()
        );
        assert!(safety_deposit_at_object == locked_asset::safety_deposit_amount_for_test(), 0);

        // Verify user's safety deposit balance decreased
        let user_safety_deposit_after_creation = primary_fungible_store::balance(
            RECIPIENT,
            locked_asset::safety_deposit_metadata_for_test()
        );
        assert!(user_safety_deposit_after_creation == initial_safety_deposit_balance - locked_asset::safety_deposit_amount_for_test(), 0);

        // Verify the object exists
        assert!(object::object_exists<LockedAsset>(locked_asset_address) == true, 0);

        // User destroys the order
        locked_asset::user_destroy_order(&recipient, locked_asset);

        // Verify the object is deleted
        assert!(object::object_exists<LockedAsset>(locked_asset_address) == false, 0);

        // Verify recipient received the main asset back
        let final_main_balance = primary_fungible_store::balance(
            RECIPIENT,
            metadata
        );
        assert!(final_main_balance == initial_main_balance + ASSET_AMOUNT, 0);

        // Verify safety deposit is returned
        let final_safety_deposit_balance = primary_fungible_store::balance(
            RECIPIENT,
            locked_asset::safety_deposit_metadata_for_test()
        );
        assert!(final_safety_deposit_balance == initial_safety_deposit_balance, 0);
    }

    #[test]
    #[expected_failure(abort_code = locked_asset::EINVALID_CALLER)]
    fun test_user_destroy_order_wrong_caller() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();


        let wrong_caller = account::create_account_for_test(@0x999);
        let asset = fungible_asset::mint(&mint_ref, ASSET_AMOUNT);

        let locked_asset = locked_asset::new_from_user(
            &recipient,
            asset,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );

        // Wrong caller tries to destroy the order
        locked_asset::user_destroy_order(&wrong_caller, locked_asset);
    }

    #[test]
    fun test_user_destroy_order_multiple_orders() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();

        // Record initial balances
        let initial_main_balance = primary_fungible_store::balance(
            RECIPIENT,
            metadata
        );
        let initial_safety_deposit_balance = primary_fungible_store::balance(
            RECIPIENT,
            locked_asset::safety_deposit_metadata_for_test()
        );

        let asset1 = fungible_asset::mint(&mint_ref, ASSET_AMOUNT);
        let asset2 = fungible_asset::mint(&mint_ref, ASSET_AMOUNT * 2);

        let locked_asset1 = locked_asset::new_from_user(
            &recipient,
            asset1,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );

        let locked_asset2 = locked_asset::new_from_user(
            &recipient,
            asset2,
            hash::sha3_256(WRONG_SECRET),
            CHAIN_ID
        );

        let safety_deposit_after_creation = primary_fungible_store::balance(
            RECIPIENT,
            locked_asset::safety_deposit_metadata_for_test()
        );
        assert!(safety_deposit_after_creation == initial_safety_deposit_balance - locked_asset::safety_deposit_amount_for_test() * 2, 0);

        // Destroy first order
        locked_asset::user_destroy_order(&recipient, locked_asset1);

        // Verify first order main asset returned
        let balance_after_first = primary_fungible_store::balance(
            RECIPIENT,
            metadata
        );
        assert!(balance_after_first == initial_main_balance + ASSET_AMOUNT, 0);

        // Verify first order safety deposit returned
        let safety_deposit_after_first_destroy = primary_fungible_store::balance(
            RECIPIENT,
            locked_asset::safety_deposit_metadata_for_test()
        );
        assert!(safety_deposit_after_first_destroy == safety_deposit_after_creation + locked_asset::safety_deposit_amount_for_test(), 0);


        // Destroy second order
        locked_asset::user_destroy_order(&recipient, locked_asset2);

        // Verify second order main asset returned
        let final_main_balance = primary_fungible_store::balance(
            RECIPIENT,
            metadata
        );
        assert!(final_main_balance == initial_main_balance + ASSET_AMOUNT + ASSET_AMOUNT * 2, 0);

        // Verify second order safety deposit returned
        let final_safety_deposit_balance = primary_fungible_store::balance(
            RECIPIENT,
            locked_asset::safety_deposit_metadata_for_test()
        );
        assert!(final_safety_deposit_balance == initial_safety_deposit_balance, 0);
    }

    #[test]
    fun test_user_destroy_order_different_recipients() {
        let (owner, recipient1, resolver, metadata, mint_ref) = setup_test();

        let recipient2 = common::initialize_account_with_fa(@0x4);
        let asset1 = fungible_asset::mint(&mint_ref, ASSET_AMOUNT);
        let asset2 = fungible_asset::mint(&mint_ref, ASSET_AMOUNT * 2);

        let locked_asset1 = locked_asset::new_from_user(
            &recipient1,
            asset1,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );

        let locked_asset2 = locked_asset::new_from_user(
            &recipient2,
            asset2,
            hash::sha3_256(WRONG_SECRET),
            CHAIN_ID
        );

        // Record initial balances
        let initial_balance1 = primary_fungible_store::balance(
            RECIPIENT,
            metadata
        );
        let initial_balance2 = primary_fungible_store::balance(
            @0x4,
            metadata
        );

        // Each recipient destroys their own order
        locked_asset::user_destroy_order(&recipient1, locked_asset1);
        locked_asset::user_destroy_order(&recipient2, locked_asset2);

        // Verify each recipient received their funds back
        let final_balance1 = primary_fungible_store::balance(
            RECIPIENT,
            metadata
        );
        let final_balance2 = primary_fungible_store::balance(
            @0x4,
            metadata
        );

        assert!(final_balance1 == initial_balance1 + ASSET_AMOUNT, 0);
        assert!(final_balance2 == initial_balance2 + ASSET_AMOUNT * 2, 0);
    }

    #[test]
    fun test_user_destroy_order_large_amount() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();


        let large_amount = 1000000000000; // 1M tokens
        let asset = fungible_asset::mint(&mint_ref, large_amount);

        let locked_asset = locked_asset::new_from_user(
            &recipient,
            asset,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );

        // Record initial balance
        let initial_balance = primary_fungible_store::balance(
            RECIPIENT,
            metadata
        );

        // User destroys the order
        locked_asset::user_destroy_order(&recipient, locked_asset);

        // Verify recipient received the funds back
        let final_balance = primary_fungible_store::balance(
            RECIPIENT,
            metadata
        );
        assert!(final_balance == initial_balance + large_amount, 0);
    }

    #[test]
    fun test_user_destroy_order_after_random_deposit() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();



        let asset = fungible_asset::mint(&mint_ref, ASSET_AMOUNT);

        let locked_asset = locked_asset::new_from_user(
            &recipient,
            asset,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );

        let locked_asset_address = object::object_address(&locked_asset);

        // Record initial balances
        let initial_recipient_balance = primary_fungible_store::balance(
            RECIPIENT,
            metadata
        );
        let initial_safety_deposit_balance = primary_fungible_store::balance(
            RECIPIENT,
            locked_asset::safety_deposit_metadata_for_test()
        );

        // Record initial balance of locked asset
        let locked_asset_balance = primary_fungible_store::balance(
            locked_asset_address,
            metadata
        );
        assert!(locked_asset_balance == ASSET_AMOUNT, 0);

        let extra_amount = 300000;

        let extra_asset = fungible_asset::mint(&mint_ref, extra_amount);
        primary_fungible_store::deposit(locked_asset_address, extra_asset);

        let fa_supply_after_mint = option::destroy_some(fungible_asset::supply(metadata)) as u64;
        assert!(fa_supply_after_mint == ASSET_AMOUNT + extra_amount, 0);

        // Record balance of locked asset after depositing
        let locked_asset_balance_after_deposit = primary_fungible_store::balance(
            locked_asset_address,
            metadata
        );
        assert!(locked_asset_balance_after_deposit == ASSET_AMOUNT + extra_amount, 0);

        // Verify the object exists
        assert!(object::object_exists<LockedAsset>(locked_asset_address) == true, 0);

        // User destroys the order
        locked_asset::user_destroy_order(&recipient, locked_asset);

        // Verify the object is deleted
        assert!(object::object_exists<LockedAsset>(locked_asset_address) == false, 0);

        // Verify recipient received the main asset back
        let final_recipient_balance = primary_fungible_store::balance(
            RECIPIENT,
            metadata
        );
        assert!(final_recipient_balance == initial_recipient_balance + ASSET_AMOUNT, 0);

        // Verify safety deposit is also returned
        let final_safety_deposit_balance = primary_fungible_store::balance(
            RECIPIENT,
            locked_asset::safety_deposit_metadata_for_test()
        );

        debug::print(&final_safety_deposit_balance);
        assert!(final_safety_deposit_balance == initial_safety_deposit_balance + locked_asset::safety_deposit_amount_for_test(), 0);

        let fa_supply_after_destroying_locked_asset = option::destroy_some(fungible_asset::supply(metadata)) as u64;
        assert!(fa_supply_after_destroying_locked_asset == ASSET_AMOUNT + extra_amount, 0);

        // Record balance of locked asset after destroying
        let locked_asset_balance_after_destroy = primary_fungible_store::balance(
            locked_asset_address,
            metadata
        );
        assert!(locked_asset_balance_after_destroy == 0, 0);

        // Remaining balance is transferred to the contract
        let remaining_balance = primary_fungible_store::balance(
            @fusion_plus,
            metadata
        );
        assert!(remaining_balance == extra_amount, 0);

    }

    #[test]
    fun test_user_destroy_order_with_unrelated_fa_lost() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();



        // Create a second FA
        let (metadata2, mint_ref2) = common::create_test_token(&owner, b"Unrelated Token");

        // Mint the main asset and create the locked asset object
        let asset = fungible_asset::mint(&mint_ref, ASSET_AMOUNT);
        let locked_asset = locked_asset::new_from_user(
            &recipient,
            asset,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );
        let locked_asset_address = object::object_address(&locked_asset);

        // Mint and deposit unrelated FA to the locked asset object
        let unrelated_amount = 12345;
        let unrelated_asset = fungible_asset::mint(&mint_ref2, unrelated_amount);
        primary_fungible_store::deposit(locked_asset_address, unrelated_asset);

        // Check unrelated FA balance at the object before destruction
        let unrelated_balance_before = primary_fungible_store::balance(
            locked_asset_address,
            metadata2
        );
        assert!(unrelated_balance_before == unrelated_amount, 0);

        // Destroy the order
        locked_asset::user_destroy_order(&recipient, locked_asset);

        // Check unrelated FA balance at the contract (should be 0, i.e., lost)
        let unrelated_balance_contract = primary_fungible_store::balance(
            @fusion_plus,
            metadata2
        );
        assert!(unrelated_balance_contract == 0, 0);

        // Check unrelated FA balance at the recipient (should be 0, i.e., lost)
        let unrelated_balance_recipient = primary_fungible_store::balance(
            RECIPIENT,
            metadata2
        );
        assert!(unrelated_balance_recipient == 0, 0);
    }


    #[test]
    fun test_user_destroy_order_with_unrelated_fa_swept() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();
        let fusion_signer = account::create_account_for_test(@fusion_plus);



        // Create a second FA
        let (metadata2, mint_ref2) = common::create_test_token(&owner, b"Unrelated Token");

        // Mint the main asset and create the locked asset object
        let asset = fungible_asset::mint(&mint_ref, ASSET_AMOUNT);
        let locked_asset = locked_asset::new_from_user(
            &recipient,
            asset,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );
        let locked_asset_address = object::object_address(&locked_asset);

        // Mint and deposit unrelated FA to the locked asset object
        let unrelated_amount = 12345;
        let unrelated_asset = fungible_asset::mint(&mint_ref2, unrelated_amount);
        primary_fungible_store::deposit(locked_asset_address, unrelated_asset);

        // Check unrelated FA balance at the object before destruction
        let unrelated_balance_before = primary_fungible_store::balance(
            locked_asset_address,
            metadata2
        );
        assert!(unrelated_balance_before == unrelated_amount, 0);

        // Sweep the unrelated FA
        locked_asset::sweep_other_asset(&fusion_signer, locked_asset, metadata2);

        // Destroy the order
        locked_asset::user_destroy_order(&recipient, locked_asset);

        // Check unrelated FA balance at the contract (should be 0, i.e., lost)
        let unrelated_balance_contract = primary_fungible_store::balance(
            @fusion_plus,
            metadata2
        );
        assert!(unrelated_balance_contract == unrelated_amount, 0);

        // Check unrelated FA balance at the recipient (should be 0, i.e., lost)
        let unrelated_balance_recipient = primary_fungible_store::balance(
            RECIPIENT,
            metadata2
        );
        assert!(unrelated_balance_recipient == 0, 0);
    }

    #[test]
    #[expected_failure(abort_code = locked_asset::ENOT_ADMIN)]
    fun test_sweep_other_asset_wrong_caller() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();


        let wrong_caller = account::create_account_for_test(@0x999);

        // Create a second FA
        let (metadata2, mint_ref2) = common::create_test_token(&owner, b"Unrelated Token");

        // Mint the main asset and create the locked asset object
        let asset = fungible_asset::mint(&mint_ref, ASSET_AMOUNT);
        let locked_asset = locked_asset::new_from_user(
            &recipient,
            asset,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );
        let locked_asset_address = object::object_address(&locked_asset);

        // Mint and deposit unrelated FA to the locked asset object
        let unrelated_amount = 12345;
        let unrelated_asset = fungible_asset::mint(&mint_ref2, unrelated_amount);
        primary_fungible_store::deposit(locked_asset_address, unrelated_asset);

        // Wrong caller tries to sweep the unrelated asset
        locked_asset::sweep_other_asset(&wrong_caller, locked_asset, metadata2);
    }

    #[test]
    fun test_sweep_other_asset_main_fa_not_swept() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();
        let fusion_signer = account::create_account_for_test(@fusion_plus);



        // Create a second FA
        let (metadata2, mint_ref2) = common::create_test_token(&owner, b"Unrelated Token");

        // Mint the main asset and create the locked asset object
        let asset = fungible_asset::mint(&mint_ref, ASSET_AMOUNT);
        let locked_asset = locked_asset::new_from_user(
            &recipient,
            asset,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );
        let locked_asset_address = object::object_address(&locked_asset);

        // Mint and deposit unrelated FA to the locked asset object
        let unrelated_amount = 12345;
        let unrelated_asset = fungible_asset::mint(&mint_ref2, unrelated_amount);
        primary_fungible_store::deposit(locked_asset_address, unrelated_asset);

        // Record initial balances
        let main_fa_balance_before = primary_fungible_store::balance(
            locked_asset_address,
            metadata
        );
        let unrelated_fa_balance_before = primary_fungible_store::balance(
            locked_asset_address,
            metadata2
        );
        let contract_balance_before = primary_fungible_store::balance(
            @fusion_plus,
            metadata
        );

        // Sweep the unrelated FA
        locked_asset::sweep_other_asset(&fusion_signer, locked_asset, metadata2);

        // Verify main FA is NOT swept (should remain at the object)
        let main_fa_balance_after = primary_fungible_store::balance(
            locked_asset_address,
            metadata
        );

        assert!(main_fa_balance_after == main_fa_balance_before, 0);

        // Verify unrelated FA is swept to contract
        let unrelated_fa_balance_contract = primary_fungible_store::balance(
            @fusion_plus,
            metadata2
        );
        assert!(unrelated_fa_balance_contract == unrelated_amount, 0);

        // Verify unrelated FA is no longer at the object
        let unrelated_fa_balance_object = primary_fungible_store::balance(
            locked_asset_address,
            metadata2
        );
        assert!(unrelated_fa_balance_object == 0, 0);

        // Verify main FA is not at contract
        let main_fa_balance_contract = primary_fungible_store::balance(
            @fusion_plus,
            metadata
        );
        assert!(main_fa_balance_contract == contract_balance_before, 0);
    }

    #[test]
    fun test_sweep_other_asset_multiple_unrelated_fas() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();
        let fusion_signer = account::create_account_for_test(@fusion_plus);


        // Create multiple unrelated FAs
        let (metadata2, mint_ref2) = common::create_test_token(&owner, b"Unrelated Token 1");
        let (metadata3, mint_ref3) = common::create_test_token(&owner, b"Unrelated Token 2");

        // Mint the main asset and create the locked asset object
        let asset = fungible_asset::mint(&mint_ref, ASSET_AMOUNT);
        let locked_asset = locked_asset::new_from_user(
            &recipient,
            asset,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );
        let locked_asset_address = object::object_address(&locked_asset);

        // Mint and deposit multiple unrelated FAs
        let unrelated_amount1 = 12345;
        let unrelated_amount2 = 67890;
        let unrelated_asset1 = fungible_asset::mint(&mint_ref2, unrelated_amount1);
        let unrelated_asset2 = fungible_asset::mint(&mint_ref3, unrelated_amount2);

        primary_fungible_store::deposit(locked_asset_address, unrelated_asset1);
        primary_fungible_store::deposit(locked_asset_address, unrelated_asset2);

        // Sweep first unrelated FA
        locked_asset::sweep_other_asset(&fusion_signer, locked_asset, metadata2);

        // Verify first unrelated FA is swept
        let unrelated_fa1_balance_contract = primary_fungible_store::balance(
            @fusion_plus,
            metadata2
        );
        assert!(unrelated_fa1_balance_contract == unrelated_amount1, 0);

        // Verify second unrelated FA is still at object
        let unrelated_fa2_balance_object = primary_fungible_store::balance(
            locked_asset_address,
            metadata3
        );
        assert!(unrelated_fa2_balance_object == unrelated_amount2, 0);

        // Sweep second unrelated FA
        locked_asset::sweep_other_asset(&fusion_signer, locked_asset, metadata3);

        // Verify second unrelated FA is also swept
        let unrelated_fa2_balance_contract = primary_fungible_store::balance(
            @fusion_plus,
            metadata3
        );
        assert!(unrelated_fa2_balance_contract == unrelated_amount2, 0);

        // Verify main FA is still at object
        let main_fa_balance_object = primary_fungible_store::balance(
            locked_asset_address,
            metadata
        );
        assert!(main_fa_balance_object == ASSET_AMOUNT, 0);
    }

    #[test]
    fun test_sweep_other_asset_nonexistent_asset() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();
        let fusion_signer = account::create_account_for_test(@fusion_plus);



        // Create a second FA
        let (metadata2, mint_ref2) = common::create_test_token(&owner, b"Unrelated Token");

        // Mint the main asset and create the locked asset object
        let asset = fungible_asset::mint(&mint_ref, ASSET_AMOUNT);
        let locked_asset = locked_asset::new_from_user(
            &recipient,
            asset,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );
        let locked_asset_address = object::object_address(&locked_asset);

        // Try to sweep an asset that doesn't exist at the object
        // This should either fail or sweep 0 amount
        locked_asset::sweep_other_asset(&fusion_signer, locked_asset, metadata2);

        // Verify no balance was swept (since there was nothing to sweep)
        let swept_balance = primary_fungible_store::balance(
            @fusion_plus,
            metadata2
        );
        assert!(swept_balance == 0, 0);
    }

    #[test]
    fun test_sweep_other_asset_zero_balance() {
        let (owner, recipient, resolver, metadata, mint_ref) = setup_test();
        let fusion_signer = account::create_account_for_test(@fusion_plus);



        // Create a second FA
        let (metadata2, mint_ref2) = common::create_test_token(&owner, b"Unrelated Token");

        // Mint the main asset and create the locked asset object
        let asset = fungible_asset::mint(&mint_ref, ASSET_AMOUNT);
        let locked_asset = locked_asset::new_from_user(
            &recipient,
            asset,
            hash::sha3_256(TEST_SECRET),
            CHAIN_ID
        );
        let locked_asset_address = object::object_address(&locked_asset);

        // Mint the unrelated asset to burn addres
        let unrelated_amount = 12345;
        let unrelated_asset = fungible_asset::mint(&mint_ref2, unrelated_amount);
        primary_fungible_store::deposit(@0x0, unrelated_asset);

        // Try to sweep the asset (should sweep 0)
        locked_asset::sweep_other_asset(&fusion_signer, locked_asset, metadata2);

        // Verify no balance was swept
        let swept_balance = primary_fungible_store::balance(
            @fusion_plus,
            metadata2
        );
        assert!(swept_balance == 0, 0);
    }

}