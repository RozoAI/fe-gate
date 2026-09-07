import { type Page } from "@playwright/test";
export interface HydratedOptions {
    /** Console error substrings that are known and tolerated (third-party noise). Keep short. */
    allowErrors?: (string | RegExp)[];
    /** Expected h1 text (substring match) after hydration. */
    h1?: string | RegExp;
    /** Expected document.title (substring match) after hydration. */
    title?: string | RegExp;
    /** Expected pathname after hydration (catches client-side redirects to the wrong route). */
    pathname?: string | RegExp;
}
/**
 * Attach BEFORE navigation. Collects console errors and page errors so that
 * `expectHydrated` can fail on hydration mismatches and uncaught exceptions.
 */
export declare function collectErrors(page: Page): {
    errors: string[];
};
/**
 * Wait for hydration and assert the page is what it claims to be AFTER hydration.
 * HTTP 200 and a green build prove nothing about the hydrated DOM (lesson 2026-08-18).
 */
export declare function expectHydrated(page: Page, box: {
    errors: string[];
}, opts?: HydratedOptions): Promise<void>;
/** Every anchor must have a non-empty href — the silent `href=""` class (rozo-landing PR #23). */
export declare function expectNoEmptyHref(page: Page): Promise<void>;
/** Primary CTA is visible and links somewhere real. */
export declare function expectPrimaryCta(page: Page, selector: string): Promise<void>;
/** A QR code that rendered but is blank (Stellar C-address incident) — assert non-empty pixels. */
export declare function expectQrNonEmpty(page: Page, selector?: string): Promise<void>;
/** Text that must NOT appear (removed copy, stale flag copy, brand leak). */
export declare function expectBodyExcludes(page: Page, phrases: (string | RegExp)[]): Promise<void>;
