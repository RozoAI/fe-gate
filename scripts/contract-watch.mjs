import { pathToFileURL } from 'node:url';
export function assertContractStatus(body, now = Date.now()) {
  const checked = Date.parse(body?.checked_at);
  if (body?.ok !== true || !Number.isFinite(checked) || checked > now + 60_000 || now - checked > 90 * 60_000) throw new Error('contract canary failed, stale, or not enabled');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const key = process.env.FE_GATE_SUPABASE_ANON_KEY;
    if (!key) throw new Error('anonymous API key missing');
    const response = await fetch('https://aozudqtlykbhzbuzalzz.supabase.co/rest/v1/rpc/payment_canary_status', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('status RPC unavailable');
    assertContractStatus(await response.json());
    console.log('ok Lightning insert contract heartbeat');
  } catch { console.error('FAIL Lightning contract canary: failed, stale, or inaccessible'); process.exitCode = 1; }
}
