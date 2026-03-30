import { AuthSessionError, fetchDashboard, resolveApiBaseUrl, writeSession } from "@/lib/api";

describe("request auth handling", () => {
  const storage = (() => {
    const store = new Map<string, string>();
    return {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(() => {
        store.clear();
      }),
    };
  })();

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
    });
    storage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    storage.clear();
  });

  it("clears the saved session and raises AuthSessionError on 401", async () => {
    writeSession({
      token: "stale-token",
      user: {
        id: "user_1",
        github_login: "octocat",
        display_name: "Octo Cat",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => '{"detail":"Invalid session token"}',
      }),
    );

    await expect(fetchDashboard("stale-token")).rejects.toBeInstanceOf(AuthSessionError);
    expect(window.localStorage.getItem("autoweave-web-session")).toBeNull();
  });
});

describe("resolveApiBaseUrl", () => {
  it("uses an explicit configured API base URL when present", () => {
    expect(resolveApiBaseUrl("http://api.example.test", { protocol: "http:", hostname: "127.0.0.1" })).toBe(
      "http://api.example.test",
    );
  });

  it("normalizes configured loopback URLs to the current browser host", () => {
    expect(resolveApiBaseUrl("http://localhost:8000", { protocol: "http:", hostname: "127.0.0.1" })).toBe(
      "http://127.0.0.1:8000",
    );
    expect(resolveApiBaseUrl("https://127.0.0.1:9000", { protocol: "https:", hostname: "localhost" })).toBe(
      "https://localhost:9000",
    );
  });

  it("derives the API base URL from the current hostname when unset", () => {
    expect(resolveApiBaseUrl(undefined, { protocol: "http:", hostname: "127.0.0.1" })).toBe("http://127.0.0.1:8000");
    expect(resolveApiBaseUrl("", { protocol: "https:", hostname: "localhost" })).toBe("https://localhost:8000");
  });
});
