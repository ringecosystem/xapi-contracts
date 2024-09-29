import { ContractBase, Nep297Event, ContractSourceMetadata } from "../../../common/src/standard.abstract";
import { encodeFunctionCall, ethereumTransaction, hexToBytes } from "../lib/ethereum";
import { AccountId, assert, LookupMap, near, NearPromise, ONE_TERA_GAS, PromiseIndex, UnorderedMap } from "near-sdk-js";
import { sizeOf } from "../lib/helper";

export type RequestId = string;
export type Timestamp = string;
export type ChainId = string;

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
  chain_id: ChainId;
  xapi_address: string;
  gas_limit: string;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;

  constructor({ chain_id, xapi_address, gas_limit, max_fee_per_gas, max_priority_fee_per_gas }: { chain_id: ChainId, xapi_address: string, gas_limit: string, max_fee_per_gas: string, max_priority_fee_per_gas: string }) {
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
  constructor(quorum: number, threshold: number) {
    this.quorum = quorum;
    this.threshold = threshold;
  }
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
  nonce: string;
  chain_id: ChainId;

  constructor(request_id: RequestId) {
    this.request_id = request_id;
    this.started_at = near.blockTimestamp().toString();
    this.status = RequestStatus.FETCHING;
  }
}

export class Report<Result> {
  request_id: RequestId;
  reporter: AccountId;
  timestamp: Timestamp;
  chain_id: ChainId;
  // Evm address to withdraw rewards on target chain 
  reward_address: string;
  // Because cross-chain transactions may fail, we need to rely on the reporter to report nonce instead of maintaining the self-increment.
  nonce: string;
  reporter_required: ReporterRequired;
  answers: Answer<Result>[];
  constructor({ request_id, chain_id, nonce, answers, reporter_required, reward_address }: { request_id: RequestId, chain_id: ChainId, nonce: string, answers: Answer<Result>[], reporter_required: ReporterRequired, reward_address: string }) {
    this.request_id = request_id;
    this.chain_id = chain_id;
    this.nonce = nonce;
    this.answers = answers;
    this.reporter_required = reporter_required;
    this.reward_address = reward_address;
    this.timestamp = near.blockTimestamp().toString();
    this.reporter = near.signerAccountId();
  }
}

export class MpcConfig {
  mpc_contract: AccountId;
  // Deposit yocto to request mpc, the surplus will be refunded to this contract.
  attached_balance: string;

  constructor({ mpc_contract, attached_balance }: { mpc_contract: AccountId, attached_balance: string }) {
    this.mpc_contract = mpc_contract;
    this.attached_balance = attached_balance;
  }
}

export class Staked {
  amount: string
  account_id: AccountId
}

// Default timeout: 2 hours
const DEFAULT_TIME_OUT = "18000000000000";

export abstract class Aggregator<Result> extends ContractBase {
  description: string;
  latest_request_id: RequestId;
  // Nanoseconds
  timeout: Timestamp;

  mpc_config: MpcConfig;
  staking_contract: AccountId;
  reporter_required: ReporterRequired

  // key: data_source name
  data_sources: UnorderedMap<DataSource>;
  // key: request_id, subKey: reporter accountId
  report_lookup: LookupMap<Report<Result>[]>;
  // key: request_id
  response_lookup: LookupMap<Response<Result>>;
  // key: chain_id
  publish_chain_config_lookup: LookupMap<PublishChainConfig>;

  constructor({ description, timeout, mpc_config, reporter_required, staking_contract, contract_metadata, }: { description: string, timeout: Timestamp, mpc_config: MpcConfig, reporter_required: ReporterRequired, staking_contract: AccountId, contract_metadata: ContractSourceMetadata }) {
    super(contract_metadata);
    this.description = description;
    this.mpc_config = mpc_config;
    this.reporter_required = reporter_required;
    this.staking_contract = staking_contract;

    if (!timeout) {
      this.timeout = DEFAULT_TIME_OUT;
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
    assert(BigInt(mpc_config.attached_balance) > 0, "MPC attached balance should be greater than 0.");

    this.mpc_config.mpc_contract = mpc_config.mpc_contract;
    this.mpc_config.attached_balance = mpc_config.attached_balance;
  }

  abstract get_mpc_config(): MpcConfig;
  _get_mpc_config(): MpcConfig {
    return this.mpc_config;
  }

  abstract set_reporter_required(reporter_required: ReporterRequired): void;
  _set_reporter_required(reporter_required: ReporterRequired): void {
    this._assert_operator();
    assert(reporter_required.quorum > 0, "Quorum should be greater than 0");
    assert(reporter_required.threshold > 0, "Threshold should be greater than 0");
    assert(reporter_required.quorum >= reporter_required.threshold, "Quorum should >= threshold");
    this.reporter_required = reporter_required;
  }

  abstract get_reporter_required(): ReporterRequired;
  _get_reporter_required(): ReporterRequired {
    return this.reporter_required;
  }

  abstract set_staking_contract({ staking_contract }: { staking_contract: AccountId }): void;
  _set_staking_contract({ staking_contract }: { staking_contract: AccountId }): void {
    this._assert_operator();
    this.staking_contract = staking_contract;
  }

  abstract get_staking_contract(): AccountId;
  _get_staking_contract(): AccountId {
    return this.staking_contract;
  }

  abstract set_publish_chain_config(publis_chain_config: PublishChainConfig): void;
  _set_publish_chain_config(publish_chain_config: PublishChainConfig): void {
    this._assert_operator();
    assert(publish_chain_config.chain_id != null, "Chain id can't be null.");
    this.publish_chain_config_lookup.set(publish_chain_config.chain_id.toString(), publish_chain_config);
  }

  abstract get_publish_chain_config({ chain_id }: { chain_id: ChainId }): PublishChainConfig;
  _get_publish_chain_config({ chain_id }: { chain_id: ChainId }): PublishChainConfig {
    return this.publish_chain_config_lookup.get(chain_id.toString());
  }

  abstract set_timeout({ timeout }: { timeout: Timestamp }): void;
  _set_timeout({ timeout }: { timeout: Timestamp }): void {
    this._assert_operator();
    assert(BigInt(timeout) > BigInt(0), "Timeout should be greater than 0.");
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

  abstract get_reports({ request_id }: { request_id: RequestId }): Report<Result>[];
  _get_reports({ request_id }: { request_id: RequestId }): Report<Result>[] {
    const _reports = this.report_lookup.get(request_id);
    assert(_reports != null, `Non reports for request_id: ${request_id}`);
    return _reports;
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

  abstract report({ request_id, nonce, answers, reporter_required, reward_address }: { request_id: RequestId, nonce: string, answers: Answer<Result>[], reporter_required: ReporterRequired, reward_address: string }): void;
  _report({ request_id, nonce, answers, reporter_required, reward_address }: { request_id: RequestId, nonce: string, answers: Answer<Result>[], reporter_required: ReporterRequired, reward_address: string }): void {
    assert(request_id != null, "request_id is null");
    assert(nonce != null, "nonce is null");
    assert(answers != null && answers.length > 0, "answers is empty");
    assert(reward_address != null, "reward_address is null");

    const _chain_id = (BigInt(request_id) >> BigInt(192)).toString();

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
        new Array<Report<Result>>()
      );
      _response = this.response_lookup.get(request_id);
    }

    // Update timeout status if necessary.
    if (_response.status == RequestStatus.FETCHING && BigInt(_response.started_at) + BigInt(this.timeout) < near.blockTimestamp()) {
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
    assert(_reports.find(r => r.reporter === _signer) == null, "Already reported");
    _reports.push(__report);
    this.report_lookup.set(request_id, _reports);
    this.response_lookup.set(request_id, _response);
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
    return this.data_sources.toArray().map(entry => entry[1]);
  }

  abstract _can_aggregate({ request_id }: { request_id: RequestId }): boolean;
  abstract _aggregate({ request_id, top_staked }: { request_id: RequestId, top_staked: Staked[] }): boolean;

  _try_aggregate({ request_id }: { request_id: RequestId }): NearPromise {
    if (this._can_aggregate({ request_id })) {
      const _response = this.response_lookup.get(request_id);
      assert(
        _response.status == RequestStatus.FETCHING,
        `The request status is ${_response.status}`
      );
      assert(this.staking_contract != null && this.staking_contract != "", "Staking contract cannot be null");
      // Check staking before aggregating
      const promise = NearPromise.new(this.staking_contract)
        .functionCall("get_top_staked", JSON.stringify({ top: this.reporter_required.quorum }), BigInt(0), ONE_TERA_GAS * BigInt(15))
        .then(
          NearPromise.new(near.currentAccountId())
            .functionCall(
              "post_aggregate_callback",
              JSON.stringify({ request_id: request_id, promise_index: 0 }),
              BigInt(0),
              // Beware of the 300T cap with mpc gas
              BigInt(ONE_TERA_GAS * BigInt(15))
            )
        );

      return promise.asReturn();
    }
  }

  abstract post_aggregate_callback({ request_id, promise_index }: { request_id: RequestId, promise_index: number }): void;
  _post_aggregate_callback({ request_id, promise_index }: { request_id: RequestId, promise_index: number }): void {
    const _result = this._promise_result({ promise_index: promise_index });
    near.log(`post_aggregate_callback ${request_id}, ${_result.success}, ${_result.result} promise_index: ${promise_index}`);
    const _top_staked: Staked[] = JSON.parse(_result.result);

    this._aggregate({ request_id, top_staked: _top_staked });

    const _response = this.response_lookup.get(request_id);
    if (_response.result) {
      _response.updated_at = near.blockTimestamp().toString();
      _response.status = RequestStatus.DONE;
      this.response_lookup.set(request_id, _response);
      this._publish({ request_id, promise_index: 1 });
    }
  }

  // Use this if autopublish fails due to mpc failure. Any safe problem??
  abstract publish_external({ request_id }: { request_id: RequestId }): NearPromise;
  _publish({ request_id, promise_index }: { request_id: RequestId, promise_index: number }): NearPromise {
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
      chainId: BigInt(_response.chain_id),
      nonce: BigInt(_response.nonce),
      maxPriorityFeePerGas: BigInt(_chain_config.max_priority_fee_per_gas),
      maxFeePerGas: BigInt(_chain_config.max_fee_per_gas),
      gasLimit: BigInt(_chain_config.gas_limit),
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
            JSON.stringify({ request_id: request_id, promise_index: promise_index }),
            BigInt(0),
            // Beware of the 300T cap with mpc gas
            BigInt(ONE_TERA_GAS * BigInt(15))
          )
      );
    this.response_lookup.set(request_id, _response);
    return promise.asReturn();
  }

  abstract publish_callback({ request_id, promise_index }: { request_id: RequestId, promise_index: number }): void
  _publish_callback({ request_id, promise_index }: { request_id: RequestId, promise_index: number }): void {
    const _result = this._promise_result({ promise_index: promise_index });
    near.log(`publish_callback ${request_id}, ${_result.success}, ${_result.result}, promise_index: ${promise_index}`);
    const _response = this.response_lookup.get(request_id);
    if (_result.success) {
      _response.status = RequestStatus.PUBLISHED;
      const _chain_config = this.publish_chain_config_lookup.get(_response.chain_id.toString());
      new PublishEvent(new PublishData({
        request_id, response: _response, chain_config: _chain_config, signature: _result.result
      })).emit();
      this.response_lookup.set(request_id, _response);
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
    } catch (error) {
      near.log(`Error retrieving promise result: ${error}, index: ${promise_index}`);
      result = undefined;
      success = false;
    }
    return { result, success };
  }
}
