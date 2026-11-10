import { describe, expect, it } from "vitest";

import {
  Annotation,
  AnnotationError,
  AnnotationTemplate,
} from "../src/index.js";

const text = "a pear";
const first = new Annotation(0, 2, "a ");
const second = new Annotation(2, 6, "[tag:fruit]", {
  name: "pear",
  count: 3,
  nested: { deep: "value" },
  items: ["zero", "one"],
});

describe("annotation templates", () => {
  it("treats null and blank expressions as empty", () => {
    expect(new AnnotationTemplate(null).build(text, [])).toBeUndefined();
    expect(new AnnotationTemplate("   ").build(text, [])).toBeUndefined();
  });

  it("supports value-position placeholders in string templates", () => {
    const template = new AnnotationTemplate("{'name':${1.name},'count':${1.count}}");
    expect(template.build(text, [first, second])).toEqual({
      name: "pear",
      count: 3,
    });
  });

  it("escapes placeholders inside quoted strings", () => {
    const template = new AnnotationTemplate("{'covered':'${0}','name':'${1.name}'}");
    expect(template.build(text, [first, second])).toEqual({
      covered: "a ",
      name: "pear",
    });
  });

  it("escapes quotes in single-quoted templates", () => {
    const apostrophe = new Annotation(0, 4, "word");
    const template = new AnnotationTemplate("{'text':'${0}'}");
    expect(template.build("it's!", [apostrophe])).toEqual({ text: "it's" });
  });

  it("supports nested paths and array indices", () => {
    const template = new AnnotationTemplate(
      "{'deep':'${1.nested.deep}','item':'${1.items[1]}'}",
    );
    expect(template.build(text, [first, second])).toEqual({
      deep: "value",
      item: "one",
    });
  });

  it("accepts lenient JSON with single quotes and bare values", () => {
    const template = new AnnotationTemplate("{name:pear,flag:true,nothing:null}");
    expect(template.build(text, [first, second])).toEqual({
      name: "pear",
      flag: true,
      nothing: null,
    });
  });

  it("expands native objects recursively and preserves types", () => {
    const template = new AnnotationTemplate({
      name: "${1.name}",
      count: "${1.count}",
      covered: "prefix-${0}",
      nested: { item: "${1.items[0]}" },
      list: ["${1.items[1]}", 7],
    });
    expect(template.build(text, [first, second])).toEqual({
      name: "pear",
      count: 3,
      covered: "prefix-a ",
      nested: { item: "zero" },
      list: ["one", 7],
    });
  });

  it("supports function templates and their context", () => {
    const template = new AnnotationTemplate(({ sequence, covered, value }) => ({
      first: covered(0),
      name: value(1, "name"),
      size: sequence.length,
    }));
    expect(template.build(text, [first, second])).toEqual({
      first: "a ",
      name: "pear",
      size: 2,
    });
  });

  it("validates and coerces data with a schema", () => {
    const template = new AnnotationTemplate<{ n: number }>(
      '{"n":"${0}"}',
      (data) => {
        const n = Number((data as { n: string }).n);
        if (!Number.isFinite(n)) {
          throw new Error("not a number");
        }
        return { n };
      },
    );
    expect(template.build("42", [new Annotation(0, 2, "word")])).toEqual({
      n: 42,
    });
    expect(() =>
      template.build("nope", [new Annotation(0, 4, "word")]),
    ).toThrow(AnnotationError);
  });

  it("rejects malformed templates eagerly", () => {
    expect(() => new AnnotationTemplate("{'broken':")).toThrow(AnnotationError);
    expect(() => new AnnotationTemplate(42 as unknown as string)).toThrow(
      AnnotationError,
    );
  });

  it("rejects invalid or out-of-range placeholders at build time", () => {
    expect(() => new AnnotationTemplate("${1.bad..path}")).toThrow(AnnotationError);
    expect(() =>
      new AnnotationTemplate("${9.name}").build(text, [first, second]),
    ).toThrow(AnnotationError);
    expect(() =>
      new AnnotationTemplate("${1.missing}").build(text, [first, second]),
    ).toThrow(AnnotationError);
    expect(() =>
      new AnnotationTemplate("${1.items[9]}").build(text, [first, second]),
    ).toThrow(AnnotationError);
  });

  it("rejects asynchronous function templates", () => {
    const template = new AnnotationTemplate(async () => ({ ok: true }));
    expect(() => template.build(text, [first, second])).toThrow(AnnotationError);
  });
});
