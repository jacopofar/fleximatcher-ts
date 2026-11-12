import { describe, expect, it } from "vitest";

import { FlexiMatcher } from "../src/index.js";

describe("match diagnostics", () => {
  it("reports a missing literal chunk", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.matches("abc", "[i:zzz]abc");
    expect(result.matching).toBe(false);
    expect(result.diagnostics.missingPart).toEqual({
      index: 0,
      chunk: "[i:zzz]",
    });
    expect(result.diagnostics.warnings).toEqual([]);
  });

  it("reports the part that could not be satisfied and the furthest end", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.matches("abc", "ab[r:\\d+]c", {
      fullyAnnotate: true,
    });
    expect(result.matching).toBe(false);
    expect(result.diagnostics.missingPart).toEqual({
      index: 1,
      chunk: "[r:\\d+]",
    });
    expect(result.diagnostics.furthestEnd).toBe(2);
  });

  it("reports interpretation truncation and budget constraints", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.matches("ab", "[r:a|ab]", {
      matchWhole: false,
      populateResult: true,
      maxInterpretations: 1,
      maxAnnotations: 50,
    });
    expect(result.diagnostics.truncated).toBe(true);
    expect(result.diagnostics.interpretations).toBe(
      result.interpretations?.length,
    );
    expect(result.diagnostics.constraints.maxInterpretations).toBe(1);
    expect(result.diagnostics.constraints.maxAnnotations).toBe(50);
    expect(result.diagnostics.warnings.length).toBeGreaterThan(0);
  });

  it("reports tag closure counters and depth pruning", () => {
    const matcher = new FlexiMatcher({ maximumTagNesting: 1 });
    matcher.addTagRule("letter", "a", { identifier: "id_letter" });
    matcher.addTagRule("letter", "[tag:letter]a", { identifier: "id_more" });

    const result = matcher.matches("aaa", "[tag:letter]", {
      matchWhole: false,
      populateResult: true,
    });
    const tags = result.diagnostics.tags;
    expect(tags.evaluatedTags).toBeGreaterThan(0);
    expect(tags.visitedTags).toBeGreaterThan(0);
    expect(tags.maxDepth).toBe(1);
    expect(tags.prunedByDepth).toBeGreaterThan(0);
    expect(
      result.diagnostics.warnings.some((warning) => warning.includes("pruned")),
    ).toBe(true);
  });

  it("reports aborted budgets as a constraint", () => {
    const matcher = new FlexiMatcher();
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      matcher.matches("x", "x", { signal: controller.signal }),
    ).toThrow();
  });

  it("exposes diagnostics on empty matches", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.matches("", "", { populateResult: true });
    expect(result.matching).toBe(true);
    expect(result.diagnostics.missingPart).toBeNull();
    expect(result.diagnostics.interpretations).toBe(1);
  });
});
