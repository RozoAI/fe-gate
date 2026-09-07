import { devices } from "@playwright/test";
/**
 * Shared Playwright config: desktop Chromium + iPhone-size Chromium, traces on first retry,
 * screenshots compared with a small tolerance so anti-aliasing does not flake.
 */
export function gateConfig(opts) {
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
