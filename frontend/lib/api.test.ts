import { resolveApiBaseUrl } from "@/lib/api";

describe("resolveApiBaseUrl", () => {
  it("uses an explicit configured API base URL when present", () => {
    expect(resolveApiBaseUrl("http://api.example.test", { protocol: "http:", hostname: "127.0.0.1" })).toBe(
      "http://api.example.test",
    );
  });

  it("derives the API base URL from the current hostname when unset", () => {
    expect(resolveApiBaseUrl(undefined, { protocol: "http:", hostname: "127.0.0.1" })).toBe("http://127.0.0.1:8000");
    expect(resolveApiBaseUrl("", { protocol: "https:", hostname: "localhost" })).toBe("https://localhost:8000");
  });
});
