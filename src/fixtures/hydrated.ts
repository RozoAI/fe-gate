import { expect, type Page, type ConsoleMessage } from "@playwright/test";

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

const HYDRATION_SIGNATURES = [
  /Minified React error #4(18|19|22|23|25)/, // hydration mismatch family
  /Hydration failed/i,
  /Text content does not match/i,
  /did not match.*server/i,
];

/**
 * Attach BEFORE navigation. Collects console errors and page errors so that
 * `expectHydrated` can fail on hydration mismatches and uncaught exceptions.
 */
export function collectErrors(page: Page): { errors: string[] } {
  const box = { errors: [] as string[] };
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") box.errors.push(m.text());
  });
  page.on("pageerror", (e) => box.errors.push(`pageerror: ${e.message}`));
  return box;
}

/**
 * Wait for hydration and assert the page is what it claims to be AFTER hydration.
 * HTTP 200 and a green build prove nothing about the hydrated DOM (lesson 2026-08-18).
 */
export async function expectHydrated(page: Page, box: { errors: string[] }, opts: HydratedOptions = {}) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // Next.js marks hydration completion by attaching React; give the client a beat.
  await page.waitForTimeout(300);

  const allowed = opts.allowErrors ?? [];
  const isAllowed = (e: string) => allowed.some((a) => (a instanceof RegExp ? a.test(e) : e.includes(a)));
  const hydration = box.errors.filter((e) => HYDRATION_SIGNATURES.some((r) => r.test(e)));
  expect(hydration, `hydration errors:\n${hydration.join("\n")}`).toEqual([]);
  const other = box.errors.filter((e) => !isAllowed(e) && !HYDRATION_SIGNATURES.some((r) => r.test(e)));
  expect(other, `console/page errors:\n${other.join("\n")}`).toEqual([]);

  if (opts.title) await expect(page).toHaveTitle(opts.title instanceof RegExp ? opts.title : new RegExp(escape(opts.title)));
  if (opts.h1) await expect(page.locator("h1").first()).toContainText(opts.h1);
  if (opts.pathname) {
    const p = new URL(page.url()).pathname;
    if (opts.pathname instanceof RegExp) expect(p).toMatch(opts.pathname);
    else expect(p).toBe(opts.pathname);
  }
}

/** Every anchor must have a non-empty href — the silent `href=""` class (rozo-landing PR #23). */
export async function expectNoEmptyHref(page: Page) {
  const bad = await page.$$eval("a", (as) =>
    as.filter((a) => !a.getAttribute("href") || a.getAttribute("href") === "#").map((a) => a.outerHTML.slice(0, 120)),
  );
  expect(bad, `anchors with empty href:\n${bad.join("\n")}`).toEqual([]);
}

/** Primary CTA is visible and links somewhere real. */
export async function expectPrimaryCta(page: Page, selector: string) {
  const cta = page.locator(selector).first();
  await expect(cta).toBeVisible();
  const href = await cta.getAttribute("href");
  if (href !== null) expect(href.trim().length, `CTA ${selector} has empty href`).toBeGreaterThan(0);
}

/** A QR code that rendered but is blank (Stellar C-address incident) — assert non-empty pixels. */
export async function expectQrNonEmpty(page: Page, selector = "canvas, svg[data-qr], img[alt*='QR' i]") {
  const el = page.locator(selector).first();
  await expect(el).toBeVisible();
  const nonEmpty = await el.evaluate((node) => {
    if (node instanceof HTMLCanvasElement) {
      const ctx = node.getContext("2d");
      if (!ctx) return false;
      const d = ctx.getImageData(0, 0, node.width, node.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 3] > 0) dark++;
      return dark > 50;
    }
    if (node instanceof SVGElement) return node.querySelectorAll("rect, path").length > 20;
    if (node instanceof HTMLImageElement) return node.naturalWidth > 0 && !!node.src;
    return false;
  });
  expect(nonEmpty, "QR rendered but empty").toBe(true);
}

/** Text that must NOT appear (removed copy, stale flag copy, brand leak). */
export async function expectBodyExcludes(page: Page, phrases: (string | RegExp)[]) {
  const body = await page.locator("body").innerText();
  for (const p of phrases) {
    if (p instanceof RegExp) expect(body).not.toMatch(p);
    else expect(body, `forbidden phrase present: ${p}`).not.toContain(p);
  }
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
