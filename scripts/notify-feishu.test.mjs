import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyOnce, quietHours } from './notify-feishu.mjs';
const env = { GITHUB_TOKEN: 'test-only', FEISHU_WEBHOOK: 'https://open.feishu.cn/open-apis/bot/v2/hook/test', GITHUB_WORKFLOW: 'real-money', GITHUB_REPOSITORY: 'fixture/repo', GITHUB_RUN_ID: '1' };
test('quiet hours use notification business timezone Singapore', () => {
  assert(quietHours(new Date('2026-09-18T15:00:00Z')));
  assert(quietHours(new Date('2026-09-18T21:59:00Z')));
  assert(!quietHours(new Date('2026-09-18T22:00:00Z')));
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
