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
    'build/staking.wasm',
  );

  // Save state for test runs, it is unique for each test
  t.context.accounts = { root, contract };
});

test('should stake tokens', async t => {
  const { contract } = t.context.accounts;
  const amount = '1000';

  // Simulate transfer
  await contract.call(contract, 'ft_on_transfer', { sender_id: contract.accountId, amount, msg: 'Stake' });

  const staked = await contract.view('get_staked', { account_id: contract.accountId });
  t.is(staked.amount, amount);
});

test('should unlock tokens', async t => {
  const { contract } = t.context.accounts;
  const amount = '500';

  // First stake
  await contract.call(contract, 'ft_on_transfer', { sender_id: contract.accountId, amount: '1000', msg: 'Stake' });

  // Unlock part of the amount
  await contract.call(contract, 'unlock', { amount });

  const staked = await contract.view('get_staked', { account_id: contract.accountId });
  t.is(staked.amount, '500'); // Remaining staked amount
  const unlocking = await contract.view('get_staked', { account_id: contract.accountId });
  t.is(unlocking.unlocking.length, 1); // There should be one unlocking entry
});

test('should withdraw unlocked tokens', async t => {
  const { contract } = t.context.accounts;
  const amount = '500';

  // First stake and unlock
  await contract.call(contract, 'ft_on_transfer', { sender_id: contract.accountId, amount: '1000', msg: 'Stake' });
  const beforeUnlockStaked = await contract.view('get_staked', { account_id: contract.accountId });
  console.log("Before unlocking staked", beforeUnlockStaked);
  await contract.call(contract, 'unlock', { amount });

  const afterUnlockStaked = await contract.view('get_staked', { account_id: contract.accountId });
  console.log("After unlocking staked", afterUnlockStaked);

  await contract.call(contract, 'withdraw', {});
  const staked = await contract.view('get_staked', { account_id: contract.accountId });
  console.log("After withdrawing staked", staked);
  t.is(staked.unlocking.length, 0);
  t.is(staked.amount, '500');
});

test('should slash tokens', async t => {
  const { contract } = t.context.accounts;
  const stakeAmount = '1000';
  const slashAmount = '300';

  // First stake
  await contract.call(contract, 'ft_on_transfer', { sender_id: contract.accountId, amount: stakeAmount, msg: 'Stake' });

  // Execute slashing
  await contract.call(contract, 'slash', { account_id: contract.accountId, amount: slashAmount });

  const staked = await contract.view('get_staked', { account_id: contract.accountId });
  t.is(staked.amount, '700'); // Remaining staked amount
});

test('should set unlock period', async t => {
  const { contract } = t.context.accounts;
  const newPeriod = '1000000000000'; // 1 second

  // Set unlock period
  await contract.call(contract, 'set_unlock_period', { period: newPeriod });

  const unlockPeriod = await contract.view('get_unlock_period');
  t.is(unlockPeriod, newPeriod);
});

test('should slash from unlocking when staked amount is insufficient', async t => {
  const { contract } = t.context.accounts;
  const stakeAmount = '1500';
  const slashAmount = '1200'; // More than staked amount

  // First stake
  await contract.call(contract, 'ft_on_transfer', { sender_id: contract.accountId, amount: stakeAmount, msg: 'Stake' });

  // Unlock part of the amount
  await contract.call(contract, 'unlock', { amount: '500' });

  // Unlock part of the amount
  await contract.call(contract, 'unlock', { amount: '800' });

  // Execute slashing
  await contract.call(contract, 'slash', { account_id: contract.accountId, amount: slashAmount });

  const staked = await contract.view('get_staked', { account_id: contract.accountId });
  t.is(staked.amount, '0'); // Staked amount should be 0 after slashing
  t.is(staked.unlocking.length, 1); // There should still be one unlocking entry
  t.is(staked.unlocking[0].amount, '300'); // Remaining unlocking amount after slashing
});