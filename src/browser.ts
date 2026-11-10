/**
 * Browser-safe fleximatcher core.
 *
 * This entry excludes the Node-only TSV file loader, CLI and Wiktionary data
 * loader.  Use `fleximatcher/wiktionary/browser` for browser-side Wiktionary
 * rules and `WiktionaryLexicon.fromData` for an in-memory lexicon.
 */

export {
  Budget,
  BudgetExceededError,
  type BudgetExceededReason,
  type BudgetOptions,
} from "./budget.js";
export {
  Annotation,
  AnnotationStore,
  Annotator,
  MatchFrame,
  MatchResult,
  buildDiagnostics,
  stableKey,
  tagDiagnosticsOf,
  type AnnotatorMatchOptions,
  type CheckSequenceOptions,
  type CheckSequenceResult,
  type MatchDiagnostics,
  type MissingPart,
  type TagDiagnostics,
} from "./annotations.js";
export {
  AnnotationError,
  FlexiMatcherError,
  MaxNestingError,
  PatternError,
  RuleError,
  UnknownMacroError,
  UnknownRuleError,
  UnknownTagError,
} from "./errors.js";
export {
  isRuleChunk,
  parameter,
  ruleName,
  splitPattern,
  usedTags,
} from "./expressions.js";
export {
  CompiledPattern,
  FlexiMatcher,
  type AnnotateError,
  type AnnotateOptions,
  type AnnotateResult,
  type AnnotateRule,
  type CompiledPart,
  type FlexiMatcherOptions,
  type InternalMatchOptions,
  type MatchOptions,
} from "./matcher.js";
export {
  InsensitiveCaseRule,
  InsensitiveCaseRuleFactory,
  MultiRule,
  MultiRuleFactory,
  OrRule,
  OrRuleFactory,
  PlainTextRule,
  RegexRule,
  RegexRuleFactory,
  RepeatRule,
  RepeatRuleFactory,
  SingleCharRuleFactory,
  type InsensitiveCaseRuleFactoryOptions,
  type RegexRuleFactoryOptions,
  type RepeatRuleOptions,
  type Rule,
  type RuleFactory,
} from "./rules.js";
export {
  ProvenanceGraph,
  type ProvenanceAnnotationLike,
  type ProvenanceEdge,
  type ProvenanceGraphOptions,
  type ProvenanceJSON,
  type ProvenanceNode,
  type ProvenanceSVGOptions,
} from "./provenance.js";
export {
  RuleDefinition,
  TagClosureState,
  TagRule,
  TagRuleFactory,
  type RuleDefinitionOptions,
  type TagClosureStats,
  type TagRuleOptions,
} from "./tag.js";
export {
  annotateAsync,
  matchesAsync,
  prefetchAsyncRules,
  type AsyncAnnotateOptions,
  type AsyncAnnotateResult,
  type AsyncAnnotationInput,
  type AsyncMatchOptions,
  type AsyncMatchResult,
  type AsyncRuleBinding,
  type AsyncRuleFactory,
  type PrefetchedRules,
} from "./async.js";
export {
  AnnotationTemplate,
  PLACEHOLDER_RE,
  type AnnotationSchema,
  type AnnotationTemplateContext,
  type AnnotationTemplateExpression,
} from "./templates.js";

export const VERSION = "0.1.0";
