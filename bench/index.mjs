#!/usr/bin/env node
/**
 * Small, dependency-free benchmark runner.
 *
 * Usage:
 *   npm run bench
 *   BENCH_SCALE=3 npm run bench
 *
 * Numbers are machine-relative smoke-signals, not rigorous measurements.
 */

import { performance } from "node:perf_hooks";

import {
  Annotation,
  AnnotationStore,
  FlexiMatcher,
  ProvenanceGraph,
} from "../dist/index.js";
import { tokenizeWords } from "../dist/wiktionary/tokenize.js";

const requestedScale = Number(process.env.BENCH_SCALE ?? 0);
const scale =
  Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1;

const results = [];

function bench(name, iterations, setup) {
  const { run, teardown } = setup();
  // Warm up so the first JIT tier does not dominate.
  for (let index = 0; index < Math.min(iterations, 50); index += 1) {
    run(index);
  }
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    run(index);
  }
  const elapsed = performance.now() - start;
  teardown?.();
  results.push({
    name,
    iterations,
    ms: elapsed,
    ops: (iterations / elapsed) * 1000,
  });
}

function buildText(width) {
  const unit = "Le case sono belle e il cane corre nel giardino. ";
  return unit.repeat(Math.ceil(width / unit.length)).slice(0, width);
}

bench("match: literal + regex (2 KB text)", 50 * scale, () => {
  const matcher = new FlexiMatcher();
  const text = buildText(2_000);
  const pattern = matcher.compile("Le [r:[a-z]+] sono belle");
  return {
    run() {
      matcher.matches(text, pattern, { matchWhole: false });
    },
  };
});

bench("annotate: 5 rules (2 KB text)", 50 * scale, () => {
  const matcher = new FlexiMatcher();
  const text = buildText(2_000);
  return {
    run() {
      matcher.annotate(text, {
        rules: [
          "[r:[A-Z][a-z]+]",
          "[r:[a-z]+]",
          "[i:Le]",
          "[i:case]",
          "[i:belle]",
        ],
        fullyAnnotate: true,
      });
    },
  };
});

bench("tags: closure chain of 24 productions", 200 * scale, () => {
  const matcher = new FlexiMatcher();
  const text = "a";
  matcher.addTagRule("layer0", "a", { identifier: "id_layer0" });
  let previous = "layer0";
  for (let index = 1; index < 24; index += 1) {
    const next = `layer${index}`;
    matcher.addTagRule(next, `[tag:${previous}]`, {
      identifier: `id_${next}`,
    });
    previous = next;
  }
  return {
    run() {
      matcher.matches(text, `[tag:${previous}]`, {
        matchWhole: true,
        populateResult: true,
      });
    },
  };
});

bench("store: sequence over 100 annotations", 1_000 * scale, () => {
  const text = "x".repeat(100);
  const store = new AnnotationStore({ text });
  const types = [];
  for (let index = 0; index < 100; index += 1) {
    const type = `[t:${index % 5}]`;
    store.add(new Annotation(index, index + 1, type));
    types.push(type);
  }
  return {
    run() {
      store.checkSequence(types, text.length, {
        matchWhole: true,
        populateResult: false,
      });
    },
  };
});

bench("provenance: DAG from 200 explained nodes", 100 * scale, () => {
  const text = "x".repeat(200);
  const annotations = [];
  for (let index = 0; index < 200; index += 1) {
    const children =
      index === 0
        ? []
        : [
            {
              start: index - 1,
              end: index,
              type: "[tag:layer]",
              __explain: { id: null, children: [] },
            },
          ];
    annotations.push(
      new Annotation(index, index + 1, "[tag:layer]", {
        __explain: { id: `id_${index}`, children },
      }),
    );
  }
  return {
    run() {
      ProvenanceGraph.fromAnnotations(annotations, text).toJSON();
    },
  };
});

bench("tokenizer: 2 KB Italian text", 100 * scale, () => {
  const text = buildText(2_000);
  return {
    run() {
      tokenizeWords(text);
    },
  };
});

const width = Math.max(...results.map((result) => result.name.length));
console.log(
  "benchmark".padEnd(width),
  "iterations".padStart(12),
  "total ms".padStart(10),
  "ops/sec".padStart(12),
);
console.log("-".repeat(width + 38));
for (const result of results) {
  console.log(
    result.name.padEnd(width),
    String(result.iterations).padStart(12),
    result.ms.toFixed(2).padStart(10),
    Math.round(result.ops).toLocaleString("en-US").padStart(12),
  );
}
