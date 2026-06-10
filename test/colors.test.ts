import { describe, it, expect } from "vitest";
import { visibleLength, padVisible, scoreBar } from "../src/lib/colors.js";

describe("visibleLength", () => {
  it("counts plain characters", () => {
    expect(visibleLength("abc")).toBe(3);
  });

  it("ignores ANSI escape codes", () => {
    expect(visibleLength("\x1b[31mabc\x1b[39m")).toBe(3);
  });
});

describe("padVisible", () => {
  it("right-pads to the target visible width", () => {
    expect(padVisible("ab", 5)).toBe("ab   ");
  });

  it("does not truncate strings already at/over width", () => {
    expect(padVisible("abcdef", 4)).toBe("abcdef");
  });

  it("pads based on visible (ANSI-stripped) width", () => {
    const s = "\x1b[31mab\x1b[39m";
    expect(visibleLength(padVisible(s, 5))).toBe(5);
  });
});

describe("scoreBar", () => {
  it("renders a 10-cell bar", () => {
    // colors are disabled in the non-TTY test env, so output is plain.
    expect(visibleLength(scoreBar(8))).toBe(10);
  });

  it("fills proportionally to the score", () => {
    expect(scoreBar(10)).toBe("█".repeat(10));
    expect(scoreBar(0)).toBe("░".repeat(10));
    expect(scoreBar(5)).toBe("█".repeat(5) + "░".repeat(5));
  });

  it("clamps out-of-range scores", () => {
    expect(scoreBar(99)).toBe("█".repeat(10));
    expect(scoreBar(-5)).toBe("░".repeat(10));
  });
});
