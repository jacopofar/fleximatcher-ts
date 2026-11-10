/**
 * Browser-safe Wiktionary annotators.
 *
 * This entry avoids `node:fs`, `node:zlib` and the streaming builder.  Use
 * `WiktionaryLexicon.fromData` or `fromEntries` to supply a lexicon.
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
