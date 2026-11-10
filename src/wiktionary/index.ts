/**
 * Optional Wiktionary-backed annotators.
 *
 * Import from `fleximatcher/wiktionary`:
 *
 * ```ts
 * import { FlexiMatcher } from "fleximatcher";
 * import { loadWiktionaryLexicon, registerWiktionaryRules } from "fleximatcher/wiktionary";
 *
 * const lexicon = await loadWiktionaryLexicon("data/wiktionary-it.jsonl.gz");
 * const matcher = new FlexiMatcher();
 * registerWiktionaryRules(matcher, lexicon, { prefix: "it" });
 * ```
 */

export {
  WiktionaryLexicon,
  createWiktionaryEntry,
  type CompactWiktionaryEntry,
  type FullWiktionaryEntryInput,
  type WiktionaryEntry,
  type WiktionaryEntryInput,
  type WiktionaryLexiconData,
  type WiktionaryLexiconLoadOptions,
} from "./lexicon.js";
export { loadWiktionaryLexicon } from "./load.js";
export {
  normalizeFeature,
  normalizeGender,
  normalizeNumber,
  normalizePerson,
  normalizePos,
  normalizeWordKey,
} from "./normalize.js";
export {
  entryMatchesQuery,
  parseWiktionaryQuery,
  type WiktionaryQuery,
} from "./query.js";
export {
  WiktionaryRule,
  WiktionaryRuleFactory,
  registerWiktionaryRules,
  type RegisterWiktionaryOptions,
  type WiktionaryRuleOptions,
} from "./rules.js";
export { tokenizeWords, type WordToken } from "./tokenize.js";
export {
  transformEntry,
  type LexiconEntry,
  type WiktextractEntry,
  type WiktextractForm,
  type WiktextractFormOf,
  type WiktextractSense,
  type WiktextractTemplate,
} from "./transform.js";
