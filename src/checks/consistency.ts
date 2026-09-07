import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/** Recursively list files under dir matching a predicate. */
export function walk(dir: string, pred: (p: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

/**
 * Page coverage: every Next.js app-router page must have a spec under specDir.
 * app/foo/bar/page.tsx  ->  e2e/pages/foo/bar.spec.ts  (root page -> e2e/pages/index.spec.ts)
 * Dynamic segments keep their brackets: app/[slug]/page.tsx -> e2e/pages/[slug].spec.ts
 * Returns the list of uncovered routes; empty = pass.
 */
export function uncoveredPages(appDir: string, specDir: string, ignore: RegExp[] = []): string[] {
  const pages = walk(appDir, (p) => /[\\/]page\.(tsx|jsx|ts|js|mdx)$/.test(p));
  const missing: string[] = [];
  for (const p of pages) {
    const route = relative(appDir, p).replace(/[\\/]page\.\w+$/, "").replace(/\\/g, "/");
    if (ignore.some((r) => r.test(route))) continue;
    const specBase = route === "" ? "index" : route.replace(/\/\([^)]+\)/g, "").replace(/^\([^)]+\)\/?/, "") || "index";
    const candidates = [join(specDir, `${specBase}.spec.ts`), join(specDir, specBase, "index.spec.ts")];
    if (!candidates.some(existsSync)) missing.push(`/${route}  (expected ${relative(process.cwd(), candidates[0])})`);
  }
  return missing;
}

/**
 * i18n key parity: every locale JSON must have exactly the keys of the reference locale.
 * Works on flat or nested JSON. Returns human-readable problems; empty = pass.
 */
export function i18nParity(localesDir: string, reference = "en"): string[] {
  const files = readdirSync(localesDir).filter((f) => f.endsWith(".json"));
  const load = (f: string) => flatten(JSON.parse(readFileSync(join(localesDir, f), "utf8")));
  const refFile = files.find((f) => f === `${reference}.json`);
  if (!refFile) return [`reference locale ${reference}.json not found in ${localesDir}`];
  const ref = load(refFile);
  const problems: string[] = [];
  for (const f of files) {
    if (f === refFile) continue;
    const loc = load(f);
    for (const k of Object.keys(ref)) if (!(k in loc)) problems.push(`${f}: missing key ${k}`);
    for (const k of Object.keys(loc)) if (!(k in ref)) problems.push(`${f}: extra key ${k}`);
    for (const k of Object.keys(ref)) if (k in loc && loc[k] === ref[k] && String(ref[k]).length > 12 && f !== "en.json")
      problems.push(`${f}: key ${k} is identical to ${reference} (untranslated?)`);
  }
  return problems;
}

/**
 * Registry ↔ vercel.json rewrite coverage (the InterServer 404 class).
 * `keys` = slugs from the source-of-truth registry; `vercelJsonPath` is read and every
 * rewrite/redirect source is scanned for each slug. Returns slugs with no rewrite.
 */
export function vercelRewriteCoverage(keys: string[], vercelJsonPath: string, pattern = (slug: string) => `/services/${slug}`): string[] {
  const v = JSON.parse(readFileSync(vercelJsonPath, "utf8"));
  const sources: string[] = [...(v.rewrites ?? []), ...(v.redirects ?? [])].map((r: { source: string }) => r.source);
  return keys.filter((k) => !sources.some((s) => s.includes(pattern(k)) || s.includes(`(${k}`) || s.includes(`|${k}`) || s.includes(`${k}|`) || s.includes(`${k})`)));
}

/** Grep built HTML for known silent-render defects. Returns problems; empty = pass. */
export function scanBuiltHtml(outDir: string): string[] {
  const problems: string[] = [];
  for (const f of walk(outDir, (p) => p.endsWith(".html"))) {
    const html = readFileSync(f, "utf8");
    const rel = relative(process.cwd(), f);
    if (/href=""/.test(html)) problems.push(`${rel}: empty href`);
    if (/\w<\/strong>\w/.test(html)) problems.push(`${rel}: missing space after </strong> (Next 16 trap)`);
    if (!/property="og:image"/.test(html) && !/name="robots"[^>]*noindex/.test(html)) problems.push(`${rel}: no og:image`);
  }
  return problems;
}

/** Repo-wide grep that must be empty (a phrase that was removed behind a flag but still exists elsewhere). */
export function forbiddenPhrases(rootDir: string, phrases: string[], exts = [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".html"]): string[] {
  const hits: string[] = [];
  for (const f of walk(rootDir, (p) => exts.some((e) => p.endsWith(e)))) {
    const txt = readFileSync(f, "utf8");
    for (const ph of phrases) if (txt.includes(ph)) hits.push(`${relative(rootDir, f)}: "${ph}"`);
  }
  return hits;
}

function flatten(obj: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out);
    else out[key] = v;
  }
  return out;
}
