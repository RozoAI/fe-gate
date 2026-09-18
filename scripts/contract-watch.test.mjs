import test from 'node:test';
import assert from 'node:assert/strict';
import { assertContractStatus } from './contract-watch.mjs';
test('watchdog refuses false, missing, future and stale canary evidence', () => {
  const now = Date.now();
  assertContractStatus({ ok: true, checked_at: new Date(now).toISOString() }, now);
  for (const body of [{ ok: false, checked_at: new Date(now).toISOString() }, { ok: true }, { ok: true, checked_at: new Date(now - 91 * 60_000).toISOString() }, { ok: true, checked_at: new Date(now + 120_000).toISOString() }]) assert.throws(() => assertContractStatus(body, now));
});
