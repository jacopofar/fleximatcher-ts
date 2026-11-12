import { describe, expect, it } from "vitest";

import {
  AnnotationStore,
  type Annotator,
  BudgetExceededError,
  CompiledPattern,
  FlexiMatcher,
  MatchResult,
  PatternError,
  RuleError,
  UnknownMacroError,
  UnknownRuleError,
} from "../src/index.js";

describe("built-in rules", () => {
  it("matches literal text and the case-insensitive rule", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("AbC", "AbC").matching).toBe(true);
    expect(matcher.matches("AbC", "A[i:B]C").matching).toBe(true);
    expect(matcher.matches("AbC", "ABC").matching).toBe(false);
    expect(matcher.contains("xxAbCxx", "A[i:B]C")).toBe(true);
  });

  it("matches regular expressions", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("AbC", "AbC").matching).toBe(true);
    expect(matcher.matches("AbC", "A[r:[BD]+]C").matching).toBe(false);
    expect(matcher.matches("AbC", "A[r:[bD]+]C").matching).toBe(true);
    expect(matcher.matches("AbC", "[r:[KAb]{2}]C").matching).toBe(true);
    expect(matcher.matches("AbC", "[r:[AbD]{2}]C").matching).toBe(true);

    // A regex can match a substring of the text when matchWhole is false.
    expect(
      matcher.matches("AbC", "A[i:b][r:k]", { populateResult: true }).matching,
    ).toBe(false);
    expect(
      matcher.matches("AbC", "A[i:b][r:[cC]]", { populateResult: true })
        .matching,
    ).toBe(true);
    expect(
      matcher.matches("eeAbC", "A[i:b][r:[cC]]", {
        matchWhole: false,
        populateResult: true,
      }).matching,
    ).toBe(true);
  });

  it("rejects empty and invalid regex parameters", () => {
    const matcher = new FlexiMatcher();
    expect(() => matcher.matches("eeAbC", "A[i:b][r]")).toThrow(RuleError);
    expect(() => matcher.matches("eeAbC", "A[i:b][r]")).toThrow(
      /Cannot create a regex annotator/,
    );
    expect(() => matcher.matches("x", "[r:(]")).toThrow(RuleError);
    expect(() => matcher.matches("x", "[r:(]")).toThrow(
      /Invalid regular expression/,
    );
  });

  it("does not explode on regexes that match the empty string", () => {
    const matcher = new FlexiMatcher();
    expect(() => matcher.matches("eeAbC", "A[i:b][r:k?]")).not.toThrow();
  });

  it("annotates every alternative length of a regex", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.matches("ab", "[r:a|ab]", { populateResult: true });
    expect(result.matching).toBe(true);
    expect(
      new Set(
        result.store
          .ofType("[r:a|ab]")
          .map((annotation) => `${annotation.start}:${annotation.end}`),
      ),
    ).toEqual(new Set(["0:1", "0:2"]));
    // Only the interpretation ending at the end of the text covers it.
    expect(result.interpretations).toHaveLength(1);
    expect(result.interpretations?.[0]?.[0]?.end).toBe(2);
  });

  it("matches multi as an intersection of sub-patterns", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("AbC", "A[r:[bD]+]C").matching).toBe(true);
    expect(matcher.matches("AbC", "A[multi:[r:[bD]+][i:B]]C").matching).toBe(
      true,
    );
    expect(matcher.matches("AbC", "A[r:[BD]+]C").matching).toBe(false);
    expect(matcher.matches("AbC", "ABC").matching).toBe(false);

    const store = new AnnotationStore();
    expect(
      matcher.matches("AbC", "A[multi:[r:[bD]+][i:B][multi:b]]C", {
        store,
        fullyAnnotate: true,
        populateResult: true,
      }).matching,
    ).toBe(true);
    // A, [r], [i], b, [multi:b], [multi:...], C
    expect(store.size).toBe(7);

    expect(matcher.generateSample("A[multi:[r:[bD]+][i:B]]C")).toBe(
      "A[multi:[r:[bD]+][i:B]]C",
    );
  });

  it("accepts the extra brackets of the original multi syntax", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("AbC", "A[multi:[[r:[bD]+][i:B]]]C").matching).toBe(
      true,
    );
  });

  it("matches single Unicode code points with char", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("AbC", "A[char:98]C").matching).toBe(true);
    expect(matcher.matches("AbC", "A[char:0x62]C").matching).toBe(true);
    expect(matcher.matches("aaèr", "aa[char:0xe8]r").matching).toBe(true);
    expect(matcher.matches("aaèr", "aa[char:0xE8]r").matching).toBe(true);
    expect(matcher.matches("aaér", "aa[char:0xe8]r").matching).toBe(false);
    expect(
      matcher.matches(
        "the emoji \u{1F617} works, too",
        "the emoji [char:0x1f617] works, too",
      ).matching,
    ).toBe(true);
  });

  it("rejects invalid char parameters", () => {
    const matcher = new FlexiMatcher();
    expect(() => matcher.matches("x", "[char:]")).toThrow(RuleError);
    expect(() => matcher.matches("x", "[char:nope]")).toThrow(RuleError);
    expect(() => matcher.matches("x", "[char:0x110000]")).toThrow(RuleError);
    expect(() => matcher.matches("x", "[char:0xd800]")).toThrow(RuleError);
  });

  it("annotates overlapping plain text occurrences", () => {
    const matcher = new FlexiMatcher();
    const store = new AnnotationStore();
    matcher.matches("aaaa", "aa", {
      store,
      matchWhole: false,
      fullyAnnotate: true,
    });
    expect(
      new Set(
        store
          .ofType("aa")
          .map((annotation) => `${annotation.start}:${annotation.end}`),
      ),
    ).toEqual(new Set(["0:2", "1:3", "2:4"]));
  });

  it("handles empty patterns", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("", "").matching).toBe(true);
    expect(matcher.matches("x", "").matching).toBe(false);
    expect(matcher.contains("x", "")).toBe(true);

    const result = matcher.matches("", "", { populateResult: true });
    expect(result.emptyMatch).toBe(true);
    expect(result.interpretations).toEqual([[]]);
    expect(result.matchingStrings("")).toEqual([""]);
  });

  it("throws for unbalanced patterns and unknown rules", () => {
    const matcher = new FlexiMatcher();
    for (const pattern of ["[r:Ab", "[r:", "[i:   [", "a]b[c"]) {
      expect(() => matcher.matches("AbC", pattern)).toThrow(PatternError);
    }
    expect(() => matcher.matches("x", "[definitely-not-bound]")).toThrow(
      UnknownRuleError,
    );
    expect(() => matcher.matches("x", "[definitely-not-bound]")).toThrow(
      /unknown/,
    );
  });

  it("exposes match result helpers", () => {
    const matcher = new FlexiMatcher();
    const text = "an apple and a pear";
    matcher.addTagRule("fruit", "apple", { identifier: "apple" });
    matcher.addTagRule("fruit", "an [tag:fruit]", { identifier: "an_fruit" });
    matcher.addTagRule("fruit", "pear", { identifier: "pear" });
    matcher.addTagRule("fruit", "a [tag:fruit]", { identifier: "a_fruit" });

    const result = matcher.matches(text, "[tag:fruit]", {
      matchWhole: false,
      populateResult: true,
    });
    expect(result).toBeInstanceOf(MatchResult);
    expect(result.matching).toBe(true);
    expect(result.isMatching).toBe(true);
    expect(new Set(result.matchingStrings(text))).toEqual(
      new Set(["apple", "an apple", "pear", "a pear"]),
    );
    expect(result.highlightedStrings(text)).toHaveLength(4);
    expect([...result.flatAnnotations()]).toHaveLength(4);
  });

  it("supports regex flags and a maximum span", () => {
    const caseInsensitive = new FlexiMatcher({ regexFlags: "i" });
    expect(caseInsensitive.matches("ABC", "[r:abc]").matching).toBe(true);

    const bounded = new FlexiMatcher({ regexMaxSpan: 2 });
    const result = bounded.matches("abcd", "[r:[a-z]+]", {
      matchWhole: false,
      populateResult: true,
    });
    expect(result.matching).toBe(true);
    for (const annotation of result.store.ofType("[r:[a-z]+]")) {
      expect(annotation.end - annotation.start).toBeLessThanOrEqual(2);
    }
    expect(bounded.matches("abcd", "[r:[a-z]+]").matching).toBe(false);
  });

  it("supports explanations through the matcher-wide setting", () => {
    const matcher = new FlexiMatcher({ explain: true });
    matcher.addTagRule("fruit", "pear", {
      identifier: "id_pear",
      template: { name: "pear" },
    });
    const result = matcher.matches("pear", "[tag:fruit]", {
      populateResult: true,
    });
    const data = result.interpretations?.[0]?.[0]?.data as Record<
      string,
      unknown
    >;
    expect(data.__explain).toMatchObject({ id: "id_pear" });
  });

  it("generates samples where possible", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.generateSample("[char:0x1F617]")).toBe("\u{1F617}");
    expect(matcher.generateSample("[i:Hello]").toLowerCase()).toBe("hello");
    expect(matcher.generateSample("[unknown-rule:x]")).toBe("[unknown-rule:x]");
    expect(matcher.generateSample("[tag:unknown]")).toBe("[tag:unknown]");
  });

  it("supports binding and unbinding custom rules", () => {
    const matcher = new FlexiMatcher();
    const factory = {
      getRule() {
        return {
          annotate(
            text: string,
            annotator: { add: (start: number, end: number) => void },
          ) {
            annotator.add(0, text.length);
            return true;
          },
        };
      },
      generateSample() {
        return "anything";
      },
    };
    expect(matcher.isBoundRule("custom")).toBe(false);
    expect(matcher.bind("custom", factory)).toBe(false);
    expect(matcher.isBoundRule("custom")).toBe(true);
    expect(matcher.getBoundRule("custom")).toBe(factory);
    expect(matcher.ruleNames).toContain("custom");
    expect(matcher.matches("whatever", "[custom]").matching).toBe(true);
    expect(matcher.generateSample("[custom]")).toBe("anything");
    expect(matcher.unbind("custom")).toBe(true);
    expect(matcher.unbind("custom")).toBe(false);
    expect(() => matcher.bind("bad:name", factory)).toThrow(PatternError);
  });

  it("compiles patterns for reuse and refreshes changed rule bindings", () => {
    const matcher = new FlexiMatcher();
    const compiled = matcher.compile("A[i:B]C");
    expect(compiled).toBeInstanceOf(CompiledPattern);
    expect(compiled.matches("AbC").matching).toBe(true);
    expect(compiled.contains("xxAbCxx")).toBe(true);
    expect(matcher.matches("AbC", compiled).matching).toBe(true);
    expect(matcher.contains("xxAbCxx", compiled)).toBe(true);

    const always = {
      getRule() {
        return {
          annotate(
            text: string,
            annotator: { add: (start: number, end: number) => void },
          ) {
            annotator.add(0, text.length);
            return true;
          },
        };
      },
      generateSample: () => "anything",
    };
    const never = {
      getRule() {
        return {
          annotate() {
            return false;
          },
        };
      },
      generateSample: () => null,
    };

    matcher.bind("custom", always);
    const custom = matcher.compile("[custom]");
    expect(custom.matches("whatever").matching).toBe(true);
    expect(custom.generateSample()).toBe("anything");

    matcher.bind("custom", never);
    expect(custom.matches("whatever").matching).toBe(false);
    expect(custom.generateSample()).toBe("[custom]");

    matcher.unbind("custom");
    expect(() => custom.matches("whatever")).toThrow(UnknownRuleError);

    const other = new FlexiMatcher();
    expect(() => other.matches("AbC", compiled)).toThrow(
      /different FlexiMatcher/,
    );
    expect(() => matcher.compile("[definitely-not-bound]")).toThrow(
      UnknownRuleError,
    );
  });

  it("lets custom rules match compiled sub-patterns", () => {
    const matcher = new FlexiMatcher();
    matcher.bind("contains-b", {
      getRule() {
        return {
          annotate(text: string, annotator: Annotator) {
            const compiled = annotator.matcher.compile("[i:b]");
            const result = annotator.match(text, compiled, {
              matchWhole: false,
            });
            if (result.matching) {
              annotator.add(0, text.length);
            }
            return false;
          },
        };
      },
      generateSample: () => null,
    });
    expect(matcher.matches("abc", "[contains-b]").matching).toBe(true);
    expect(matcher.matches("xyz", "[contains-b]").matching).toBe(false);
  });

  it("matches or-alternatives, including multi-chunk alternatives", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("cat", "[or:[i:cat]|[i:dog]]").matching).toBe(true);
    expect(matcher.matches("dog", "[or:[i:cat]|[i:dog]]").matching).toBe(true);
    expect(matcher.matches("cow", "[or:[i:cat]|[i:dog]]").matching).toBe(false);
    expect(
      matcher.matches("the dog", "[or:[i:the] [i:dog]|[i:cat]]").matching,
    ).toBe(true);
    expect(
      matcher.matches("cat", "[or:[i:the] [i:dog]|[i:cat]]").matching,
    ).toBe(true);
    expect(matcher.matches("a", "[or:[r:a|b]|[i:c]]").matching).toBe(true);
    expect(matcher.matches("b", "[or:[r:a|b]|[i:c]]").matching).toBe(true);
    expect(matcher.matches("c", "[or:[r:a|b]|[i:c]]").matching).toBe(true);
  });

  it("records which or-alternatives matched", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.matches("cat", "[or:[i:cat]|[i:CAT]]", {
      populateResult: true,
    });
    const annotation = result.store.ofType("[or:[i:cat]|[i:CAT]]")[0];
    expect(annotation?.data).toEqual({
      alternatives: ["[i:cat]", "[i:CAT]"],
    });
  });

  it("matches one or more repetitions", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("ha", "[repeat:[i:ha]]").matching).toBe(true);
    expect(matcher.matches("hahaha", "[repeat:[i:ha]]").matching).toBe(true);
    expect(matcher.matches("xx", "[repeat:[i:ha]]").matching).toBe(false);
    expect(matcher.matches("hahaha!", "[repeat:[i:ha]][i:!]").matching).toBe(
      true,
    );

    const result = matcher.matches("hahaha", "[repeat:[i:ha]]", {
      fullyAnnotate: true,
      populateResult: true,
    });
    const spans = result.store
      .ofType("[repeat:[i:ha]]")
      .map(
        (annotation) =>
          `${annotation.start}:${annotation.end}:${(annotation.data as { repetitions: number[] }).repetitions.join(",")}`,
      );
    expect(spans).toContain("0:4:2");
    expect(spans).toContain("0:6:3");
    expect(spans).toContain("2:6:2");
  });

  it("matches repeated multi-chunk patterns", () => {
    const matcher = new FlexiMatcher();
    expect(matcher.matches("ha!ha!", "[repeat:[i:ha][i:!]]").matching).toBe(
      true,
    );
    const result = matcher.matches("ha!ha!", "[repeat:[i:ha][i:!]]", {
      fullyAnnotate: true,
      populateResult: true,
    });
    const spans = result.store
      .ofType("[repeat:[i:ha][i:!]]")
      .map((annotation) => `${annotation.start}:${annotation.end}`);
    expect(spans).toContain("0:3");
    expect(spans).toContain("0:6");
    expect(spans).toContain("3:6");
  });

  it("generates samples for or and repeat", () => {
    const matcher = new FlexiMatcher();
    expect(
      ["cat", "dog"].includes(
        matcher.generateSample("[or:[i:cat]|[i:dog]]").toLowerCase(),
      ),
    ).toBe(true);
    expect(matcher.generateSample("[repeat:[i:ha]]").toLowerCase()).toBe(
      "haha",
    );
  });

  it("annotates a text without a pattern", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.annotate("Le case", {
      rules: ["[i:Le]", "i:case"],
    });
    expect(result.errors).toEqual([]);
    expect(result.store.text).toBe("Le case");
    expect(
      result.annotations.map((annotation) => ({
        start: annotation.start,
        end: annotation.end,
        type: annotation.type,
      })),
    ).toEqual([
      { start: 0, end: 2, type: "[i:Le]" },
      { start: 3, end: 7, type: "[i:case]" },
    ]);
  });

  it("can collect annotate errors and continue", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.annotate("x", {
      rules: ["[definitely-not-bound]", "[i:x]"],
      onError: "collect",
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.rule).toBe("[definitely-not-bound]");
    expect(result.annotations).toHaveLength(1);
    expect(() =>
      matcher.annotate("x", { rules: ["[definitely-not-bound]"] }),
    ).toThrow(UnknownRuleError);
  });

  it("annotates with compiled patterns and a supplied store", () => {
    const matcher = new FlexiMatcher();
    const compiled = matcher.compile("[i:x]");
    const store = new AnnotationStore({ text: "x" });
    const result = matcher.annotate("x", { rules: [compiled], store });
    expect(result.store).toBe(store);
    expect(result.annotations).toHaveLength(1);
  });

  it("caps annotation collection with maxAnnotations", () => {
    const matcher = new FlexiMatcher();
    matcher.bind("many", {
      getRule() {
        return {
          annotate(text: string, annotator: Annotator) {
            for (let index = 0; index < text.length; index += 1) {
              annotator.add(index, index + 1);
            }
            return false;
          },
        };
      },
      generateSample: () => null,
    });
    const result = matcher.matches("abcdef", "[many]", {
      maxAnnotations: 3,
      fullyAnnotate: true,
    });
    expect(result.store.size).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("caps interpretations and reports truncation", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.matches("ab", "[r:a|ab]", {
      populateResult: true,
      maxInterpretations: 1,
    });
    expect(result.matching).toBe(true);
    expect(result.interpretations).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("supports an aborted signal and a time budget", () => {
    const matcher = new FlexiMatcher();
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      matcher.matches("x", "x", { signal: controller.signal }),
    ).toThrow(BudgetExceededError);

    matcher.bind("slow", {
      getRule() {
        return {
          annotate(_text: string, annotator: Annotator) {
            const deadline = Date.now() + 10;
            while (Date.now() < deadline) {
              annotator.budget.check();
            }
            return false;
          },
        };
      },
      generateSample: () => null,
    });
    expect(() => matcher.matches("x", "[slow]", { timeoutMs: 1 })).toThrow(
      BudgetExceededError,
    );
  });

  it("ranks interpretations and can keep the best", () => {
    const matcher = new FlexiMatcher();
    const ranked = matcher.matches("ab", "[r:a|ab]", {
      matchWhole: false,
      populateResult: true,
      rankInterpretation: (sequence) => sequence[0].end - sequence[0].start,
      strategy: "best",
    });
    expect(ranked.interpretations).toHaveLength(1);
    expect(ranked.interpretations?.[0]?.[0]?.end).toBe(2);
    expect(ranked.scores).toEqual([2]);

    const all = matcher.matches("ab", "[r:a|ab]", {
      matchWhole: false,
      populateResult: true,
      rankInterpretation: (sequence) => sequence[0].end - sequence[0].start,
    });
    expect(all.interpretations).toHaveLength(2);
    expect(all.scores).toEqual([2, 1]);
  });

  it("reports truncation from annotate()", () => {
    const matcher = new FlexiMatcher();
    const result = matcher.annotate("abcdef", {
      rules: ["[r:[a-z]]"],
      maxAnnotations: 2,
    });
    expect(result.annotations).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("expands pattern macros", () => {
    const matcher = new FlexiMatcher({ macros: { hello: "[i:hello]" } });
    expect(matcher.matches("HELLO", "{{hello}}").matching).toBe(true);

    matcher.defineMacro("greeting", "{{hello}} world");
    expect(matcher.matches("hello world", "{{greeting}}").matching).toBe(true);
    expect(matcher.generateSample("{{hello}}").toLowerCase()).toBe("hello");

    const compiled = matcher.compile("{{hello}}");
    expect(compiled.expandedPattern).toBe("[i:hello]");
    expect(compiled.matches("hello").matching).toBe(true);

    expect(() => matcher.matches("x", "{{missing}}")).toThrow(
      UnknownMacroError,
    );
    matcher.defineMacro("a", "{{b}}");
    matcher.defineMacro("b", "{{a}}");
    expect(() => matcher.matches("x", "{{a}}")).toThrow(/Cyclic/);

    expect(matcher.macroNames).toContain("hello");
    expect(matcher.getMacro("hello")).toBe("[i:hello]");
    expect(matcher.removeMacro("hello")).toBe(true);
    expect(matcher.removeMacro("hello")).toBe(false);
    matcher.clearMacros();
    expect(matcher.macroNames).toEqual([]);
    expect(() => matcher.defineMacro("bad name", "x")).toThrow(PatternError);
  });

  it("expands macros inside tag productions", () => {
    const matcher = new FlexiMatcher({ macros: { pear: "[i:pear]" } });
    matcher.addTagRule("fruit", "{{pear}}", {
      identifier: "id_fruit",
      template: { kind: "pear" },
    });
    expect(matcher.matches("pear", "[tag:fruit]").matching).toBe(true);
  });

  it("rejects reusing a store for a different text", () => {
    const matcher = new FlexiMatcher();
    const store = new AnnotationStore();
    matcher.matches("x", "x", { store });
    expect(() => matcher.matches("y", "y", { store })).toThrow(RuleError);
    expect(() => matcher.matches("y", "y", { store })).toThrow(
      /different text/,
    );
  });

  it("rejects annotations outside the text", () => {
    const matcher = new FlexiMatcher();
    matcher.bind("bad", {
      getRule() {
        return {
          annotate(
            _text: string,
            annotator: { add: (start: number, end: number) => void },
          ) {
            annotator.add(0, 99);
            return true;
          },
        };
      },
      generateSample: () => null,
    });
    expect(() => matcher.matches("short", "[bad]")).toThrow(RuleError);
    expect(() => matcher.matches("short", "[bad]")).toThrow(/outside the text/);
  });
});
