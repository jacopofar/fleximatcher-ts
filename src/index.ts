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
export {
  readTagsFromTsv,
  readTagsFromTsvLines,
  readTagsFromTsvText,
} from "./tsv.js";
export { main } from "./cli.js";

export const VERSION = "0.1.0";
