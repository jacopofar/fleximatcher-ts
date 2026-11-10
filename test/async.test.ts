import { describe, expect, it } from "vitest";

import {
  AnnotationStore,
  annotateAsync,
  FlexiMatcher,
  matchesAsync,
  prefetchAsyncRules,
  RuleError,
  type AsyncRuleFactory,
  type RuleFactory,
} from "../src/index.js";

function asyncPosFactory(): AsyncRuleFactory {
  return {
    async analyze(text, parameter) {
      const start = text.indexOf("dog");
      if (start === -1) return [];
      return [{ start, end: start + 3, data: { pos: parameter } }];
    },
    generateSample: () => "dog",
  };
}

describe("async rule adapter", () => {
  it("prefetches async annotations and uses them in tag closure", async () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule("animal", "[remote-pos:NOUN]", {
      identifier: "id_animal",
      template: { kind: "animal" },
    });

    const result = await matchesAsync(
      matcher,
      "a dog",
      "[tag:animal]",
      {
        matchWhole: false,
        asyncRules: [
          {
            name: "remote-pos",
            factory: asyncPosFactory(),
            parameters: ["NOUN"],
          },
        ],
      },
    );

    expect(result.matching).toBe(true);
    expect(result.store.ofType("[remote-pos:NOUN]")).toHaveLength(1);
    expect(result.store.ofType("[tag:animal]")).toHaveLength(1);
    result.release();
    expect(matcher.isBoundRule("remote-pos")).toBe(false);
  });

  it("combines sync annotators with async rules", async () => {
    const matcher = new FlexiMatcher();
    matcher.bind("sync-word", {
      getRule() {
        return {
          annotate(text, annotator) {
            if (text.includes("dog")) annotator.add(0, 5, { sync: true });
            return false;
          },
        };
      },
      generateSample: () => null,
    });

    const result = await annotateAsync(matcher, "a dog", {
      rules: ["[sync-word]"],
      asyncRules: [
        {
          name: "remote-pos",
          factory: asyncPosFactory(),
          parameters: ["NOUN"],
        },
      ],
    });
    expect(result.annotations).toHaveLength(1);
    expect(result.store.ofType("[sync-word]")).toHaveLength(1);
    result.release();
  });

  it("restores previous bindings on release", async () => {
    const matcher = new FlexiMatcher();
    const original: RuleFactory = {
      getRule() {
        return { annotate: () => false };
      },
      generateSample: () => null,
    };
    matcher.bind("remote-pos", original);

    const prefetched = await prefetchAsyncRules(matcher, "dog", [
      { name: "remote-pos", factory: asyncPosFactory(), parameters: ["NOUN"] },
    ]);
    expect(matcher.getBoundRule("remote-pos")).not.toBe(original);
    prefetched.release();
    expect(matcher.getBoundRule("remote-pos")).toBe(original);
  });

  it("rejects unprefetched parameters and different texts", async () => {
    const matcher = new FlexiMatcher();
    const prefetched = await prefetchAsyncRules(matcher, "dog", [
      { name: "remote-pos", factory: asyncPosFactory(), parameters: ["NOUN"] },
    ]);
    expect(() => matcher.matches("dog", "[remote-pos:VERB]")).toThrow(
      RuleError,
    );
    expect(() => matcher.matches("cat", "[remote-pos:NOUN]")).toThrow(
      /different text/,
    );
    prefetched.release();
  });

  it("restores bindings when analysis fails", async () => {
    const matcher = new FlexiMatcher();
    const original: RuleFactory = {
      getRule() {
        return { annotate: () => false };
      },
      generateSample: () => null,
    };
    matcher.bind("remote-pos", original);

    const failing: AsyncRuleFactory = {
      async analyze() {
        throw new Error("remote service down");
      },
      generateSample: () => null,
    };
    await expect(
      prefetchAsyncRules(matcher, "dog", [
        { name: "remote-pos", factory: failing },
      ]),
    ).rejects.toThrow("remote service down");
    expect(matcher.getBoundRule("remote-pos")).toBe(original);
  });

  it("can annotate an existing store", async () => {
    const matcher = new FlexiMatcher();
    const store = new AnnotationStore({ text: "dog" });
    const result = await annotateAsync(matcher, "dog", {
      rules: ["[remote-pos:NOUN]"],
      store,
      asyncRules: [
        {
          name: "remote-pos",
          factory: asyncPosFactory(),
          parameters: ["NOUN"],
        },
      ],
    });
    expect(result.store).toBe(store);
    expect(store.ofType("[remote-pos:NOUN]")).toHaveLength(1);
    result.release();
  });
});
