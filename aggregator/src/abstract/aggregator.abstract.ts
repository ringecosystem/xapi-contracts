import { ContractBase, Nep297Event, ContractSourceMetadata } from "./standard.abstract";
import { AccountId, assert, LookupMap, near, UnorderedMap, Vector } from "near-sdk-js";

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

export class DataSource {
  name: string;
  url: string;
  method: RequestMethod;
  headers: Object;
  body_json: Object;
  // https://docs.api3.org/reference/ois/latest/reserved-parameters.html#path, split by `,`
  answer_path: string;
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

class TimeoutEvent<Answer> extends Nep297Event {
  constructor(data: Response<Answer>) {
    super("Timeout", data)
  }
}

class ReportEvent<Answer> extends Nep297Event {
  constructor(data: Report<Answer[]>) {
    super("Report", data)
  }
}

class PublishEvent<Answer> extends Nep297Event {
  constructor(data: Response<Answer>) {
    super("Publish", data)
  }
}

export class Response<Answer> {
  request_id: RequestId;
  reporters: AccountId[];
  started_at: Timestamp;
  updated_at: Timestamp;
  answer: Answer;
  status: RequestStatus;

  constructor(request_id: RequestId) {
    this.request_id = request_id;
    this.started_at = near.blockTimestamp();
    this.status = RequestStatus.FETCHING;
  }
}

export class Report<Answer> {
  request_id: RequestId;
  reporter: AccountId;
  timestamp: Timestamp;
  answer: Answer;
  constructor(request_id: RequestId, answer: Answer) {
    this.request_id = request_id;
    this.answer = answer;
    this.timestamp = near.blockTimestamp();
    this.reporter = near.signerAccountId();
  }
}

export abstract class Aggregator<Answer> extends ContractBase {
  description: string;
  latest_request_id: RequestId;
  timeout: Timestamp;

  // key: data_source name
  data_sources: UnorderedMap<DataSource>;
  // key: request_id, subKey: reporter accountId
  report_lookup: LookupMap<Map<AccountId, Report<Answer[]>>>;
  // key: request_id
  response_lookup: LookupMap<Response<Answer>>;

  constructor({ description, timeout, contract_metadata }: { description: string, timeout: Timestamp, contract_metadata: ContractSourceMetadata }) {
    super(contract_metadata);
    this.description = description;
    if (!timeout) {
      // Default timeout: 2 hours
      this.timeout = BigInt(18000);
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

  abstract get_latest_response(): Response<Answer>;
  _get_latest_response(): Response<Answer> {
    assert(this.latest_request_id != null, "No latest response");
    return this.response_lookup.get(this.latest_request_id);
  }

  abstract get_response({ request_id }: { request_id: RequestId }): Response<Answer>;
  _get_response({ request_id }: { request_id: RequestId }): Response<Answer> {
    return this.response_lookup.get(request_id);
  }

  abstract can_report(): boolean;

  abstract report({ request_id, answers }: { request_id: RequestId, answers: Answer[] }): void;
  _report({ request_id, answers }: { request_id: RequestId, answers: Answer[] }): void {
    const __report = new Report(request_id, answers);

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
        new Response<Answer>(request_id)
      );
      this.report_lookup.set(
        request_id,
        new Map<AccountId, Report<Answer[]>>()
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
    new ReportEvent<Answer>(__report).emit();
    this._try_aggregate(request_id);
  }

  abstract add_data_source(data_source: DataSource): void;
  _add_data_source(data_source: DataSource): void {
    this._assert_operator();

    assert(data_source.name != null, "Datasource name is null");
    assert(data_source.method != null, "Datasource method is null");
    assert(data_source.url != null, "Datasource url is null");
    assert(data_source.answer_path != null, "Datasource answer_path is null")

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

  abstract get_data_source({ data_source_name }: { data_source_name: string }): DataSource
  _get_data_source({ data_source_name }: { data_source_name: string }): DataSource {
    return this.data_sources.get(data_source_name);
  }

  abstract get_data_source_names(): Vector<string>;
  _get_data_source_names(): Vector<string> {
    return this.data_sources._keys;
  }

  abstract _can_aggregate(request_id: RequestId): boolean;
  abstract _aggregate(request_id: RequestId): Answer;

  private _try_aggregate(request_id: RequestId): void {
    if (this._can_aggregate(request_id)) {
      const _response = this.response_lookup.get(request_id);
      assert(
        _response.status == RequestStatus.FETCHING,
        `The request status is ${_response.status}`
      );
      _response.answer = this._aggregate(request_id);
      _response.reporters = Array.from(this.report_lookup.get(request_id).keys());
      _response.updated_at = near.blockTimestamp();
      _response.status = RequestStatus.DONE;
      this._publish(request_id);
    }
  }

  private _publish(request_id: RequestId) {
    const _response = this.response_lookup.get(request_id);
    // todo request mpc signature
    new PublishEvent<Answer>(_response).emit();
  }

  private _report_deposit(report: Report<Answer[]>): bigint {
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
