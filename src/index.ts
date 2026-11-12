/**
 * Fleximatcher: annotate and bottom-up parse natural language text.
 *
 * Patterns mix literal text with rule invocations in square brackets:
 *
 * ```text
 * the [i:dog] eats [tag:fruit]
 * ```
 *
 * Rules annotate spans of the input; matching then becomes a search for
 * consecutive annotations covering the pattern chunks in order.  Tags turn the
 * matcher into a small generative grammar, so patterns can recurse.
 *
 * @example
 * ```ts
 * import { FlexiMatcher } from "fleximatcher";
 *
 * const matcher = new FlexiMatcher();
 * matcher.addTagRule("fruit", "pear", {
 *   identifier: "id_pear",
 *   template: { fruitName: "pear" },
 * });
 * matcher.addTagRule("fruit", "a [tag:fruit]", {
 *   identifier: "id_a_fruit",
 *   template: {
 *     fruitName: "${1.fruitName}",
 *     article: "${0}",
 *   },
 * });
 *
 * const result = matcher.matches(
 *   "the dog eats a pear",
 *   "the dog eats [tag:fruit]",
 *   { populateResult: true },
 * );
 * console.log(result.matching); // true
 * ```
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
export { main } from "./cli.js";
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
  usesOptional,
} from "./expressions.js";
export {
  type AnnotateError,
  type AnnotateOptions,
  type AnnotateResult,
  type AnnotateRule,
  type BatchAnnotateOptions,
  type BatchAnnotateResult,
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
  OptionalRule,
  OptionalRuleFactory,
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
  WhitespaceRule,
  WhitespaceRuleFactory,
  WordRule,
  WordRuleFactory,
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
export {
  readTagsFromTsv,
  readTagsFromTsvLines,
  readTagsFromTsvText,
} from "./tsv.js";

export const VERSION = "0.1.0";
