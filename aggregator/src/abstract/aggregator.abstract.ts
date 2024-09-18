import { ContractBase, Nep297Event, ContractSourceMetadata } from "../../../common/src/standard.abstract";
import { encodeFunctionCall, ethereumTransaction, hexToBytes } from "../lib/ethereum";
import { AccountId, assert, LookupMap, near, NearPromise, ONE_TERA_GAS, PromiseIndex, UnorderedMap } from "near-sdk-js";
import { sizeOf } from "../lib/helper";

export type RequestId = string;
export type Timestamp = bigint;

export enum RequestStatus {
  FETCHING,
  DONE,
  TIMEOUT,
  PUBLISHED,
}

export enum RequestMethod {
  GET,
  POST
}

export class PublishChainConfig {
  chain_id: bigint;
  xapi_address: string;
  gas_limit: bigint;
  max_fee_per_gas: bigint;
  max_priority_fee_per_gas: bigint;

  constructor({ chain_id, xapi_address, gas_limit, max_fee_per_gas, max_priority_fee_per_gas }: { chain_id: bigint, xapi_address: string, gas_limit: bigint, max_fee_per_gas: bigint, max_priority_fee_per_gas: bigint }) {
    this.chain_id = chain_id;
    this.xapi_address = xapi_address;
    this.gas_limit = gas_limit;
    this.max_fee_per_gas = max_fee_per_gas;
    this.max_priority_fee_per_gas = max_priority_fee_per_gas;
  }
}

export class DataSource {
  name: string;
  url: string;
  method: RequestMethod;
  headers: Object;
  body_json: Object;
  // https://docs.api3.org/reference/ois/latest/reserved-parameters.html#path, split by `,`
  result_path: string;

  constructor({ name, url, method, headers, body_json, result_path }: { name: string, url: string, method: RequestMethod, headers: Object, body_json: Object, result_path: string }) {
    this.name = name;
    this.url = url;
    this.method = method;
    this.headers = headers;
    this.body_json = body_json;
    this.result_path = result_path;
  }
}

export class Answer<Result> {
  data_source_name: string;
  result: Result;

  constructor({ data_source_name, result }: { data_source_name: string, result: Result }) {
    this.data_source_name = data_source_name;
    this.result = result;
  }
}

class AddDataSourceEvent extends Nep297Event {
  constructor(data: DataSource) {
    super("AddDataSource", data)
  }
}

class RemoveDataSourceEvent extends Nep297Event {
  constructor(data: DataSource) {
    super("RemoveDataSource", data)
  }
}

class TimeoutEvent<Result> extends Nep297Event {
  constructor(data: Response<Result>) {
    super("Timeout", data)
  }
}

class ReportEvent<Result> extends Nep297Event {
  constructor(data: Report<Result>) {
    super("Report", data)
  }
}

class PublishData {
  request_id: RequestId;
  response: Response<any>;
  chain_config: PublishChainConfig;
  signature: string;

  constructor({ request_id, response, chain_config, signature }: { request_id: RequestId, response: Response<any>, chain_config: PublishChainConfig, signature: string }) {
    this.request_id = request_id;
    this.response = response;
    this.chain_config = chain_config;
    this.signature = signature;
  }
}

class PublishEvent extends Nep297Event {
  constructor(data: PublishData) {
    super("Publish", data)
  }
}

export class ReporterRequired {
  quorum: number;
  threshold: number;
}

export class Response<Result> {
  request_id: RequestId;
  reporters: AccountId[];
  // EVM address to distribute rewards
  reporter_reward_addresses: string[];
  started_at: Timestamp;
  updated_at: Timestamp;
  status: RequestStatus;
  // Build in _publish
  call_data: string;

  // 👇 These values should be aggregated from reporter's answer
  result: Result;
  nonce: bigint;
  chain_id: bigint;

  constructor(request_id: RequestId) {
    this.request_id = request_id;
    this.started_at = near.blockTimestamp();
    this.status = RequestStatus.FETCHING;
  }
}

export class Report<Result> {
  request_id: RequestId;
  reporter: AccountId;
  timestamp: Timestamp;
  chain_id: bigint;
  // Evm address to withdraw rewards on target chain 
  reward_address: string;
  // Because cross-chain transactions may fail, we need to rely on the reporter to report nonce instead of maintaining the self-increment.
  nonce: bigint;
  reporter_required: ReporterRequired;
  answers: Answer<Result>[];
  constructor({ request_id, chain_id, nonce, answers, reporter_required, reward_address }: { request_id: RequestId, chain_id: bigint, nonce: bigint, answers: Answer<Result>[], reporter_required: ReporterRequired, reward_address: string }) {
    this.request_id = request_id;
    this.chain_id = chain_id;
    this.nonce = nonce;
    this.answers = answers;
    this.reporter_required = reporter_required;
    this.reward_address = reward_address;
    this.timestamp = near.blockTimestamp();
    this.reporter = near.signerAccountId();
  }
}

export class StakingConfig {
  staking_contract: AccountId;
  // Top n reporters can report data.
  top_threshold: number;

  constructor({ staking_contract, top_threshold }: { staking_contract: AccountId, top_threshold: number }) {
    this.staking_contract = staking_contract;
    this.top_threshold = top_threshold;
  }
}

export class MpcConfig {
  mpc_contract: AccountId;
  // Deposit yocto to request mpc, the surplus will be refunded to this contract.
  attached_balance: bigint;

  constructor({ mpc_contract, attached_balance }: { mpc_contract: AccountId, attached_balance: bigint }) {
    this.mpc_contract = mpc_contract;
    this.attached_balance = attached_balance;
  }
}

export abstract class Aggregator<Result> extends ContractBase {
  description: string;
  latest_request_id: RequestId;
  timeout: Timestamp;

  mpc_config: MpcConfig;
  // !! Setting this to null will not check the reporter's staking before aggregating.
  staking_config: StakingConfig;

  // key: data_source name
  data_sources: UnorderedMap<DataSource>;
  // key: request_id, subKey: reporter accountId
  report_lookup: LookupMap<Map<AccountId, Report<Result>>>;
  // key: request_id
  response_lookup: LookupMap<Response<Result>>;
  // key: chain_id
  publish_chain_config_lookup: LookupMap<PublishChainConfig>;

  constructor({ description, timeout, mpc_config, staking_config, contract_metadata, }: { description: string, timeout: Timestamp, mpc_config: MpcConfig, staking_config: StakingConfig, contract_metadata: ContractSourceMetadata }) {
    super(contract_metadata);
    this.description = description;
    this.mpc_config = mpc_config;
    this.staking_config = staking_config;

    if (!timeout) {
      // Default timeout: 2 hours
      this.timeout = BigInt(18000);
    } else {
      this.timeout = timeout;
    }

    this.data_sources = new UnorderedMap("data_sources");
    this.report_lookup = new LookupMap("report_lookup");
    this.response_lookup = new LookupMap("response_lookup");
  }

  abstract _assert_operator(): void;

  abstract get_description(): string;
  _get_description(): string {
    return this.description;
  }

  abstract set_mpc_config(mpc_config: MpcConfig): void;
  _set_mpc_config(mpc_config: MpcConfig): void {
    this._assert_operator();
    assert(mpc_config.mpc_contract != null, "MPC contract can't be null.");
    assert(mpc_config.attached_balance > 0, "MPC attached balance should be greater than 0.");

    this.mpc_config.mpc_contract = mpc_config.mpc_contract;
    this.mpc_config.attached_balance = mpc_config.attached_balance;
  }

  abstract get_mpc_config(): MpcConfig;
  _get_mpc_config(): MpcConfig {
    return this.mpc_config;
  }

  abstract set_staking_config(staking_config: StakingConfig): void;
  _set_staking_config(staking_config: StakingConfig): void {
    this._assert_operator();
    this.staking_config = staking_config;
  }

  abstract get_staking_config(): StakingConfig;
  _get_staking_config(): StakingConfig {
    return this.staking_config;
  }

  abstract set_publish_chain_config(publis_chain_config: PublishChainConfig): void;
  _set_publish_chain_config(publish_chain_config: PublishChainConfig): void {
    this._assert_operator();
    assert(publish_chain_config.chain_id != null, "Chain id can't be null.");
    this.publish_chain_config_lookup.set(publish_chain_config.chain_id.toString(), publish_chain_config);
  }

  abstract get_publish_chain_config({ chain_id }: { chain_id: bigint }): PublishChainConfig;
  _get_publish_chain_config({ chain_id }: { chain_id: bigint }): PublishChainConfig {
    return this.publish_chain_config_lookup.get(chain_id.toString());
  }

  abstract set_timeout({ timeout }: { timeout: Timestamp }): void;
  _set_timeout({ timeout }: { timeout: Timestamp }): void {
    this._assert_operator();
    assert(timeout > BigInt(0), "Timeout should be greater than 0.");
    this.timeout = timeout;
  }

  abstract get_timeout(): Timestamp;
  _get_timeout(): Timestamp {
    return this.timeout;
  }

  abstract get_latest_request_id(): string;
  _get_latest_request_id(): RequestId {
    return this.latest_request_id;
  }

  abstract get_report({ request_id, reporter_account }: { request_id: RequestId, reporter_account: AccountId }): Report<Result>;
  _get_report({ request_id, reporter_account }: { request_id: RequestId, reporter_account: AccountId }): Report<Result> {
    const _report_map = this.report_lookup.get(request_id);
    assert(_report_map != null, `Non reports for request_id: ${request_id}`);
    return _report_map.get(reporter_account);
  }

  abstract get_latest_response(): Response<Result>;
  _get_latest_response(): Response<Result> {
    assert(this.latest_request_id != null, "No latest response");
    return this.response_lookup.get(this.latest_request_id);
  }

  abstract get_response({ request_id }: { request_id: RequestId }): Response<Result>;
  _get_response({ request_id }: { request_id: RequestId }): Response<Result> {
    return this.response_lookup.get(request_id);
  }

  abstract can_report(): boolean;

  abstract report({ request_id, nonce, answers, reporter_required, reward_address }: { request_id: RequestId, nonce: bigint, answers: Answer<Result>[], reporter_required: ReporterRequired, reward_address: string }): void;
  _report({ request_id, nonce, answers, reporter_required, reward_address }: { request_id: RequestId, nonce: bigint, answers: Answer<Result>[], reporter_required: ReporterRequired, reward_address: string }): void {
    assert(request_id != null, "request_id is null");
    assert(nonce != null, "nonce is null");
    assert(answers != null && answers.length > 0, "answers is empty");
    assert(reward_address != null, "reward_address is null");

    const _chain_id = BigInt(request_id) >> BigInt(192);

    const __report = new Report<Result>({
      request_id,
      chain_id: _chain_id,
      nonce,
      answers,
      reporter_required,
      reward_address
    });

    const _deposit = near.attachedDeposit();
    const _required_deposit = this._report_deposit(__report);
    assert(
      _deposit >= _required_deposit,
      `Insufficient deposit, deposit: ${_deposit}, required: ${_required_deposit}`
    );

    assert(this.can_report(), "Reporting requirements not met.");

    let _response = this.response_lookup.get(request_id);
    if (_response == null) {
      // Maybe first report
      // !!! The request_id may be abused to prevent normal requests.
      this.response_lookup.set(
        request_id,
        new Response<Result>(request_id)
      );
      this.report_lookup.set(
        request_id,
        new Map<AccountId, Report<Result>>()
      );
      _response = this.response_lookup.get(request_id);
    }

    // Update timeout status if necessary.
    if (_response.status == RequestStatus.FETCHING && _response.started_at + this.timeout < near.blockTimestamp()) {
      _response.status = RequestStatus.TIMEOUT;
      new TimeoutEvent(_response).emit();
    }

    // Only fetching request can accept reports.
    assert(
      _response.status == RequestStatus.FETCHING,
      `The request status is ${_response.status}`
    );

    const _reports = this.report_lookup.get(request_id);
    const _signer = near.signerAccountId();
    assert(_reports.get(_signer) == null, "Already reported");
    _reports.set(_signer, __report);
    new ReportEvent<Result>(__report).emit();
    this._try_aggregate({ request_id });
  }

  abstract add_data_source(data_source: DataSource): void;
  _add_data_source(data_source: DataSource): void {
    this._assert_operator();

    assert(data_source.name != null, "Datasource name is null");
    assert(data_source.method != null, "Datasource method is null");
    assert(data_source.url != null, "Datasource url is null");
    assert(data_source.result_path != null, "Datasource result_path is null")

    assert(this.data_sources.get(data_source.name) == null, "Datasource name already exists");
    this.data_sources.set(data_source.name, data_source);
    new AddDataSourceEvent(data_source).emit();
  }

  abstract remove_data_source({ data_source_name }: { data_source_name: string }): void;
  _remove_data_source({ data_source_name }: { data_source_name: string }): void {
    this._assert_operator();

    const _removed = this.data_sources.remove(data_source_name);
    assert(_removed != null, `${data_source_name} does not exist.`);
    new RemoveDataSourceEvent(_removed).emit();
  }

  abstract get_data_sources(): DataSource[]
  _get_data_sources(): DataSource[] {
    const _keys = this.data_sources._keys;
    const _values: DataSource[] = [];
    for (let i = 0; i < _keys.length; i++) {
      _values.push(this.data_sources[i]);
    }
    return _values;
  }

  abstract _can_aggregate({ request_id }: { request_id: RequestId }): boolean;
  abstract _aggregate({ request_id }: { request_id: RequestId }): Result;

  _try_aggregate({ request_id }: { request_id: RequestId }): NearPromise {
    if (this._can_aggregate({ request_id })) {
      const _response = this.response_lookup.get(request_id);
      assert(
        _response.status == RequestStatus.FETCHING,
        `The request status is ${_response.status}`
      );
      if (this.staking_config && this.staking_config.staking_contract) {
        // todo Check staking before aggregating
        const promise = NearPromise.new(this.staking_config.staking_contract)
          .functionCall("top_list", JSON.stringify({ threshold: this.staking_config.top_threshold }), BigInt(0), ONE_TERA_GAS * BigInt(15))
          .then(
            NearPromise.new(near.currentAccountId())
              .functionCall(
                "post_aggregate_callback",
                JSON.stringify({ request_id: request_id }),
                BigInt(0),
                // Beware of the 300T cap with mpc gas
                BigInt(ONE_TERA_GAS * BigInt(15))
              )
          );

        return promise.asReturn();
      } else {
        this._post_aggregate({ request_id });
      }
    }
  }

  abstract post_aggregate_callback({ request_id }: { request_id: RequestId }): void;
  _post_aggregate({ request_id }: { request_id: RequestId }): void {
    const _response = this.response_lookup.get(request_id);

    if (this.staking_config && this.staking_config.staking_contract) {
      const _reporters = _response.reporters;
      // todo check _reporters is in the top list
      // todo check the promise_index
      const _result = this._promise_result({ promise_index: 0 });
    }
    // todo filter invalid reporter
    _response.result = this._aggregate({ request_id });
    _response.reporters = Array.from(this.report_lookup.get(request_id).keys());

    _response.reporter_reward_addresses = Array.from(this.report_lookup.get(request_id).values())
      .map(report => report.reward_address);
    _response.updated_at = near.blockTimestamp();
    _response.status = RequestStatus.DONE;
    this._publish({ request_id });
  }

  // Use this if autopublish fails due to mpc failure. Any safe problem??
  abstract publish_external({ request_id }: { request_id: RequestId }): NearPromise;
  _publish({ request_id }: { request_id: RequestId }): NearPromise {
    const _response = this.response_lookup.get(request_id);
    assert(_response != null, `Response for ${request_id} does not exist`);

    assert(_response.status == RequestStatus.DONE, `Response status is ${_response.status}, can't be published`)

    const _chain_config = this.publish_chain_config_lookup.get(_response.chain_id.toString());
    assert(_chain_config != null, `Chain config for ${_response.chain_id} does not exist`);

    // Relay it https://sepolia.etherscan.io/tx/0xfe2e2e0018f609b5d10250a823f191942fc42d597ad1cccfb4842f43f1d9196e
    const function_call_data = encodeFunctionCall({
      functionSignature: "fulfill(uint256,tuple(address[],bytes))",
      params: [
        BigInt(request_id),
        [
          _response.reporter_reward_addresses,
          _response.result
        ]
      ]
    })
    _response.call_data = function_call_data;
    near.log("functionCallData", function_call_data);

    const function_call_data_bytes = hexToBytes(function_call_data);
    near.log("bytes functionCallData", Array.from(function_call_data_bytes));

    const payload = ethereumTransaction({
      chainId: _response.chain_id,
      nonce: _response.nonce,
      maxPriorityFeePerGas: _chain_config.max_priority_fee_per_gas,
      maxFeePerGas: _chain_config.max_fee_per_gas,
      gasLimit: _chain_config.gas_limit,
      to: _chain_config.xapi_address,
      value: BigInt(0),
      data: function_call_data_bytes,
      accessList: []
    });
    const payload_arr = Array.from(payload);
    near.log("payload_arr", payload_arr);
    // 215,91,147,81,5,211,171,61,184,185,105,11,93,160,46,31,46,184,4,159,21,167,69,34,35,91,31,56,138,152,163,51

    const mpc_args = {
      "request": {
        "key_version": 0,
        "payload": payload_arr,
        // 0x4dd0A89Cb15D953Fc738362066b412fd303BCe17
        "path": "test"
      }
    }
    const promise = NearPromise.new(this.mpc_config.mpc_contract)
      // 1 NEAR to request signature, the surplus will be refunded
      .functionCall("sign", JSON.stringify(mpc_args), BigInt(this.mpc_config.attached_balance), ONE_TERA_GAS * BigInt(250))
      .then(
        NearPromise.new(near.currentAccountId())
          .functionCall(
            "publish_callback",
            JSON.stringify({ request_id: request_id }),
            BigInt(0),
            // Beware of the 300T cap with mpc gas
            BigInt(ONE_TERA_GAS * BigInt(15))
          )
      );

    return promise.asReturn();
  }

  abstract publish_callback({ request_id }: { request_id: RequestId }): void
  _publish_callback({ request_id }: { request_id: RequestId }): void {
    const _result = this._promise_result({ promise_index: 0 });
    near.log(`publish call back ${request_id}, ${_result.success}, ${_result.result}`);
    const _response = this.response_lookup.get(request_id);
    if (_result.success) {
      _response.status = RequestStatus.PUBLISHED;
      const _chain_config = this.publish_chain_config_lookup.get(_response.chain_id.toString());
      new PublishEvent(new PublishData({
        request_id, response: _response, chain_config: _chain_config, signature: _result.result
      })).emit();
    }
  }

  private _report_deposit(report: Report<Result>): bigint {
    const _bytes = BigInt(sizeOf(report));
    // 100KB == 1Near == 10^24 yoctoNear
    // 1024 bytes == 10^22 yoctoNear
    const _yocto_per_byte = BigInt(10 ** 22) / BigInt(1024);
    return _bytes * _yocto_per_byte * BigInt(2);
  }

  private _promise_result({ promise_index }: { promise_index: PromiseIndex }): { result: string; success: boolean } {
    let result: string, success: boolean;
    try {
      result = near.promiseResult(promise_index);
      success = true;
    } catch {
      result = undefined;
      success = false;
    }
    return { result, success };
  }
}
