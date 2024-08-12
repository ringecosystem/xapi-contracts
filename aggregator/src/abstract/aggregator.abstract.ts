import { ContractBase, Nep297Event, ContractSourceMetadata } from "./standard.abstract";
import { ethereumTransaction } from "../lib/ethereum";
import { AccountId, assert, LookupMap, near, UnorderedMap } from "near-sdk-js";

export type RequestId = string;
export type Timestamp = bigint;

export enum RequestStatus {
  FETCHING,
  DONE,
  TIMEOUT,
}

export enum RequestMethod {
  GET,
  POST
}

export class PublishChainConfig {
  chain_id: bigint;
  xapi_address: string;
  gas_limit: number;
  max_fee_per_gas: bigint;
  max_priority_fee_per_gas: bigint;

  constructor(chain_id: bigint, xapi_address: string, gas_limit: number, max_fee_per_gas: bigint, max_priority_fee_per_gas: bigint) {
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

  constructor(name: string, url: string, method: RequestMethod, headers: Object, body_json: Object, result_path: string) {
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

  constructor(data_source_name: string, result: Result) {
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

class PublishEvent<Result> extends Nep297Event {
  constructor(data: Response<Result>) {
    super("Publish", data)
  }
}

export class Response<Result> {
  request_id: RequestId;
  reporters: AccountId[];
  started_at: Timestamp;
  updated_at: Timestamp;
  result: Result;
  status: RequestStatus;

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
  // Because cross-chain transactions may fail, we need to rely on the reporter to report nonce instead of maintaining the self-increment.
  nonce: bigint;
  answers: Answer<Result>[];
  constructor(request_id: RequestId, chain_id: bigint, nonce: bigint, answers: Answer<Result>[]) {
    this.request_id = request_id;
    this.chain_id = chain_id;
    this.nonce = nonce;
    this.answers = answers;
    this.timestamp = near.blockTimestamp();
    this.reporter = near.signerAccountId();
  }
}

export abstract class Aggregator<Result> extends ContractBase {
  description: string;
  latest_request_id: RequestId;
  timeout: Timestamp;
  multichain_mpc: AccountId;

  // key: data_source name
  data_sources: UnorderedMap<DataSource>;
  // key: request_id, subKey: reporter accountId
  report_lookup: LookupMap<Map<AccountId, Report<Result>>>;
  // key: request_id
  response_lookup: LookupMap<Response<Result>>;
  // key: chain_id
  publish_chain_config_lookup: LookupMap<PublishChainConfig>;

  constructor({ description, multichain_mpc, timeout, contract_metadata, }: { description: string, multichain_mpc: AccountId, timeout: Timestamp, contract_metadata: ContractSourceMetadata }) {
    super(contract_metadata);
    this.description = description;
    this.multichain_mpc = multichain_mpc;
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

  abstract report({ request_id, chain_id, nonce, answers }: { request_id: RequestId, chain_id: bigint, nonce: bigint, answers: Answer<Result>[] }): void;
  _report({ request_id, chain_id, nonce, answers }: { request_id: RequestId, chain_id: bigint, nonce: bigint, answers: Answer<Result>[] }): void {
    assert(request_id == null, "request_id is null");
    assert(chain_id == null, "chain_id is null");
    assert(nonce == null, "nonce is null");
    assert(answers == null || answers.length == 0, "answers is empty");

    const __report = new Report<Result>(request_id, chain_id, nonce, answers);

    const _deposit = near.attachedDeposit();
    const _required_deposit = this._report_deposit(__report);
    assert(
      _deposit >= _required_deposit,
      `Insufficient deposit, deposit: ${_deposit}, required: ${_required_deposit}`
    );

    assert(this.can_report(), "Reporting requirements not met");

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

  _try_aggregate({ request_id }: { request_id: RequestId }): void {
    if (this._can_aggregate({ request_id })) {
      const _response = this.response_lookup.get(request_id);
      assert(
        _response.status == RequestStatus.FETCHING,
        `The request status is ${_response.status}`
      );
      _response.result = this._aggregate({ request_id });
      _response.reporters = Array.from(this.report_lookup.get(request_id).keys());
      _response.updated_at = near.blockTimestamp();
      _response.status = RequestStatus.DONE;
      this._publish({ request_id });
    }
  }

  _publish({ request_id }: { request_id: RequestId }): Uint8Array {
    const _response = this.response_lookup.get(request_id);
    // assert(_response != null, `${request_id} does not exist`);

    // todo request mpc signature
    const encoded = ethereumTransaction({
      chainId: BigInt(11155111),
      nonce: BigInt(1),
      maxPriorityFeePerGas: BigInt(145926504),
      maxFeePerGas: BigInt(17544136403),
      gasLimit: BigInt(21000),
      to: "0xe0f3B7e68151E9306727104973752A415c2bcbEb",
      value: BigInt(10000000000000000),
      data: new Uint8Array(0),
      accessList: []
    });

    // [217,205,244,193,150,175,218,123,107,205,196,18,36,196,95,176,228,235,211,179,95,200,47,190,83,246,35,14,208,117,207,202]

    new PublishEvent<Result>(_response).emit();
    return encoded;
  }

  private _report_deposit(report: Report<Result>): bigint {
    const _bytes = BigInt(this._size_of(report));
    // 100KB == 1Near == 10^24 yoctoNear
    // 1024 bytes == 10^22 yoctoNear
    const _yocto_per_byte = BigInt(10 ** 22) / BigInt(1024);
    return _bytes * _yocto_per_byte * BigInt(2);
  }

  private _size_of(obj: any) {
    let _bytes = 0;
    if (obj !== null && obj !== undefined) {
      switch (typeof obj) {
        case "number":
          _bytes += 8;
          break;
        case "string":
          _bytes += obj.length * 2;
          break;
        case "boolean":
          _bytes += 4;
          break;
        case "object":
          const _objClass = Object.prototype.toString.call(obj).slice(8, -1);
          if (_objClass === "Object" || _objClass === "Array") {
            for (let _key in obj) {
              if (!obj.hasOwnProperty(_key)) continue;
              this._size_of(obj[_key]);
            }
          } else {
            _bytes += obj.toString().length * 2;
          }
          break;
      }
    }
    return _bytes;
  }
}
