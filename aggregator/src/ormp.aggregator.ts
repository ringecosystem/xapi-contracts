// Find all our documentation at https://docs.near.org
import { NearBindgen, near, call, view, migrate, assert, NearPromise, AccountId } from "near-sdk-js";
import { Aggregator, Answer, ChainId, DataSource, MpcConfig, PublishChainConfig, Report, ReporterRequired, RequestId, Response, Staked, Timestamp } from "./abstract/aggregator.abstract";
import { ContractSourceMetadata, Standard } from "../../common/src/standard.abstract";

@NearBindgen({})
class OrmpAggregator extends Aggregator<string> {
  // !!! Need to implement

  constructor() {
    super({
      description: "ORMP Aggregator", timeout: null,
      mpc_config: new MpcConfig({ mpc_contract: "v1.signer-prod.testnet", attached_balance: BigInt(10 ** 24).toString() }),
      reporter_required: new ReporterRequired(1, 1),
      // todo update staking contract
      staking_contract: "stake.guantong.testnet",
      contract_metadata: new ContractSourceMetadata({
        version: "56d1e9e35257ff6712159ccfefc4aae830469b32",
        link: "https://github.com/xapi-box/xapi-contracts/blob/main/aggregator/src/ormp.aggregator.ts",
        standards: [new Standard("nep330", "1.1.0"), new Standard("nep297", "1.0.0")]
      })
    });
  }

  _assert_operator(): void {
    assert(near.signerAccountId() == near.currentAccountId(), `Permission denied, ${near.signerAccountId()} != ${near.currentAccountId()}`);
  }

  _can_aggregate({ request_id }: { request_id: RequestId }): boolean {
    return Array.from(this.report_lookup.get(request_id).keys()).length >= this.reporter_required.quorum;
  }

  _aggregate({ request_id, top_staked }: { request_id: RequestId, top_staked: Staked[] }): boolean {
    // filter invalid reporter
    const _reporters = this.report_lookup.get(request_id).map(r => r.reporter);
    const _valid_reporters = _reporters.filter(reporter =>
      top_staked.some(staked => staked.account_id === reporter)
    );
    const _reports = this.report_lookup.get(request_id);
    const _valid_reports = _reports.filter(r => _valid_reporters.includes(r.reporter));

    const _each_reporter_report = [];
    const _each_reporter_result = new Map<string, string>();
    _valid_reports.forEach(report => {
      const _result = this._aggregate_answer(report.answers.map(r => r.result)).result;
      _each_reporter_result.set(report.reporter, _result);
      _each_reporter_report.push(`${_result}-${report.nonce}-${report.chain_id}`);
    });

    const most_common_report = this._aggregate_answer(_each_reporter_report);

    const [result, nonce, chain_id] = most_common_report.result.split('-');
    assert(_valid_reporters.length >= this.reporter_required.quorum, `Quorum: required ${this.reporter_required.quorum}, but got ${_valid_reporters.length}`);
    assert(most_common_report.count >= this.reporter_required.threshold, `Threshold: required ${this.reporter_required.threshold}, but got ${most_common_report.count}`)

    const _response = this.response_lookup.get(request_id);

    _response.reporter_reward_addresses = _valid_reports
      .filter(report => {
        const key = `${_each_reporter_result.get(report.reporter)}-${report.nonce}-${report.chain_id}`;
        return key === most_common_report.result;
      })
      .map(report => report.reward_address);

    _response.result = result;
    _response.nonce = nonce;
    _response.chain_id = chain_id;
    return true;
  }

  _aggregate_answer(answers: string[]): { result: string, count: number } {
    const answer_frequency: { [key: string]: number } = {};

    answers.forEach(answer => {
      if (!answer_frequency[answer]) {
        answer_frequency[answer] = 0;
      }
      answer_frequency[answer]++;
    });

    const most_common_answer = Object.keys(answer_frequency).reduce((a, b) =>
      answer_frequency[a] > answer_frequency[b] ? a : b
    );
    return {
      result: most_common_answer,
      count: answer_frequency[most_common_answer]
    }
  }

  @migrate({})
  _clear_state() {
    this._assert_operator();
    near.storageRemove("STATE");
  }

  /// Calls

  @call({})
  publish_external({ request_id }: { request_id: RequestId; }): NearPromise {
    return this._publish({ request_id, promise_index: 0 });
  }

  @call({ privateFunction: true })
  publish_callback({ request_id, promise_index }: { request_id: RequestId; promise_index: number; }): void {
    super._publish_callback({ request_id, promise_index });
  }

  @call({ privateFunction: true })
  post_aggregate_callback({ request_id }: { request_id: RequestId; }): void {
    this.post_aggregate_callback({ request_id });
  }

  @call({ payableFunction: true })
  report({ request_id, nonce, answers, reporter_required, reward_address }: { request_id: RequestId; nonce: string; answers: Answer<string>[]; reporter_required: ReporterRequired; reward_address: string }): void {
    super._report({ request_id, nonce, answers, reporter_required, reward_address });
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
  set_publish_chain_config(publis_chain_config: PublishChainConfig): void {
    super._set_publish_chain_config(publis_chain_config);
  }

  @call({})
  set_timeout({ timeout }: { timeout: Timestamp; }): void {
    super._set_timeout({ timeout })
  }

  @call({})
  set_mpc_config(mpc_config: MpcConfig): void {
    super._set_mpc_config(mpc_config);
  }

  @call({})
  set_reporter_required(reporter_required: ReporterRequired): void {
    super._set_reporter_required(reporter_required);
  }

  @call({})
  set_staking_contract({ staking_contract }: { staking_contract: AccountId }): void {
    super._set_staking_contract({ staking_contract });
  }

  /// Views

  @view({})
  get_description(): string {
    return super._get_description();
  }
  @view({})
  get_mpc_config(): MpcConfig {
    return super._get_mpc_config();
  }
  @view({})
  get_reporter_required(): ReporterRequired {
    return super._get_reporter_required();
  }
  @view({})
  get_staking_contract(): AccountId {
    return super._get_staking_contract();
  }
  @view({})
  get_reports({ request_id }: { request_id: RequestId; }): Report<string>[] {
    return super._get_reports({ request_id });
  }
  @view({})
  get_timeout(): Timestamp {
    return super._get_timeout();
  }
  @view({})
  get_publish_chain_config({ chain_id }: { chain_id: ChainId; }): PublishChainConfig {
    return super._get_publish_chain_config({ chain_id })
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
