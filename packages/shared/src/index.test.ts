import { describe, expect, it } from "vitest";
import { LINGHUN_CLI_NAME, LINGHUN_NAME, LINGHUN_VERSION } from "./index.js";

describe("shared constants", () => {
  it("uses Linghun naming conventions", () => {
    expect(LINGHUN_NAME).toBe("Linghun");
    expect(LINGHUN_CLI_NAME).toBe("linghun");
    expect(LINGHUN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
