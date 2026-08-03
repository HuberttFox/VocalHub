import { describe, expect, it } from "vitest";
import { parseDiscoveryQuery } from "@/lib/discover/query";

describe("discovery query", () => {
  it("uses bounded defaults", () => {
    expect(parseDiscoveryQuery({})).toEqual({ success: true, data: { page: 1, pageSize: 24 } });
  });

  it("rejects duplicate and out-of-range values", () => {
    expect(parseDiscoveryQuery({ page: ["1", "2"] })).toEqual({ success: false });
    expect(parseDiscoveryQuery({ page: "0" })).toEqual({ success: false });
    expect(parseDiscoveryQuery({ pageSize: "51" })).toEqual({ success: false });
  });
});
