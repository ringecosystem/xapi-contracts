// Find all our documentation at https://docs.near.org
import { NearBindgen, near, call, view, assert, NearPromise, AccountId } from "near-sdk-js";
import { Aggregator, Answer, DataSource, ChainId, MpcConfig, PublishChainConfig, PublishData, Report, ReporterRequired, RequestId, Response, Staked, SyncPublishChainConfigData } from "./abstract/aggregator.abstract";
import { ContractSourceMetadata, Standard } from "../../common/src/standard.abstract";
import { encodeParameter, stringToBytes } from "./lib/ethereum";

@NearBindgen({})
class OrmpAggregator extends Aggregator {
  // !!! Need to implement

  constructor() {
    super({
      description: "Test Aggregator",
      mpc_config: new MpcConfig({ mpc_contract: "v1.signer-prod.testnet", attached_balance: "500000000000000000000000", key_version: 0 }),
      reporter_required: new ReporterRequired(3, 5),
      staking_contract: "staking.xapi.testnet",
      contract_metadata: new ContractSourceMetadata({
        version: "679c9bd28540f5d335e649426a4a87f0ee09ef21",
        link: "https://github.com/ringecosystem/xapi-contracts/blob/main/aggregator/src/ormp.aggregator.ts",
        standards: [new Standard("nep330", "1.1.0"), new Standard("nep297", "1.0.0")]
      })
    });
  }

  _assert_operator(): void {
    assert(near.signerAccountId() == near.currentAccountId(), `Permission denied, ${near.signerAccountId()} != ${near.currentAccountId()}`);
  }

  _can_aggregate({ request_id }: { request_id: RequestId }): boolean {
    return this.report_lookup.get(request_id).length >= this.reporter_required.threshold;
  }

  _aggregate({ request_id, top_staked }: { request_id: RequestId, top_staked: Staked[] }): void {
    // 1. Filter invalid reports via top staked reporters
    const _reporters = this.report_lookup.get(request_id).map(r => r.reporter);
    const _valid_reporters = _reporters.filter(reporter =>
      top_staked.some(staked => staked.account_id === reporter)
    );
    near.log("valid_reporters: ", JSON.stringify(_valid_reporters));
    if (_valid_reporters.length == 0) {
      near.log("No valid reporters");
      return;
    }
    const _reports = this.report_lookup.get(request_id);
    const _valid_reports = _reports.filter(r => _valid_reporters.includes(r.reporter));

    const _each_reporter_report = [];
    const _each_reporter_result = new Map<string, string>();

    let _error_reporters = [];
    let _error = "";

    // 2. Aggregate from multi datasources of one report.
    _valid_reports.forEach(report => {
      // calc error reports
      for (const a of report.answers) {
        if (a.error) {
          _error = a.error;
          _error_reporters.push(report.reporter);
          break;
        }
      }
      const _result = this._aggregate_answer(report.answers.map(r => r.result)).result;
      _each_reporter_result.set(report.reporter, _result);
      _each_reporter_report.push(_result);
    });

    if (_error_reporters.length >= this.reporter_required.threshold) {
      // 3. Handle error
      const _response = this.response_lookup.get(request_id);

      _response.valid_reporters = _error_reporters;
      _response.reporter_reward_addresses = []
      // 4. Only error report will be rewarded
      for (const _report of _valid_reports) {
        if (_error_reporters.includes(_report.reporter)) {
          _response.reporter_reward_addresses.push(_report.reward_address);
        }
      }
      _response.error_code = 1;
      _response.result = stringToBytes(null);
      this.response_lookup.set(request_id, _response);
    } else {
      // 3. Aggregate from multi reports
      const most_common_report = this._aggregate_answer(_each_reporter_report);
      near.log("most_common_report: ", most_common_report);

      const result = most_common_report.result;
      assert(_valid_reporters.length >= this.reporter_required.threshold, `valid_reporters, Threshold: required ${this.reporter_required.threshold}, but got ${_valid_reporters.length}`);
      assert(most_common_report.count >= this.reporter_required.threshold, `most_common_report, Threshold: required ${this.reporter_required.threshold}, but got ${most_common_report.count}`)

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

      _response.result = this._encode_result(result.split(","));

      this.response_lookup.set(request_id, _response);
    }
  }

  _encode_result(params: any[]): string {
    const encodeParams = [
      encodeParameter("uint256", params[0]),
      encodeParameter("address", params[1]),
      encodeParameter("uint256", params[2]),
      encodeParameter("bytes32", params[3])
    ].join('');
    return '0x' + encodeParams;
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

  /// Calls

  // todo !!! just for testing, remember to remove it
  @call({})
  clear_request({ request_id }: { request_id: RequestId }) {
    this._assert_operator();
    this.report_lookup.remove(request_id);
    this.response_lookup.remove(request_id);
  }

  @call({})
  publish_external({ request_id, publisher_paymaster }: { request_id: RequestId; publisher_paymaster: string }): NearPromise {
    return super._publish({ request_id, publisher_paymaster });
  }

  @call({ privateFunction: true })
  publish_callback({ request_id }: { request_id: RequestId; }): PublishData {
    return super._publish_callback({ request_id });
  }

  @call({ privateFunction: true })
  post_aggregate_callback({ request_id, promise_index }: { request_id: RequestId, promise_index: number }): Response {
    return super._post_aggregate_callback({ request_id, promise_index });
  }

  @call({ payableFunction: true })
  report({ request_id, answers, reward_address }: { request_id: RequestId; answers: Answer[]; reward_address: string; }): NearPromise {
    return super._report({ request_id, answers, reward_address });
  }

  @call({})
  try_aggregate_external({ request_id }: { request_id: RequestId; }): NearPromise {
    return super._try_aggregate({ request_id });
  }

  @call({})
  sync_publish_config_to_remote({ chain_id }: { chain_id: ChainId; }): NearPromise {
    return super._sync_publish_config_to_remote({ chain_id });
  }

  @call({ privateFunction: true })
  sync_publish_config_to_remote_callback({ chain_id, version }: { chain_id: ChainId; version: string; }): SyncPublishChainConfigData {
    return super._sync_publish_config_to_remote_callback({ chain_id, version });
  }

  @call({ payableFunction: true })
  add_data_source(data_source: DataSource): NearPromise {
    return super._add_data_source(data_source);
  }
  @call({})
  remove_data_source({ data_source_name }: { data_source_name: string; }): void {
    super._remove_data_source({ data_source_name });
  }

  @call({ payableFunction: true })
  set_publish_chain_config(publis_chain_config: PublishChainConfig): NearPromise {
    return super._set_publish_chain_config(publis_chain_config);
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

  @call({})
  set_max_result_length({ max_result_length }: { max_result_length: number; }): void {
    super._set_max_result_length({ max_result_length });
  }

  /// Views

  @view({})
  estimate_storage_deposit(obj: any): bigint {
    return super._storage_deposit(obj);
  }
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
  get_max_result_length(): number {
    return super._get_max_result_length();
  }
  @view({})
  contract_source_metadata(): ContractSourceMetadata {
    return super._contract_source_metadata();
  }
}
