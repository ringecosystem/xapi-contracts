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

export class RequestTemplate {
  name: string;
  url: string;
  method: RequestMethod;
  bodyJson: Object;
  // https://docs.api3.org/reference/ois/latest/reserved-parameters.html#path, split by `,`
  answerPath: string;
}

class AddRequestTemplateEvent extends Nep297Event {
  constructor(data: RequestTemplate) {
    super("AddRequestTemplate", data)
  }
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

  // key: template_name
  request_templates: UnorderedMap<RequestTemplate>;
  // key: request_id, subKey: reporter accountId
  report_lookup: LookupMap<Map<AccountId, Report<Answer>>>;
  // key: request_id
  response_lookup: LookupMap<Response<Answer>>;

  constructor(description: string, contract_metadata: ContractSourceMetadata) {
    super(contract_metadata);
    this.description = description;
    this.timeout = BigInt(60000);

    this.request_templates = new UnorderedMap("request_templates");
    this.report_lookup = new LookupMap("report_lookup");
    this.response_lookup = new LookupMap("response_lookup");
  }

  abstract get_description(): string;
  _get_description(): string {
    return this.description;
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

  abstract report({ request_id, answer }: { request_id: RequestId, answer: Answer }): void;
  _report({ request_id, answer }: { request_id: RequestId, answer: Answer }): void {
    const __report = new Report(request_id, answer);

    const _deposit = near.attachedDeposit();
    const _required_eposit = this._report_deposit(__report);
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
    _reports.set(_signer, __report);
    new ReportEvent<Answer>(__report).emit();
    this._try_aggregate(request_id);
  }

  abstract add_request_template(request_template: RequestTemplate): void;
  _add_request_template(request_template: RequestTemplate): void {
    assert(request_template.name != null, "Template name is null");
    assert(request_template.method != null, "Template method is null");
    assert(request_template.url != null, "Template url is null");

    assert(this.request_templates.get(request_template.name) == null, "Template name already exists");
    this.request_templates.set(request_template.name, request_template);
    new AddRequestTemplateEvent(request_template).emit();
  }

  abstract get_request_template({ request_template_name }: { request_template_name: string }): RequestTemplate
  _get_request_template({ request_template_name }: { request_template_name: string }): RequestTemplate {
    return this.request_templates.get(request_template_name);
  }

  abstract get_request_template_names(): Vector<string>;
  _get_request_template_names(): Vector<string> {
    return this.request_templates._keys;
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
