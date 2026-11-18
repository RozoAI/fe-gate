import { pathToFileURL } from 'node:url';

// Company alerting moved to Lark international (Rozo Ops / Rozo Founder) and
// the Feishu CN app was retired on 2026-10-24. Lark is authoritative as soon
// as any LARK_* value is configured: a partial Lark configuration is an error
// and never silently falls back to the retired Feishu path.
const LARK_BASE = 'https://open.larksuite.com/open-apis';
const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const LARK_KEYS = ['LARK_APP_ID', 'LARK_APP_SECRET', 'LARK_OPS_CHAT_ID', 'LARK_FOUNDER_CHAT_ID'];
// Errors this module raises itself: fixed text plus numeric codes only.
export class NotifyError extends Error {}

// Funding and low-balance notices ask the founder to act; every other
// monitor failure is a machine alert for the ops chat.
export function needsFounder(env) {
  return env.FE_GATE_FUNDING_REQUIRED === 'true' || env.FE_GATE_LOW_BALANCE === 'true';
}
export function channel(env) {
  if (LARK_KEYS.some((key) => env[key])) {
    if (!env.LARK_APP_ID || !env.LARK_APP_SECRET || !env.LARK_OPS_CHAT_ID) return { kind: 'lark-incomplete' };
    const chatId = needsFounder(env) ? env.LARK_FOUNDER_CHAT_ID || env.LARK_OPS_CHAT_ID : env.LARK_OPS_CHAT_ID;
    return { kind: 'app', label: 'Lark', base: LARK_BASE, appId: env.LARK_APP_ID, appSecret: env.LARK_APP_SECRET, chatId };
  }
  if (env.FEISHU_WEBHOOK) return { kind: 'webhook' };
  if (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_ALERT_CHAT_ID) return { kind: 'app', label: 'Feishu', base: FEISHU_BASE, appId: env.FEISHU_APP_ID, appSecret: env.FEISHU_APP_SECRET, chatId: env.FEISHU_ALERT_CHAT_ID };
  return { kind: 'none' };
}
export function configured(env) {
  const { kind } = channel(env);
  return kind === 'app' || kind === 'webhook';
}
async function sendViaApp(fetcher, target, text) {
  // Errors carry only numeric API codes: run logs of this public repo are public.
  const tokenResponse = await fetcher(`${target.base}/auth/v3/tenant_access_token/internal`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: target.appId, app_secret: target.appSecret }) });
  if (!tokenResponse.ok) throw new NotifyError(`${target.label} token request failed HTTP ${tokenResponse.status}`);
  const tokenBody = await tokenResponse.json();
  if (tokenBody.code !== 0 || !tokenBody.tenant_access_token) throw new NotifyError(`${target.label} token rejected code ${Number(tokenBody.code)}`);
  const url = new URL(`${target.base}/im/v1/messages`);
  url.searchParams.set('receive_id_type', 'chat_id');
  const response = await fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${tokenBody.tenant_access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ receive_id: target.chatId, msg_type: 'text', content: JSON.stringify({ text }) }) });
  if (!response.ok) throw new NotifyError(`${target.label} HTTP delivery failed HTTP ${response.status}`);
  const body = await response.json();
  if (body.code !== 0) throw new NotifyError(`${target.label} rejected delivery code ${Number(body.code)}`);
}
export async function notify(fetcher = fetch, env = process.env) {
  const reason = env.FE_GATE_FUNDING_REQUIRED === 'true' ? '需老板打钱：余额低于安全门槛，未下单。' : env.FE_GATE_LOW_BALANCE === 'true' ? '一周内要补钱，请查看两链余额。' : '监控失败，请核查运行证据。';
  const text = `fe-gate ${env.GITHUB_WORKFLOW || 'monitor'}：${reason}\nhttps://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const target = channel(env);
  if (target.kind === 'lark-incomplete') throw new NotifyError('Lark configuration incomplete: LARK_APP_ID, LARK_APP_SECRET and LARK_OPS_CHAT_ID are required');
  if (target.kind === 'none') throw new NotifyError('notification channel is not configured');
  if (target.kind === 'app') return sendViaApp(fetcher, target, text);
  const url = new URL(env.FEISHU_WEBHOOK);
  if (url.protocol !== 'https:' || !['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname)) throw new NotifyError('invalid webhook host');
  const response = await fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg_type: 'text', content: { text } }) });
  if (!response.ok) throw new NotifyError(`webhook HTTP delivery failed HTTP ${response.status}`);
  const body = await response.json();
  if ((body.code ?? body.StatusCode) !== 0) throw new NotifyError(`webhook rejected delivery code ${Number(body.code ?? body.StatusCode)}`);
}
// Quiet hours 23:00-06:00 in the founder's current local timezone
// (Asia/Bangkok, UTC+07:00, no DST), matching the company alert policy.
export function quietHours(now = new Date()) {
  const hour = (now.getUTCHours() + 7) % 24;
  return hour >= 23 || hour < 6;
}
export async function notifyOnce(fetcher = fetch, env = process.env, now = new Date()) {
  // Issue body is the durable notification marker, separate from run logs.
  // Reserve before delivery: an unknown HTTP result never causes blind resend.
  if (!env.GITHUB_TOKEN || !configured(env)) throw new NotifyError('notification configuration missing');
  const title = `fe-gate monitor: ${env.GITHUB_WORKFLOW}`;
  const api = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
  async function gh(path, method = 'GET', body) {
    const response = await fetcher(`${api}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new NotifyError('notification ledger unavailable');
    return response.json();
  }
  let issue;
  for (let page = 1; page <= 10; page++) {
    const issues = await gh(`/issues?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(issues)) throw new NotifyError('invalid notification ledger');
    issue = issues.find((row) => row.title === title && row.user?.login === 'github-actions[bot]');
    if (issue || issues.length < 100) break;
    if (page === 10) throw new NotifyError('notification ledger pagination incomplete');
  }
  if (!issue) issue = await gh('/issues', 'POST', { title, body: `监控待核查：${env.GITHUB_WORKFLOW}。运行证据：https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` });
  if (quietHours(now)) return 'quiet-hours';
  const marker = /notification_reserved_at=([^\s]+)/.exec(issue.body || '')?.[1];
  if (marker && now - Date.parse(marker) < 24 * 60 * 60_000) return 'deduplicated';
  await gh(`/issues/${issue.number}`, 'PATCH', { body: `监控待核查：${env.GITHUB_WORKFLOW}。\n运行证据：https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}\nnotification_reserved_at=${now.toISOString()}\n如手机消息未到，先核实 Lark 投递结果再人工重试。` });
  await notify(fetcher, env);
  return 'delivered';
}
// Run logs of this public repo are public. Only NotifyError messages, which
// this module builds from fixed strings and numeric codes, are printed;
// anything else, such as a JSON parse error that may quote a response body
// holding a token, is reduced to its error class name.
export function publicReason(error) {
  if (error instanceof NotifyError) return error.message;
  const name = typeof error?.name === 'string' && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error';
  return `${name} (details withheld from public log)`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(await notifyOnce()); } catch (error) {
    console.error(`FAIL notification delivery (${publicReason(error)}); inspect LARK_* secret configuration and run URL`);
    process.exitCode = 1;
  }
}
