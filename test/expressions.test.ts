import { describe, expect, it } from "vitest";

import {
  isRuleChunk,
  PatternError,
  parameter,
  ruleName,
  splitPattern,
  usedTags,
} from "../src/index.js";

describe("pattern expressions", () => {
  it("splits text and rule chunks, preserving whitespace", () => {
    expect(splitPattern("the dog [pos: verb] the wall")).toEqual([
      "the dog ",
      "[pos: verb]",
      " the wall",
    ]);
  });

  it("keeps nested rule chunks together", () => {
    expect(splitPattern("[multi:[i:a][i:b]]")).toEqual(["[multi:[i:a][i:b]]"]);
    expect(splitPattern("a[i:[r:x]]b")).toEqual(["a", "[i:[r:x]]", "b"]);
  });

  it("handles the trivial cases", () => {
    expect(splitPattern("")).toEqual([]);
    expect(splitPattern("plain")).toEqual(["plain"]);
    expect(splitPattern("[i:x]")).toEqual(["[i:x]"]);
  });

  it("rejects unbalanced brackets", () => {
    for (const pattern of ["[r:Ab", "[r:", "[i:   [", "a]b[c"]) {
      expect(() => splitPattern(pattern)).toThrow(PatternError);
      expect(() => splitPattern(pattern)).toThrow(/brackets are unbalanced/);
    }
  });

  it("extracts rule names and parameters", () => {
    expect(ruleName("[it-pos: Ss]")).toBe("it-pos");
    expect(ruleName("[token]")).toBe("token");
    expect(ruleName("[multi:[i:a][i:b]]")).toBe("multi");
    expect(parameter("[it-pos: Ss]")).toBe(" Ss");
    expect(parameter("[token]")).toBe("");
    expect(parameter("[r:[a-z]+]")).toBe("[a-z]+");
  });

  it("rejects malformed rule chunks", () => {
    expect(() => ruleName("plain")).toThrow(PatternError);
    expect(() => ruleName("[]")).toThrow(PatternError);
    expect(() => ruleName("[[i:a]]")).toThrow(PatternError);
    expect(() => parameter("plain")).toThrow(PatternError);
  });

  it("recognises rule chunks", () => {
    expect(isRuleChunk("[i:x]")).toBe(true);
    expect(isRuleChunk("i:x")).toBe(false);
    expect(isRuleChunk("[i:x")).toBe(false);
  });

  it("finds used tags, including nested multi conditions", () => {
    expect([...usedTags("[tag:fruit] and [tag:animal]")].sort()).toEqual([
      "animal",
      "fruit",
    ]);
    expect([...usedTags("[multi:[tag:a][i:b][tag:c]]")].sort()).toEqual([
      "a",
      "c",
    ]);
    expect([...usedTags("[or:[tag:a]|[tag:b]]")].sort()).toEqual(["a", "b"]);
    expect([...usedTags("[repeat:[tag:a]]")]).toEqual(["a"]);
    expect([...usedTags("plain text")]).toEqual([]);
  });
});
