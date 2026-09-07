/**
 * Injects a minimal EIP-1193 provider as window.ethereum before any app script runs.
 * It answers connect / chain / accounts / sign calls deterministically and records every
 * request on window.__mockWalletCalls so specs can assert the click→request path.
 * No real key, no money: this is for connect/UI-state tests only. Real-money runs use a
 * separate signer fixture (L2).
 */
export async function installMockEvmWallet(page, opts = {}) {
    const cfg = {
        address: opts.address ?? "0x000000000000000000000000000000000000dEaD",
        chainId: opts.chainId ?? 8453,
        rejectConnect: !!opts.rejectConnect,
        rejectSign: !!opts.rejectSign,
        txHash: opts.txHash ?? "0x" + "ab".repeat(32),
    };
    await page.addInitScript((c) => {
        const listeners = {};
        const calls = [];
        window.__mockWalletCalls = calls;
        const hex = (n) => "0x" + n.toString(16);
        const reject = (msg) => Promise.reject(Object.assign(new Error(msg), { code: 4001 }));
        const provider = {
            isMetaMask: true,
            isMockWallet: true,
            selectedAddress: c.address,
            chainId: hex(c.chainId),
            request: async ({ method, params }) => {
                calls.push({ method, params });
                switch (method) {
                    case "eth_requestAccounts":
                        if (c.rejectConnect)
                            return reject("User rejected the request.");
                        return [c.address];
                    case "eth_accounts":
                        return [c.address];
                    case "eth_chainId":
                        return hex(c.chainId);
                    case "net_version":
                        return String(c.chainId);
                    case "wallet_switchEthereumChain":
                    case "wallet_addEthereumChain":
                        return null;
                    case "personal_sign":
                    case "eth_sign":
                    case "eth_signTypedData":
                    case "eth_signTypedData_v4":
                        if (c.rejectSign)
                            return reject("User rejected the request.");
                        return "0x" + "11".repeat(65);
                    case "eth_sendTransaction":
                        if (c.rejectSign)
                            return reject("User rejected the request.");
                        return c.txHash;
                    case "eth_getBalance":
                        return "0x0";
                    default:
                        return null;
                }
            },
            on: (ev, fn) => {
                (listeners[ev] ||= []).push(fn);
                return provider;
            },
            removeListener: (ev, fn) => {
                listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
                return provider;
            },
            emit: (ev, ...a) => (listeners[ev] || []).forEach((f) => f(...a)),
        };
        Object.defineProperty(window, "ethereum", { value: provider, configurable: true, writable: false });
        // EIP-6963 announcement so wagmi/ConnectKit style discovery sees it.
        const info = { uuid: "mock-wallet-0000", name: "Mock Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "ai.rozo.mockwallet" };
        const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
        window.addEventListener("eip6963:requestProvider", announce);
        announce();
    }, cfg);
}
/** Read back the provider calls the page made (assert the click really reached the wallet). */
export async function mockWalletCalls(page) {
    return page.evaluate(() => window.__mockWalletCalls ?? []);
}
