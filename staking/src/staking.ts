import { NearBindgen, near, call, view, UnorderedMap, AccountId, assert, NearPromise, migrate } from 'near-sdk-js';
import { ContractBase, ContractSourceMetadata, Nep297Event, Standard } from '../../common/src/standard.abstract';

interface FungibleReceiver {
  ft_on_transfer({ sender_id, amount, msg }: { sender_id: string, amount: string, msg: string }): string;
}

class Unlocking {
  amount: string
  account_id: AccountId
  unlock_time: string
}

class Staked {
  amount: string
  account_id: AccountId
  unlocking: Unlocking[]
}

class StakeEvent extends Nep297Event {
  constructor(data: Staked) {
    super("Stake", data)
  }
}

class UnlockEvent extends Nep297Event {
  constructor(data: Unlocking) {
    super("Unlock", data)
  }
}
class WithdrawEvent extends Nep297Event {
  constructor(data: { account_id: AccountId, amount: string }) {
    super("Withdraw", data)
  }
}


@NearBindgen({})
class Staking extends ContractBase implements FungibleReceiver {
  total_staked: bigint;
  staked_map: UnorderedMap<Staked>;
  token_account: AccountId;
  unlock_period: bigint;

  constructor() {
    super(new ContractSourceMetadata({
      version: "",
      link: "",
      standards: [new Standard("nep330", "1.1.0"), new Standard("nep297", "1.0.0")]
    }));
    this.total_staked = BigInt(0);
    this.staked_map = new UnorderedMap("staking");
    this.token_account = "3beb2cf5c2c050bc575350671aa5f06e589386e8.factory.sepolia.testnet";
    this.unlock_period = BigInt(0);
  }

  @migrate({})
  _clear_state() {
    assert(near.signerAccountId() == near.currentAccountId(), "Require owner");
    near.storageRemove("STATE");
  }

  // calls

  @call({})
  unlock({ amount }: { amount: string }) {
    const account_id = near.signerAccountId();
    const _amount = BigInt(amount);
    const staked = this.staked_map.get(account_id);
    let _staked_amount = BigInt(staked.amount);

    assert(staked && _staked_amount >= _amount, "Insufficient staked");

    near.log(`${account_id} unstaking ${amount}`);

    _staked_amount -= _amount;
    this.total_staked -= _amount;

    const _unlock_time = near.blockTimestamp() + this.unlock_period;
    const _unlock = { amount: _amount.toString(), unlock_time: _unlock_time.toString(), account_id: near.signerAccountId() };
    staked.unlocking.push(_unlock);

    this.staked_map.set(account_id, staked);
    new UnlockEvent(_unlock).emit();
  }

  @call({})
  ft_on_transfer({ sender_id, amount, msg }: { sender_id: string, amount: string, msg: string }): string {
    // on_transfer: predecessor: eth.sepolia.testnet, signer: test.guantong.testnet, sender_id: test.guantong.testnet, amount: 1000, msg: Stake
    near.log(`on_transfer: predecessor: ${near.predecessorAccountId()}, signer: ${near.signerAccountId()}, sender_id: ${sender_id}, amount: ${amount}, msg: ${msg}`);

    assert(near.predecessorAccountId() == this.token_account && msg == "Stake", `Require ${this.token_account} and msg Stake, Current: ${near.predecessorAccountId()}, msg: ${msg}`);

    const _amount = BigInt(amount);
    let staked = this.staked_map.get(sender_id) || { amount: "0", unlocking: [], account_id: near.signerAccountId() };
    let _staked_amount = BigInt(staked.amount);
    _staked_amount += _amount;
    staked.amount = _staked_amount.toString();

    this.staked_map.set(sender_id, staked);
    this.total_staked += _amount;

    near.log(`${sender_id} staked ${amount}. Total staked: ${this.total_staked}`);
    new StakeEvent(staked).emit();
    return "0"; // Return 0 to keep all tokens
  }

  @call({})
  withdraw() {
    const account_id = near.signerAccountId();
    let staked = this.staked_map.get(account_id);

    assert(staked && staked.unlocking.length > 0, "No tokens to withdraw")

    const currentTime = BigInt(near.blockTimestamp());
    let total_withdraw = BigInt(0);
    let new_unlocking = [];

    for (let entry of staked.unlocking) {
      if (currentTime >= BigInt(entry.unlock_time)) {
        total_withdraw += BigInt(entry.amount);
      } else {
        new_unlocking.push(entry);
      }
    }

    assert(total_withdraw > BigInt(0), "No tokens are unlocked yet");

    staked.unlocking = new_unlocking;
    this.staked_map.set(account_id, staked);

    near.log(`${account_id} withdrawing ${total_withdraw}`);

    const promise = NearPromise.new(this.token_account)
      .functionCall(
        "ft_transfer",
        JSON.stringify({
          receiver_id: account_id,
          amount: total_withdraw.toString(),
        }),
        BigInt(1), // 1 yoctoNEAR for security reasons
        BigInt(30000000000000) // 30 TGas
      );
    new WithdrawEvent({ account_id: near.signerAccountId(), amount: total_withdraw.toString() }).emit();
    return promise.asReturn();
  }

  // views

  @view({})
  get_top_staked({ top }: { top: number }) {
    const all_stakers = [];
    // near contract call-function as-transaction stake.guantong.testnet get_top_staked json-args '{"top":3}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as guantong.testnet network-config testnet sign-with-legacy-keychain send
    const _staked_array = this.staked_map.toArray();

    for (let i = 0; i < _staked_array.length; i++) {
      const _staked = _staked_array[i];
      all_stakers.push({ account_id: _staked[1].account_id, amount: _staked[1].amount })
    }

    all_stakers.sort((a, b) => {
      if (b.amount > a.amount) return 1;
      if (b.amount < a.amount) return -1;
      return 0;
    });

    return all_stakers.slice(0, top).map(staked => ({
      account_id: staked.account_id,
      amount: staked.amount.toString()
    }));
  }

  @view({})
  get_staked({ account_id }) {
    return this.staked_map.get(account_id) || { amount: BigInt(0) };
  }

  @view({})
  get_total_staked() {
    return this.total_staked.toString();
  }

  @view({})
  get_token_account() {
    return this.token_account;
  }

  @view({})
  contract_source_metadata(): ContractSourceMetadata {
    return super._contract_source_metadata();
  }
}