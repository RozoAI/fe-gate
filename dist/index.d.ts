export { gateConfig, type GateConfigOptions } from "./config.js";
export { collectErrors, expectHydrated, expectNoEmptyHref, expectPrimaryCta, expectQrNonEmpty, expectBodyExcludes, type HydratedOptions } from "./fixtures/hydrated.js";
export { installMockEvmWallet, mockWalletCalls, type MockWalletOptions } from "./fixtures/mockWallet.js";
export { uncoveredPages, i18nParity, vercelRewriteCoverage, scanBuiltHtml, forbiddenPhrases, walk } from "./checks/consistency.js";
