import { describe, expect, it } from "vitest";
import { decidePermission } from "./permissions.js";

describe("decidePermission", () => {
  it("always allows read tools", () => {
    for (const mode of ["ask", "assist", "build", "autonomous"] as const) {
      expect(decidePermission({ mode, category: "read" })).toBe("allow");
    }
  });

  it("denies writes in ask mode", () => {
    expect(decidePermission({ mode: "ask", category: "write" })).toBe("deny");
  });

  it("requires approval for writes in assist mode", () => {
    expect(decidePermission({ mode: "assist", category: "write" })).toBe("approve");
  });

  it("allows writes in build and autonomous mode", () => {
    expect(decidePermission({ mode: "build", category: "write" })).toBe("allow");
    expect(decidePermission({ mode: "autonomous", category: "write" })).toBe("allow");
  });

  it("always requires approval for dangerous commands, even in autonomous mode", () => {
    expect(decidePermission({ mode: "autonomous", category: "execution", dangerous: true })).toBe("approve");
  });

  it("always requires approval for tools that cost money, even in autonomous mode and for read-category tools", () => {
    for (const mode of ["ask", "assist", "build", "autonomous"] as const) {
      expect(decidePermission({ mode, category: "generation", costsMoney: true })).toBe("approve");
      expect(decidePermission({ mode, category: "read", costsMoney: true })).toBe("approve");
    }
  });
});
