import { AccountId, assert, LookupMap, near, view, call, NearBindgen } from "near-sdk-js";

export type RequestId = string;
export type Timestamp = bigint;

export enum RequestStatus {
  FETCHING,
  DONE,
  TIMEOUT,
}

export class Response<Answer> {
  requestId: RequestId;
  reporters: AccountId[];
  startedAt: Timestamp;
  updatedAt: Timestamp;
  answer: Answer;
  status: RequestStatus;

  constructor(requestId: RequestId) {
    this.requestId = requestId;
    this.startedAt = near.blockTimestamp();
    this.status = RequestStatus.FETCHING;
  }
}

export class Report<Answer> {
  requestId: RequestId;
  reporter: AccountId;
  timestamp: Timestamp;
  answer: Answer;
  constructor(requestId: RequestId, answer: Answer) {
    this.requestId = requestId;
    this.answer = answer;
    this.timestamp = near.blockTimestamp();
    this.reporter = near.signerAccountId();
  }
}

@NearBindgen({})
export abstract class Aggregator<Answer> {
  description: string;
  version: number;
  latestRequestId: RequestId;
  timeout: Timestamp;

  // key: requestId, subKey: reporter accountId
  reportLookup: LookupMap<Map<AccountId, Report<Answer>>>;
  // key: requestId
  responseLookup: LookupMap<Response<Answer>>;

  getDescription(): string {
    return this.description;
  }
  @view({})
  getVersion(): number {
    return this.version;
  }

  getLatestRequestId(): RequestId {
    return this.latestRequestId;
  }
  getLatestResponse(): Response<Answer> {
    assert(this.latestRequestId != null, "No latest response");
    return this.responseLookup.get(this.latestRequestId);
  }
  getResponse(requestId: RequestId): Response<Answer> {
    return this.responseLookup.get(requestId);
  }

  abstract canReport(reporter: AccountId): boolean;

  @call({ payableFunction: true })
  report({ requestId, answer }: { requestId: RequestId, answer: Answer }): void {
    const report = new Report(requestId, answer);

    const deposit = near.attachedDeposit();
    const requiredDeposit = this.reportDeposit(report);
    assert(
      deposit >= requiredDeposit,
      `Insufficient deposit, deposit: ${deposit}, required: ${requiredDeposit}`
    );
    const signer = near.signerAccountId();

    assert(this.canReport(signer), "Reporting requirements not met");

    const response = this.responseLookup.get(report.requestId);
    if (response == null) {
      // Maybe first report
      // !!! The requestId may be abused to prevent normal requests.
      this.responseLookup.set(
        report.requestId,
        new Response<Answer>(report.requestId)
      );
      this.reportLookup.set(
        report.requestId,
        new Map<AccountId, Report<Answer>>()
      );
    }
    const currentStatus = this.responseLookup.get(report.requestId).status;
    // Only fetching request can accept reports.
    assert(
      currentStatus == RequestStatus.FETCHING,
      `The request status is ${currentStatus}`
    );

    const reports = this.reportLookup.get(requestId);
    assert(reports.get(signer) == null, "Already reported");
    reports.set(signer, report);
    this.tryAggregate(requestId);
  }

  abstract _canAggregate(requestId: RequestId): boolean;
  abstract _aggregate(requestId: RequestId): Answer;

  private tryAggregate(requestId: RequestId): void {
    if (this._canAggregate(requestId)) {
      const _response = this.responseLookup.get(requestId);
      assert(
        _response.status == RequestStatus.FETCHING,
        `The request status is ${_response.status}`
      );
      _response.answer = this._aggregate(requestId);
      _response.reporters = Array.from(this.reportLookup.get(requestId).keys());
      _response.updatedAt = near.blockTimestamp();
      _response.status = RequestStatus.DONE;
      this.publish(requestId);
    }
  }

  private publish(requestId: RequestId) {
    const _response = this.responseLookup.get(requestId);
    // todo request mpc signature
    near.log(JSON.stringify(_response));
  }

  reportDeposit(report: Report<Answer>): bigint {
    const bytes = BigInt(this.sizeOf(report));
    // 100KB == 1Near == 10^24 yoctoNear
    // 1024 bytes == 10^22 yoctoNear
    const yoctoPerByte = BigInt(10 ** 22) / BigInt(1024);
    return bytes * yoctoPerByte * BigInt(2);
  }

  private sizeOf(obj: any) {
    let bytes = 0;
    if (obj !== null && obj !== undefined) {
      switch (typeof obj) {
        case "number":
          bytes += 8;
          break;
        case "string":
          bytes += obj.length * 2;
          break;
        case "boolean":
          bytes += 4;
          break;
        case "object":
          const objClass = Object.prototype.toString.call(obj).slice(8, -1);
          if (objClass === "Object" || objClass === "Array") {
            for (let key in obj) {
              if (!obj.hasOwnProperty(key)) continue;
              this.sizeOf(obj[key]);
            }
          } else {
            bytes += obj.toString().length * 2;
          }
          break;
      }
    }
    return bytes;
  }
}
