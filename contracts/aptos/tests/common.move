
#[test_only]
module fusion_plus::common {
    use std::option::{Self};
    use std::string::utf8;
    use aptos_framework::account;
    use aptos_framework::fungible_asset::{Self, Metadata, MintRef};
    use aptos_framework::object::{Self, Object};
    use aptos_framework::primary_fungible_store;

    public fun create_test_token(owner: &signer, seed: vector<u8>): (Object<Metadata>, MintRef) {
        let constructor_ref = object::create_named_object(owner, seed);

            primary_fungible_store::create_primary_store_enabled_fungible_asset(
                &constructor_ref,
                option::none(),
                utf8(seed),
                utf8(b"TEST"),
                8,
                utf8(b""),
                utf8(b""),
            );

            let metadata = object::object_from_constructor_ref(&constructor_ref);
            let mint_ref = fungible_asset::generate_mint_ref(&constructor_ref);

            (metadata, mint_ref)
    }
}