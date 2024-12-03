import { ContractBase, Nep297Event, ContractSourceMetadata } from "../../../common/src/standard.abstract";
import { encodePublishCall, ethereumTransaction, hexToBytes, buildEIP712AggregatorConfigPayload, buildEIP712ResponsePayload } from "../lib/ethereum";
import { AccountId, assert, LookupMap, near, NearPromise, ONE_TERA_GAS, PromiseIndex, UnorderedMap } from "near-sdk-js";
import { concatSignature, sizeOf } from "../lib/helper";

export type RequestId = string;
export type Timestamp = string;
export type ChainId = string;

export enum RequestStatus {
  FETCHING,
  AGGREGATED,
  PUBLISHED,
}

export enum RequestMethod {
  GET,
  POST,
  PUT,
  DELETE,
  PATCH
}

export class PublishChainConfig {
  chain_id: ChainId;
  xapi_address: string;
  reporters_fee: string;
  publish_fee: string;
  version: string;

  constructor({ chain_id, xapi_address, reporters_fee, publish_fee }: { chain_id: ChainId, xapi_address: string, reporters_fee: string, publish_fee: string }) {
    this.chain_id = chain_id;
    this.xapi_address = xapi_address;
    this.reporters_fee = reporters_fee;
    this.publish_fee = publish_fee;
    this.version = near.blockTimestamp().toString();
  }
}

export class EIP712AggregatorConfig {
  aggregator: string;
  reportersFee: string;
  publishFee: string;
  version: string;
}

class DataAuth {
  /**
   * headers.Authorization = headers: {"Authorization": "xxx"}
   * query.token = example.com?token=xxx
   * body.authorization.token = body: {"authorization":{"token": "xxx"}}
   */
  place_path: string;
  /**
   * env.API_KEY = read API_KEY from reporter node env
   */
  value_path: string;

  constructor(place_path: string, value_path: string) {
    this.place_path = place_path;
    this.value_path = value_path;
  }
}

export class DataSource {
  name: string;
  url: string;
  method: string;
  headers: Object;
  body_json: Object;
  query_json: Object;
  // https://docs.api3.org/reference/ois/latest/reserved-parameters.html#path, split by `.`
  result_paths: string[];
  auth: DataAuth;
  constructor({ name, url, method, headers, body_json, query_json, result_paths, auth }: { name: string, url: string, method: string, headers: Object, body_json: Object, query_json: Object, result_paths: string[], auth: DataAuth }) {
    this.name = name;
    this.url = url;
    this.method = method;
    this.headers = headers;
    this.body_json = body_json;
    this.query_json = query_json;
    this.result_paths = result_paths;
    this.auth = auth;
  }
}

export class Answer {
  data_source_name: string;
  result: string;
  // Set the error message if there is an error, leave it null/blank if there's no error.
  error: string;

  constructor({ data_source_name, result, error }: { data_source_name: string, result: string, error: string }) {
    this.data_source_name = data_source_name;
    this.result = result;
    this.error = error;
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

class ReportEvent extends Nep297Event {
  constructor(data: Report) {
    super("Report", data)
  }
}

export class PublishData {
  eip712_response: EIP712Response;
  eip712_domain: EIP712Domain;
  signature: string;

  constructor({ eip712_response, eip712_domain, signature }: { eip712_response: EIP712Response, eip712_domain: EIP712Domain, signature: string }) {
    this.eip712_response = eip712_response;
    this.eip712_domain = eip712_domain;
    this.signature = signature;
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

class SetPublishChainConfigEvent extends Nep297Event {
  constructor(data: PublishChainConfig) {
    super("SetPublishChainConfig", data);
  }
}

export class SyncPublishChainConfigData {
  eip712_aggregator_config: EIP712AggregatorConfig;
  eip712_domain: EIP712Domain;
  signature: string;
  constructor({ eip712_aggregator_config, eip712_domain, signature }: { eip712_aggregator_config: EIP712AggregatorConfig, eip712_domain: EIP712Domain, signature: string }) {
    this.eip712_aggregator_config = eip712_aggregator_config;
    this.eip712_domain = eip712_domain;
    this.signature = signature;
  }
}

class SyncPublishChainConfigEvent extends Nep297Event {
  constructor(data: SyncPublishChainConfigData) {
    super("SyncPublishChainConfig", data);
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

  // 👇 These values should be aggregated from reporter's answer
  // !!! Encode it to bytes in _aggregate
  result: string;
  // Leave it 0 if there's no error. MAX: 65535(uint16)
  error_code: number;

  constructor(request_id: RequestId) {
    this.request_id = request_id;
    this.started_at = near.blockTimestamp().toString();
    this.status = RequestStatus[RequestStatus.FETCHING];
    this.error_code = 0;
  }
}

export class EIP712Response {
  requestId: RequestId;
  // EVM address to distribute rewards
  reporters: string[];
  // !!! Encode it to bytes in _aggregate
  result: string;
  // Leave it 0 if there's no error. MAX: 65535(uint16)
  errorCode: number;
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
  key_version: number;

  constructor({ mpc_contract, attached_balance, key_version }: { mpc_contract: AccountId, attached_balance: string, key_version: number }) {
    this.mpc_contract = mpc_contract;
    this.attached_balance = attached_balance;
    this.key_version = key_version;
  }
}

// todo remove this
export class MpcOptions {
  nonce: string
  gas_limit: string
  max_fee_per_gas: string
  max_priority_fee_per_gas: string
  key_version: number
}

export class Staked {
  amount: string
  account_id: AccountId
}

export class EIP712Domain {
  name: string
  version: string
  chainId: string
  verifyingContract: string
}

// Derivation path prefix for mpc
const PROTOCAL_NAME = "XAPI";
const PROTOCOL_VERSION = "1";

const DEFAULT_MAX_RESULT_LENGTH = 300;

export abstract class Aggregator extends ContractBase {
  description: string;
  latest_request_id: RequestId;
  // The max length of the report answer. Preventing gas limit being exceeded when publishing.
  max_result_length: number;

  mpc_config: MpcConfig;
  staking_contract: AccountId;
  reporter_required: ReporterRequired;
  // key: data_source name
  data_sources: UnorderedMap<DataSource>;
  // key: request_id, subKey: reporter accountId
  report_lookup: LookupMap<Report[]>;
  // key: request_id
  response_lookup: LookupMap<Response>;
  // key: chain_id
  publish_chain_config_lookup: LookupMap<PublishChainConfig>;

  constructor({ description, mpc_config, reporter_required, staking_contract, contract_metadata, }: { description: string, mpc_config: MpcConfig, reporter_required: ReporterRequired, staking_contract: AccountId, contract_metadata: ContractSourceMetadata }) {
    super(contract_metadata);
    this.description = description;
    this.max_result_length = DEFAULT_MAX_RESULT_LENGTH;
    this.mpc_config = mpc_config;
    this.reporter_required = reporter_required;
    this.staking_contract = staking_contract;
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

  abstract set_max_result_length({ max_result_length }: { max_result_length: number }): void;
  _set_max_result_length({ max_result_length }: { max_result_length: number }): void {
    this._assert_operator();
    max_result_length = Number(max_result_length);
    assert(max_result_length > 0, "max_result_length should be greater than 0");
    this.max_result_length = max_result_length;
  }

  abstract get_max_result_length(): number;
  _get_max_result_length(): number {
    return this.max_result_length;
  }

  abstract set_mpc_config(mpc_config: MpcConfig): void;
  _set_mpc_config(mpc_config: MpcConfig): void {
    this._assert_operator();
    assert(mpc_config.mpc_contract != null, "mpc_contract can't be null.");
    assert(BigInt(mpc_config.attached_balance) > 0, "attached_balance should be greater than 0.");

    this.mpc_config.mpc_contract = mpc_config.mpc_contract;
    this.mpc_config.attached_balance = mpc_config.attached_balance;
    this.mpc_config.key_version = mpc_config.key_version || 0;
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

  abstract set_publish_chain_config(publish_chain_config: PublishChainConfig): NearPromise;
  _set_publish_chain_config(publish_chain_config: PublishChainConfig): NearPromise {
    this._assert_operator();
    assert(publish_chain_config.chain_id != null && publish_chain_config.chain_id.length <= 20, "chain_id can't be null and the length should <= 20");
    assert(publish_chain_config.xapi_address != null && publish_chain_config.xapi_address.length == 42, "xapi_address can't be null and the length should be 42.");
    assert(publish_chain_config.reporters_fee != null && publish_chain_config.reporters_fee.length <= 78, "reporters_fee can't be null and the length should <= 78");
    assert(publish_chain_config.publish_fee != null && publish_chain_config.publish_fee.length <= 78, "publish_fee can't be null and the length should <= 78");
    const _publish_config = new PublishChainConfig({ ...publish_chain_config });

    const _required_deposit = this._storage_deposit(publish_chain_config);
    const _surplus = near.attachedDeposit() - _required_deposit;
    assert(_surplus >= 0, `Attached: ${near.attachedDeposit()}, Require: ${_required_deposit}`)
    let promise = null;
    if (_surplus > 0) {
      near.log(`Attached: ${near.attachedDeposit()}, Require: ${_required_deposit}, refund more than required deposit ${_surplus} YOCTO to ${near.signerAccountId()}`);
      promise = NearPromise.new(near.signerAccountId()).transfer(_surplus);
    }

    this.publish_chain_config_lookup.set(publish_chain_config.chain_id, _publish_config);
    new SetPublishChainConfigEvent(_publish_config).emit();
    if (promise) {
      return promise;
    }
  }

  abstract sync_publish_config_to_remote({ chain_id }: { chain_id: ChainId }): NearPromise;
  _sync_publish_config_to_remote({ chain_id }: { chain_id: ChainId }): NearPromise {
    const _latest_config = this.publish_chain_config_lookup.get(chain_id);
    assert(_latest_config != null, `No publish chain config for ${chain_id}`);

    const eip712_domain: EIP712Domain = {
      name: PROTOCAL_NAME,
      version: PROTOCOL_VERSION,
      chainId: chain_id,
      verifyingContract: _latest_config.xapi_address
    }

    const eip712_aggregator_config: EIP712AggregatorConfig = {
      "aggregator": near.currentAccountId(),
      "reportersFee": _latest_config.reporters_fee,
      "publishFee": _latest_config.publish_fee,
      "version": _latest_config.version,
    }

    const payload = buildEIP712AggregatorConfigPayload(eip712_domain, eip712_aggregator_config);
    const payload_arr = Array.from(payload);
    // near.log("payload_arr", payload_arr);

    const mpc_args = {
      "request": {
        "key_version": this.mpc_config.key_version || 0,
        "payload": payload_arr,
        "path": `${PROTOCAL_NAME}-${PROTOCOL_VERSION}-${chain_id}`
      }
    }
    near.log(`before request signature, prepaidGas: ${near.prepaidGas()}, leftGas: ${near.prepaidGas() - near.usedGas()}`)
    const promise = NearPromise.new(this.mpc_config.mpc_contract)
      // 1 NEAR to request signature, the surplus will be refunded
      .functionCall("sign", JSON.stringify(mpc_args), BigInt(this.mpc_config.attached_balance), ONE_TERA_GAS * BigInt(250))
      .then(
        NearPromise.new(near.currentAccountId())
          .functionCall(
            "sync_publish_config_to_remote_callback",
            JSON.stringify({ chain_id, version: _latest_config.version }),
            BigInt(0),
            // Beware of the 300T cap with mpc gas
            BigInt(near.prepaidGas() - near.usedGas() - ONE_TERA_GAS * BigInt(255))
          )
      );
    return promise.asReturn();
  }

  abstract sync_publish_config_to_remote_callback({ chain_id, version }: { chain_id: ChainId, version: string }): SyncPublishChainConfigData;
  _sync_publish_config_to_remote_callback({ chain_id, version }: { chain_id: ChainId, version: string }): SyncPublishChainConfigData {
    const _result = this._promise_result({ promise_index: 0 });
    near.log(`sync_publish_config_to_remote_callback ${chain_id}, ${_result.success}, ${_result.result}, version: ${version}`);
    const _latest_config = this.publish_chain_config_lookup.get(chain_id);
    if (_result.success) {
      if (_latest_config.version != version) {
        near.log(`Config is out of date, latest: ${_latest_config.version}, want to sync: ${version}`)
        return;
      }
      const _signature_json = JSON.parse(_result.result);
      const _signature = concatSignature(_signature_json.big_r.affine_point, _signature_json.s.scalar, _signature_json.recovery_id);

      const sync_data = new SyncPublishChainConfigData({
        eip712_aggregator_config: {
          aggregator: near.currentAccountId(),
          reportersFee: _latest_config.reporters_fee,
          publishFee: _latest_config.publish_fee,
          version: _latest_config.version
        },
        eip712_domain: {
          name: PROTOCAL_NAME,
          version: PROTOCOL_VERSION,
          chainId: chain_id,
          verifyingContract: _latest_config.xapi_address
        },
        signature: _signature,
      });
      new SyncPublishChainConfigEvent(sync_data).emit();
      return sync_data;
    }
  }

  abstract get_publish_chain_config({ chain_id }: { chain_id: ChainId }): PublishChainConfig;
  _get_publish_chain_config({ chain_id }: { chain_id: ChainId }): PublishChainConfig {
    return this.publish_chain_config_lookup.get(chain_id);
  }

  abstract get_latest_request_id(): string;
  _get_latest_request_id(): RequestId {
    return this.latest_request_id;
  }

  abstract get_reports({ request_id }: { request_id: RequestId }): Report[];
  _get_reports({ request_id }: { request_id: RequestId }): Report[] {
    const _reports = this.report_lookup.get(request_id);
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

    for (let i = 0; i < answers.length; i++) {
      assert(answers[i].result.length <= this.max_result_length, `answers[${i}].result.length > ${this.max_result_length}`);
    }

    const _deposit = near.attachedDeposit();
    const _required_deposit = this._storage_deposit({ request_id, answers, reward_address });
    assert(
      _deposit == _required_deposit,
      `Wrong deposit, deposit: ${_deposit}, required: ${_required_deposit}`
    );

    const __report = new Report({
      request_id,
      answers,
      reward_address
    });

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

  abstract add_data_source(data_source: DataSource): NearPromise;
  _add_data_source(data_source: DataSource): NearPromise {
    this._assert_operator();
    assert(data_source.name != null, "Datasource name is null");
    assert(data_source.method != null, "Datasource method is null");
    assert(data_source.url != null, "Datasource url is null");
    if (!data_source.result_paths) {
      data_source.result_paths = [];
    }
    assert(this.data_sources.get(data_source.name) == null, "Datasource name already exists");
    const _required_deposit = this._storage_deposit(data_source);
    const _surplus = near.attachedDeposit() - _required_deposit;
    assert(_surplus >= 0, `Attached: ${near.attachedDeposit()}, Require: ${_required_deposit}`)
    let promise = null;
    if (_surplus > 0) {
      near.log(`Attached: ${near.attachedDeposit()}, Require: ${_required_deposit}, refund more than required deposit ${_surplus} YOCTO to ${near.signerAccountId()}`);
      promise = NearPromise.new(near.signerAccountId()).transfer(_surplus);
    }
    const checkMethod = data_source.method.toString();
    if (checkMethod.toUpperCase() == "GET") {
      data_source.method = RequestMethod[RequestMethod.GET];
    } else if (checkMethod.toUpperCase() == "POST") {
      data_source.method = RequestMethod[RequestMethod.POST];
    } else if (checkMethod.toUpperCase() == "PUT") {
      data_source.method = RequestMethod[RequestMethod.PUT];
    } else if (checkMethod.toUpperCase() == "DELETE") {
      data_source.method = RequestMethod[RequestMethod.DELETE];
    } else if (checkMethod.toUpperCase() == "PATCH") {
      data_source.method = RequestMethod[RequestMethod.PATCH];
    } else {
      assert(false, "method should be in [GET, POST, PUT, DELETE, PATCH]");
    }
    if (data_source.headers) {
      assert(typeof data_source.headers == "object", "headers must be object");
    }
    if (data_source.body_json) {
      assert(typeof data_source.body_json == "object", "body_json must be object");
    }
    if (data_source.query_json) {
      assert(typeof data_source.query_json == "object", "query_json must be object");
    }
    if (data_source.auth) {
      assert(
        data_source.auth.place_path && data_source.auth.place_path.length > 0 &&
        data_source.auth.value_path && data_source.auth.value_path.length > 0, "place_path and value_path of auth need to be set at the same time");
      data_source.auth = new DataAuth(data_source.auth.place_path, data_source.auth.value_path);
    } else {
      data_source.auth = new DataAuth("", "");
    }
    this.data_sources.set(data_source.name, data_source);
    new AddDataSourceEvent(data_source).emit();
    if (promise) {
      return promise.asReturn();
    }
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
  abstract _aggregate({ request_id, top_staked }: { request_id: RequestId, top_staked: Staked[] }): void;

  abstract try_aggregate_external({ request_id }: { request_id: RequestId }): NearPromise;
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

  abstract post_aggregate_callback({ request_id, promise_index }: { request_id: RequestId, promise_index: number }): Response;
  _post_aggregate_callback({ request_id, promise_index }: { request_id: RequestId, promise_index: number }): Response {
    const _result = this._promise_result({ promise_index: promise_index });
    near.log(`post_aggregate_callback ${request_id}, ${_result.success}, ${_result.result} promise_index: ${promise_index}`);
    const _top_staked: Staked[] = JSON.parse(_result.result);

    this._aggregate({ request_id, top_staked: _top_staked });

    const _response = this.response_lookup.get(request_id);
    if (_response.result || _response.error_code) {
      _response.chain_id = (BigInt(request_id) >> BigInt(192)).toString();
      _response.updated_at = near.blockTimestamp().toString();
      _response.status = RequestStatus[RequestStatus.AGGREGATED];
      this.response_lookup.set(request_id, _response);
      new AggregatedEvent(_response).emit();
      return _response;
    }
  }

  abstract publish_external({ request_id }: { request_id: RequestId }): NearPromise;
  _publish({ request_id }: { request_id: RequestId }): NearPromise {

    const _response = this.response_lookup.get(request_id);
    assert(_response != null, `Response for ${request_id} does not exist`);
    assert(_response.status == RequestStatus[RequestStatus.AGGREGATED] || _response.status == RequestStatus[RequestStatus.PUBLISHED], `Response status is ${_response.status}, can't be published`);

    const _chain_config = this.publish_chain_config_lookup.get(_response.chain_id);
    assert(_chain_config != null, `Chain config for ${_response.chain_id} does not exist`);

    const eip712_domain: EIP712Domain = {
      name: PROTOCAL_NAME,
      version: PROTOCOL_VERSION,
      chainId: _chain_config.chain_id,
      verifyingContract: _chain_config.xapi_address
    }

    const eip712_response: EIP712Response = {
      "requestId": request_id,
      "reporters": _response.reporter_reward_addresses,
      "result": _response.result,
      "errorCode": _response.error_code,
    }

    const payload = buildEIP712ResponsePayload(eip712_domain, eip712_response);
    const payload_arr = Array.from(payload);

    const mpc_args = {
      "request": {
        "key_version": this.mpc_config.key_version || 0,
        "payload": payload_arr,
        // 0x4dd0A89Cb15D953Fc738362066b412fd303BCe17
        "path": `${PROTOCAL_NAME}-${PROTOCOL_VERSION}-${_response.chain_id}`
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
            JSON.stringify({ request_id }),
            BigInt(0),
            // Beware of the 300T cap with mpc gas
            BigInt(near.prepaidGas() - near.usedGas() - ONE_TERA_GAS * BigInt(255))
          )
      );
    return promise.asReturn();
  }

  abstract publish_callback({ request_id }: { request_id: RequestId }): PublishData
  _publish_callback({ request_id }: { request_id: RequestId }): PublishData {
    const _result = this._promise_result({ promise_index: 0 });
    near.log(`publish_callback ${request_id}, ${_result.success}, ${_result.result}`);
    const _response = this.response_lookup.get(request_id);
    const _chain_config = this.publish_chain_config_lookup.get(_response.chain_id);

    if (_result.success) {
      _response.status = RequestStatus[RequestStatus.PUBLISHED];
      const _publish_data = new PublishData({
        eip712_response: {
          requestId: request_id,
          reporters: _response.reporter_reward_addresses,
          result: _response.result,
          errorCode: _response.error_code
        },
        eip712_domain: {
          name: PROTOCAL_NAME,
          version: PROTOCOL_VERSION,
          chainId: _chain_config.chain_id,
          verifyingContract: _chain_config.xapi_address
        },
        signature: _result.result,
      })
      new PublishEvent(_publish_data).emit();
      this.response_lookup.set(request_id, _response);
      return _publish_data;
    }
  }

  abstract estimate_storage_deposit(obj: any): bigint;
  _storage_deposit(obj: any): bigint {
    const _bytes = BigInt(sizeOf(obj));
    // 100KB == 1Near == 10^24 yoctoNear
    // 1024 bytes == 10^22 yoctoNear
    const _yocto_per_byte = BigInt("10000000000000000000000") / BigInt(1024);
    return _bytes * _yocto_per_byte * BigInt(3);
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
