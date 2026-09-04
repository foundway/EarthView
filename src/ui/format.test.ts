import { describe, expect, it } from "vitest";
import { formatCenterline } from "./format";

describe("formatCenterline", () => {
  it("defaults to miles", () => {
    expect(formatCenterline(1609.344)).toBe("1.0 mi");
  });

  it("uses meters below a kilometer", () => {
    expect(formatCenterline(820, "kilometers")).toBe("820 m");
  });

  it("uses kilometers above a kilometer", () => {
    expect(formatCenterline(1500, "kilometers")).toBe("1.5 km");
  });

  it("drops decimals once the total is large", () => {
    expect(formatCenterline(123_400, "kilometers")).toBe("123 km");
  });

  it("renders a dash when the height is missing", () => {
    expect(formatCenterline(null)).toBe("—");
  });
});
