# @rozoai/fe-gate

One shared frontend gate for every Rozo web app. Three layers:

| Layer | Where it runs | What it catches |
|---|---|---|
| **L0 PR gate** | each app repo's `fe-gate.yml` → calls `RozoAI/fe-gate/.github/workflows/gate.yml` | hydration errors, empty hrefs, blank QR, wallet-connect UI state, page coverage, i18n parity, vercel.json rewrite coverage, visual baselines |
| **L1 prod smoke** | this repo, hourly (`prod-smoke.yml`) + after each deploy | merged-but-not-deployed (`/version` sha vs branch tip), hydration on production, dead pages |
| **L2 real money** | this repo, daily (`real-money.yml`, added in week 1 day 5) | false "Payment Complete", broken pay flow end-to-end with a capped test wallet |

## Adopt in an app repo (10 minutes)

```bash
npm i -D github:RozoAI/fe-gate#v0.1.0 @playwright/test
mkdir -p e2e/pages
```

`e2e/pages/playwright.config.ts`
```ts
import { gateConfig } from "@rozoai/fe-gate";
export default gateConfig({ baseURL: process.env.GATE_BASE_URL ?? "http://localhost:3000", webServerCommand: process.env.GATE_BASE_URL ? undefined : "npm run dev" });
```

`e2e/pages/index.spec.ts`
```ts
import { test, expect } from "@playwright/test";
import { collectErrors, expectHydrated, expectNoEmptyHref, installMockEvmWallet } from "@rozoai/fe-gate";

test("home hydrates and links are real", async ({ page }) => {
  const box = collectErrors(page);
  await installMockEvmWallet(page);
  await page.goto("/");
  await expectHydrated(page, box, { title: /Rozo/, pathname: "/" });
  await expectNoEmptyHref(page);
  await expect(page).toHaveScreenshot();
});
```

`.github/workflows/fe-gate.yml`
```yaml
name: fe-gate
on:
  pull_request:
  push:
    branches: [main]
jobs:
  gate:
    uses: RozoAI/fe-gate/.github/workflows/gate.yml@main
    with:
      package-manager: npm
      build-command: npm run build
      unit-command: npm run test:gate
    secrets:
      env-file: ${{ secrets.FE_GATE_ENV }}
```
(YAML note: never put `${{ }}` inside a `{ }` flow mapping — GitHub rejects the file.)

`scripts/gate-checks.ts` (wired to `npm run test:gate`) — page coverage + any registry checks:
```ts
import { uncoveredPages, i18nParity } from "@rozoai/fe-gate";
const problems = [...uncoveredPages("app", "e2e/pages", [/^api\//]), ...i18nParity("messages")];
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
```

Then in the repo's GitHub settings → Branches → require the `gate` check. Copy
`templates/PULL_REQUEST_TEMPLATE.md` to `.github/`.

## The rule for new work
- **New page → new spec** (`e2e/pages/<route>.spec.ts`; CI fails when missing).
- **Bug fix → the failing test is committed before the fix.**
- **Feature flag → both states in one spec.**
- **Copy removed → `forbiddenPhrases()` for the old sentence.**

## Known traps encoded here
HTTP 200 ≠ page correct (assert after hydration); prod builds hide hydration errors (gate runs the
dev server); "User rejected" can be a blocked popup (mock wallet records the request path);
Next 16 drops the space after `</strong>`; `href=""` renders silently; a registry updated in 4 of
5 places passes build and unit tests (`vercelRewriteCoverage`).
