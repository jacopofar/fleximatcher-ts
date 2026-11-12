import { describe, expect, it } from "vitest";

import { Annotation, AnnotationStore, MatchFrame } from "../src/index.js";

describe("annotations and stores", () => {
  it("indexes annotations by start and type", () => {
    const store = new AnnotationStore({ text: "a pear" });
    const first = new Annotation(0, 2, "a ");
    const second = new Annotation(2, 6, "[tag:fruit]", { name: "pear" });

    expect(store.add(first)).toBe(true);
    expect(store.add(second)).toBe(true);
    expect(store.add(new Annotation(0, 2, "a "))).toBe(false);
    expect(store.size).toBe(2);
    expect(store.at(0)).toEqual([first]);
    expect(store.ofType("[tag:fruit]")).toEqual([second]);
    expect(store.has(0, 2, "a ")).toBe(true);
    expect(store.has(0, 2, "other")).toBe(false);
    expect([...store.starts]).toEqual([0, 2]);
    expect([...store]).toEqual([first, second]);
    expect(second.coveredText("a pear")).toBe("pear");
  });

  it("deduplicates structurally equal data", () => {
    const store = new AnnotationStore();
    expect(store.addAnnotation(0, 1, "x", { a: 1, b: [2, 3] })).toBe(true);
    expect(store.addAnnotation(0, 1, "x", { b: [2, 3], a: 1 })).toBe(false);
    expect(store.size).toBe(1);
  });

  it("validates annotation spans", () => {
    expect(() => new Annotation(-1, 2, "x")).toThrow(RangeError);
    expect(() => new Annotation(2, 2, "x")).toThrow(RangeError);
    expect(() => new Annotation(3, 2, "x")).toThrow(RangeError);
    expect(() => new Annotation(0, 1, "")).toThrow(RangeError);
    expect(() =>
      new AnnotationStore({ text: "abc" }).addAnnotation(0, 9, "x"),
    ).toThrow(/outside the text/);
  });

  it("refuses to attach a different text", () => {
    const store = new AnnotationStore();
    store.attachText("abc");
    expect(() => store.attachText("def")).toThrow(/different text/);
  });

  it("tracks nested match frames", () => {
    const root = new MatchFrame("", 0);
    const child = root.child("[tag:fruit]", 3);
    expect(root.depth).toBe(0);
    expect(child.depth).toBe(1);
    expect(child.parent).toBe(root);
    expect(child.matcher).toBe("[tag:fruit]");
    expect(String(child)).toContain("depth=1");
  });
});
