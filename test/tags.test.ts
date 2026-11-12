import { describe, expect, it } from "vitest";

import {
  AnnotationError,
  FlexiMatcher,
  MaxNestingError,
  PatternError,
  RuleDefinition,
  UnknownTagError,
} from "../src/index.js";

describe("tags", () => {
  it("matches a simple tag and builds an annotation from a native template", () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule("fruit", "pear", {
      identifier: "id_pear",
      template: { fruitName: "pear" },
    });
    matcher.addTagRule("fruit", "a [tag:fruit]", {
      identifier: "id_a_fruit",
      template: {
        fruitName: "${1.fruitName}",
        article: "${0}",
      },
    });

    const result = matcher.matches(
      "the dog eats a pear",
      "the dog eats [tag:fruit]",
      {
        populateResult: true,
      },
    );
    expect(result.matching).toBe(true);
    const interpretation = result.interpretations?.[0];
    expect(interpretation).toBeDefined();
    const tag = interpretation?.[interpretation.length - 1];
    expect(tag?.type).toBe("[tag:fruit]");
    expect(tag?.data).toEqual({ fruitName: "pear", article: "a " });

    expect(matcher.matches("pear", "[tag:fruit]").matching).toBe(true);
    expect(matcher.matches("a pear", "[tag:fruit]").matching).toBe(true);
  });

  it("supports lenient JSON string templates and both placeholder positions", () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule("fruit", "pear", {
      identifier: "id_pear",
      template: "{'name':'pear','kind':'fruit'}",
    });
    matcher.addTagRule("fruit", "a [tag:fruit]", {
      identifier: "id_a_fruit",
      template: "{'inner':${1.name},'article':'${0}','kind':'${1.kind}'}",
    });

    const result = matcher.matches("a pear", "[tag:fruit]", {
      populateResult: true,
    });
    const tag = result.interpretations?.[0]?.[0];
    expect(tag?.data).toEqual({ inner: "pear", article: "a ", kind: "fruit" });
  });

  it("preserves non-string values with exact native placeholders", () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule("digit", "4", {
      identifier: "id_digit",
      template: { value: 4, words: ["four"] },
    });
    matcher.addTagRule("pair", "[tag:digit]2", {
      identifier: "id_pair",
      template: {
        value: "${0.value}",
        words: "${0.words}",
      },
    });

    const result = matcher.matches("42", "[tag:pair]", {
      populateResult: true,
    });
    const tag = result.interpretations?.[0]?.[0];
    expect(tag?.data).toEqual({ value: 4, words: ["four"] });
  });

  it("supports function templates", () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule("word", "[r:[a-z]+]", {
      identifier: "id_word",
      template: ({ sequence, text, covered }) => ({
        text: covered(0),
        upper: text.slice(sequence[0].start, sequence[0].end).toUpperCase(),
        length: sequence.length,
      }),
    });

    const result = matcher.matches("hello", "[tag:word]", {
      populateResult: true,
    });
    const tags = (result.interpretations ?? []).map(
      (sequence) => sequence[0]?.data,
    );
    expect(tags).toContainEqual({ text: "hello", upper: "HELLO", length: 1 });
  });

  it("adds explanations when requested", () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule("fruit", "pear", {
      identifier: "id_pear",
      template: { name: "pear" },
    });
    matcher.addTagRule("fruit", "a [tag:fruit]", {
      identifier: "id_a_fruit",
      template: { article: "${0}" },
    });

    const result = matcher.matches("a pear", "[tag:fruit]", {
      populateResult: true,
      explain: true,
    });
    const tag = result.interpretations?.[0]?.[0];
    const data = tag?.data as Record<string, unknown>;
    expect(data.__explain).toMatchObject({
      id: "id_a_fruit",
      children: [
        { start: 0, end: 2, type: "a " },
        {
          start: 2,
          end: 6,
          type: "[tag:fruit]",
          __explain: { id: "id_pear" },
        },
      ],
    });
  });

  it("supports recursive tags up to the nesting limit", () => {
    const matcher = new FlexiMatcher({ maximumTagNesting: 1 });
    matcher.addTagRule("loop", "y", { identifier: "base" });
    matcher.addTagRule("loop", "x [tag:loop]", { identifier: "recursive" });

    const result = matcher.matches("x x y", "[tag:loop]", {
      matchWhole: false,
      populateResult: true,
    });
    const strings = new Set(result.matchingStrings("x x y"));
    expect(strings).toContain("y");
    expect(strings).toContain("x y");
    expect(strings).not.toContain("x x y");
  });

  it("can throw when the nesting limit is reached", () => {
    const matcher = new FlexiMatcher({
      maximumTagNesting: 1,
      throwOnMaxDepth: true,
    });
    matcher.addTagRule("loop", "y", { identifier: "base" });
    matcher.addTagRule("loop", "x [tag:loop]", { identifier: "recursive" });

    expect(() =>
      matcher.matches("x x y", "[tag:loop]", {
        matchWhole: false,
        populateResult: true,
      }),
    ).toThrow(MaxNestingError);
  });

  it("supports mutually recursive tags without looping forever", () => {
    const matcher = new FlexiMatcher({ maximumTagNesting: 3 });
    matcher.addTagRule("a", "an [tag:b]", { identifier: "a_rec" });
    matcher.addTagRule("a", "apple", { identifier: "a_base" });
    matcher.addTagRule("b", "a [tag:a]", { identifier: "b_rec" });
    matcher.addTagRule("b", "pear", { identifier: "b_base" });

    expect(matcher.matches("an a apple", "[tag:a]").matching).toBe(true);
    expect(matcher.matches("a an pear", "[tag:b]").matching).toBe(true);
  });

  it("removes and clears tag productions", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.addTagRule("fruit", "pear", { identifier: "id_pear" })).toBe(
      false,
    );
    expect(matcher.tagNames).toContain("fruit");
    expect(matcher.tagDefinitions("fruit")).toHaveLength(1);
    expect(matcher.getTagRule("fruit", "id_pear")?.pattern).toBe("pear");

    expect(
      matcher.addTagRule("fruit", "apple", { identifier: "id_pear" }),
    ).toBe(true);
    expect(matcher.tagDefinitions("fruit")).toHaveLength(1);
    expect(matcher.getTagRule("fruit", "id_pear")?.pattern).toBe("apple");

    expect(matcher.removeTagRule("fruit", "id_pear")).toBe(true);
    expect(matcher.tagNames).not.toContain("fruit");
    expect(() => matcher.removeTagRule("fruit", "id_pear")).toThrow(
      UnknownTagError,
    );

    matcher.addTagRule("fruit", "pear", { identifier: "id_pear" });
    matcher.clearTags();
    expect(matcher.tagNames).toEqual([]);
  });

  it("combines tags through or and repeat", () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule("fruit", "pear", { identifier: "id_pear" });
    matcher.addTagRule("animal", "cat", { identifier: "id_cat" });
    matcher.addTagRule("thing", "[or:[tag:fruit]|[tag:animal]]", {
      identifier: "id_thing",
    });
    expect(matcher.matches("pear", "[tag:thing]").matching).toBe(true);
    expect(matcher.matches("cat", "[tag:thing]").matching).toBe(true);
    expect(matcher.matches("dog", "[tag:thing]").matching).toBe(false);

    matcher.addTagRule("fruits", "[repeat:[tag:fruit]]", {
      identifier: "id_fruits",
    });
    expect(matcher.matches("pearpear", "[tag:fruits]").matching).toBe(true);
    expect(matcher.matches("pearpearpear", "[tag:fruits]").matching).toBe(true);
  });

  it("applies schemas to generated tag data", () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule<{ value: number }>("number", "[r:\\d+]", {
      identifier: "id_number",
      template: ({ covered }) => ({ value: Number(covered(0)) }),
      schema: (data) => {
        const value = (data as { value?: unknown }).value;
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error("invalid number annotation");
        }
        return { value };
      },
    });
    const result = matcher.matches("42", "[tag:number]", {
      populateResult: true,
    });
    const data = result.store
      .ofType<{ value: number }>("[tag:number]")
      .find(
        (annotation) => annotation.start === 0 && annotation.end === 2,
      )?.data;
    expect(data?.value).toBe(42);

    matcher.addTagRule("bad", "[r:\\d+]", {
      identifier: "id_bad",
      template: ({ covered }) => ({ value: covered(0) }),
      schema: () => {
        throw new Error("rejected");
      },
    });
    expect(() => matcher.matches("42", "[tag:bad]")).toThrow(AnnotationError);
  });

  it("supports custom rules that internally use tags", () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule("fruit", "pear", {
      identifier: "id_pear",
      template: { lemma: "pear" },
    });

    matcher.bind("delegate", {
      usesTags: true,
      getRule() {
        return {
          annotate(text, annotator) {
            const result = annotator.match(text, "[tag:fruit]", {
              matchWhole: true,
            });
            if (result.matching) {
              annotator.add(0, text.length, { ok: true });
            }
            return false;
          },
        };
      },
      generateSample: () => null,
    });

    matcher.addTagRule("wrapper", "[delegate]", {
      identifier: "id_wrapper",
      template: { wrapped: true },
    });

    expect(matcher.matches("pear", "[tag:wrapper]").matching).toBe(true);
  });

  it("accepts a template without an identifier", () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule("fruit", "pear", { template: { name: "pear" } });
    expect(matcher.tagDefinitions("fruit")[0]?.identifier).toBeNull();
    const result = matcher.matches("pear", "[tag:fruit]", {
      populateResult: true,
    });
    expect(result.interpretations?.[0]?.[0]?.data).toEqual({ name: "pear" });
  });

  it("accepts RuleDefinition objects", () => {
    const matcher = new FlexiMatcher();
    const definition = new RuleDefinition("pear", {
      identifier: "id_pear",
      template: { name: "pear" },
    });
    expect(matcher.addTagDefinition("fruit", definition)).toBe(false);
    expect(matcher.getTagRule("fruit", "id_pear")).toBe(definition);

    const result = matcher.matches("pear", "[tag:fruit]", {
      populateResult: true,
    });
    expect(result.interpretations?.[0]?.[0]?.data).toEqual({ name: "pear" });
  });

  it("rejects direct self-reference and empty productions", () => {
    const matcher = new FlexiMatcher();
    expect(() => matcher.addTagRule("fruit", "[tag:fruit]")).toThrow(
      PatternError,
    );
    expect(() => matcher.addTagRule("fruit", "")).toThrow(PatternError);
    expect(() => matcher.addTagRule("", "pear")).toThrow(PatternError);
  });

  it("does not match unknown tags", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("pear", "[tag:fruit]").matching).toBe(false);
    expect(() => matcher.matches("pear", "[tag:]")).toThrow(PatternError);
  });

  it("generates samples for tags", () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule("single", "abc", { identifier: "id" });
    expect(matcher.generateSample("[tag:single]")).toBe("abc");
    expect(matcher.generateSample("[tag:missing]")).toBe("[tag:missing]");
  });

  it("rejects missing template paths", () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule("fruit", "pear", {
      identifier: "id_pear",
      template: { name: "pear" },
    });
    matcher.addTagRule("fruit", "a [tag:fruit]", {
      identifier: "id_a_fruit",
      template: { missing: "${1.nope}" },
    });
    expect(() =>
      matcher.matches("a pear", "[tag:fruit]", { populateResult: true }),
    ).toThrow(AnnotationError);
  });
});
