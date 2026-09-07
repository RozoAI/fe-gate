import { type PlaywrightTestConfig } from "@playwright/test";
export interface GateConfigOptions {
    /** Base URL under test. In CI the reusable workflow passes the local dev/prod server URL. */
    baseURL: string;
    /** Command that starts the app locally (omit when testing a deployed URL). */
    webServerCommand?: string;
    /** Spec directory, relative to the config file. Default "." (config lives in e2e/pages/). */
    testDir?: string;
    /** Extra Playwright overrides merged last. */
    overrides?: Partial<PlaywrightTestConfig>;
}
/**
 * Shared Playwright config: desktop Chromium + iPhone-size Chromium, traces on first retry,
 * screenshots compared with a small tolerance so anti-aliasing does not flake.
 */
export declare function gateConfig(opts: GateConfigOptions): PlaywrightTestConfig;
