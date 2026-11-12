/**
 * Browser-safe fleximatcher core.
 *
 * This entry excludes the Node-only TSV file loader, CLI and Wiktionary data
 * loader.  Use `fleximatcher/wiktionary/browser` for browser-side Wiktionary
 * rules and `WiktionaryLexicon.fromData` for an in-memory lexicon.
 */

export {
  Annotation,
  AnnotationStore,
  Annotator,
  type AnnotatorMatchOptions,
  buildDiagnostics,
  type CheckSequenceOptions,
  type CheckSequenceResult,
  type MatchDiagnostics,
  MatchFrame,
  MatchResult,
  type MissingPart,
  stableKey,
  type TagDiagnostics,
  tagDiagnosticsOf,
} from "./annotations.js";
export {
  type AsyncAnnotateOptions,
  type AsyncAnnotateResult,
  type AsyncAnnotationInput,
  type AsyncMatchOptions,
  type AsyncMatchResult,
  type AsyncRuleBinding,
  type AsyncRuleFactory,
  annotateAsync,
  matchesAsync,
  type PrefetchedRules,
  prefetchAsyncRules,
} from "./async.js";
export {
  Budget,
  BudgetExceededError,
  type BudgetExceededReason,
  type BudgetOptions,
} from "./budget.js";
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
  type AnnotateError,
  type AnnotateOptions,
  type AnnotateResult,
  type AnnotateRule,
  type CompiledPart,
  CompiledPattern,
  FlexiMatcher,
  type FlexiMatcherOptions,
  type InternalMatchOptions,
  type MatchOptions,
} from "./matcher.js";
export {
  type ProvenanceAnnotationLike,
  type ProvenanceEdge,
  ProvenanceGraph,
  type ProvenanceGraphOptions,
  type ProvenanceJSON,
  type ProvenanceNode,
  type ProvenanceSVGOptions,
} from "./provenance.js";
export {
  InsensitiveCaseRule,
  InsensitiveCaseRuleFactory,
  type InsensitiveCaseRuleFactoryOptions,
  MultiRule,
  MultiRuleFactory,
  OrRule,
  OrRuleFactory,
  PlainTextRule,
  RegexRule,
  RegexRuleFactory,
  type RegexRuleFactoryOptions,
  RepeatRule,
  RepeatRuleFactory,
  type RepeatRuleOptions,
  type Rule,
  type RuleFactory,
  SingleCharRuleFactory,
} from "./rules.js";
export {
  RuleDefinition,
  type RuleDefinitionOptions,
  TagClosureState,
  type TagClosureStats,
  TagRule,
  TagRuleFactory,
  type TagRuleOptions,
} from "./tag.js";
export {
  type AnnotationSchema,
  AnnotationTemplate,
  type AnnotationTemplateContext,
  type AnnotationTemplateExpression,
  PLACEHOLDER_RE,
} from "./templates.js";

export const VERSION = "0.1.0";
