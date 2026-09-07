import type { Page } from "@playwright/test";
export interface MockWalletOptions {
    /** Checksummed EVM address the mock reports. Deterministic, never funded. */
    address?: string;
    chainId?: number;
    /** When true, `eth_requestAccounts` rejects like a blocked popup / user rejection (code 4001). */
    rejectConnect?: boolean;
    /** When true, `eth_sendTransaction` / signing rejects with 4001. */
    rejectSign?: boolean;
    /** Fake tx hash returned by eth_sendTransaction. */
    txHash?: string;
}
/**
 * Injects a minimal EIP-1193 provider as window.ethereum before any app script runs.
 * It answers connect / chain / accounts / sign calls deterministically and records every
 * request on window.__mockWalletCalls so specs can assert the click→request path.
 * No real key, no money: this is for connect/UI-state tests only. Real-money runs use a
 * separate signer fixture (L2).
 */
export declare function installMockEvmWallet(page: Page, opts?: MockWalletOptions): Promise<void>;
/** Read back the provider calls the page made (assert the click really reached the wallet). */
export declare function mockWalletCalls(page: Page): Promise<Array<{
    method: string;
    params?: unknown;
}>>;
