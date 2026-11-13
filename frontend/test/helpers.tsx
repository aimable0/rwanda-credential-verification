import { render } from "@testing-library/react";
import { vi } from "vitest";
import App from "../src/App";

export const API = "http://localhost:4000/api";
export const HEC_WALLET = "0x1111111111111111111111111111111111111111";
export const UNIVA_WALLET = "0x2222222222222222222222222222222222222222";
export const OTHER_WALLET = "0x3333333333333333333333333333333333333333";

type Handler = { status?: number; body: unknown } | ((init?: RequestInit) => { status?: number; body: unknown });

/**
 * Replaces fetch with canned answers keyed by "METHOD /path" (query string ignored).
 * Unknown requests fail the test loudly instead of hanging.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${(init?.method ?? "GET").toUpperCase()} ${url.pathname.replace("/api", "")}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request in test: ${key}`);
    const { status = 200, body } = typeof handler === "function" ? handler(init) : handler;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Default answers for the two requests the app makes on every page load. */
export function baseRoutes(institutions: unknown[] = []): Record<string, Handler> {
  return {
    "GET /health": {
      body: { status: "ok", contractAddress: "0xC0FFEE", hecAddress: HEC_WALLET },
    },
    "GET /institutions": { body: institutions },
  };
}

/** A MetaMask stand-in that reports `account` as already connected. */
export function connectWallet(account: string) {
  (window as any).ethereum = {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
      if (method === "eth_chainId") return "0xaa36a7";
      throw new Error(`Unexpected MetaMask call in test: ${method}`);
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
}

/** Pretends the wallet already signed in, so no signature prompt is needed. */
export function signedIn(account: string) {
  sessionStorage.setItem("auth", JSON.stringify({ token: "test-token", wallet: account }));
}

export function institution(overrides: Record<string, unknown> = {}) {
  return {
    institution_id: 1,
    code: "UNIVA",
    name: "University A",
    institution_type: "UNIVERSITY",
    wallet_address: UNIVA_WALLET,
    accreditation_status: "ACCREDITED",
    ...overrides,
  };
}

export function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

/** Body of the first request made to `pathname`, parsed from JSON. */
export function sentBody(fetchMock: ReturnType<typeof mockApi>, pathname: string) {
  const call = fetchMock.mock.calls.find(([u]) => String(u).includes(pathname));
  return call ? JSON.parse(String(call[1]?.body)) : undefined;
}
