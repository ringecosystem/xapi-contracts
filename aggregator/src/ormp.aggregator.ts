// Find all our documentation at https://docs.near.org
import { NearBindgen, near, call, view, migrate, assert, NearPromise, AccountId } from "near-sdk-js";
import { Aggregator, Answer, ChainId, DataSource, MpcConfig, MpcOptions, PublishChainConfig, Report, ReporterRequired, RequestId, Response, Staked, Timestamp } from "./abstract/aggregator.abstract";
import { ContractSourceMetadata, Standard } from "../../common/src/standard.abstract";
import { encodeSetConfigCall, encodePublishCall, stringToBytes } from "./lib/ethereum";

@NearBindgen({})
class OrmpAggregator extends Aggregator {
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

  // todo remove
  @call({})
  test_publish_encode(): void {
    near.log("enter");
    const function_call_data = encodePublishCall({
      functionSignature: "fulfill(uint256,(address[],bytes))",
      params: [
        BigInt("70021766616531051842153016788507494922593962344450640499185811457"),
        [
          ["0x9F33a4809aA708d7a399fedBa514e0A0d15EfA85", "0xF29Ff96aaEa6C9A1fBa851f74737f3c069d4f1a9"],
          stringToBytes("Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem. Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur")
        ]
      ]
    })
    near.log("functionCallData", function_call_data);
  }

  // todo remove
  @call({})
  test_sync_config_encode(): void {
    near.log("enter");
    const function_call_data = encodeSetConfigCall({
      functionSignature: "setAggregatorConfig(string,uint256,uint256,address)",
      params: [
        "ormpaggregator.guantong.testnet",
        BigInt("100"),
        BigInt("200"),
        "0x9F33a4809aA708d7a399fedBa514e0A0d15EfA85"
      ]
    })
    near.log("functionCallData", function_call_data);
  }

  _assert_operator(): void {
    assert(near.signerAccountId() == near.currentAccountId(), `Permission denied, ${near.signerAccountId()} != ${near.currentAccountId()}`);
  }

  _can_aggregate({ request_id }: { request_id: RequestId }): boolean {
    return this.report_lookup.get(request_id).length >= this.reporter_required.threshold;
  }

  _aggregate({ request_id, top_staked }: { request_id: RequestId, top_staked: Staked[] }): boolean {
    // 1. Filter invalid reports via top staked reporters
    const _reporters = this.report_lookup.get(request_id).map(r => r.reporter);
    const _valid_reporters = _reporters.filter(reporter =>
      top_staked.some(staked => staked.account_id === reporter)
    );
    near.log("valid_reporters: ", JSON.stringify(_valid_reporters));
    const _reports = this.report_lookup.get(request_id);
    const _valid_reports = _reports.filter(r => _valid_reporters.includes(r.reporter));

    const _each_reporter_report = [];
    const _each_reporter_result = new Map<string, string>();

    // 2. Aggregate from multi datasources of one report.
    _valid_reports.forEach(report => {
      const _result = this._aggregate_answer(report.answers.map(r => r.result)).result;
      _each_reporter_result.set(report.reporter, _result);
      _each_reporter_report.push(_result);
    });

    // 3. Aggregate from multi reports
    const most_common_report = this._aggregate_answer(_each_reporter_report);
    near.log("most_common_report: ", most_common_report);

    const result = most_common_report.result;
    assert(_valid_reporters.length >= this.reporter_required.quorum, `Quorum: required ${this.reporter_required.quorum}, but got ${_valid_reporters.length}`);
    assert(most_common_report.count >= this.reporter_required.threshold, `Threshold: required ${this.reporter_required.threshold}, but got ${most_common_report.count}`)

    const _response = this.response_lookup.get(request_id);

    _response.valid_reporters = [];
    _response.reporter_reward_addresses = []
    // 4. Filter most common reporter, only most common report will be rewarded
    for (const _report of _valid_reports) {
      const key = _each_reporter_result.get(_report.reporter);
      if (key === most_common_report.result) {
        _response.reporter_reward_addresses.push(_report.reward_address);
        _response.valid_reporters.push(_report.reporter);
      }
    }

    _response.result = result;
    this.response_lookup.set(request_id, _response);
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
  publish_external({ request_id, mpc_options }: { request_id: RequestId; mpc_options: MpcOptions }): NearPromise {
    return super._publish({ request_id, mpc_options });
  }

  @call({ privateFunction: true })
  publish_callback({ request_id, mpc_options, call_data }: { request_id: RequestId; mpc_options: MpcOptions, call_data: string }): void {
    super._publish_callback({ request_id, mpc_options, call_data });
  }

  @call({ privateFunction: true })
  post_aggregate_callback({ request_id, promise_index }: { request_id: RequestId, promise_index: number }): void {
    super._post_aggregate_callback({ request_id, promise_index });
  }

  @call({ payableFunction: true })
  report({ request_id, answers, reward_address }: { request_id: RequestId; answers: Answer[]; reward_address: string; }): NearPromise {
    return super._report({ request_id, answers, reward_address });
  }

  @call({})
  sync_publish_config_to_remote({ chain_id, mpc_options }: { chain_id: ChainId; mpc_options: MpcOptions; }): NearPromise {
    return super._sync_publish_config_to_remote({ chain_id, mpc_options });
  }

  @call({ privateFunction: true })
  sync_publish_config_to_remote_callback({ chain_id, mpc_options, call_data, version }: { chain_id: ChainId; mpc_options: MpcOptions; call_data: string; version: string; }): void {
    return super._sync_publish_config_to_remote_callback({ chain_id, mpc_options, call_data, version });
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
  get_reports({ request_id }: { request_id: RequestId; }): Report[] {
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
  get_latest_response(): Response {
    return super._get_latest_response();
  }
  @view({})
  get_response({ request_id }: { request_id: RequestId; }): Response {
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
