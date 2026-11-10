#!/usr/bin/env node
/** Command line interface: a small demo and a one-shot matcher. */

import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { FlexiMatcher } from "./matcher.js";
import { readTagsFromTsv } from "./tsv.js";

function demo(): void {
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

  const text = "the damn dog eats a pear";
  const pattern = "the [i:DAMN] dog eats [tag:fruit]";
  const result = matcher.matches(text, pattern, {
    populateResult: true,
    explain: true,
  });

  console.log(`text:    ${JSON.stringify(text)}`);
  console.log(`pattern: ${JSON.stringify(pattern)}`);
  console.log(`match:   ${result.matching}`);
  for (const interpretation of result.interpretations ?? []) {
    for (const annotation of interpretation) {
      const data = annotation.data === undefined ? "" : ` -> ${JSON.stringify(annotation.data)}`;
      console.log(
        `  ${annotation.type.padEnd(14)} [${annotation.start}:${annotation.end}] ${JSON.stringify(text.slice(annotation.start, annotation.end))}${data}`,
      );
    }
  }

  console.log();
  console.log("generated samples:");
  for (const samplePattern of [
    "[tag:fruit]",
    "[i:Hello] [r:[a-z]+]",
    "[char:0x1F617]",
  ]) {
    console.log(
      `  ${samplePattern.padEnd(22)} -> ${JSON.stringify(matcher.generateSample(samplePattern))}`,
    );
  }
}

function run(
  pattern: string,
  text: string,
  options: { explain: boolean; contains: boolean; tags?: string },
): number {
  const matcher = new FlexiMatcher({ explain: options.explain });
  if (options.tags !== undefined) {
    readTagsFromTsv(options.tags, matcher);
  }
  const result = matcher.matches(text, pattern, {
    populateResult: true,
    matchWhole: !options.contains,
  });
  console.log(`match: ${result.matching}`);
  for (const line of result.highlightedStrings(text)) {
    console.log(`  ${line}`);
  }
  return result.matching ? 0 : 1;
}

function usage(): string {
  return [
    "Usage: fleximatcher [options] [TEXT PATTERN]",
    "",
    "With no arguments a short demo is shown; with TEXT and PATTERN a single",
    "match is performed.",
    "",
    "Options:",
    "  --contains   look for the pattern anywhere in TEXT",
    "  --explain    include __explain information in tag annotations",
    "  --tags FILE  load tag productions from a TSV file",
    "  --demo       show the demo even when arguments are present",
    "  --help       show this help",
  ].join("\n");
}

/** Entry point for the `fleximatcher` console script. */
export function main(argv: string[] = process.argv.slice(2)): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        contains: { type: "boolean", default: false },
        explain: { type: "boolean", default: false },
        tags: { type: "string" },
        demo: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    return 2;
  }

  const { values, positionals } = parsed;
  if (values.help) {
    console.log(usage());
    return 0;
  }
  if (values.demo || positionals.length === 0) {
    demo();
    return 0;
  }
  if (positionals.length !== 2) {
    console.error("provide exactly TEXT and PATTERN, or use --demo");
    console.error(usage());
    return 2;
  }
  try {
    return run(positionals[1], positionals[0], {
      explain: values.explain,
      contains: values.contains,
      tags: values.tags,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exit(main());
}
