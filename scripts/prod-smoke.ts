/**
 * L1 production smoke — runs hourly in GitHub Actions.
 * For every site in sites.json:
 *   1. GET /  must be 200 (cache-busted) and the HTML must not contain href="" or \w</strong>\w.
 *   2. If the site exposes /version, its git sha must equal the tip of <repo>@<branch>
 *      ("merged ≠ deployed" class). Requires GITHUB_TOKEN for the API call.
 *   3. Open the page in headless Chromium, wait for hydration, fail on hydration/console errors,
 *      and check document.title is non-empty (HTTP 200 ≠ page correct).
 * Prints one line per site and exits 1 on any failure. Alerting is done by the workflow.
 * Local run on a Mac whose Playwright revision is not cached: FE_GATE_CHROMIUM=<path to chrome-headless-shell>.
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

interface Site { name: string; url: string; repo: string; branch: string; version?: string; allowErrors?: string[] }
const { sites } = JSON.parse(readFileSync(new URL("../sites.json", import.meta.url), "utf8")) as { sites: Site[] };
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;

async function headSha(repo: string, branch: string): Promise<string | null> {
  const tok = process.env.GITHUB_TOKEN;
  if (!tok) return null;
  const r = await fetch(`https://api.github.com/repos/${repo}/commits/${branch}`, {
    headers: { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github.sha", "User-Agent": "fe-gate" },
  });
  return r.ok ? (await r.text()).trim() : null;
}

async function main() {
  const browser = await chromium.launch(process.env.FE_GATE_CHROMIUM ? { executablePath: process.env.FE_GATE_CHROMIUM } : {});
  let failed = 0;
  for (const s of sites) {
    if (only && s.name !== only) continue;
    const problems: string[] = [];
    const bust = `?fegate=${Date.now()}`;
    try {
      const r = await fetch(s.url + "/" + bust, { redirect: "follow", headers: { "User-Agent": "fe-gate-smoke" } });
      if (r.status !== 200) problems.push(`GET / -> ${r.status}`);
      const html = await r.text();
      if (/href=""/.test(html)) problems.push("empty href in HTML");
      if (/\w<\/strong>\w/.test(html)) problems.push("missing space after </strong>");
    } catch (e) { problems.push(`fetch error: ${(e as Error).message}`); }

    if (s.version) {
      try {
        const r = await fetch(s.url + s.version + bust, { headers: { "User-Agent": "fe-gate-smoke" } });
        const body = await r.text();
        const deployed = (body.match(/\b[0-9a-f]{40}\b/) || body.match(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{7,12}\b/) || [])[0];
        const head = await headSha(s.repo, s.branch);
        if (r.status !== 200) problems.push(`${s.version} -> ${r.status}`);
        else if (!deployed) console.log(`warn ${s.name}: ${s.version} is not a git sha (${body.trim().slice(0, 60)}), cannot compare with ${s.repo}@${s.branch}`);
        else if (head && !head.startsWith(deployed) && !deployed.startsWith(head.slice(0, deployed.length)))
          problems.push(`deployed ${deployed.slice(0, 7)} != ${s.repo}@${s.branch} ${head.slice(0, 7)} (merged but not deployed?)`);
      } catch (e) { problems.push(`version check error: ${(e as Error).message}`); }
    }

    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    try {
      await page.goto(s.url + "/" + bust, { waitUntil: "networkidle", timeout: 45_000 });
      await page.waitForTimeout(500);
      const title = await page.title();
      if (!title.trim()) problems.push("empty document.title after hydration");
      const hyd = errors.filter((e) => /Minified React error #4(18|19|22|23|25)|Hydration failed|did not match/i.test(e));
      if (hyd.length) problems.push(`hydration errors: ${hyd[0].slice(0, 120)}`);
      const allowed = (e: string) => (s.allowErrors ?? []).some((a) => e.includes(a));
      const uncaught = errors.filter((e) => e.startsWith("pageerror:") && !allowed(e));
      if (uncaught.length) problems.push(`uncaught: ${uncaught[0].slice(0, 120)}`);
    } catch (e) { problems.push(`browser: ${(e as Error).message.slice(0, 120)}`); }
    await page.close();

    if (problems.length) { failed++; console.log(`FAIL ${s.name} ${s.url}\n  - ${problems.join("\n  - ")}`); }
    else console.log(`ok   ${s.name}`);
  }
  await browser.close();
  if (failed) { console.log(`\n${failed} site(s) failed`); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(2); });
