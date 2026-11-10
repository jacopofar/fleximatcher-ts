/**
 * Seeded property/fuzz tests.
 *
 * These use a tiny deterministic PRNG so failures are reproducible.  They are
 * deliberately fast enough to run in normal CI.
 */

import { describe, expect, it } from "vitest";

import {
  Annotation,
  AnnotationStore,
  AnnotationTemplate,
  FlexiMatcher,
  PatternError,
  ProvenanceGraph,
  splitPattern,
} from "../src/index.js";
import { tokenizeWords } from "../src/wiktionary/tokenize.js";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

function randomString(random: () => number, length: number): string {
  const alphabet = "abc XYZ 0123-'\"\\\n\tàèéìòù\u0000\u{1F600}";
  const characters = [...alphabet];
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += pick(random, characters);
  }
  return output;
}

describe("fuzz: splitPattern", () => {
  it("preserves the input and produces well-formed chunks", () => {
    const random = mulberry32(0x5eed);
    const atoms = [
      "a",
      "bc",
      " ",
      "[i:x]",
      "[r:a|b]",
      "[tag:fruit]",
      "[multi:[i:a][i:b]]",
      "[or:[i:a]|[r:\\d+]]",
    ];

    for (let iteration = 0; iteration < 400; iteration += 1) {
      let pattern = "";
      const count = Math.floor(random() * 8);
      for (let index = 0; index < count; index += 1) {
        pattern += pick(random, atoms);
      }

      const chunks = splitPattern(pattern);
      expect(chunks.join("")).toBe(pattern);
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
        if (chunk.startsWith("[")) {
          expect(chunk.endsWith("]")).toBe(true);
        }
      }
    }
  });

  it("either rejects unbalanced brackets or round-trips them", () => {
    const random = mulberry32(0xb0a7);
    for (let iteration = 0; iteration < 300; iteration += 1) {
      const pattern = randomString(random, Math.floor(random() * 12));
      let chunks: string[] | null = null;
      try {
        chunks = splitPattern(pattern);
      } catch (error) {
        expect(error).toBeInstanceOf(PatternError);
      }
      if (chunks !== null) {
        expect(chunks.join("")).toBe(pattern);
      }
    }
  });
});

describe("fuzz: annotation templates", () => {
  it("round-trips arbitrary covered strings", () => {
    const random = mulberry32(0x7e4);
    for (let iteration = 0; iteration < 400; iteration += 1) {
      const text = randomString(random, 1 + Math.floor(random() * 20));
      const start = Math.floor(random() * text.length);
      const end = start + 1 + Math.floor(random() * (text.length - start));
      const annotation = new Annotation(start, end, "word");
      const template = new AnnotationTemplate("{'s':'${0}'}");
      const data = template.build(text, [annotation]) as { s: string };
      expect(data.s).toBe(text.slice(start, end));
    }
  });

  it("preserves exact placeholder types", () => {
    const random = mulberry32(0xda7a);
    for (let iteration = 0; iteration < 300; iteration += 1) {
      const value = {
        n: Math.floor(random() * 1_000_000),
        flag: random() < 0.5,
        nested: { label: randomString(random, Math.floor(random() * 6)) },
      };
      const annotation = new Annotation(0, 1, "x", { value });
      const template = new AnnotationTemplate({
        value: "${0.value}",
      });
      expect(template.build("x", [annotation])).toEqual({ value });
    }
  });
});

describe("fuzz: tokenizer", () => {
  it("returns sorted, well-formed, deterministic tokens", () => {
    const random = mulberry32(0x701e);
    for (let iteration = 0; iteration < 300; iteration += 1) {
      const text = randomString(random, Math.floor(random() * 40));
      const tokens = tokenizeWords(text);
      expect(tokenizeWords(text)).toEqual(tokens);
      let previousStart = -1;
      for (const token of tokens) {
        expect(token.start).toBeGreaterThanOrEqual(0);
        expect(token.end).toBeGreaterThan(token.start);
        expect(token.end).toBeLessThanOrEqual(text.length);
        expect(token.text).toBe(text.slice(token.start, token.end));
        expect(token.start).toBeGreaterThanOrEqual(previousStart);
        previousStart = token.start;
      }
    }
  });
});

describe("fuzz: annotation store sequences", () => {
  it("finds the sequence that partition annotations create", () => {
    const random = mulberry32(0xcafe);
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const length = 1 + Math.floor(random() * 8);
      const text = "x".repeat(length);
      const store = new AnnotationStore({ text });
      const types: string[] = [];
      let position = 0;
      while (position < length) {
        const size = 1 + Math.floor(random() * (length - position));
        const type = `[t:${Math.floor(random() * 3)}]`;
        store.add(new Annotation(position, position + size, type));
        types.push(type);
        position += size;
      }

      const result = store.checkSequence(types, length, {
        matchWhole: true,
        populateResult: true,
      });
      expect(result.matching).toBe(true);
      expect(result.interpretations?.length).toBeGreaterThan(0);
      expect(result.interpretations?.[0]?.map((item) => item.type)).toEqual(
        types,
      );
    }
  });
});

describe("fuzz: provenance", () => {
  it("builds a DAG and exports stable JSON for random tag chains", () => {
    const random = mulberry32(0x9a9);
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const words = 1 + Math.floor(random() * 4);
      const text = "a".repeat(words);
      const matcher = new FlexiMatcher();
      matcher.addTagRule("base", "a", { identifier: "id_base" });
      let previous = "base";
      for (let index = 0; index < words; index += 1) {
        const next = `layer${index}`;
        matcher.addTagRule(next, `[tag:${previous}]a`, {
          identifier: `id_${next}`,
        });
        previous = next;
      }

      const result = matcher.matches(text, `[tag:${previous}]`, {
        explain: true,
        populateResult: true,
      });
      const graph = ProvenanceGraph.fromAnnotations(
        result.store.annotations,
        text,
      );
      const json = graph.toJSON();
      expect(JSON.parse(JSON.stringify(json))).toEqual(json);
      expect(graph.toSVG({ width: 400 })).toContain("</svg>");
      for (const node of graph.nodes.values()) {
        for (const parent of node.parents) {
          expect(graph.nodes.has(parent)).toBe(true);
        }
        for (const child of node.children) {
          expect(graph.nodes.has(child)).toBe(true);
        }
      }
    }
  });
});
