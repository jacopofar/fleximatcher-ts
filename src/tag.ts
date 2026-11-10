/**
 * Tag definitions and the recursive `tag` rule.
 *
 * Tags are grammar rules.  `addTagRule("fruit", "an [tag:fruit]", ...)` says
 * that the tag `fruit` can match `"an "` followed by anything already known
 * to be a `fruit`.  Tags may be mutually recursive; expansion is monotone and
 * stops at a fixed point, with a maximum nesting guard for pathological
 * grammars.
 */

import { Annotation, stableKey } from "./annotations.js";
import type { Annotator, MatchFrame } from "./annotations.js";
import {
  MaxNestingError,
  PatternError,
  UnknownTagError,
} from "./errors.js";
import { isRuleChunk, parameter, ruleName, splitPattern, usedTags, usesOptional } from "./expressions.js";
import type { CompiledPattern, FlexiMatcher } from "./matcher.js";
import type { Rule, RuleFactory } from "./rules.js";
import {
  AnnotationTemplate,
  type AnnotationSchema,
  type AnnotationTemplateExpression,
} from "./templates.js";

/** Options for a tag production. */
export interface RuleDefinitionOptions<TData = unknown> {
  /** Stable identifier used to replace or remove the production later. */
  identifier?: string | null;
  /** Annotation template: a string, native object/array, or function. */
  template?: AnnotationTemplateExpression;
  /** Optional validation/coercion for the generated annotation data. */
  schema?: AnnotationSchema<TData>;
}

export type TagRuleOptions<TData = unknown> = RuleDefinitionOptions<TData>;

/** One production of a tag: a pattern, an identifier and a template. */
export class RuleDefinition<TData = unknown> {
  readonly pattern: string;
  readonly identifier: string | null;
  readonly template: AnnotationTemplate<TData>;

  constructor(pattern: string, options: RuleDefinitionOptions<TData> = {}) {
    const chunks = splitPattern(pattern);
    if (chunks.length === 0) {
      throw new PatternError("A tag production cannot be empty");
    }
    if (
      usesOptional(pattern) &&
      options.template !== undefined &&
      options.template !== null &&
      typeof options.template !== "function"
    ) {
      throw new PatternError(
        `A tag production that uses [optional:...] must use a function template: a skipped optional chunk is absent from the matched sequence, so positional placeholders would refer to the wrong annotation (pattern: ${JSON.stringify(pattern)})`,
      );
    }
    this.pattern = pattern;
    this.identifier = options.identifier ?? null;
    this.template = new AnnotationTemplate<TData>(
      options.template ?? null,
      options.schema ?? null,
    );
  }

  /** The original annotation template expression. */
  get annotationTemplate(): AnnotationTemplateExpression {
    return this.template.expression;
  }

  /** Whether this production refers to any tag. */
  get isRecursive(): boolean {
    return this.pattern.includes("[tag:");
  }

  /** Expand this production's annotation template for a match. */
  buildAnnotation(text: string, sequence: readonly Annotation[]): TData {
    return this.template.build(text, sequence);
  }

  equals(other: unknown): boolean {
    if (!(other instanceof RuleDefinition)) {
      return false;
    }
    const left = this.template.expression;
    const right = other.template.expression;
    const sameTemplate =
      typeof left === "function" || typeof right === "function"
        ? left === right
        : stableKey(left) === stableKey(right);
    return (
      this.pattern === other.pattern &&
      this.identifier === other.identifier &&
      sameTemplate
    );
  }

  toString(): string {
    return `RuleDefinition(pattern=${JSON.stringify(this.pattern)}, identifier=${JSON.stringify(this.identifier)}, annotation=${this.template.toString()})`;
  }
}

/** Diagnostic counters for one store's tag closure. */
export interface TagClosureStats {
  /** Number of tag evaluations (one per tag popped from the worklist). */
  evaluatedTags: number;
  /** Number of distinct tags discovered while closing. */
  visitedTags: number;
  /** Deepest tag derivation produced. */
  maxDepth: number;
  /** Productions skipped because they exceeded the nesting limit. */
  prunedByDepth: number;
  /** Tags treated as opaque because a production uses dynamic tags. */
  opaqueTags: number;
}

function emptyTagStats(): TagClosureStats {
  return {
    evaluatedTags: 0,
    visitedTags: 0,
    maxDepth: 0,
    prunedByDepth: 0,
    opaqueTags: 0,
  };
}

/** Per-store state for computing the tag closure without deep recursion. */
export class TagClosureState {
  expanding = false;
  readonly tags = new Set<string>();
  /**
   * Derivation depth of each derived tag annotation, keyed by its
   * {@link Annotation.key}.  Used to enforce the maximum nesting limit.
   */
  readonly depths = new Map<string, number>();
  /** Accumulated diagnostic counters. */
  readonly stats: TagClosureStats = emptyTagStats();
}

/**
 * The rule behind `[tag:name]`.
 *
 * Tag expansion is computed cooperatively: the first `tag` rule invoked on a
 * store runs a fixed-point closure over the relevant productions, and nested
 * tag rules simply register their tag for the closure.  This avoids deep,
 * repetitive recursion while still supporting mutually recursive grammars.
 */
export class TagRule implements Rule {
  private readonly factory: TagRuleFactory;
  readonly name: string;

  constructor(factory: TagRuleFactory, name: string) {
    this.factory = factory;
    this.name = name;
  }

  annotate(text: string, annotator: Annotator): boolean {
    const store = annotator.store;
    const existing = store.extras.get("tag_closure");
    const state =
      existing instanceof TagClosureState ? existing : new TagClosureState();
    if (existing !== state) {
      store.extras.set("tag_closure", state);
    }

    if (!state.expanding) {
      this.factory.closeTags(text, annotator, state, this.name);
    } else {
      // The closure loop will process this tag in its next iteration.
      state.tags.add(this.name);
    }

    return store.has(0, text.length, annotator.type);
  }

  toString(): string {
    return `TagRule(${JSON.stringify(this.name)})`;
  }
}

function frameStack(frame: MatchFrame): string[] {
  const stack: string[] = [];
  let current: MatchFrame | null = frame;
  while (current !== null) {
    stack.push(current.matcher);
    current = current.parent;
  }
  return stack.reverse();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function withExplanation(
  definition: RuleDefinition,
  sequence: readonly Annotation[],
  data: unknown,
): unknown {
  let base: Record<string, unknown>;
  if (data === undefined || data === null) {
    base = {};
  } else if (isRecord(data)) {
    base = { ...data };
  } else {
    return data;
  }

  const children = sequence.map((annotation) => {
    const child: Record<string, unknown> = {
      start: annotation.start,
      end: annotation.end,
      type: annotation.type,
    };
    if (isRecord(annotation.data) && "__explain" in annotation.data) {
      child.__explain = annotation.data.__explain;
    }
    return child;
  });

  base.__explain = {
    id: definition.identifier,
    children,
  };
  return base;
}

/** Store tag productions and create {@link TagRule} instances. */
export class TagRuleFactory implements RuleFactory {
  private readonly matcher: FlexiMatcher;
  private readonly rules = new Map<string, RuleDefinition[]>();
  private readonly snapshotCache = new Map<string, readonly RuleDefinition[]>();
  private compiledPatterns = new WeakMap<RuleDefinition, CompiledPattern>();
  private dependentsCache: Map<string, Set<string>> | null = null;
  private opaqueTagsCache: Set<string> | null = null;
  private maximumNestingValue = 15;
  private throwOnMaxDepthValue = false;

  constructor(matcher: FlexiMatcher) {
    this.matcher = matcher;
  }

  /** Maximum number of nested tag expansions (default `15`). */
  get maximumNesting(): number {
    return this.maximumNestingValue;
  }

  set maximumNesting(depth: number) {
    this.setMaximumNesting(depth);
  }

  setMaximumNesting(depth: number): void {
    if (!Number.isInteger(depth) || depth < 0) {
      throw new RangeError("The maximum nesting level must be a non-negative integer");
    }
    this.maximumNestingValue = depth;
  }

  /** Whether exceeding the nesting limit raises instead of failing. */
  get throwOnMaxDepth(): boolean {
    return this.throwOnMaxDepthValue;
  }

  set throwOnMaxDepth(value: boolean) {
    this.throwOnMaxDepthValue = Boolean(value);
  }

  setThrowOnMaxDepth(value: boolean): void {
    this.throwOnMaxDepthValue = Boolean(value);
  }

  /**
   * Add a production for `tag`.
   *
   * Returns `true` when a production with the same identifier was replaced,
   * `false` otherwise.  A production may not be a direct self-reference such as
   * `[tag:fruit]` for tag `fruit`.
   */
  addTagRule<TData = unknown>(
    tag: string,
    pattern: string,
    options: TagRuleOptions<TData> = {},
  ): boolean {
    if (!tag) {
      throw new PatternError("A tag name cannot be empty");
    }
    if (pattern === `[tag:${tag}]`) {
      throw new PatternError(
        `Circular definition of tag ${JSON.stringify(tag)}: ${JSON.stringify(pattern)} cannot be its own production`,
      );
    }
    return this.addTagDefinition(tag, new RuleDefinition<TData>(pattern, options));
  }

  /** Add an already-built {@link RuleDefinition} for `tag`. */
  addTagDefinition<TData = unknown>(
    tag: string,
    definition: RuleDefinition<TData>,
  ): boolean {
    if (!tag) {
      throw new PatternError("A tag name cannot be empty");
    }
    const definitions = this.rules.get(tag);
    if (definitions === undefined) {
      this.rules.set(tag, [definition]);
      this.snapshotCache.delete(tag);
      this.invalidateDependencies();
      return false;
    }

    let removed = false;
    if (definition.identifier !== null) {
      const kept = definitions.filter(
        (item) => item.identifier !== definition.identifier,
      );
      removed = kept.length !== definitions.length;
      definitions.length = 0;
      definitions.push(...kept);
    }
    definitions.push(definition);
    this.snapshotCache.delete(tag);
    this.invalidateDependencies();
    return removed;
  }

  /** Remove a production by identifier. */
  removeTagRule(tag: string, identifier: string): boolean {
    if (!tag) {
      throw new PatternError("The tag cannot be empty");
    }
    if (identifier === undefined || identifier === null) {
      throw new PatternError("The identifier cannot be null or undefined");
    }
    const definitions = this.rules.get(tag);
    if (definitions === undefined) {
      throw new UnknownTagError(`Unknown tag ${JSON.stringify(tag)}`);
    }

    const kept = definitions.filter((item) => item.identifier !== identifier);
    const removed = kept.length !== definitions.length;
    if (kept.length > 0) {
      definitions.length = 0;
      definitions.push(...kept);
    } else {
      this.rules.delete(tag);
    }
    this.snapshotCache.delete(tag);
    this.invalidateDependencies();
    return removed;
  }

  /** Remove every tag production. */
  clearTags(): void {
    this.rules.clear();
    this.snapshotCache.clear();
    this.compiledPatterns = new WeakMap();
    this.invalidateDependencies();
  }

  /**
   * Invalidate dependency analysis after rule binding changes.
   *
   * @internal
   */
  invalidateDependencies(): void {
    this.dependentsCache = null;
    this.opaqueTagsCache = null;
  }

  /** The currently defined tag names. */
  get tagNames(): readonly string[] {
    return [...this.rules.keys()];
  }

  /** The productions of `tag` (empty when the tag is unknown). */
  tagDefinitions(tag: string): readonly RuleDefinition[] {
    return [...(this.rules.get(tag) ?? [])];
  }

  /** Return the production of `tag` with `identifier`, if any. */
  getTagRule(tag: string, identifier: string): RuleDefinition | undefined {
    return (this.rules.get(tag) ?? []).find(
      (definition) => definition.identifier === identifier,
    );
  }

  /**
   * A stable copy of the tag productions, terminals first.
   *
   * Terminal productions are tried before recursive ones: this makes the
   * fixed-point iteration reach useful annotations earlier.
   */
  snapshot(tag: string): readonly RuleDefinition[] {
    const cached = this.snapshotCache.get(tag);
    if (cached !== undefined) {
      return cached;
    }
    const snapshot = [...(this.rules.get(tag) ?? [])].sort(
      (left, right) => Number(left.isRecursive) - Number(right.isRecursive),
    );
    this.snapshotCache.set(tag, snapshot);
    return snapshot;
  }

  private compiledFor(definition: RuleDefinition): CompiledPattern {
    let compiled = this.compiledPatterns.get(definition);
    if (compiled === undefined) {
      compiled = this.matcher.compile(definition.pattern);
      this.compiledPatterns.set(definition, compiled);
    }
    return compiled;
  }

  private patternUsesDynamicTags(pattern: string): boolean {
    for (const chunk of splitPattern(pattern)) {
      if (!isRuleChunk(chunk)) {
        continue;
      }
      let name: string;
      try {
        name = ruleName(chunk);
      } catch {
        return true;
      }
      if (name === "tag") {
        continue;
      }
      if (name === "multi" || name === "or" || name === "repeat" || name === "optional") {
        if (this.patternUsesDynamicTags(parameter(chunk))) {
          return true;
        }
        continue;
      }
      if (this.matcher.getBoundRule(name)?.usesTags === true) {
        return true;
      }
    }
    return false;
  }

  private dependencies(): {
    dependents: Map<string, Set<string>>;
    opaque: Set<string>;
  } {
    if (this.dependentsCache !== null && this.opaqueTagsCache !== null) {
      return {
        dependents: this.dependentsCache,
        opaque: this.opaqueTagsCache,
      };
    }

    const dependents = new Map<string, Set<string>>();
    const opaque = new Set<string>();

    for (const [tag, definitions] of this.rules) {
      for (const definition of definitions) {
        for (const used of usedTags(definition.pattern)) {
          let bucket = dependents.get(used);
          if (bucket === undefined) {
            bucket = new Set();
            dependents.set(used, bucket);
          }
          bucket.add(tag);
        }
        if (this.patternUsesDynamicTags(definition.pattern)) {
          opaque.add(tag);
        }
      }
    }

    this.dependentsCache = dependents;
    this.opaqueTagsCache = opaque;
    return { dependents, opaque };
  }

  /**
   * Derive all tag annotations reachable from `rootTag`.
   *
   * This is a semi-naive monotone fixed point.  A dirty-tag worklist is seeded
   * with the root tag; nested `tag` rules register newly seen tags in
   * `state.tags`, and a static dependency graph re-queues only the productions
   * that can be affected by a tag whose annotations changed.  Rules that
   * declare `usesTags: true` are handled conservatively as opaque productions.
   */
  closeTags(
    text: string,
    annotator: Annotator,
    state: TagClosureState,
    rootTag: string,
  ): void {
    const store = annotator.store;
    const { dependents, opaque } = this.dependencies();
    state.expanding = true;
    state.tags.add(rootTag);
    state.stats.opaqueTags = opaque.size;
    store.extras.set("tag_stats", state.stats);

    const dirty = new Set<string>([rootTag]);
    const queued = new Set<string>([rootTag]);
    const evaluated = new Set<string>();

    const enqueue = (tag: string): void => {
      if (!queued.has(tag)) {
        queued.add(tag);
        dirty.add(tag);
      }
    };

    try {
      let ticks = 0;
      while (dirty.size > 0) {
        const tag = dirty.values().next().value;
        if (tag === undefined) {
          break;
        }
        dirty.delete(tag);
        queued.delete(tag);
        annotator.budget.check();

        const tagType = `[tag:${tag}]`;
        const before = store.ofType(tagType).length;

        for (const definition of this.snapshot(tag)) {
          annotator.budget.check();
          const compiled = this.compiledFor(definition);
          const result = this.matcher._matchCompiled(text, compiled, {
            store,
            frame: annotator.frame.child(definition.pattern, store.size),
            fullyAnnotate: false,
            matchWhole: false,
            populateResult: true,
            budget: annotator.budget,
          });

          for (const sequence of result.interpretations ?? []) {
            ticks += 1;
            if ((ticks & 255) === 0) {
              annotator.budget.check();
            }
            if (sequence.length === 0) {
              continue;
            }
            const childDepths: number[] = [];
            for (const child of sequence) {
              const childDepth = state.depths.get(child.key);
              if (childDepth !== undefined) {
                childDepths.push(childDepth);
              }
            }
            const depth =
              childDepths.length === 0 ? 0 : 1 + Math.max(...childDepths);
            if (depth > this.maximumNestingValue) {
              state.stats.prunedByDepth += 1;
              if (this.throwOnMaxDepthValue) {
                throw new MaxNestingError(
                  `Reached the maximum tag expansion depth (${this.maximumNestingValue}) while matching tag ${JSON.stringify(tag)}. Pattern stack: ${JSON.stringify(frameStack(annotator.frame))}`,
                );
              }
              continue;
            }
            if (depth > state.stats.maxDepth) {
              state.stats.maxDepth = depth;
            }

            let data = definition.buildAnnotation(text, sequence);
            if (store.explain) {
              data = withExplanation(definition, sequence, data);
            }
            const annotation = new Annotation(
              sequence[0].start,
              sequence[sequence.length - 1].end,
              tagType,
              data,
            );
            if (store.add(annotation)) {
              state.depths.set(annotation.key, depth);
            }
          }
        }

        evaluated.add(tag);
        state.stats.evaluatedTags += 1;
        state.stats.visitedTags = state.tags.size;

        // Tags discovered dynamically by nested rules (including custom rules
        // that call annotator.match) are enqueued once.
        for (const seen of state.tags) {
          if (!evaluated.has(seen)) {
            enqueue(seen);
          }
        }

        if (store.ofType(tagType).length > before) {
          for (const dependent of dependents.get(tag) ?? []) {
            enqueue(dependent);
          }
          for (const opaqueTag of opaque) {
            enqueue(opaqueTag);
          }
        }
      }
    } finally {
      state.expanding = false;
    }
  }

  /** Create the rule for a `[tag:name]` chunk. */
  getRule(parameter: string): TagRule {
    if (!parameter) {
      throw new PatternError("A tag name cannot be empty");
    }
    return new TagRule(this, parameter);
  }

  /** Generate a sample string for a tag, where possible. */
  generateSample(parameter: string): string | null {
    return this.generateTagSample(parameter, 0, new Set());
  }

  private generateTagSample(
    name: string,
    depth: number,
    stack: Set<string>,
  ): string | null {
    let definitions = [...this.snapshot(name)];
    if (definitions.length === 0) {
      // Unknown tag: leave the original chunk as a visible placeholder.
      return `[tag:${name}]`;
    }

    const limit = Math.max(this.maximumNestingValue, 10);
    if (depth >= limit || stack.has(name)) {
      const terminals = definitions.filter((definition) => !definition.isRecursive);
      if (terminals.length > 0) {
        definitions = terminals;
      } else {
        return null;
      }
    }

    const definition = definitions[Math.floor(Math.random() * definitions.length)];
    const pieces: string[] = [];
    for (const chunk of splitPattern(definition.pattern)) {
      if (!isRuleChunk(chunk)) {
        pieces.push(chunk);
        continue;
      }

      const chunkName = ruleName(chunk);
      let sample: string | null | undefined;
      if (chunkName === "tag") {
        sample = this.generateTagSample(
          parameter(chunk),
          depth + 1,
          new Set([...stack, name]),
        );
      } else {
        const factory = this.matcher.getBoundRule(chunkName);
        if (factory === undefined) {
          pieces.push(chunk);
          continue;
        }
        sample = factory.generateSample(parameter(chunk));
      }
      pieces.push(sample ?? chunk);
    }
    return pieces.join("");
  }
}
