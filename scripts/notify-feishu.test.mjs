import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyOnce, quietHours } from './notify-feishu.mjs';
const env = { GITHUB_TOKEN: 'test-only', FEISHU_WEBHOOK: 'https://open.feishu.cn/open-apis/bot/v2/hook/test', GITHUB_WORKFLOW: 'real-money', GITHUB_REPOSITORY: 'fixture/repo', GITHUB_RUN_ID: '1' };
test('quiet hours follow founder timezone Asia/Bangkok (23:00-06:00 = 16:00-23:00 UTC)', () => {
  assert(!quietHours(new Date('2026-09-18T15:59:00Z')));
  assert(quietHours(new Date('2026-09-18T16:00:00Z')));
  assert(quietHours(new Date('2026-09-18T22:59:00Z')));
  assert(!quietHours(new Date('2026-09-18T23:00:00Z')));
  assert(!quietHours(new Date('2026-11-16T01:45:00Z')));
});
test('24h marker prevents duplicate notification', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, json: async () => [{ number: 1, title: 'fe-gate monitor: real-money', user: { login: 'github-actions[bot]' }, body: 'notification_reserved_at=2026-09-18T00:00:00Z' }] }; };
  assert.equal(await notifyOnce(fetcher, env, new Date('2026-09-18T01:00:00Z')), 'deduplicated');
  assert.equal(calls, 1);
});
test('unknown Feishu result leaves reservation, never retries', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push([String(url), options.method]);
    if (String(url).includes('open.feishu')) throw new Error('timeout');
    return { ok: true, json: async () => options.method === 'GET' ? [{ number: 1, title: 'fe-gate monitor: real-money', user: { login: 'github-actions[bot]' }, body: '' }] : {} };
  };
  await assert.rejects(notifyOnce(fetcher, env, new Date('2026-09-18T01:00:00Z')));
  assert.deepEqual(calls.map((r) => r[1]), ['GET', 'PATCH', 'POST']);
});
test('App Bot obtains a token then sends to the configured chat', async () => {
  const calls = [];
  const appEnv = { FEISHU_APP_ID: 'app-id', FEISHU_APP_SECRET: 'app-secret', FEISHU_ALERT_CHAT_ID: 'chat-id', GITHUB_WORKFLOW: 'prod-smoke', GITHUB_REPOSITORY: 'fixture/repo', GITHUB_RUN_ID: '2' };
  const fetcher = async (url, options) => {
    calls.push([String(url), JSON.parse(options.body), options.headers.Authorization]);
    if (String(url).includes('/auth/')) return { ok: true, json: async () => ({ code: 0, tenant_access_token: 'token' }) };
    return { ok: true, json: async () => ({ code: 0 }) };
  };
  const { notify } = await import('./notify-feishu.mjs');
  await notify(fetcher, appEnv);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1].receive_id, 'chat-id');
  assert.equal(calls[1][2], 'Bearer token');
});
test('unknown App Bot delivery remains reserved and is not retried', async () => {
  const calls = [];
  const appEnv = { GITHUB_TOKEN: 'test-only', FEISHU_APP_ID: 'app-id', FEISHU_APP_SECRET: 'app-secret', FEISHU_ALERT_CHAT_ID: 'chat-id', GITHUB_WORKFLOW: 'real-money-app', GITHUB_REPOSITORY: 'fixture/repo', GITHUB_RUN_ID: '3' };
  const fetcher = async (url, options) => {
    calls.push([String(url), options.method]);
    if (String(url).includes('api.github.com') && options.method === 'GET') return { ok: true, json: async () => [{ number: 2, title: 'fe-gate monitor: real-money-app', user: { login: 'github-actions[bot]' }, body: '' }] };
    if (String(url).includes('api.github.com')) return { ok: true, json: async () => ({}) };
    if (String(url).includes('/auth/')) return { ok: true, json: async () => ({ code: 0, tenant_access_token: 'token' }) };
    throw new Error('message delivery outcome unknown');
  };
  await assert.rejects(notifyOnce(fetcher, appEnv, new Date('2026-09-18T01:00:00Z')));
  assert.deepEqual(calls.map((row) => row[1]), ['GET', 'PATCH', 'POST', 'POST']);
});
const larkEnv = { LARK_APP_ID: 'lark-app', LARK_APP_SECRET: 'lark-secret', LARK_OPS_CHAT_ID: 'ops-chat', LARK_FOUNDER_CHAT_ID: 'founder-chat', FEISHU_WEBHOOK: '', FEISHU_APP_ID: 'old-app', FEISHU_APP_SECRET: 'old-secret', FEISHU_ALERT_CHAT_ID: 'old-chat', GITHUB_WORKFLOW: 'real-money', GITHUB_REPOSITORY: 'fixture/repo', GITHUB_RUN_ID: '4' };
function larkFetcher(calls, messageBody = { code: 0 }) {
  return async (url, options) => {
    calls.push([String(url), JSON.parse(options.body)]);
    if (String(url).includes('/auth/')) return { ok: true, json: async () => ({ code: 0, tenant_access_token: 'token' }) };
    return { ok: true, json: async () => messageBody };
  };
}
test('Lark is authoritative over the retired Feishu app and uses open.larksuite.com', async () => {
  const calls = [];
  const { notify } = await import('./notify-feishu.mjs');
  await notify(larkFetcher(calls), larkEnv);
  assert.equal(calls.length, 2);
  assert(calls.every(([url]) => url.startsWith('https://open.larksuite.com/open-apis/')));
  assert.deepEqual(calls[0][1], { app_id: 'lark-app', app_secret: 'lark-secret' });
  assert.equal(calls[1][1].receive_id, 'ops-chat');
});
test('funding and low-balance notices go to the founder chat', async () => {
  const { notify } = await import('./notify-feishu.mjs');
  for (const flag of ['FE_GATE_FUNDING_REQUIRED', 'FE_GATE_LOW_BALANCE']) {
    const calls = [];
    await notify(larkFetcher(calls), { ...larkEnv, [flag]: 'true' });
    assert.equal(calls[1][1].receive_id, 'founder-chat');
  }
  const calls = [];
  await notify(larkFetcher(calls), { ...larkEnv, LARK_FOUNDER_CHAT_ID: '', FE_GATE_LOW_BALANCE: 'true' });
  assert.equal(calls[1][1].receive_id, 'ops-chat');
});
test('partial Lark configuration fails closed without touching Feishu', async () => {
  const { notify, configured } = await import('./notify-feishu.mjs');
  const partial = { ...larkEnv, LARK_APP_SECRET: '' };
  assert.equal(configured(partial), false);
  const calls = [];
  await assert.rejects(notify(larkFetcher(calls), partial), /Lark configuration incomplete/);
  assert.equal(calls.length, 0);
});
test('Lark rejection surfaces only the numeric code', async () => {
  const { notify } = await import('./notify-feishu.mjs');
  await assert.rejects(notify(larkFetcher([], { code: 230002, msg: 'bot not in chat lark-secret' }), larkEnv), (error) => {
    assert.equal(error.message, 'Lark rejected delivery code 230002');
    return true;
  });
});
test('public log reason withholds foreign error text such as response bodies', async () => {
  const { notify, publicReason } = await import('./notify-feishu.mjs');
  const leaky = async (url) => {
    if (String(url).includes('/auth/')) return { ok: true, json: async () => ({ code: 0, tenant_access_token: 't-SECRETTOKEN' }) };
    return { ok: true, json: async () => JSON.parse('{"tenant_access_token":"t-SECRETTOKEN"') };
  };
  let caught;
  await notify(leaky, larkEnv).catch((error) => { caught = error; });
  assert(caught);
  assert.equal(publicReason(caught), 'SyntaxError (details withheld from public log)');
  assert.doesNotMatch(publicReason(caught), /SECRET/);
  assert.doesNotMatch(publicReason(Object.assign(new Error('x'), { name: 'bad name t-SECRETTOKEN' })), /SECRET/);
  await notify(larkFetcher([], { code: 99991663 }), larkEnv).catch((error) => { caught = error; });
  assert.equal(publicReason(caught), 'Lark rejected delivery code 99991663');
});
test('real-money: a notification failure is a warning, payment failures still fail the run', async () => {
  const { readFileSync } = await import('node:fs');
  const workflow = readFileSync(new URL('../.github/workflows/real-money.yml', import.meta.url), 'utf8');
  const step = (name) => workflow.split('      - ').find((block) => block.includes(`name: ${name}`)) ?? '';
  assert.match(step('Alert Lark'), /continue-on-error: true/);
  assert.match(step('Alert Lark'), /LARK_APP_SECRET: \$\{\{ secrets\.LARK_APP_SECRET \}\}/);
  assert.match(step('Warn on notification failure'), /steps\.alert\.outcome == 'failure'/);
  assert.doesNotMatch(step('Base and Stellar round trip'), /continue-on-error/);
  assert.doesNotMatch(step('Require notification configuration before money movement'), /continue-on-error/);
});
