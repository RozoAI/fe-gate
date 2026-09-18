import { pathToFileURL } from 'node:url';

export const API = 'https://aozudqtlykbhzbuzalzz.supabase.co/functions/v1/payment-api';
const positive = (v) => v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
export function assertPreview(rail, body) {
  if (!body || body.error || body.errorCode || body.databaseError || body.id || body.lnInvoice || body.source?.receiverAddress) throw new Error('preview returned an error or payable order');
  if (rail === 'lightning') {
    if (body.dryrun !== true || body.provider !== 'phoenixd' || !positive(body.source?.quotedSats) || !positive(body.source?.refSats) || body.expiresAt !== null) throw new Error('invalid Lightning preview');
  } else if (body.status !== 'dryrun' || body.id !== null || !positive(body.source?.amount) || !positive(body.destination?.amount) || body.source?.fee === null || body.source?.fee === undefined || !Number.isFinite(Number(body.source.fee)) || Number(body.source.fee) < 0 || !body.feeInfo) {
    throw new Error('invalid Base preview');
  }
  if (body.destination?.chainId !== '8453' || body.destination?.tokenSymbol !== 'USDC' || Number(body.destination?.amount) !== 1) throw new Error('wrong preview destination/amount');
}

export async function probePayments(fetcher = fetch, appId = 'merchant_openrouter') {
  const results = [];
  for (const rail of ['lightning', 'base']) {
    try {
      const response = await fetcher(`${API}/payments?dryrun=true`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', Origin: 'https://checkout.rozo.ai' },
        body: JSON.stringify({ appId, type: 'exactOut', source: { chainId: rail === 'lightning' ? 'lightning' : '8453', tokenSymbol: rail === 'lightning' ? 'BTC' : 'USDC' }, destination: { chainId: '8453', tokenSymbol: 'USDC', amount: '1' } }),
      });
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      assertPreview(rail, await response.json());
      results.push({ rail, ok: true });
    } catch {
      // Never serialize responses, wallet data, URLs or SDK error objects.
      results.push({ rail, ok: false });
    }
  }
  return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await probePayments(fetch, process.env.FE_GATE_PROBE_APP_ID || 'merchant_openrouter');
  for (const result of results) console.log(`${result.ok ? 'ok' : 'FAIL'} checkout-${result.rail} quote-preview`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}
