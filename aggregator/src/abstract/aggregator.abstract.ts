import { ContractBase, Nep297Event, ContractSourceMetadata } from "../../../common/src/standard.abstract";
import { encodeFunctionCall, ethereumTransaction, hexToBytes } from "../lib/ethereum";
import { AccountId, assert, LookupMap, near, NearPromise, ONE_TERA_GAS, PromiseIndex, UnorderedMap } from "near-sdk-js";
import { sizeOf } from "../lib/helper";

export type RequestId = string;
export type Timestamp = string;
export type ChainId = string;

export enum RequestStatus {
  FETCHING,
  AGGREGATED,
  PUBLISHED,
  TIMEOUT,
}

export enum RequestMethod {
  GET,
  POST
}

export class PublishChainConfig {
  chain_id: ChainId;
  xapi_address: string;

  constructor({ chain_id, xapi_address }: { chain_id: ChainId, xapi_address: string }) {
    this.chain_id = chain_id;
    this.xapi_address = xapi_address;
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

export class Answer {
  data_source_name: string;
  result: string;

  constructor({ data_source_name, result }: { data_source_name: string, result: string }) {
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

class TimeoutEvent extends Nep297Event {
  constructor(data: Response) {
    super("Timeout", data)
  }
}

class ReportEvent extends Nep297Event {
  constructor(data: Report) {
    super("Report", data)
  }
}

class PublishData {
  request_id: RequestId;
  response: Response;
  chain_config: PublishChainConfig;
  signature: string;

  nonce: string;
  gas_limit: string;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;

  constructor({ request_id, response, chain_config, signature, nonce, gas_limit, max_fee_per_gas, max_priority_fee_per_gas }: { request_id: RequestId, response: Response, chain_config: PublishChainConfig, signature: string, nonce: string, gas_limit: string, max_fee_per_gas: string, max_priority_fee_per_gas: string }) {
    this.request_id = request_id;
    this.response = response;
    this.chain_config = chain_config;
    this.signature = signature;
    this.nonce = nonce;
    this.gas_limit = gas_limit;
    this.max_fee_per_gas = max_fee_per_gas;
    this.max_priority_fee_per_gas = max_priority_fee_per_gas;
  }
}

class PublishEvent extends Nep297Event {
  constructor(data: PublishData) {
    super("Publish", data)
  }
}

class AggregatedEvent extends Nep297Event {
  constructor(data: Response) {
    super("Aggregated", data);
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

export class Response {
  request_id: RequestId;
  chain_id: ChainId;
  valid_reporters: AccountId[];
  // EVM address to distribute rewards
  reporter_reward_addresses: string[];
  started_at: Timestamp;
  updated_at: Timestamp;
  status: string;
  // Build in _publish
  call_data: string;

  // 👇 These values should be aggregated from reporter's answer
  result: string;

  constructor(request_id: RequestId) {
    this.request_id = request_id;
    this.started_at = near.blockTimestamp().toString();
    this.status = RequestStatus[RequestStatus.FETCHING];
  }
}

export class Report {
  request_id: RequestId;
  reporter: AccountId;
  timestamp: Timestamp;
  // Evm address to withdraw rewards on target chain 
  reward_address: string;
  answers: Answer[];
  constructor({ request_id, answers, reward_address }: { request_id: RequestId, answers: Answer[], reward_address: string }) {
    this.request_id = request_id;
    this.answers = answers;
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

export abstract class Aggregator extends ContractBase {
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
  report_lookup: LookupMap<Report[]>;
  // key: request_id
  response_lookup: LookupMap<Response>;
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
    this.publish_chain_config_lookup = new LookupMap("publish_chain_config_lookup");
  }

  abstract _assert_operator(): void;

  abstract get_description(): string;
  _get_description(): string {
    return this.description;
  }

  abstract set_mpc_config(mpc_config: MpcConfig): void;
  _set_mpc_config(mpc_config: MpcConfig): void {
    this._assert_operator();
    assert(mpc_config.mpc_contract != null, "mpc_contract can't be null.");
    assert(BigInt(mpc_config.attached_balance) > 0, "attached_balance should be greater than 0.");

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
    assert(reporter_required.quorum > 0, "quorum should be greater than 0");
    assert(reporter_required.threshold > 0, "threshold should be greater than 0");
    assert(reporter_required.quorum >= reporter_required.threshold, "quorum should >= threshold");
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
    assert(publish_chain_config.chain_id != null, "chain_id can't be null.");
    assert(publish_chain_config.xapi_address != null, "xapi_address can't be null.");
    this.publish_chain_config_lookup.set(publish_chain_config.chain_id.toString(), publish_chain_config);
  }

  abstract get_publish_chain_config({ chain_id }: { chain_id: ChainId }): PublishChainConfig;
  _get_publish_chain_config({ chain_id }: { chain_id: ChainId }): PublishChainConfig {
    return this.publish_chain_config_lookup.get(chain_id.toString());
  }

  abstract set_timeout({ timeout }: { timeout: Timestamp }): void;
  _set_timeout({ timeout }: { timeout: Timestamp }): void {
    this._assert_operator();
    assert(BigInt(timeout) > BigInt(0), "timeout should be greater than 0.");
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

  abstract get_reports({ request_id }: { request_id: RequestId }): Report[];
  _get_reports({ request_id }: { request_id: RequestId }): Report[] {
    const _reports = this.report_lookup.get(request_id);
    assert(_reports != null, `Non reports for request_id: ${request_id}`);
    return _reports;
  }

  abstract get_latest_response(): Response;
  _get_latest_response(): Response {
    assert(this.latest_request_id != null, "No latest response");
    return this.response_lookup.get(this.latest_request_id);
  }

  abstract get_response({ request_id }: { request_id: RequestId }): Response;
  _get_response({ request_id }: { request_id: RequestId }): Response {
    return this.response_lookup.get(request_id);
  }

  abstract report({ request_id, answers, reward_address }: { request_id: RequestId, answers: Answer[], reward_address: string }): NearPromise;
  _report({ request_id, answers, reward_address }: { request_id: RequestId, answers: Answer[], reward_address: string }): NearPromise {
    assert(request_id != null, "request_id is null");
    assert(answers != null && answers.length > 0, "answers is empty");
    assert(reward_address != null, "reward_address is null");

    const __report = new Report({
      request_id,
      answers,
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
        new Response(request_id)
      );
      this.report_lookup.set(
        request_id,
        new Array<Report>()
      );
      _response = this.response_lookup.get(request_id);
    }

    // Update timeout status if necessary.
    if (_response.status == RequestStatus[RequestStatus.FETCHING] && BigInt(_response.started_at) + BigInt(this.timeout) < near.blockTimestamp()) {
      _response.status = RequestStatus[RequestStatus.TIMEOUT];
      new TimeoutEvent(_response).emit();
      this.response_lookup.set(request_id, _response);
      return;
    }

    // Only fetching request can accept reports.
    assert(
      _response.status == RequestStatus[RequestStatus.FETCHING],
      `The request status is ${_response.status}`
    );

    const _reports = this.report_lookup.get(request_id);
    const _signer = near.signerAccountId();
    assert(_reports.find(r => r.reporter === _signer) == null, "Already reported");
    _reports.push(__report);
    this.report_lookup.set(request_id, _reports);
    this.response_lookup.set(request_id, _response);
    new ReportEvent(__report).emit();
    return this._try_aggregate({ request_id });
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
      near.log("try_aggregate: ", request_id);
      const _response = this.response_lookup.get(request_id);
      assert(
        _response.status == RequestStatus[RequestStatus.FETCHING],
        `The request status is ${_response.status}`
      );
      assert(this.staking_contract != null && this.staking_contract != "", "Staking contract cannot be null");
      near.log(`get_top_staked: request_id: ${request_id}, contract: ${this.staking_contract}, top: ${this.reporter_required.quorum}, prepaidGas: ${near.prepaidGas()}, leftGas: ${near.prepaidGas() - near.usedGas()}`);
      // Check staking before aggregating
      const promise = NearPromise.new(this.staking_contract)
        .functionCall("get_top_staked", JSON.stringify({ top: this.reporter_required.quorum }), BigInt(0), ONE_TERA_GAS * BigInt(50))
        .then(
          NearPromise.new(near.currentAccountId())
            .functionCall(
              "post_aggregate_callback",
              JSON.stringify({ request_id: request_id, promise_index: 0 }),
              BigInt(0),
              // Beware of the 300T cap with mpc gas
              BigInt(ONE_TERA_GAS * BigInt(100))
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
      _response.status = RequestStatus[RequestStatus.AGGREGATED];
      this.response_lookup.set(request_id, _response);
      new AggregatedEvent(_response).emit();
    }
  }

  abstract publish_external({ request_id, nonce, gas_limit, max_fee_per_gas, max_priority_fee_per_gas }: { request_id: RequestId, nonce: string, gas_limit: string, max_fee_per_gas: string, max_priority_fee_per_gas: string }): NearPromise;
  _publish({ request_id, nonce, gas_limit, max_fee_per_gas, max_priority_fee_per_gas }: { request_id: RequestId, nonce: string, gas_limit: string, max_fee_per_gas: string, max_priority_fee_per_gas: string }): NearPromise {
    assert(nonce != null, "nonce can't be null.");
    assert(gas_limit != null, "gas_limit can't be null.");
    assert(max_fee_per_gas != null, "max_fee_per_gas can't be null.");
    assert(max_priority_fee_per_gas != null, "max_priority_fee_per_gas can't be null.");

    const _response = this.response_lookup.get(request_id);
    assert(_response != null, `Response for ${request_id} does not exist`);
    assert(_response.status == RequestStatus[RequestStatus.AGGREGATED] || _response.status == RequestStatus[RequestStatus.PUBLISHED], `Response status is ${_response.status}, can't be published`);

    // Update timeout status if necessary.
    if (BigInt(_response.started_at) + BigInt(this.timeout) < near.blockTimestamp()) {
      if (_response.status == RequestStatus[RequestStatus.AGGREGATED]) {
        _response.status = RequestStatus[RequestStatus.TIMEOUT];
        new TimeoutEvent(_response).emit();
        this.response_lookup.set(request_id, _response);
      }
      return;
    }

    _response.chain_id = (BigInt(request_id) >> BigInt(192)).toString();
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
      nonce: BigInt(nonce),
      maxPriorityFeePerGas: BigInt(max_priority_fee_per_gas),
      maxFeePerGas: BigInt(max_fee_per_gas),
      gasLimit: BigInt(gas_limit),
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
    this.response_lookup.set(request_id, _response);
    near.log(`before request signature, prepaidGas: ${near.prepaidGas()}, leftGas: ${near.prepaidGas() - near.usedGas()}`)
    const promise = NearPromise.new(this.mpc_config.mpc_contract)
      // 1 NEAR to request signature, the surplus will be refunded
      .functionCall("sign", JSON.stringify(mpc_args), BigInt(this.mpc_config.attached_balance), ONE_TERA_GAS * BigInt(250))
      .then(
        NearPromise.new(near.currentAccountId())
          .functionCall(
            "publish_callback",
            JSON.stringify({ request_id, nonce, gas_limit, max_fee_per_gas, max_priority_fee_per_gas }),
            BigInt(0),
            // Beware of the 300T cap with mpc gas
            BigInt(ONE_TERA_GAS * BigInt(25))
          )
      );
    return promise.asReturn();
  }

  abstract publish_callback({ request_id, nonce, gas_limit, max_fee_per_gas, max_priority_fee_per_gas }: { request_id: RequestId, nonce: string, gas_limit: string, max_fee_per_gas: string, max_priority_fee_per_gas: string }): void
  _publish_callback({ request_id, nonce, gas_limit, max_fee_per_gas, max_priority_fee_per_gas }: { request_id: RequestId, nonce: string, gas_limit: string, max_fee_per_gas: string, max_priority_fee_per_gas: string }): void {
    const _result = this._promise_result({ promise_index: 0 });
    near.log(`publish_callback ${request_id}, ${_result.success}, ${_result.result}`);
    const _response = this.response_lookup.get(request_id);
    if (_result.success) {
      _response.status = RequestStatus[RequestStatus.PUBLISHED];
      const _chain_config = this.publish_chain_config_lookup.get(_response.chain_id.toString());
      new PublishEvent(new PublishData({
        request_id, response: _response, chain_config: _chain_config, signature: _result.result,
        nonce, gas_limit, max_fee_per_gas, max_priority_fee_per_gas
      })).emit();
      this.response_lookup.set(request_id, _response);
    }
  }

  private _report_deposit(report: Report): bigint {
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
