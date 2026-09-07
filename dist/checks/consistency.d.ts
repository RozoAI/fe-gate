/** Recursively list files under dir matching a predicate. */
export declare function walk(dir: string, pred: (p: string) => boolean, out?: string[]): string[];
/**
 * Page coverage: every Next.js app-router page must have a spec under specDir.
 * app/foo/bar/page.tsx  ->  e2e/pages/foo/bar.spec.ts  (root page -> e2e/pages/index.spec.ts)
 * Dynamic segments keep their brackets: app/[slug]/page.tsx -> e2e/pages/[slug].spec.ts
 * Returns the list of uncovered routes; empty = pass.
 */
export declare function uncoveredPages(appDir: string, specDir: string, ignore?: RegExp[]): string[];
/**
 * i18n key parity: every locale JSON must have exactly the keys of the reference locale.
 * Works on flat or nested JSON. Returns human-readable problems; empty = pass.
 */
export declare function i18nParity(localesDir: string, reference?: string): string[];
/**
 * Registry ↔ vercel.json rewrite coverage (the InterServer 404 class).
 * `keys` = slugs from the source-of-truth registry; `vercelJsonPath` is read and every
 * rewrite/redirect source is scanned for each slug. Returns slugs with no rewrite.
 */
export declare function vercelRewriteCoverage(keys: string[], vercelJsonPath: string, pattern?: (slug: string) => string): string[];
/** Grep built HTML for known silent-render defects. Returns problems; empty = pass. */
export declare function scanBuiltHtml(outDir: string): string[];
/** Repo-wide grep that must be empty (a phrase that was removed behind a flag but still exists elsewhere). */
export declare function forbiddenPhrases(rootDir: string, phrases: string[], exts?: string[]): string[];
