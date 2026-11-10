import { describe, expect, it } from "vitest";

import { FlexiMatcher } from "../src/index.js";

describe("annotateBatch", () => {
  it("annotates each text and aggregates usage by type", () => {
    const matcher = new FlexiMatcher();
    const batch = matcher.annotateBatch(["a b", "a", "c"], {
      rules: ["[i:a]", "[i:b]"],
    });
    expect(batch.results).toHaveLength(3);
    expect(batch.results[0]?.store.text).toBe("a b");
    expect(batch.results[1]?.store.text).toBe("a");
    expect(batch.usage["[i:a]"]).toBe(2);
    expect(batch.usage["[i:b]"]).toBe(1);
  });

  it("can skip the usage map", () => {
    const matcher = new FlexiMatcher();
    const batch = matcher.annotateBatch(["a"], {
      rules: ["[i:a]"],
      collectUsage: false,
    });
    expect(batch.usage).toEqual({});
  });

  it("keeps per-text errors when onError is collect", () => {
    const matcher = new FlexiMatcher();
    const batch = matcher.annotateBatch(["a", "b"], {
      rules: ["[i:a]", "[r:(]"],
      onError: "collect",
    });
    expect(batch.results[0]?.errors).toHaveLength(1);
    expect(batch.results[0]?.errors[0]?.rule).toBe("[r:(]");
    expect(batch.usage["[i:a]"]).toBe(1);
  });

  it("includes tag annotations in usage", () => {
    const matcher = new FlexiMatcher();
    matcher.addTagRule("thing", "[i:a]", { identifier: "id_a" });
    const batch = matcher.annotateBatch(["a"], { rules: ["[tag:thing]"] });
    expect(batch.usage["[tag:thing]"]).toBe(1);
  });
});
