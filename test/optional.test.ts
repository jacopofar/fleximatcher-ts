import { describe, expect, it } from "vitest";

import {
  FlexiMatcher,
  PatternError,
  usedTags,
  usesOptional,
} from "../src/index.js";

describe("optional combinator", () => {
  it("matches with and without the optional part", () => {
    const matcher = new FlexiMatcher();
    const pattern = "[i:a][ws][optional:[i:b][ws]][i:c]";
    expect(matcher.matches("a c", pattern).matching).toBe(true);
    expect(matcher.matches("a b c", pattern).matching).toBe(true);
    expect(matcher.matches("a b d", pattern).matching).toBe(false);
  });

  it("keeps both interpretations when the optional part is present", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.matches("a b", "[i:a][optional:[ws][i:b]]", {
      matchWhole: false,
      populateResult: true,
    });
    expect(result.matching).toBe(true);
    const lengths = new Set(
      (result.interpretations ?? []).map((sequence) => sequence.length),
    );
    expect(lengths.has(1)).toBe(true); // "a" alone
    expect(lengths.has(2)).toBe(true); // "a" + the optional wrapper
  });

  it("works at the start and at the end of a pattern", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("b", "[optional:[i:a][ws]][i:b]").matching).toBe(
      true,
    );
    expect(matcher.matches("a b", "[optional:[i:a][ws]][i:b]").matching).toBe(
      true,
    );
    expect(matcher.matches("a", "[i:a][optional:[ws][i:b]]").matching).toBe(
      true,
    );
    expect(matcher.matches("a b", "[i:a][optional:[ws][i:b]]").matching).toBe(
      true,
    );
  });

  it("matches an empty text when the whole pattern is optional", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("", "[optional:[i:a]]").matching).toBe(true);
    expect(matcher.matches("a", "[optional:[i:a]]").matching).toBe(true);
    expect(matcher.matches("aa", "[optional:[i:a]]").matching).toBe(false);
  });

  it("does not treat a missing optional part as a diagnostic failure", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.matches(
      "a c",
      "[i:a][ws][optional:[i:b][ws]][i:c]",
      { populateResult: true },
    );
    expect(result.matching).toBe(true);
    expect(result.diagnostics.missingPart).toBeNull();
  });

  it("composes with repeat, tags and nested optionals", () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule("letter", "[i:x]", { identifier: "id_x" });
    expect(
      matcher.matches(
        "a x x b",
        "[i:a][ws][optional:[repeat:[tag:letter][ws]]][i:b]",
      ).matching,
    ).toBe(true);
    expect(
      matcher.matches(
        "a x y b",
        "[i:a][ws][optional:[repeat:[tag:letter][ws]]][i:b]",
      ).matching,
    ).toBe(false);
    expect(
      matcher.matches("a b", "[i:a][ws][optional:[optional:[i:x][ws]]][i:b]")
        .matching,
    ).toBe(true);
  });

  it("respects maxInterpretations", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.matches(
      "a b c",
      "[i:a][ws][optional:[i:b][ws]][i:c]",
      { populateResult: true, maxInterpretations: 1 },
    );
    expect(result.matching).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.interpretations?.length).toBeLessThanOrEqual(1);
  });

  it("generates a sample from the inner pattern", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.generateSample("[optional:[i:ha]]").toLowerCase()).toBe(
      "ha",
    );
  });

  it("recurses into usedTags", () => {
    expect([...usedTags("[optional:[tag:fruit]]")]).toEqual(["fruit"]);
    expect(usesOptional("[or:[i:a]|[optional:[i:b]]]")).toBe(true);
    expect(usesOptional("[i:a][i:b]")).toBe(false);
  });

  it("rejects positional templates in tag productions with optional chunks", () => {
    const matcher = new FlexiMatcher();
    expect(() =>
      matcher.addTagRule("thing", "[i:a][ws][optional:[i:b]]", {
        template: { value: "${0}" },
      }),
    ).toThrow(PatternError);

    expect(() =>
      matcher.addTagRule("thing", "[i:a][ws][optional:[i:b]]", {
        template: ({ sequence }) => ({ length: sequence.length }),
      }),
    ).not.toThrow();
  });
});

describe("ws rule", () => {
  it("annotates whitespace runs", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("a   b", "[i:a][ws][i:b]").matching).toBe(true);
    expect(matcher.matches("a\n\tb", "[i:a][ws][i:b]").matching).toBe(true);
    expect(matcher.matches("ab", "[i:a][ws][i:b]").matching).toBe(false);

    const result = matcher.matches("a   b", "[i:a][ws][i:b]", {
      populateResult: true,
    });
    const spans = result.store
      .ofType("[ws]")
      .map((annotation) => `${annotation.start}:${annotation.end}`);
    expect(spans).toEqual(["1:4"]);
  });
});

describe("word rule", () => {
  it("matches whole words and ignores substrings", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.contains("nonostante", "[word:non]")).toBe(false);
    expect(matcher.contains("non sono", "[word:non]")).toBe(true);
    expect(matcher.contains("Non sono", "[word:non]")).toBe(true);
  });

  it("exposes Italian elisions as pieces", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("l'uomo", "[word:l'uomo]").matching).toBe(true);
    expect(matcher.contains("l'uomo", "[word:uomo]")).toBe(true);
    expect(matcher.contains("l'uomo", "[word:l']")).toBe(true);
  });

  it("matches a truncation with its apostrophe", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.contains("un po'", "[word:po']")).toBe(true);
  });

  it("rejects empty, spaced and letterless parameters", () => {
    const matcher = new FlexiMatcher();
    expect(() => matcher.matches("x", "[word:]")).toThrow();
    expect(() => matcher.matches("x", "[word:due parole]")).toThrow();
    expect(() => matcher.matches("x", "[word:123]")).toThrow();
  });
});
