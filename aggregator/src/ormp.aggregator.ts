// Find all our documentation at https://docs.near.org
import { NearBindgen, near, call, view, migrate, assert, NearPromise, AccountId } from "near-sdk-js";
import { Aggregator, Answer, DataSource, RequestId, Response, Timestamp } from "./abstract/aggregator.abstract";
import { ContractSourceMetadata, Standard } from "./abstract/standard.abstract";

@NearBindgen({})
class OrmpAggregator extends Aggregator<string> {
  // !!! Need to implement

  constructor() {
    super({
      description: "ORMP Aggregator", timeout: null,
      mpc_contract: "v1.signer-prod.testnet",
      mpc_attached_balance: BigInt(10 ** 24),
      contract_metadata: new ContractSourceMetadata({
        version: "56d1e9e35257ff6712159ccfefc4aae830469b32",
        link: "https://github.com/xapi-box/xapi-contracts/blob/main/aggregator/src/ormp.aggregator.ts",
        standards: [new Standard("nep330", "1.1.0"), new Standard("nep297", "1.0.0")]
      })
    });
  }

  @view({})
  can_report(): boolean {
    throw new Error("Method not implemented.");
  }

  _assert_operator(): void {
    assert(near.signerAccountId() == near.currentAccountId(), `Permission denied, ${near.signerAccountId()} != ${near.currentAccountId()}`);
  }

  _can_aggregate({ request_id }: { request_id: RequestId }): boolean {
    throw new Error("Method not implemented.");
  }

  _aggregate({ request_id }: { request_id: RequestId }): string {
    throw new Error("Method not implemented.");
  }

  @migrate({})
  _clear_state() {
    this._assert_operator();
    near.storageRemove("STATE");
  }

  /// Calls

  // todo remove after testing
  @call({})
  publish({ request_id }: { request_id: RequestId }): NearPromise {
    return this._publish({ request_id });
  }

  @call({ privateFunction: true })
  publish_callback({ request_id }: { request_id: RequestId; }): void {
    super._publish_callback({ request_id });
  }

  @call({ payableFunction: true })
  report({ request_id, chain_id, nonce, answers }: { request_id: RequestId; chain_id: bigint; nonce: bigint; answers: Answer<string>[]; }): void {
    super._report({ request_id, chain_id, nonce, answers });
  }

  @call({ payableFunction: true })
  add_data_source(data_source: DataSource): void {
    super._add_data_source(data_source);
  }

  @call({})
  remove_data_source({ data_source_name }: { data_source_name: string; }): void {
    super._remove_data_source({ data_source_name });
  }

  @call({})
  set_timeout({ timeout }: { timeout: Timestamp; }): void {
    super._set_timeout({ timeout })
  }

  @call({})
  set_mpc_contract({ mpc_contract }: { mpc_contract: AccountId; }): void {
    super._set_mpc_contract({ mpc_contract });
  }

  @call({})
  set_mpc_attached_balance({ mpc_attached_balance }: { mpc_attached_balance: bigint; }): void {
    super._set_mpc_attached_balance({ mpc_attached_balance })
  }

  /// Views

  @view({})
  get_description(): string {
    return super._get_description();
  }
  @view({})
  get_mpc_contract(): AccountId {
    return super._get_mpc_contract();
  }
  @view({})
  get_mpc_attached_balance(): bigint {
    return super._get_mpc_attached_balance();
  }
  @view({})
  get_timeout(): Timestamp {
    return super._get_timeout();
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
  get_data_sources(): DataSource[] {
    return super._get_data_sources()
  }
  @view({})
  contract_source_metadata(): ContractSourceMetadata {
    return super._contract_source_metadata();
  }
}
