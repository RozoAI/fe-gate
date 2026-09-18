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
