import { describe, expect, it } from "vitest";

import { FlexiMatcher, readTagsFromTsvLines, readTagsFromTsvText } from "../src/index.js";

describe("TSV loading", () => {
  it("loads two, three and four-column productions", () => {
    const matcher = new FlexiMatcher();
    const inserted = readTagsFromTsvText(
      [
        "# a comment",
        "",
        "fruit\tpear",
        "fruit\tan [tag:fruit]\t{'article':'${0}'}",
        "fruit\ta [tag:fruit]\tid_a_fruit\t{'article':'${0}'}",
      ].join("\n"),
      matcher,
      "dataset",
    );

    expect(inserted).toBe(3);
    expect(matcher.tagNames).toEqual(["fruit"]);
    expect(matcher.tagDefinitions("fruit")).toHaveLength(3);
    expect(matcher.getTagRule("fruit", "dataset_3")?.pattern).toBe("pear");
    expect(matcher.getTagRule("fruit", "dataset_4")?.pattern).toBe("an [tag:fruit]");
    expect(matcher.getTagRule("fruit", "id_a_fruit")?.pattern).toBe("a [tag:fruit]");

    const result = matcher.matches("a pear", "[tag:fruit]", { populateResult: true });
    expect(result.matching).toBe(true);
    expect(result.interpretations?.[0]?.[0]?.data).toEqual({ article: "a " });
  });

  it("counts replaced productions instead of insertions", () => {
    const matcher = new FlexiMatcher();
    const lines = ["fruit\tpear\tid_pear\t"];
    expect(readTagsFromTsvLines(lines, matcher, "first")).toBe(1);
    expect(readTagsFromTsvLines(lines, matcher, "second")).toBe(0);
    expect(matcher.tagDefinitions("fruit")).toHaveLength(1);
  });

  it("treats an empty template column as no annotation", () => {
    const matcher = new FlexiMatcher();
    readTagsFromTsvText("fruit\tpear\tid_pear\t", matcher, "dataset");
    const result = matcher.matches("pear", "[tag:fruit]", { populateResult: true });
    expect(result.interpretations?.[0]?.[0]?.data).toBeUndefined();
  });

  it("rejects lines with an impossible number of columns", () => {
    const matcher = new FlexiMatcher();
    expect(() => readTagsFromTsvText("only-one-column", matcher, "dataset")).toThrow(
      /expected 2/,
    );
    expect(() =>
      readTagsFromTsvText("a\tb\tc\td\te", matcher, "dataset"),
    ).toThrow(/5 columns/);
  });
});
