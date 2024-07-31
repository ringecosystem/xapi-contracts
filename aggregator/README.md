# XAPI Near Contracts

## Quickstart

1. Make sure you have installed [node.js](https://nodejs.org/en/download/package-manager/) >= 16.
2. Install the [`NEAR CLI`](https://docs.near.org/tools/near-cli-rs#install)

### 1. Build and Test the Contract

```bash
npm install
```

```bash
npm run build
```

### 2. Create an Account and Deploy the Contract

You can create a new account and deploy the contract by running:

```bash
# Create account to deploy your contract
near account create-account fund-myself <your-subaccount.testnet> '0.1 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as <your-account.testnet> network-config testnet sign-with-legacy-keychain send

near contract deploy <your-subaccount.testnet> use-file ./build/hello_near.wasm without-init-call network-config testnet sign-with-legacy-keychain send
```

### 3. Retrieve the Greeting

`get_greeting` is a read-only method (aka `view` method).

`View` methods can be called for **free** by anyone, even people **without a NEAR account**!

```bash
# Use near-cli to get the greeting
near contract call-function as-read-only <your-subaccount.testnet> get_greeting text-args '' network-config testnet now
```

### 4. Store a New Greeting

`set_greeting` changes the contract's state, for which it is a `call` method.

`Call` methods can only be invoked using a NEAR account, since the account needs to pay GAS for the transaction.

```bash
# Use near-cli to set a new greeting
near contract call-function as-transaction <your-subaccount.testnet> set_greeting json-args '{"greeting":"hello near"}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as <your-account.testnet> network-config testnet sign-with-legacy-keychain send
```

**Tip:** If you would like to call `set_greeting` using another account, first login into NEAR using:

```bash
# Use near-cli to login your NEAR account
near account import-account
```
