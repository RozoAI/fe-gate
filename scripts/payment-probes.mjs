import { pathToFileURL } from 'node:url';

export const API = 'https://aozudqtlykbhzbuzalzz.supabase.co/functions/v1/payment-api';
// Every source rail OpenRouter checkout accepts in production. Rail names are
// the log/alert labels; keep 'lightning' and 'base' stable for alert history.
export const RAILS = [
  { rail: 'lightning', chainId: 'lightning', tokenSymbol: 'BTC' },
  { rail: 'base', chainId: '8453', tokenSymbol: 'USDC' },
  { rail: 'base-eth', chainId: '8453', tokenSymbol: 'ETH' },
  { rail: 'ethereum-eth', chainId: '1', tokenSymbol: 'ETH' },
  { rail: 'arbitrum-eth', chainId: '42161', tokenSymbol: 'ETH' },
  { rail: 'bsc-bnb', chainId: '56', tokenSymbol: 'BNB' },
  { rail: 'solana-sol', chainId: '900', tokenSymbol: 'SOL' },
  { rail: 'solana-usdt', chainId: '900', tokenSymbol: 'USDT' },
  { rail: 'bsc-usdt', chainId: '56', tokenSymbol: 'USDT' },
];
const positive = (v) => v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
export function assertPreview(rail, body, expected) {
  if (!body || body.error || body.errorCode || body.databaseError || body.id || body.lnInvoice || body.source?.receiverAddress) throw new Error('preview returned an error or payable order');
  if (rail === 'lightning') {
    if (body.dryrun !== true || body.provider !== 'phoenixd' || !positive(body.source?.quotedSats) || !positive(body.source?.refSats) || body.expiresAt !== null) throw new Error('invalid Lightning preview');
  } else if (body.status !== 'dryrun' || body.id !== null || !positive(body.source?.amount) || !positive(body.destination?.amount) || body.source?.fee === null || body.source?.fee === undefined || !Number.isFinite(Number(body.source.fee)) || Number(body.source.fee) < 0 || !body.feeInfo) {
    throw new Error('invalid preview');
  }
  // A non-Lightning preview must echo the requested source, so a silent
  // fallback to another rail cannot pass as this one.
  if (expected && rail !== 'lightning' && (String(body.source?.chainId) !== expected.chainId || body.source?.tokenSymbol !== expected.tokenSymbol)) throw new Error('preview source mismatch');
  if (body.destination?.chainId !== '8453' || body.destination?.tokenSymbol !== 'USDC' || Number(body.destination?.amount) !== 1) throw new Error('wrong preview destination/amount');
}

export async function probePayments(fetcher = fetch, appId = 'merchant_openrouter') {
  const results = [];
  for (const { rail, chainId, tokenSymbol } of RAILS) {
    try {
      const response = await fetcher(`${API}/payments?dryrun=true`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', Origin: 'https://checkout.rozo.ai' },
        body: JSON.stringify({ appId, type: 'exactOut', source: { chainId, tokenSymbol }, destination: { chainId: '8453', tokenSymbol: 'USDC', amount: '1' } }),
      });
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      assertPreview(rail, await response.json(), { chainId, tokenSymbol });
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
