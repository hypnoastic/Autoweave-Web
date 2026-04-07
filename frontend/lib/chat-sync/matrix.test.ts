import { describe, expect, it } from "vitest";

import { normalizeLoopbackBaseUrl } from "@/lib/api";
import { resolveMatrixSyncBaseUrl } from "@/lib/chat-sync/matrix";

describe("Matrix loopback URL normalization", () => {
  it("matches the current browser host for loopback URLs", () => {
    const currentLocation = {
      protocol: "http:",
      hostname: "127.0.0.1",
    } as Pick<Location, "protocol" | "hostname">;

    expect(normalizeLoopbackBaseUrl("http://localhost:8008", currentLocation)).toBe("http://127.0.0.1:8008");
  });

  it("keeps non-loopback Matrix URLs unchanged", () => {
    expect(resolveMatrixSyncBaseUrl("https://matrix.example.com")).toBe("https://matrix.example.com");
  });
});
