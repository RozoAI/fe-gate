import { devices, type PlaywrightTestConfig } from "@playwright/test";

export interface GateConfigOptions {
  /** Base URL under test. In CI the reusable workflow passes the local dev/prod server URL. */
  baseURL: string;
  /** Command that starts the app locally (omit when testing a deployed URL). */
  webServerCommand?: string;
  /** Directory holding the specs. Default: e2e/pages */
  testDir?: string;
  /** Extra Playwright overrides merged last. */
  overrides?: Partial<PlaywrightTestConfig>;
}

/**
 * Shared Playwright config: desktop Chromium + iPhone-size Chromium, traces on first retry,
 * screenshots compared with a small tolerance so anti-aliasing does not flake.
 */
export function gateConfig(opts: GateConfigOptions): PlaywrightTestConfig {
  const isCI = !!process.env.CI;
  return {
    testDir: opts.testDir ?? "e2e/pages",
    fullyParallel: true,
    forbidOnly: isCI,
    retries: isCI ? 1 : 0,
    reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
    timeout: 45_000,
    expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
    use: {
      baseURL: opts.baseURL,
      trace: "on-first-retry",
      screenshot: "only-on-failure",
      ignoreHTTPSErrors: true,
      // Mac trap: `playwright install` hangs at 100% on some machines; point at a cached
      // chrome-headless-shell instead. Unset in CI (ubuntu installs normally).
      launchOptions: process.env.FE_GATE_CHROMIUM ? { executablePath: process.env.FE_GATE_CHROMIUM } : undefined,
    },
    projects: [
      { name: "desktop", use: { ...devices["Desktop Chrome"] } },
      { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    ],
    webServer: opts.webServerCommand
      ? { command: opts.webServerCommand, url: opts.baseURL, reuseExistingServer: !isCI, timeout: 180_000 }
      : undefined,
    ...opts.overrides,
  };
}
