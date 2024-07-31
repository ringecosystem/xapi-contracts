// Find all our documentation at https://docs.near.org
import { NearBindgen, near, call, view, AccountId } from "near-sdk-js";
import { Aggregator, RequestId } from "./abstract/aggregator.abstract";

@NearBindgen({})
class OrmpAggregator extends Aggregator<string> {

  @view({})
  canReport(reporter: AccountId): boolean {
    near.log(`reporter: ${reporter}`)
    throw new Error("Method not implemented.");
  }

  _canAggregate(requestId: RequestId): boolean {
    throw new Error("Method not implemented.");
  }

  _aggregate(requestId: RequestId): string {
    throw new Error("Method not implemented.");
  }
}
