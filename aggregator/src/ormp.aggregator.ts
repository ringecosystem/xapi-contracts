// Find all our documentation at https://docs.near.org
import { NearBindgen, near, call, view, AccountId } from "near-sdk-js";
import { Aggregator, RequestId, Response } from "./abstract/aggregator.abstract";
import { ContractSourceMetadata, Standard } from "./abstract/standard.abstract";

// todo try abi and use js style function name <https://github.com/near/abi>
@NearBindgen({})
class OrmpAggregator extends Aggregator<string> {

  contract_metadata = new ContractSourceMetadata(null, "https://github.com/xapi-box/xapi-contracts/blob/main/aggregator/src/ormp.aggregator.ts", [new Standard("nep330", "1.1.0"), new Standard("nep297", "1.0.0")])

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

  // @call({ payableFunction: true })
  // report({ request_id, answer }: { request_id: RequestId, answer: string; }): void {
  //   super.report({ request_id, answer })
  // }

  // @view({})
  // get_latest_response(): Response<string> {
  //   return super.get_latest_response();
  // }
  // @view({})
  // get_response({ request_id }: { request_id: RequestId }): Response<string> {
  //   return super.get_response({ request_id });
  // }

  // @view({})
  // contract_source_metadata(): ContractSourceMetadata {
  //   return super.contract_source_metadata();
  // }

  // @view({})
  // get_description(): string {
  //   return super.get_description();
  // }
  // @view({})
  // get_version(): number {
  //   return super.get_version();
  // }
  // @view({})
  // get_latest_request_id(): RequestId {
  //   return super.get_latest_request_id();
  // }
}

