import { pathToFileURL } from 'node:url';

export async function notify(fetcher = fetch, env = process.env) {
  const reason = env.FE_GATE_FUNDING_REQUIRED === 'true' ? '需老板打钱：余额低于安全门槛，未下单。' : env.FE_GATE_LOW_BALANCE === 'true' ? '一周内要补钱，请查看两链余额。' : '监控失败，请核查运行证据。';
  const text = `fe-gate ${env.GITHUB_WORKFLOW || 'monitor'}：${reason}\nhttps://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  if (env.FEISHU_WEBHOOK) {
    const url = new URL(env.FEISHU_WEBHOOK);
    if (url.protocol !== 'https:' || !['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname)) throw new Error('invalid webhook host');
    const response = await fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg_type: 'text', content: { text } }) });
    if (!response.ok) throw new Error('Feishu HTTP delivery failed');
    const body = await response.json();
    if ((body.code ?? body.StatusCode) !== 0) throw new Error('Feishu rejected delivery');
    return;
  }
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !env.FEISHU_ALERT_CHAT_ID) throw new Error('Feishu App Bot is not configured');
  const tokenResponse = await fetcher('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }) });
  if (!tokenResponse.ok) throw new Error('Feishu token request failed');
  const tokenBody = await tokenResponse.json();
  if (tokenBody.code !== 0 || !tokenBody.tenant_access_token) throw new Error('Feishu token rejected');
  const url = new URL('https://open.feishu.cn/open-apis/im/v1/messages');
  url.searchParams.set('receive_id_type', 'chat_id');
  const response = await fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${tokenBody.tenant_access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ receive_id: env.FEISHU_ALERT_CHAT_ID, msg_type: 'text', content: JSON.stringify({ text }) }) });
  if (!response.ok) throw new Error('Feishu HTTP delivery failed');
  const body = await response.json();
  if (body.code !== 0) throw new Error('Feishu rejected delivery');
}
function configured(env) {
  return Boolean(env.FEISHU_WEBHOOK || (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_ALERT_CHAT_ID));
}
export function quietHours(now = new Date()) {
  const hour = (now.getUTCHours() + 8) % 24;
  return hour >= 23 || hour < 6;
}
export async function notifyOnce(fetcher = fetch, env = process.env, now = new Date()) {
  // Issue body is the durable notification marker, separate from run logs.
  // Reserve before delivery: an unknown HTTP result never causes blind resend.
  if (!env.GITHUB_TOKEN || !configured(env)) throw new Error('notification configuration missing');
  const title = `fe-gate monitor: ${env.GITHUB_WORKFLOW}`;
  const api = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
  async function gh(path, method = 'GET', body) {
    const response = await fetcher(`${api}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error('notification ledger unavailable');
    return response.json();
  }
  let issue;
  for (let page = 1; page <= 10; page++) {
    const issues = await gh(`/issues?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(issues)) throw new Error('invalid notification ledger');
    issue = issues.find((row) => row.title === title && row.user?.login === 'github-actions[bot]');
    if (issue || issues.length < 100) break;
    if (page === 10) throw new Error('notification ledger pagination incomplete');
  }
  if (!issue) issue = await gh('/issues', 'POST', { title, body: `监控待核查：${env.GITHUB_WORKFLOW}。运行证据：https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` });
  if (quietHours(now)) return 'quiet-hours';
  const marker = /notification_reserved_at=([^\s]+)/.exec(issue.body || '')?.[1];
  if (marker && now - Date.parse(marker) < 24 * 60 * 60_000) return 'deduplicated';
  await gh(`/issues/${issue.number}`, 'PATCH', { body: `监控待核查：${env.GITHUB_WORKFLOW}。\n运行证据：https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}\nnotification_reserved_at=${now.toISOString()}\n如手机消息未到，先核实 Feishu 投递结果再人工重试。` });
  await notify(fetcher, env);
  return 'delivered';
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(await notifyOnce()); } catch { console.error('FAIL Feishu delivery; inspect secret configuration and run URL'); process.exitCode = 1; }
}
