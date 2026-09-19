import test from 'node:test';
import assert from 'node:assert/strict';
import { fundingGuard, runRoundTrip, previousRunGuard, validateIntent, registrationPreflight } from './real-money.mjs';
const balances = { baseUsdc: 2, stellarUsdc: 2, baseEth: 0.0003, stellarXlm: 3 };
function adapter() {
  const state = { ...balances };
  return {
    addresses: { base: 'base-test', stellar: 'stellar-test' },
    balances: async () => ({ ...state }),
    create: async (body) => ({ ...body, id: body.orderId, appId: body.appId, status: 'payment_unpaid', expiresAt: new Date(Date.now() + 120_000).toISOString(), source: { ...body.source, receiverAddress: 'deposit-test' }, destination: { ...body.destination, amount: '0.49' } }),
    pay: async (_, source) => { if (source === '8453') { state.baseUsdc -= .5; state.stellarUsdc += .49; } else { state.stellarUsdc -= .5; state.baseUsdc += .49; } return 'tx-test'; },
    wait: async () => ({ status: 'payment_payout_completed', destination: { txHash: 'destination-test' } }),
  };
}
test('balance guard refuses missing readings and insufficient funds', () => {
  fundingGuard(balances);
  for (const patch of [{ baseUsdc: .59 }, { baseEth: .00009 }, { stellarUsdc: NaN }, { stellarXlm: 1 }]) assert.throws(() => fundingGuard({ ...balances, ...patch }));
});
test('two legs reconcile both destination increases and loop balances', async () => {
  const records = [];
  const after = await runRoundTrip(adapter(), (r) => records.push(r), 'test-day');
  assert.equal(records.filter((r) => r.phase === 'paid').length, 2);
  assert(Math.abs(after.baseUsdc - 1.99) < 1e-8);
});
test('order ids carry the run id so two runs on one day never collide', async () => {
  const records = [];
  await runRoundTrip(adapter(), (r) => records.push(r), 'test-day', 'run-a');
  await runRoundTrip(adapter(), (r) => records.push(r), 'test-day', 'run-b');
  const ids = records.filter((r) => r.phase === 'create_pending').map((r) => r.orderId);
  assert.deepEqual(ids, ['fe-gate-test-day-run-a-1', 'fe-gate-test-day-run-a-2', 'fe-gate-test-day-run-b-1', 'fe-gate-test-day-run-b-2']);
  assert.equal(new Set(ids).size, ids.length);
});
test('unknown broadcast outcome never retries or starts return leg', async () => {
  const fake = adapter(); let sends = 0;
  fake.pay = async () => { sends++; throw new Error('timeout after broadcast'); };
  const records = [];
  await assert.rejects(runRoundTrip(fake, (r) => records.push(r), 'test-day'));
  assert.equal(sends, 1); assert.equal(records.at(-1).phase, 'broadcast_pending');
});
test('paid API status without destination chain/balance evidence fails', async () => {
  const fake = adapter(); fake.pay = async () => 'tx';
  await assert.rejects(runRoundTrip(fake, () => {}, 'test-day'), /balance/);
});
test('replay, non-main, uncertain previous run fail closed', async () => {
  const env = { GITHUB_RUN_ATTEMPT: '1', GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ID: '3' };
  const failed = async () => ({ workflow_runs: [{ id: 2, conclusion: 'failure' }] });
  await assert.rejects(previousRunGuard(failed, env));
  await assert.rejects(previousRunGuard(failed, { ...env, GITHUB_RUN_ATTEMPT: '2' }));
  await previousRunGuard(failed, { ...env, FE_GATE_RECONCILED_RUN_ID: '2' });
});
test('wrong recipient or overlarge quote cannot be paid', async () => {
  const intent = await adapter().create({ appId: 'fe_gate_canary', source: { chainId: '8453', tokenSymbol: 'USDC', amount: '0.5' }, destination: { chainId: '1500', tokenSymbol: 'USDC', receiverAddress: 'stellar-test' } });
  assert.throws(() => validateIntent(intent, '8453', 'someone-else'));
  assert.throws(() => validateIntent({ ...intent, source: { ...intent.source, amount: '50' } }, '8453', 'stellar-test'));
});
test('unregistered app cannot pass the read-only preflight', async () => {
  await assert.rejects(registrationPreflight('fixture', async () => ({ error: { code: 'unknown_app_id' } })));
  await registrationPreflight('fixture', async (url, options) => {
    assert(url.endsWith('?dryrun=true'));
    assert.equal(JSON.parse(options.body).appId, 'fe_gate_canary');
    return { status: 'dryrun', id: null, appId: 'fe_gate_canary' };
  });
});
