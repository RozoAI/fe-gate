import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPreview, probePayments } from './payment-probes.mjs';
import { notify } from './notify-feishu.mjs';
const lightning = { dryrun: true, provider: 'phoenixd', source: { quotedSats: 1000, refSats: 990 }, destination: { chainId: '8453', tokenSymbol: 'USDC', amount: '1' }, expiresAt: null };
const base = { id: null, status: 'dryrun', source: { amount: '1.01', fee: '0.01', receiverAddress: null }, destination: { chainId: '8453', tokenSymbol: 'USDC', amount: '1' }, feeInfo: { provider: 'rozo' } };
test('real preview contracts require no payable invoice or deposit', () => {
  assertPreview('lightning', lightning); assertPreview('base', base);
  for (const payload of [{ ...base, id: 'real-order' }, { ...lightning, lnInvoice: 'payable' }, { ...base, databaseError: 'schema' }, { ...base, source: { amount: 'NaN', fee: 0 } }]) assert.throws(() => assertPreview('base', payload));
});
test('both rails use URL dryrun and never send a real create', async () => {
  const calls = [];
  const results = await probePayments(async (url, options) => {
    assert.equal(options.headers.Origin, 'https://checkout.rozo.ai');
    calls.push([url, JSON.parse(options.body)]);
    return { status: 200, json: async () => calls.length === 1 ? lightning : base };
  });
  assert.equal(results.filter((r) => r.ok).length, 2);
  assert(calls.every(([url, body]) => url.endsWith('?dryrun=true') && body.appId === 'merchant_openrouter'));
});
test('HTTP errors and network uncertainty fail without retry', async () => {
  let calls = 0;
  const results = await probePayments(async () => { calls++; throw new Error('network'); });
  assert.equal(calls, 2); assert(results.every((r) => !r.ok));
});
test('notification cannot silently succeed without secret or Feishu acceptance', async () => {
  await assert.rejects(notify(async () => {}, {}));
  const env = { FEISHU_WEBHOOK: 'https://open.feishu.cn/open-apis/bot/v2/hook/test' };
  await assert.rejects(notify(async () => ({ ok: true, json: async () => ({ code: 1 }) }), env));
  await notify(async () => ({ ok: true, json: async () => ({ code: 0 }) }), env);
});
