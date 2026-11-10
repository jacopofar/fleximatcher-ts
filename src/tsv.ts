/**
 * Load tag productions from tab-separated files.
 *
 * Each non-comment line describes one tag production.  The accepted columns
 * are:
 *
 * | columns | fields |
 * | ------- | ------ |
 * | 2 | `tag`, `pattern` |
 * | 3 | `tag`, `pattern`, `annotation template` |
 * | 4 | `tag`, `pattern`, `identifier`, `annotation template` |
 *
 * Lines starting with `#` and blank lines are ignored.  When no identifier is
 * given, `<dataset>_<line number>` is used.  An empty template column means
 * "no annotation".
 */

import { readFileSync } from "node:fs";
import type { FlexiMatcher } from "./matcher.js";

/** Load tag productions from a file; return how many were inserted. */
export function readTagsFromTsv(
  path: string,
  matcher: FlexiMatcher,
  datasetName?: string,
): number {
  const content = readFileSync(path, "utf8");
  return readTagsFromTsvText(content, matcher, datasetName ?? path);
}

/** Load tag productions from a string; return how many were inserted. */
export function readTagsFromTsvText(
  content: string,
  matcher: FlexiMatcher,
  datasetName = "tsv",
): number {
  const normalized = content.replace(/^\uFEFF/, "");
  return readTagsFromTsvLines(normalized.split(/\r\n|\n|\r/), matcher, datasetName);
}

/** Load tag productions from an iterable of lines; return how many were inserted. */
export function readTagsFromTsvLines(
  lines: Iterable<string>,
  matcher: FlexiMatcher,
  datasetName: string,
): number {
  let inserted = 0;
  let lineNumber = 0;

  for (const rawLine of lines) {
    lineNumber += 1;
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }

    const columns = line.split("\t");
    let tag: string;
    let pattern: string;
    let identifier: string | null = null;
    let template: string | null = null;

    if (columns.length === 2) {
      [tag, pattern] = columns;
    } else if (columns.length === 3) {
      [tag, pattern, template] = columns;
    } else if (columns.length === 4) {
      [tag, pattern, identifier, template] = columns;
    } else {
      throw new Error(
        `Line ${lineNumber} of ${JSON.stringify(datasetName)} has ${columns.length} columns; expected 2 (tag, pattern), 3 (tag, pattern, annotation) or 4 (tag, pattern, identifier, annotation)`,
      );
    }

    const effectiveIdentifier =
      identifier === null || identifier === ""
        ? `${datasetName}_${lineNumber}`
        : identifier;
    const effectiveTemplate = template === null || template.trim() === "" ? null : template;

    const replaced = matcher.addTagRule(tag, pattern, {
      identifier: effectiveIdentifier,
      template: effectiveTemplate,
    });
    if (!replaced) {
      inserted += 1;
    }
  }

  return inserted;
}
