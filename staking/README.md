# XAPI Staking

## How to stake

Transfer xRING to staking.xapi.testnet with msg "Stake"
```
near contract call-function as-transaction 3beb2cf5c2c050bc575350671aa5f06e589386e8.factory.sepolia.testnet ft_transfer_call json-args '{"receiver_id":"staking.xapi.testnet","amount":"10000000000000000000","msg":"Stake"}' prepaid-gas '100.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as guantong.testnet network-config testnet sign-with-legacy-keychain send
```