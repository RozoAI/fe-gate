import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { API } from './payment-probes.mjs';

// Public identity digests bind the existing dedicated CI secrets to the
// approved wallets without publishing addresses in logs or documentation.
export const WALLET_DIGESTS = {
  base: 'e10d30358ea75829e52181826aea7d5477221e5299f78784ae9f4aa25e9939e9', stellar: '7c8fd0fd2bcbe10f00a0995aedbfda50b6a7941f81733f38619a05b933b39fdc',
};
export const digest = (value) => createHash('sha256').update(value.toLowerCase()).digest('hex');
// Synced from the company blacklist and e2e compromised-wallets, 2026-09-18.
const BLOCKED = new Set(['576ace2d6a2ebd18c08d4467a6a61901fa02ae4e3a744a306ac5a5dddc255e5a', '0dbf33b720faa8b85b57ce57a2e072e235b61cf8cbcf0288b16c8c99ddbe6c87', '50d1d1947c2f813e35690c301241fc6c7b336b97bedf450e42362aa5677a64ff', '552aa57ea441816c9976f371ce933fd5e5579886af88afd74290b0f685d7eead', '3ed6d16ebc4d36cc47329e1b56a470b4999317a7038521cf85429f203842f706', '4eea2d0ee7abe6d9ca3d175690bdccddc78d0ebfe76cbfe85b1888c8a76b1141', 'f4a857fe90f4362d277a53ca582875c206bbcc98459624c3ba5f3fe63f36141a', '30d06a08f3e2f2a032a36e33e5847c6be4319d3d7916ee031828550c7ffe3914', '4d67cc7877a498d0f37db181aec2ea12a00b07c3d02e533239465ce1a8d25811', '2a17c3b61899b6e3dcee446b7bf542f112aaa7d60e1a3a9976a605c4c335f494', 'f067bdec0ac97ab3b1719db1f970d23d912600b9df9f3364ea3f3e32a2d298f0', '7eaeb9affcbe5887e58e2d7b3c05aa9f4534b02bb23d35f694aea9c526722432', '8fe8f3d0caf4310c9c9ba357f93810cefb5f2105bb990ea4653f27a37139fb54']);
export function fundingGuard(b) {
  for (const key of ['baseUsdc', 'stellarUsdc', 'baseEth', 'stellarXlm']) if (!Number.isFinite(b[key])) throw new Error('balance observation incomplete');
  if (b.baseUsdc < 0.6 || b.stellarUsdc < 0.6 || b.baseEth < 0.0001 || b.stellarXlm < 1.1) throw Object.assign(new Error('需老板打钱：余额低于安全门槛'), { code: 'FUNDING_REQUIRED' });
}
export function validateIntent(intent, source, receiver) {
  if (!intent?.id || intent.appId !== 'fe_gate_canary' || intent.status !== 'payment_unpaid' || String(intent.source?.chainId) !== source || intent.source?.tokenSymbol !== 'USDC' || Number(intent.source?.amount) !== 0.5 || intent.destination?.receiverAddress?.toLowerCase() !== receiver.toLowerCase() || intent.destination?.tokenSymbol !== 'USDC' || String(intent.destination?.chainId) !== (source === '8453' ? '1500' : '8453')) throw new Error('payment identity or amount mismatch');
  if (!(Number(intent.destination.amount) >= 0.48 && Number(intent.destination.amount) <= 0.5)) throw new Error('bridge fee exceeds 0.02 USDC per leg');
  if (!intent.source.receiverAddress || !(Date.parse(intent.expiresAt) > Date.now() + 60_000)) throw new Error('deposit missing or expiring');
  if (BLOCKED.has(digest(intent.source.receiverAddress))) throw new Error('compromised deposit address');
}
export async function runRoundTrip(adapter, record, day) {
  const before = await adapter.balances(); record({ phase: 'before', balances: before }); fundingGuard(before);
  for (const [leg, source, target] of [[1, '8453', 'stellar'], [2, '1500', 'base']]) {
    const orderId = `fe-gate-${day}-${leg}`;
    const destinationBefore = await adapter.balances();
    // No automatic retries around create or broadcast. A failed run blocks
    // future runs until an operator reconciles the saved payment/chain evidence.
    record({ phase: 'create_pending', leg, orderId });
    const intent = await adapter.create({ appId: 'fe_gate_canary', orderId, type: 'exactIn', display: { title: 'Internal cloud synthetic', currency: 'USD' }, source: { chainId: source, tokenSymbol: 'USDC', amount: '0.5' }, destination: { chainId: target === 'base' ? '8453' : '1500', tokenSymbol: 'USDC', receiverAddress: adapter.addresses[target] } });
    validateIntent(intent, source, adapter.addresses[target]);
    record({ phase: 'broadcast_pending', leg, paymentId: intent.id, orderId });
    const txHash = await adapter.pay(intent, source);
    record({ phase: 'broadcast_returned', leg, paymentId: intent.id, txHash });
    if (adapter.registerPayin) {
      try { await adapter.registerPayin(intent.id, txHash, source); }
      catch { record({ phase: 'payin_registration_unknown', leg, paymentId: intent.id }); }
    }
    const final = await adapter.wait(intent.id);
    if (final.status !== 'payment_payout_completed' || !final.destination?.txHash) throw new Error('payout completion has no chain evidence');
    const after = await adapter.balances();
    const key = target === 'base' ? 'baseUsdc' : 'stellarUsdc';
    if (after[key] - destinationBefore[key] + 0.000001 < Number(intent.destination.amount)) throw new Error('destination balance did not increase by quote');
    record({ phase: 'paid', leg, paymentId: intent.id, txHash, destinationTxHash: final.destination.txHash, balances: after });
  }
  const after = await adapter.balances();
  if (Math.abs(after.baseUsdc - before.baseUsdc) > 0.020001 || Math.abs(after.stellarUsdc - before.stellarUsdc) > 0.020001) throw new Error('round trip balance mismatch');
  return after;
}
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`request failed HTTP ${response.status}`);
  return response.json();
}
export async function previousRunGuard(fetcher = request, env = process.env) {
  if (env.GITHUB_RUN_ATTEMPT !== '1' || env.GITHUB_REF !== 'refs/heads/main') throw new Error('only first attempts on main can move funds');
  const response = await fetcher(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/real-money.yml/runs?per_page=100`, { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
  if (!Array.isArray(response.workflow_runs)) throw new Error('prior run history unavailable');
  const prior = response.workflow_runs.filter((r) => Number(r.id) < Number(env.GITHUB_RUN_ID) && r.conclusion !== 'skipped').sort((a, b) => b.id - a.id)[0];
  if (prior && prior.conclusion !== 'success' && String(prior.id) !== env.FE_GATE_RECONCILED_RUN_ID) throw new Error('previous run unresolved; reconcile balances/transactions before approving its run id');
}
async function makeAdapter() {
  const { createPublicClient, createWalletClient, http, erc20Abi, parseUnits } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const { base } = await import('viem/chains');
  const stellar = await import('@stellar/stellar-sdk');
  const account = privateKeyToAccount(process.env.FE_GATE_EVM_PRIVATE_KEY);
  const keypair = stellar.Keypair.fromSecret(process.env.FE_GATE_STELLAR_SECRET);
  const addresses = { base: account.address, stellar: keypair.publicKey() };
  for (const chain of ['base', 'stellar']) if (digest(addresses[chain]) !== WALLET_DIGESTS[chain]) throw new Error('CI wallet is not the approved dedicated identity');
  const token = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const issuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
  const publicClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org', { retryCount: 0, timeout: 30_000 }) });
  const wallet = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org', { retryCount: 0, timeout: 30_000 }) });
  const horizon = new stellar.Horizon.Server('https://horizon.stellar.org');
  return {
    addresses,
    async balances() {
      const [usdc, eth, balance] = await Promise.all([publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [addresses.base] }), publicClient.getBalance({ address: addresses.base }), horizon.loadAccount(addresses.stellar)]);
      return { baseUsdc: Number(usdc) / 1e6, baseEth: Number(eth) / 1e18, stellarUsdc: Number(balance.balances.find((b) => b.asset_code === 'USDC' && b.asset_issuer === issuer)?.balance ?? NaN), stellarXlm: Number(balance.balances.find((b) => b.asset_type === 'native')?.balance ?? NaN) };
    },
    create(body) { return request(`${API}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); },
    registerPayin(id, txHash, chain) { return request(`${API}/payments/${encodeURIComponent(id)}/payin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHash, fromAddress: addresses[chain === '8453' ? 'base' : 'stellar'] }) }); },
    async pay(intent, chain) {
      if (chain === '8453') {
        if (!/^0x[0-9a-fA-F]{40}$/.test(intent.source.receiverAddress)) throw new Error('invalid Base deposit');
        return wallet.writeContract({ address: token, abi: erc20Abi, functionName: 'transfer', args: [intent.source.receiverAddress, parseUnits('0.5', 6)] });
      }
      if (!stellar.StrKey.isValidEd25519PublicKey(intent.source.receiverAddress) || !/^\d+$/.test(String(intent.source.receiverMemo))) throw new Error('invalid Stellar deposit/memo');
      const source = await horizon.loadAccount(addresses.stellar);
      const tx = new stellar.TransactionBuilder(source, { fee: '100000', networkPassphrase: stellar.Networks.PUBLIC }).addOperation(stellar.Operation.payment({ destination: intent.source.receiverAddress, asset: new stellar.Asset('USDC', issuer), amount: '0.5' })).addMemo(stellar.Memo.id(String(intent.source.receiverMemo))).setTimeout(60).build();
      tx.sign(keypair);
      return (await horizon.submitTransaction(tx)).hash;
    },
    async wait(id) {
      const deadline = Date.now() + 15 * 60_000;
      while (Date.now() < deadline) {
        const payment = await request(`${API}/payments/${encodeURIComponent(id)}`);
        if (payment.status === 'payment_payout_completed') return payment;
        if (['payment_error', 'payment_expired', 'payment_refunded'].includes(payment.status)) throw new Error('payment entered unsuccessful terminal state');
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
      throw new Error('payout deadline exceeded; outcome requires reconciliation');
    },
  };
}
async function main() {
  if (process.env.FE_GATE_REAL_MONEY_ENABLED !== 'true') throw new Error('real-money gate disabled');
  await previousRunGuard();
  const records = [];
  const record = (entry) => { records.push(entry); writeFileSync('real-money-evidence.json', JSON.stringify(records, null, 2)); console.log(JSON.stringify(entry)); };
  const adapter = await makeAdapter();
  try {
    const after = await runRoundTrip(adapter, record, new Date().toISOString().slice(0, 10));
    if (after.baseUsdc < 1 || after.stellarUsdc < 1 || after.baseEth < 0.0002) {
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'low_balance=true\n');
      console.log('一周内要补钱');
    }
  } finally {
    try { record({ phase: 'final_snapshot', balances: await adapter.balances() }); } catch { record({ phase: 'final_snapshot_unavailable' }); }
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n支付往返证据\n\n\`\`\`json\n${JSON.stringify(records, null, 2)}\n\`\`\`\n`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  if (error.code === 'FUNDING_REQUIRED') {
    console.error('FAIL 需老板打钱：余额低于安全门槛，未下单');
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'funding_required=true\n');
  } else console.error('FAIL synthetic payment; do not retry before reconciling payment ids and chain balances');
  process.exitCode = 1;
});
