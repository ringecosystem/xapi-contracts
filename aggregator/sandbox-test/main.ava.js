import anyTest from 'ava';
import { Worker } from 'near-workspaces';
import { setDefaultResultOrder } from 'dns'; setDefaultResultOrder('ipv4first'); // temp fix for node >v17

/**
 *  @typedef {import('near-workspaces').NearAccount} NearAccount
 *  @type {import('ava').TestFn<{worker: Worker, accounts: Record<string, NearAccount>}>}
 */
const test = anyTest;

test.beforeEach(async t => {
  // Create sandbox
  const worker = t.context.worker = await Worker.init();

  // Deploy contract
  const root = worker.rootAccount;
  const contract = await root.createSubAccount('test-account');

  // Get wasm file path from package.json test script in folder above
  await contract.deploy(
    'build/ormp_aggregator.wasm',
  );

  // Save state for test runs, it is unique for each test
  t.context.accounts = { root, contract };
});

test.afterEach.always(async (t) => {
  await t.context.worker.tearDown().catch((error) => {
    console.log('Failed to stop the Sandbox:', error);
  });
});

test('add data source', async (t) => {
  const { contract } = t.context.accounts;
  const dataSource = {
    name: 'test-source',
    url: 'https://example.com',
    method: 'GET',
    headers: {},
    body_json: {},
    result_path: 'data.result'
  };

  await contract.call(contract, 'add_data_source', dataSource);

  const dataSources = await contract.view('get_data_sources', {});
  t.is(dataSources.length, 1);
  t.is(dataSources[0].name, 'test-source');
});

test('report data', async (t) => {
  const { contract, root } = t.context.accounts;
  const requestId = '6277101735386680763835789423207666416102355444464034512896';
  const nonce = '1';
  const answers = [{ data_source_name: 'test-source', result: 'test-result' }];
  const reporterRequired = { quorum: 3, threshold: 2 };
  const rewardAddress = 'reward-address';

  await contract.call(root, 'report',
    { request_id: requestId, nonce, answers, reporter_required: reporterRequired, reward_address: rewardAddress });

  const response = await contract.view('get_response', { request_id: requestId });
  console.log("response", response);
  t.is(response.result, 'test-result');
});

test('publish external', async (t) => {
  const { contract } = t.context.accounts;
  const requestId = 'request-1';

  const result = await contract.call(contract, 'publish_external', { request_id: requestId });
  t.truthy(result);
});

test('report 11', async (t) => {
  const { contract, root } = t.context.accounts;
  const requestId = '6277101735386680763835789423207666416102355444464034512896';
  const nonce = '1';
  const answers = [{ data_source_name: 'test-source', result: 'test-result' }];
  const reporterRequired = { quorum: 3, threshold: 2 };
  const rewardAddress = 'reward-address';
  console.log({ request_id: requestId, nonce, answers, reporter_required: reporterRequired, reward_address: rewardAddress });
  await contract.call(root, 'report',
    { request_id: requestId, nonce, answers, reporter_required: reporterRequired, reward_address: rewardAddress });

  const response = await contract.view('get_response', { request_id: requestId });
  console.log("response", response);
  t.is(response.result, 'test-result');
});

test('encodePublishCall', async (t)=>{
  const { contract, root } = t.context.accounts;
  await contract.call(contract, 'test_publish_encode', {});
})

test('encodeSyncConfigCall', async (t)=>{
  const { contract, root } = t.context.accounts;
  await contract.call(contract, 'test_sync_config_encode', {});
})


test('testEip712', async (t)=>{
  const { contract, root } = t.context.accounts;
  await contract.call(contract, 'test_eip712', {});
})