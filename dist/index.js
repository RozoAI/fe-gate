export { gateConfig } from "./config.js";
export { collectErrors, expectHydrated, expectNoEmptyHref, expectPrimaryCta, expectQrNonEmpty, expectBodyExcludes } from "./fixtures/hydrated.js";
export { installMockEvmWallet, mockWalletCalls } from "./fixtures/mockWallet.js";
export { uncoveredPages, i18nParity, vercelRewriteCoverage, scanBuiltHtml, forbiddenPhrases, walk } from "./checks/consistency.js";
