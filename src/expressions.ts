/**
 * Parsing of fleximatcher patterns.
 *
 * A pattern is a plain string where text outside square brackets is matched
 * literally and every `[name:parameter]` chunk invokes a rule.  The helpers in
 * this module only split and inspect patterns; they never execute rules.
 */

import { PatternError } from "./errors.js";

/**
 * Split a pattern into chunks, preserving every character.
 *
 * Plain text and rule chunks are returned in order; the concatenation of the
 * result is always the original pattern (except that empty chunks are
 * dropped).  Square brackets may nest, which is how a `multi` rule can hold
 * several sub-patterns:
 *
 * ```ts
 * splitPattern("the dog [pos: verb] the wall");
 * // ["the dog ", "[pos: verb]", " the wall"]
 * splitPattern("[multi:[i:a][i:b]]");
 * // ["[multi:[i:a][i:b]]"]
 * ```
 *
 * @throws {@link PatternError} when brackets are unbalanced.
 */
export function splitPattern(pattern: string): string[] {
  if (!pattern.includes("[")) {
    return pattern ? [pattern] : [];
  }

  const chunks: string[] = [];
  let last = 0;
  let depth = 0;

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === "[") {
      depth += 1;
      if (depth === 1) {
        if (index > last) {
          chunks.push(pattern.slice(last, index));
        }
        last = index;
      }
    } else if (character === "]") {
      depth -= 1;
      if (depth < 0) {
        throw new PatternError(
          `Square brackets are unbalanced in pattern ${JSON.stringify(pattern)}`,
        );
      }
      if (depth === 0) {
        chunks.push(pattern.slice(last, index + 1));
        last = index + 1;
      }
    }
  }

  if (depth !== 0) {
    throw new PatternError(
      `Square brackets are unbalanced in pattern ${JSON.stringify(pattern)}`,
    );
  }
  if (last < pattern.length) {
    chunks.push(pattern.slice(last));
  }
  return chunks;
}

/** Return `true` when `chunk` is a `[...]` rule invocation. */
export function isRuleChunk(chunk: string): boolean {
  return chunk.startsWith("[") && chunk.endsWith("]");
}

function innerChunk(chunk: string): string {
  if (!isRuleChunk(chunk)) {
    throw new PatternError(
      `Expected a rule chunk in square brackets, got ${JSON.stringify(chunk)}`,
    );
  }
  return chunk.slice(1, -1);
}

/**
 * Return the rule name of a rule chunk.
 *
 * ```ts
 * ruleName("[it-pos: Ss]"); // "it-pos"
 * ruleName("[multi:[i:a]]"); // "multi"
 * ```
 */
export function ruleName(chunk: string): string {
  const inner = innerChunk(chunk);
  const name = inner.split(":", 1)[0];
  if (!name || name.includes("[") || name.includes("]")) {
    throw new PatternError(
      `Malformed rule name in chunk ${JSON.stringify(chunk)}`,
    );
  }
  return name;
}

/**
 * Return the parameter of a rule chunk, or `""` when it has none.
 *
 * ```ts
 * parameter("[it-pos: Ss]"); // " Ss"
 * parameter("[token]"); // ""
 * ```
 */
export function parameter(chunk: string): string {
  const inner = innerChunk(chunk);
  const separator = inner.indexOf(":");
  return separator === -1 ? "" : inner.slice(separator + 1);
}

/** Combinators whose parameter is itself a pattern. */
const NESTED_PATTERN_RULES = new Set(["multi", "or", "repeat", "optional"]);

/**
 * Return the names of the tags used by `pattern`, including nested ones.
 *
 * `multi` parameters are inspected recursively so that
 * `[multi:[tag:a][tag:b]]` reports `{"a", "b"}`.
 */
export function usedTags(pattern: string): Set<string> {
  const result = new Set<string>();
  for (const chunk of splitPattern(pattern)) {
    if (!isRuleChunk(chunk)) {
      continue;
    }
    let name: string;
    try {
      name = ruleName(chunk);
    } catch {
      continue;
    }
    if (name === "tag") {
      result.add(parameter(chunk));
    } else if (NESTED_PATTERN_RULES.has(name)) {
      for (const tag of usedTags(parameter(chunk))) {
        result.add(tag);
      }
    }
  }
  return result;
}

/**
 * Whether `pattern` contains an `[optional:...]` chunk, including nested ones.
 *
 * Tag productions that use optional chunks cannot use positional `${N}`
 * templates: a skipped chunk is absent from the matched sequence, so indices
 * would silently refer to the wrong annotation.
 */
export function usesOptional(pattern: string): boolean {
  for (const chunk of splitPattern(pattern)) {
    if (!isRuleChunk(chunk)) {
      continue;
    }
    let name: string;
    try {
      name = ruleName(chunk);
    } catch {
      continue;
    }
    if (name === "optional") {
      return true;
    }
    if (NESTED_PATTERN_RULES.has(name) && usesOptional(parameter(chunk))) {
      return true;
    }
  }
  return false;
}
