// Find all our documentation at https://docs.near.org
import { NearBindgen, near, call, view, AccountId, initialize, migrate, assert } from "near-sdk-js";
import { Aggregator, RequestId, Response } from "./abstract/aggregator.abstract";
import { ContractSourceMetadata, Standard } from "./abstract/standard.abstract";

@NearBindgen({})
class OrmpAggregator extends Aggregator<string> {

  constructor() {
    super("ORMP Aggregator", new ContractSourceMetadata("56d1e9e35257ff6712159ccfefc4aae830469b32",
      "https://github.com/xapi-box/xapi-contracts/blob/main/aggregator/src/ormp.aggregator.ts",
      [new Standard("nep330", "1.1.0"), new Standard("nep297", "1.0.0")]));
  }

  @migrate({})
  _clear_state() {
    assert(near.signerAccountId() == near.currentAccountId(), `Permission denied, ${near.signerAccountId()} != ${near.currentAccountId()}`);
    near.storageRemove("STATE");
  }

  @view({})
  can_report(): boolean {
    throw new Error("Method not implemented.");
  }

  _can_aggregate(requestId: RequestId): boolean {
    throw new Error("Method not implemented.");
  }

  _aggregate(requestId: RequestId): string {
    throw new Error("Method not implemented.");
  }

  @call({ payableFunction: true })
  report({ request_id, answer }: { request_id: RequestId, answer: string; }): void {
    super.report({ request_id, answer })
  }

  @view({})
  get_latest_response(): Response<string> {
    return super.get_latest_response();
  }
  @view({})
  get_response({ request_id }: { request_id: RequestId }): Response<string> {
    return super.get_response({ request_id });
  }

  @view({})
  get_latest_request_id(): RequestId {
    return super.get_latest_request_id();
  }

  @view({})
  get_description(): string {
    return super.get_description();
  }

  @view({})
  contract_source_metadata(): ContractSourceMetadata {
    return super.contract_source_metadata();
  }

}

