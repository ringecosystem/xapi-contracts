import { ContractBase, Nep297Event, ContractSourceMetadata } from "./standard.abstract";
import { AccountId, assert, LookupMap, near } from "near-sdk-js";

export type RequestId = string;
export type Timestamp = bigint;

export enum RequestStatus {
  FETCHING,
  DONE,
  TIMEOUT,
}

class ReportEvent<Answer> extends Nep297Event {
  constructor(data: Report<Answer>) {
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
  // todo how to set?
  timeout: Timestamp;

  // key: request_id, subKey: reporter accountId
  report_lookup: LookupMap<Map<AccountId, Report<Answer>>>;
  // key: request_id
  response_lookup: LookupMap<Response<Answer>>;

  constructor(description: string, contract_metadata: ContractSourceMetadata) {
    super(contract_metadata);
    this.description = description;
    this.timeout = BigInt(1000);

    this.report_lookup = new LookupMap("report_lookup");
    this.response_lookup = new LookupMap("response_lookup");
  }

  get_description(): string {
    return this.description;
  }
  get_latest_request_id(): RequestId {
    return this.latest_request_id;
  }
  get_latest_response(): Response<Answer> {
    assert(this.latest_request_id != null, "No latest response");
    return this.response_lookup.get(this.latest_request_id);
  }
  get_response({ request_id }: { request_id: RequestId }): Response<Answer> {
    return this.response_lookup.get(request_id);
  }

  abstract can_report(): boolean;

  report({ request_id, answer }: { request_id: RequestId, answer: Answer }): void {
    const _report = new Report(request_id, answer);

    const _deposit = near.attachedDeposit();
    const _required_eposit = this._report_deposit(_report);
    assert(
      _deposit >= _required_eposit,
      `Insufficient deposit, deposit: ${_deposit}, required: ${_required_eposit}`
    );

    assert(this.can_report(), "Reporting requirements not met");

    const _response = this.response_lookup.get(request_id);
    if (_response == null) {
      // Maybe first report
      // !!! The request_id may be abused to prevent normal requests.
      this.response_lookup.set(
        request_id,
        new Response<Answer>(request_id)
      );
      this.report_lookup.set(
        request_id,
        new Map<AccountId, Report<Answer>>()
      );
    }
    const _status = this.response_lookup.get(request_id).status;
    // Only fetching request can accept reports.
    assert(
      _status == RequestStatus.FETCHING,
      `The request status is ${_status}`
    );

    const _reports = this.report_lookup.get(request_id);
    const _signer = near.signerAccountId();
    assert(_reports.get(_signer) == null, "Already reported");
    _reports.set(_signer, _report);
    new ReportEvent<Answer>(_report).emit();
    this._try_aggregate(request_id);
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

  private _report_deposit(report: Report<Answer>): bigint {
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
