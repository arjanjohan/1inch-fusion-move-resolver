// MIT License
// Copyright (c) 2024 Aptos
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
// Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. NOTWITHSTANDING ANYTHING TO THE
// CONTRARY, IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
// WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

/// This module implements the USDT contract that allows minting, burning and transfering USDT.
/// Since most of the user functionalities are already provided as part of the Fungible Asset standard within the Aptos
/// framework, this module only provides management functionalities like minting, burning, freezing, etc.
module usdt::usdt {
    use aptos_framework::dispatchable_fungible_asset;
    use aptos_framework::event;
    use aptos_framework::function_info;
    use aptos_framework::fungible_asset::{
        Self,
        MintRef,
        TransferRef,
        BurnRef,
        Metadata,
        FungibleAsset,
        FungibleStore
    };
    use aptos_framework::object::{Self, Object, ExtendRef};
    use aptos_framework::primary_fungible_store;
    use aptos_std::table::{Self, Table};
    use std::option;
    use std::signer;
    use std::signer::address_of;
    use std::string::{Self, utf8};
    use std::vector;

    /// Caller is not authorized to make this call
    const EUNAUTHORIZED: u64 = 1;
    /// The account is frozen and cannot perform the operation
    const EFROZEN: u64 = 2;
    /// The sender account is frozen and cannot send tokens
    const EFROZEN_SENDING: u64 = 3;
    /// The recipient account is frozen and cannot receive tokens
    const EFROZEN_RECEIVING: u64 = 4;
    /// The account is not frozen so the operation is not allowed
    const ENOT_FROZEN: u64 = 5;
    /// The length of the vectors do not match
    const EARGUMENT_VECTORS_LENGTH_MISMATCH: u64 = 6;
    /// Cannot transfer admin to the same address
    const ESAME_ADMIN: u64 = 7;
    /// Invalid asset
    const EINVALID_ASSET: u64 = 8;

    const USDT_NAME: vector<u8> = b"Tether USD";
    const USDT_SYMBOL: vector<u8> = b"USDt";
    const USDT_DECIMALS: u8 = 6;
    const PROJECT_URI: vector<u8> = b"https://tether.to";
    const ICON_URI: vector<u8> = b"https://tether.to/images/logoCircle.png";

    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    struct Management has key {
        extend_ref: ExtendRef,
        mint_ref: MintRef,
        burn_ref: BurnRef,
        transfer_ref: TransferRef,
        admin: address,
        pending_admin: address,
        freeze_sending: Table<address, bool>,
        freeze_receiving: Table<address, bool>
    }

    #[event]
    struct Mint has drop, store {
        to: address,
        amount: u64
    }

    #[event]
    struct Burn has drop, store {
        from: address,
        store: Object<FungibleStore>,
        amount: u64
    }

    #[event]
    struct Freeze has drop, store {
        account: address,
        freeze_sending: bool,
        freeze_receiving: bool
    }

    #[event]
    struct Unfreeze has drop, store {
        account: address,
        unfreeze_sending: bool,
        unfreeze_receiving: bool
    }

    #[event]
    struct TransferAdmin has drop, store {
        admin: address,
        pending_admin: address
    }

    #[event]
    struct AcceptAdmin has drop, store {
        old_admin: address,
        new_admin: address
    }

    #[view]
    public fun usdt_address(): address {
        object::create_object_address(&@usdt, USDT_SYMBOL)
    }

    #[view]
    public fun metadata(): Object<Metadata> {
        object::address_to_object(usdt_address())
    }

    #[view]
    public fun is_frozen(account: address): (bool, bool) acquires Management {
        let management = borrow_global<Management>(usdt_address());
        let freeze_sending =
            *table::borrow_with_default(&management.freeze_sending, account, &false);
        let freeze_receiving =
            *table::borrow_with_default(&management.freeze_receiving, account, &false);
        (freeze_sending, freeze_receiving)
    }

    #[view]
    public fun admin(): address acquires Management {
        borrow_global<Management>(usdt_address()).admin
    }

    /// Called as part of deployment to initialize USDT.
    /// Create a stablecoin token (a new Fungible Asset)
    /// Ensure any stores for the stablecoin are untransferable as this can allow bypassing the frozen flag.
    /// Store Roles, Management and State resources in the Metadata object.
    /// Override deposit and withdraw functions of the newly created asset/token to add custom frozen check.
    fun init_module(usdt_signer: &signer) {
        // Create the stablecoin with primary store support.
        let constructor_ref = &object::create_named_object(usdt_signer, USDT_SYMBOL);
        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            constructor_ref,
            option::none(),
            utf8(USDT_NAME),
            utf8(USDT_SYMBOL),
            USDT_DECIMALS,
            string::utf8(ICON_URI),
            string::utf8(PROJECT_URI)
        );

        // Set ALL stores for the fungible asset to untransferable.
        // This prevents any store from being transferred to another account, which can be used to bypass the frozen
        // flag.
        fungible_asset::set_untransferable(constructor_ref);

        // Create mint/burn/transfer refs to allow admin to manage the stablecoin.
        let metadata_object_signer = &object::generate_signer(constructor_ref);
        move_to(
            metadata_object_signer,
            Management {
                extend_ref: object::generate_extend_ref(constructor_ref),
                mint_ref: fungible_asset::generate_mint_ref(constructor_ref),
                burn_ref: fungible_asset::generate_burn_ref(constructor_ref),
                transfer_ref: fungible_asset::generate_transfer_ref(constructor_ref),
                admin: @admin,
                pending_admin: @0x0,
                freeze_sending: table::new(),
                freeze_receiving: table::new()
            }
        );

        // Override the deposit and withdraw functions which mean overriding transfer.
        // This ensures all transfer will call withdraw and deposit functions in this module and perform the necessary
        // checks.
        let deposit =
            function_info::new_function_info(
                usdt_signer,
                string::utf8(b"usdt"),
                string::utf8(b"deposit")
            );
        let withdraw =
            function_info::new_function_info(
                usdt_signer,
                string::utf8(b"usdt"),
                string::utf8(b"withdraw")
            );
        dispatchable_fungible_asset::register_dispatch_functions(
            constructor_ref,
            option::some(withdraw),
            option::some(deposit),
            option::none()
        );
    }

    /// Deposit function override to ensure that the account is not frozen.
    public fun deposit<T: key>(
        store: Object<T>,
        fa: FungibleAsset,
        transfer_ref: &TransferRef
    ) acquires Management {
        assert!(
            fungible_asset::transfer_ref_metadata(transfer_ref) == metadata(),
            EINVALID_ASSET
        );
        let store_addr = object::object_address(&store);
        assert_not_frozen(store_addr, false, true);
        fungible_asset::deposit_with_ref(transfer_ref, store, fa);
    }

    /// Withdraw function override to ensure that the account is not frozen.
    public fun withdraw<T: key>(
        store: Object<T>,
        amount: u64,
        transfer_ref: &TransferRef
    ): FungibleAsset acquires Management {
        assert!(
            fungible_asset::transfer_ref_metadata(transfer_ref) == metadata(),
            EINVALID_ASSET
        );
        let store_addr = object::object_address(&store);
        assert_not_frozen(store_addr, true, false);
        fungible_asset::withdraw_with_ref(transfer_ref, store, amount)
    }

    /// Mint new tokens to the specified account. Can only be called by the admin.
    public entry fun mint(
        admin: &signer,
        to: address,
        amount: u64
    ) acquires Management {
        assert_is_admin(admin);
        let primary_store =
            primary_fungible_store::ensure_primary_store_exists(to, metadata());
        assert_not_frozen(object::object_address(&primary_store), false, true);
        let management = borrow_global<Management>(usdt_address());
        let tokens = fungible_asset::mint(&management.mint_ref, amount);
        fungible_asset::deposit_with_ref(
            &management.transfer_ref, primary_store, tokens
        );
        event::emit(Mint { to, amount });
    }

    public entry fun faucet(user: &signer, amount: u64) acquires Management {
        let to_address = address_of(user);
        let primary_store =
            primary_fungible_store::ensure_primary_store_exists(to_address, metadata());
        assert_not_frozen(object::object_address(&primary_store), false, true);
        let management = borrow_global<Management>(usdt_address());
        let tokens =
            fungible_asset::mint(
                &management.mint_ref,
                if (amount > 1000000000) 1000000000 else amount
            );
        fungible_asset::deposit_with_ref(
            &management.transfer_ref, primary_store, tokens
        );
        event::emit(Mint { to: to_address, amount });
    }

    public entry fun faucet_to_address(_user: &signer, to: address, amount: u64) acquires Management {
        let primary_store =
            primary_fungible_store::ensure_primary_store_exists(to, metadata());
        assert_not_frozen(object::object_address(&primary_store), false, true);
        let management = borrow_global<Management>(usdt_address());
        let tokens =
            fungible_asset::mint(
                &management.mint_ref,
                if (amount > 1000000000) 1000000000 else amount
            );
        fungible_asset::deposit_with_ref(
            &management.transfer_ref, primary_store, tokens
        );
        event::emit(Mint { to, amount });
    }

    /// Burn tokens from the admin's account.
    /// Can only be called by admin
    public entry fun revoke(admin: &signer, amount: u64) acquires Management {
        assert_is_admin(admin);
        let management = borrow_global<Management>(usdt_address());
        burn_internal(
            management,
            primary_fungible_store::ensure_primary_store_exists(
                signer::address_of(admin), metadata()
            ),
            amount
        );
    }

    /// Transfer tokens from a frozen account.
    /// Can only be called by admin
    public entry fun transfer(
        admin: &signer,
        from: address,
        to: address,
        amount: u64
    ) acquires Management {
        transfer_store(
            admin,
            primary_fungible_store::ensure_primary_store_exists(from, metadata()),
            to,
            amount
        );
    }

    /// Transfer tokens from a frozen account's specific store.
    /// Can only be called by admin
    public entry fun transfer_store(
        admin: &signer,
        from_store: Object<FungibleStore>,
        to: address,
        amount: u64
    ) acquires Management {
        assert_is_admin(admin);
        assert_is_frozen(from_store);
        let transfer_ref = &borrow_global<Management>(usdt_address()).transfer_ref;
        let to_store = primary_fungible_store::ensure_primary_store_exists(
            to, metadata()
        );
        fungible_asset::transfer_with_ref(transfer_ref, from_store, to_store, amount);
    }

    /// Burn tokens from the specified accounts.
    /// Can only be called by admin
    public entry fun burn(
        admin: &signer,
        account: address,
        amount: u64
    ) acquires Management {
        let store =
            primary_fungible_store::ensure_primary_store_exists(account, metadata());
        burn_from(admin, store, amount);
    }

    /// Burn tokens from the specified accounts' stores only if the accounts are frozen.
    /// Can only be called by an admin.
    public entry fun burn_from(
        admin: &signer,
        store: Object<FungibleStore>,
        amount: u64
    ) acquires Management {
        assert_is_admin(admin);
        assert_is_frozen(store);
        let management = borrow_global<Management>(usdt_address());
        burn_internal(management, store, amount);
    }

    fun burn_internal(
        management: &Management,
        store: Object<FungibleStore>,
        amount: u64
    ) {
        let tokens =
            fungible_asset::withdraw_with_ref(&management.transfer_ref, store, amount);
        fungible_asset::burn(&management.burn_ref, tokens);
        event::emit(
            Burn { from: object::owner(store), store, amount }
        );
    }

    /// Freeze an account. Can only be called by the admin.
    public entry fun freeze_accounts(
        admin: &signer,
        accounts: vector<address>,
        sending_flags: vector<bool>,
        receiving_flags: vector<bool>
    ) acquires Management {
        assert!(
            vector::length(&accounts) == vector::length(&sending_flags),
            EARGUMENT_VECTORS_LENGTH_MISMATCH
        );
        assert!(
            vector::length(&accounts) == vector::length(&receiving_flags),
            EARGUMENT_VECTORS_LENGTH_MISMATCH
        );
        assert_is_admin(admin);
        let management = borrow_global_mut<Management>(usdt_address());
        for (i in 0..vector::length(&accounts)) {
            let account = *vector::borrow(&accounts, i);
            let freeze_sending = *vector::borrow(&sending_flags, i);
            // Only set if the value is true to disallow unfreezing by passing false to this freeze function.
            if (freeze_sending) {
                let current_value =
                    table::borrow_mut_with_default(
                        &mut management.freeze_sending, account, freeze_sending
                    );
                *current_value = true;
            };
            let freeze_receiving = *vector::borrow(&receiving_flags, i);
            if (freeze_receiving) {
                let current_value =
                    table::borrow_mut_with_default(
                        &mut management.freeze_receiving, account, freeze_receiving
                    );
                *current_value = true;
            };
            event::emit(Freeze { account, freeze_sending, freeze_receiving });
        }
    }

    /// Remove an account from the denylist. This checks that the caller is the denylister.
    public entry fun unfreeze_accounts(
        admin: &signer,
        accounts: vector<address>,
        unfreeze_sending: vector<bool>,
        unfreeze_receiving: vector<bool>
    ) acquires Management {
        assert!(
            vector::length(&accounts) == vector::length(&unfreeze_sending),
            EARGUMENT_VECTORS_LENGTH_MISMATCH
        );
        assert!(
            vector::length(&accounts) == vector::length(&unfreeze_receiving),
            EARGUMENT_VECTORS_LENGTH_MISMATCH
        );
        assert_is_admin(admin);
        let management = borrow_global_mut<Management>(usdt_address());
        for (i in 0..vector::length(&accounts)) {
            let account = *vector::borrow(&accounts, i);
            let unfreeze_sending = *vector::borrow(&unfreeze_sending, i);
            let unfreeze_receiving = *vector::borrow(&unfreeze_receiving, i);
            if (unfreeze_sending
                && table::contains(&management.freeze_sending, account)) {
                table::remove(&mut management.freeze_sending, account);
            };
            if (unfreeze_receiving
                && table::contains(&management.freeze_receiving, account)) {
                table::remove(&mut management.freeze_receiving, account);
            };
            event::emit(Unfreeze { account, unfreeze_sending, unfreeze_receiving });
        }
    }

    /// Set the pending admin to the specified new admin. The new admin still needs to accept to become the admin.
    public entry fun transfer_admin(admin: &signer, new_admin: address) acquires Management {
        assert_is_admin(admin);
        assert!(signer::address_of(admin) != new_admin, ESAME_ADMIN);
        let management = borrow_global_mut<Management>(usdt_address());
        management.pending_admin = new_admin;
        event::emit(
            TransferAdmin { admin: management.admin, pending_admin: new_admin }
        );
    }

    /// Accept the admin role. This can only be called by the pending admin.
    public entry fun accept_admin(pending_admin: &signer) acquires Management {
        let management = borrow_global_mut<Management>(usdt_address());
        assert!(
            signer::address_of(pending_admin) == management.pending_admin,
            EUNAUTHORIZED
        );
        let old_admin = management.admin;
        management.admin = management.pending_admin;
        management.pending_admin = @0x0;
        event::emit(
            AcceptAdmin { old_admin, new_admin: management.admin }
        );
    }

    // Checks if a store is directly frozen
    fun assert_is_frozen(store: Object<FungibleStore>) acquires Management {
        let (store_frozen_sending, store_frozen_receiving) =
            is_frozen(object::object_address(&store));
        let is_store_frozen = store_frozen_sending || store_frozen_receiving;
        assert!(is_store_frozen, ENOT_FROZEN);
    }

    fun assert_not_frozen(
        account: address, check_sending: bool, check_receiving: bool
    ) acquires Management {
        let management = borrow_global<Management>(usdt_address());
        let frozen_sending =
            *table::borrow_with_default(&management.freeze_sending, account, &false);
        assert!(!check_sending || !frozen_sending, EFROZEN_SENDING);
        let frozen_receiving =
            *table::borrow_with_default(&management.freeze_receiving, account, &false);
        assert!(!check_receiving || !frozen_receiving, EFROZEN_RECEIVING);
    }

    fun assert_is_admin(account: &signer) acquires Management {
        let management = borrow_global<Management>(usdt_address());
        assert!(signer::address_of(account) == management.admin, EUNAUTHORIZED);
    }

    #[test_only]
    use aptos_framework::account;

    #[test_only]
    public fun init_for_test() {
        init_module(&account::create_signer_for_test(@usdt));
    }
}
