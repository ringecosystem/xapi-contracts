// Find all our documentation at https://docs.near.org
import { NearBindgen, near, call, view, AccountId, initialize, migrate, assert, Vector } from "near-sdk-js";
import { Aggregator, RequestId, RequestTemplate, Response } from "./abstract/aggregator.abstract";
import { ContractSourceMetadata, Standard } from "./abstract/standard.abstract";

@NearBindgen({})
class OrmpAggregator extends Aggregator<string> {

  @migrate({})
  _clear_state() {
    assert(near.signerAccountId() == near.currentAccountId(), `Permission denied, ${near.signerAccountId()} != ${near.currentAccountId()}`);
    near.storageRemove("STATE");
  }

  /// Need to implement

  constructor() {
    super("ORMP Aggregator", new ContractSourceMetadata("56d1e9e35257ff6712159ccfefc4aae830469b32",
      "https://github.com/xapi-box/xapi-contracts/blob/main/aggregator/src/ormp.aggregator.ts",
      [new Standard("nep330", "1.1.0"), new Standard("nep297", "1.0.0")]));
  }

  _can_aggregate(requestId: RequestId): boolean {
    throw new Error("Method not implemented.");
  }

  _aggregate(requestId: RequestId): string {
    throw new Error("Method not implemented.");
  }

  @view({})
  can_report(): boolean {
    throw new Error("Method not implemented.");
  }

  /// calls

  @call({ payableFunction: true })
  report({ request_id, answer }: { request_id: RequestId; answer: string; }): void {
    super._report({ request_id, answer });
  }
  @call({ payableFunction: true })
  add_request_template(request_template: RequestTemplate): void {
    super._add_request_template(request_template);
  }

  /// views

  @view({})
  get_description(): string {
    return super._get_description();
  }
  @view({})
  get_latest_request_id(): string {
    return super._get_latest_request_id();
  }
  @view({})
  get_latest_response(): Response<string> {
    return super._get_latest_response();
  }
  @view({})
  get_response({ request_id }: { request_id: RequestId; }): Response<string> {
    return super._get_response({ request_id });
  }
  @view({})
  get_request_template({ request_template_name }: { request_template_name: string; }): RequestTemplate {
    return super._get_request_template({ request_template_name })
  }
  @view({})
  get_request_template_names(): Vector<string> {
    return super._get_request_template_names();
  }
  @view({})
  contract_source_metadata(): ContractSourceMetadata {
    return super._contract_source_metadata();
  }
}

