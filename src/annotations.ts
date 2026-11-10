/**
 * Annotations, annotation stores and match results.
 *
 * The matcher works by letting every rule *annotate* the text with spans tagged
 * by the rule chunk that produced them (for example `[i:pear]`).  Matching a
 * pattern then becomes a graph search over these annotations: consecutive spans
 * must cover the pattern chunks in order.
 *
 * Every top-level call to {@link FlexiMatcher.matches} gets its own
 * {@link AnnotationStore}, so rules that recurse (`multi` and `tag`) share the
 * store of the match that invoked them while independent calls stay isolated.
 */

import { RuleError } from "./errors.js";
import { Budget } from "./budget.js";
import type { CompiledPattern, FlexiMatcher } from "./matcher.js";

/** A deterministic string key for arbitrary JSON-like annotation data. */
export function stableKey(value: unknown): string {
  const seen = new WeakSet<object>();

  const walk = (current: unknown): string => {
    if (current === null) {
      return "null";
    }
    switch (typeof current) {
      case "undefined":
        return "undefined";
      case "string":
        return JSON.stringify(current);
      case "number":
        return Number.isFinite(current) ? String(current) : JSON.stringify(String(current));
      case "boolean":
        return current ? "true" : "false";
      case "bigint":
        return `${current}n`;
      case "function":
        return `[function ${current.name || "anonymous"}]`;
      case "symbol":
        return String(current);
      case "object":
        break;
    }

    if (Array.isArray(current)) {
      return `[${current.map(walk).join(",")}]`;
    }
    if (current instanceof Date) {
      return `Date(${current.toISOString()})`;
    }
    if (seen.has(current)) {
      return "[circular]";
    }
    seen.add(current);
    const keys = Object.keys(current).sort();
    const result = `{${keys
      .map((key) => `${JSON.stringify(key)}:${walk((current as Record<string, unknown>)[key])}`)
      .join(",")}}`;
    seen.delete(current);
    return result;
  };

  return walk(value);
}

/**
 * An immutable span of text produced by a rule.
 *
 * `start` and `end` are offsets into the matched text, counted in UTF-16 code
 * units (the same units as `String.prototype.slice`).  `end` must be greater
 * than `start`: zero-length annotations are meaningless here and are silently
 * discarded by {@link Annotator.add}.
 */
export class Annotation<TData = unknown> {
  readonly start: number;
  readonly end: number;
  readonly type: string;
  readonly data: TData;
  readonly key: string;

  constructor(start: number, end: number, type: string, data?: TData) {
    if (!Number.isInteger(start) || start < 0) {
      throw new RangeError(`Annotation start must be a non-negative integer, got ${start}`);
    }
    if (!Number.isInteger(end) || end <= start) {
      throw new RangeError(
        `Annotation end (${end}) must be an integer greater than start (${start})`,
      );
    }
    if (!type) {
      throw new RangeError("Annotation type must not be empty");
    }
    this.start = start;
    this.end = end;
    this.type = type;
    this.data = data as TData;
    this.key = `${start}:${end}:${type}:${stableKey(data)}`;
  }

  /** Return the substring covered by this annotation. */
  coveredText(text: string): string {
    return text.slice(this.start, this.end);
  }

  equals(other: unknown): boolean {
    return other instanceof Annotation && this.key === other.key;
  }

  toJSON(): { start: number; end: number; type: string; data?: unknown } {
    return { start: this.start, end: this.end, type: this.type, data: this.data };
  }

  toString(): string {
    const suffix = this.data === undefined ? "" : ` => ${JSON.stringify(this.data)}`;
    return `Annotation(${this.start}:${this.end}, ${JSON.stringify(this.type)}${suffix})`;
  }
}

export interface CheckSequenceOptions {
  /** When true the last annotation must end exactly at the text length. */
  matchWhole: boolean;
  /** When true every distinct interpretation is collected. */
  populateResult: boolean;
  /** Optional cooperative budget. */
  budget?: Budget;
  /** Maximum number of interpretation sequences to retain. */
  maxInterpretations?: number;
  /**
   * Indices of parts that may be skipped.  A skipped part adds no annotation
   * to the interpretation; the sequence simply continues at the same position.
   */
  optional?: ReadonlySet<number>;
}

export interface MissingPart {
  /** Index of the part within the pattern. */
  index: number;
  /** The chunk (rule name or literal) that could not be satisfied. */
  chunk: string;
}

export interface CheckSequenceResult {
  matching: boolean;
  interpretations?: Annotation[][];
  /** Whether interpretation collection hit a limit. */
  truncated?: boolean;
  /** The first part that had no candidate annotation, when matching failed. */
  missingPart?: MissingPart | null;
  /** The furthest text position reached by a complete part prefix. */
  furthestEnd?: number;
}

/** Diagnostic counters for a store's tag closure, mirrored on results. */
export interface TagDiagnostics {
  evaluatedTags: number;
  visitedTags: number;
  maxDepth: number;
  prunedByDepth: number;
  opaqueTags: number;
}

/** Why a match succeeded, failed, or was truncated. */
export interface MatchDiagnostics {
  /** Number of collected interpretation sequences (0 when not requested). */
  interpretations: number;
  /** Whether annotation or interpretation collection hit a limit. */
  truncated: boolean;
  /** The part that could not be satisfied, when matching failed. */
  missingPart: MissingPart | null;
  /** The furthest text position reached by a complete part prefix. */
  furthestEnd: number;
  /** Budget limits in effect for this match. */
  constraints: {
    maxInterpretations: number | undefined;
    maxAnnotations: number | undefined;
    timeoutMs: number | undefined;
    aborted: boolean;
  };
  /** Aggregate tag-closure counters. */
  tags: TagDiagnostics;
  /** Human-readable warnings derived from the counters above. */
  warnings: string[];
}

const ZERO_TAG_DIAGNOSTICS: TagDiagnostics = {
  evaluatedTags: 0,
  visitedTags: 0,
  maxDepth: 0,
  prunedByDepth: 0,
  opaqueTags: 0,
};

/** Build a diagnostics object with the default (no-budget) constraints. */
export function buildDiagnostics(options: {
  store: AnnotationStore;
  interpretations?: number;
  truncated?: boolean;
  missingPart?: MissingPart | null;
  furthestEnd?: number;
  constraints?: Partial<MatchDiagnostics["constraints"]>;
}): MatchDiagnostics {
  const tags = tagDiagnosticsOf(options.store);
  const constraints = {
    maxInterpretations: options.constraints?.maxInterpretations,
    maxAnnotations: options.constraints?.maxAnnotations,
    timeoutMs: options.constraints?.timeoutMs,
    aborted: options.constraints?.aborted ?? false,
  };
  const warnings: string[] = [];
  if (options.truncated === true) {
    warnings.push("The result was truncated by a budget limit.");
  }
  if (options.store.truncated) {
    warnings.push(
      `Annotation collection stopped at ${options.store.size} annotations (maxAnnotations).`,
    );
  }
  if (tags.prunedByDepth > 0) {
    warnings.push(
      `${tags.prunedByDepth} tag production(s) were pruned at the maximum nesting depth.`,
    );
  }
  if (tags.opaqueTags > 0) {
    warnings.push(
      `${tags.opaqueTags} tag(s) use dynamic tag patterns and were re-evaluated conservatively.`,
    );
  }
  return {
    interpretations: options.interpretations ?? 0,
    truncated: options.truncated ?? false,
    missingPart: options.missingPart ?? null,
    furthestEnd: options.furthestEnd ?? 0,
    constraints,
    tags,
    warnings,
  };
}

function defaultDiagnostics(store: AnnotationStore): MatchDiagnostics {
  return buildDiagnostics({ store, truncated: store.truncated });
}

/** Read the tag stats a tag closure recorded on a store, if any. */
export function tagDiagnosticsOf(store: AnnotationStore): TagDiagnostics {
  const raw = store.extras.get("tag_stats");
  if (raw === null || typeof raw !== "object") {
    return { ...ZERO_TAG_DIAGNOSTICS };
  }
  const record = raw as Partial<TagDiagnostics>;
  return {
    evaluatedTags: record.evaluatedTags ?? 0,
    visitedTags: record.visitedTags ?? 0,
    maxDepth: record.maxDepth ?? 0,
    prunedByDepth: record.prunedByDepth ?? 0,
    opaqueTags: record.opaqueTags ?? 0,
  };
}

interface CandidateMap {
  get(position: number): Map<string, Annotation[]> | undefined;
}

function sequenceKey(sequence: readonly Annotation[]): string {
  return JSON.stringify(sequence.map((annotation) => annotation.key));
}

/**
 * A mutable collection of annotations, indexed by start position and type.
 *
 * Annotations are deduplicated: adding the same span, type and data twice is a
 * no-op.  A store is meant to be used by a single match at a time; the public
 * {@link FlexiMatcher} creates one per call unless you pass your own.
 */
export class AnnotationStore implements Iterable<Annotation> {
  private readonly byStart = new Map<number, Annotation[]>();
  private readonly byType = new Map<string, Annotation[]>();
  private readonly seen = new Set<string>();
  private readonly all: Annotation[] = [];
  private textValue: string | null = null;

  /** Maximum number of annotations; `undefined` means unlimited. */
  maxAnnotations: number | undefined;
  /** Whether annotations were discarded because of `maxAnnotations`. */
  truncated = false;

  /** Whether tag annotations should include an `__explain` field. */
  explain: boolean;

  /**
   * Internal scratch space for cooperative algorithms (currently the tag
   * closure).  Not part of the public API.
   */
  readonly extras = new Map<string, unknown>();

  constructor(
    options: { explain?: boolean; text?: string; maxAnnotations?: number } = {},
  ) {
    this.explain = options.explain ?? false;
    this.maxAnnotations = options.maxAnnotations;
    if (options.text !== undefined) {
      this.textValue = options.text;
    }
  }

  /** The text this store annotates, or `null` when it has not been attached. */
  get text(): string | null {
    return this.textValue;
  }

  /**
   * Attach a text to this store.  Re-attaching the same text is a no-op;
   * attaching a different one is an error because annotation offsets are
   * relative to a single string.
   */
  attachText(text: string): void {
    if (this.textValue === null) {
      this.textValue = text;
      return;
    }
    if (this.textValue !== text) {
      throw new RuleError(
        "This AnnotationStore belongs to a different text; create a new store for each match",
      );
    }
  }

  /** Add `annotation`; return `true` when it was new. */
  add(annotation: Annotation): boolean {
    if (this.textValue !== null && annotation.end > this.textValue.length) {
      throw new RuleError(
        `Annotation ${annotation.start}:${annotation.end} is outside the text (length ${this.textValue.length})`,
      );
    }
    if (this.seen.has(annotation.key)) {
      return false;
    }
    if (this.maxAnnotations !== undefined && this.all.length >= this.maxAnnotations) {
      this.truncated = true;
      return false;
    }
    this.seen.add(annotation.key);
    this.all.push(annotation);

    const atStart = this.byStart.get(annotation.start);
    if (atStart === undefined) {
      this.byStart.set(annotation.start, [annotation]);
    } else {
      atStart.push(annotation);
    }

    const atType = this.byType.get(annotation.type);
    if (atType === undefined) {
      this.byType.set(annotation.type, [annotation]);
    } else {
      atType.push(annotation);
    }
    return true;
  }

  /** Create and add an annotation; return `true` when it was new. */
  addAnnotation(start: number, end: number, type: string, data?: unknown): boolean {
    return this.add(new Annotation(start, end, type, data));
  }

  /** Return the annotations that start at `start`. */
  at<TData = unknown>(start: number): readonly Annotation<TData>[] {
    return (this.byStart.get(start) ?? []) as readonly Annotation<TData>[];
  }

  /** Return every annotation whose type is exactly `type`. */
  ofType<TData = unknown>(type: string): readonly Annotation<TData>[] {
    return (this.byType.get(type) ?? []) as readonly Annotation<TData>[];
  }

  /** Return whether a given span/type annotation exists. */
  has(start: number, end: number, type: string): boolean {
    return (this.byStart.get(start) ?? []).some(
      (annotation) => annotation.end === end && annotation.type === type,
    );
  }

  /** The positions at which at least one annotation starts. */
  get starts(): IterableIterator<number> {
    return this.byStart.keys();
  }

  /** Every annotation in insertion order. */
  get annotations(): readonly Annotation[] {
    return this.all;
  }

  /** The number of annotations in the store. */
  get size(): number {
    return this.all.length;
  }

  get length(): number {
    return this.all.length;
  }

  [Symbol.iterator](): Iterator<Annotation> {
    return this.all[Symbol.iterator]();
  }

  toString(): string {
    return `AnnotationStore(${this.all.length} annotations)`;
  }

  /**
   * Find contiguous annotation sequences covering `parts`.
   *
   * Each part must be matched by an annotation whose type is exactly that
   * part, and each annotation must start where the previous one ended.  If
   * `matchWhole` is true the last annotation must end at `length`; otherwise
   * any match inside the text is accepted.
   */
  checkSequence(
    parts: readonly string[],
    length: number,
    options: CheckSequenceOptions,
  ): CheckSequenceResult {
    const { matchWhole, populateResult, budget, maxInterpretations } = options;
    const optionalParts = options.optional;
    let truncated = false;
    let ticks = 0;
    const touch = (): void => {
      ticks += 1;
      if ((ticks & 1023) === 0) {
        budget?.check();
      }
    };
    budget?.check();

    if (parts.length === 0) {
      const matching = matchWhole ? length === 0 : true;
      return {
        matching,
        interpretations: populateResult && matching ? [[]] : undefined,
        truncated: false,
      };
    }

    let startPositions = new Set<number>([0]);
    if (!matchWhole) {
      for (const start of this.byStart.keys()) {
        startPositions.add(start);
      }
    }

    let candidates: CandidateMap | null = populateResult ? new Map() : null;
    let firstStep = true;

    let furthestEnd = 0;
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex] as string;
      const newPositions = new Set<number>();
      const newCandidates: CandidateMap | null = populateResult ? new Map() : null;
      let stageCount = 0;
      const canAdd = (): boolean => {
        if (
          maxInterpretations !== undefined &&
          stageCount >= maxInterpretations
        ) {
          truncated = true;
          return false;
        }
        return true;
      };

      for (const start of startPositions) {
        touch();
        if (optionalParts?.has(partIndex) === true) {
          // The zero-occurrence path: keep the sequences built so far and
          // continue at the same position.
          newPositions.add(start);
          if (populateResult) {
            const target = newCandidates as Map<number, Map<string, Annotation[]>>;
            let bucket = target.get(start);
            if (bucket === undefined) {
              bucket = new Map();
              target.set(start, bucket);
            }
            if (firstStep) {
              if (canAdd()) {
                const sequence: Annotation[] = [];
                bucket.set(sequenceKey(sequence), sequence);
                stageCount += 1;
              }
            } else {
              const previous = (candidates as CandidateMap).get(start);
              if (previous !== undefined) {
                for (const sequence of previous.values()) {
                  if (!canAdd()) {
                    break;
                  }
                  bucket.set(sequenceKey(sequence), sequence);
                  stageCount += 1;
                }
              }
            }
          }
        }
        for (const annotation of this.byStart.get(start) ?? []) {
          if (annotation.type !== part) {
            continue;
          }
          newPositions.add(annotation.end);
          if (!populateResult) {
            touch();
            continue;
          }

          const target = newCandidates as Map<number, Map<string, Annotation[]>>;
          let bucket = target.get(annotation.end);
          if (bucket === undefined) {
            bucket = new Map();
            target.set(annotation.end, bucket);
          }

          if (firstStep) {
            if (!canAdd()) {
              continue;
            }
            const sequence = [annotation];
            bucket.set(sequenceKey(sequence), sequence);
            stageCount += 1;
          } else {
            const previous = (candidates as CandidateMap).get(start);
            if (previous === undefined) {
              continue;
            }
            for (const sequence of previous.values()) {
              if (!canAdd()) {
                break;
              }
              const extended = [...sequence, annotation];
              bucket.set(sequenceKey(extended), extended);
              stageCount += 1;
            }
          }
          touch();
        }
      }

      if (newPositions.size === 0) {
        return {
          matching: false,
          truncated,
          missingPart: { index: partIndex, chunk: part },
          furthestEnd,
        };
      }

      for (const end of newPositions) {
        if (end > furthestEnd) {
          furthestEnd = end;
        }
      }

      startPositions = newPositions;
      candidates = newCandidates;
      firstStep = false;
    }

    const matching = matchWhole ? startPositions.has(length) : startPositions.size > 0;
    if (!matching) {
      const last = parts.length - 1;
      return {
        matching: false,
        truncated,
        missingPart: { index: last, chunk: parts[last] as string },
        furthestEnd,
      };
    }
    if (!populateResult) {
      return { matching: true, truncated, missingPart: null, furthestEnd };
    }

    const interpretations: Annotation[][] = [];
    const candidateMap = candidates as Map<number, Map<string, Annotation[]>>;
    if (matchWhole) {
      // Only interpretations whose last annotation ends exactly at the end of
      // the text actually cover the whole text.
      for (const sequence of candidateMap.get(length)?.values() ?? []) {
        interpretations.push(sequence);
      }
    } else {
      for (const bucket of candidateMap.values()) {
        for (const sequence of bucket.values()) {
          interpretations.push(sequence);
        }
      }
    }
    interpretations.sort((left, right) => {
      const leftStart = left[0]?.start ?? 0;
      const rightStart = right[0]?.start ?? 0;
      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }
      const leftEnd = left[left.length - 1]?.end ?? 0;
      const rightEnd = right[right.length - 1]?.end ?? 0;
      if (leftEnd !== rightEnd) {
        return leftEnd - rightEnd;
      }
      return sequenceKey(left).localeCompare(sequenceKey(right));
    });

    return {
      matching: true,
      interpretations,
      truncated,
      missingPart: null,
      furthestEnd,
    };
  }
}

/** The outcome of matching a pattern against a text. */
export class MatchResult {
  /** Whether the pattern matched. */
  readonly matching: boolean;
  /** Whether the match came from an empty pattern. */
  readonly emptyMatch: boolean;
  /**
   * Every distinct sequence of annotations that produced the match, when
   * `populateResult` was requested.  `undefined` means "not collected".
   */
  readonly interpretations: readonly (readonly Annotation[])[] | undefined;
  /** The store that was annotated during this match. */
  readonly store: AnnotationStore;
  /** Whether annotation or interpretation collection hit a limit. */
  readonly truncated: boolean;
  /** Optional scores, aligned with `interpretations`, when a ranker is used. */
  readonly scores: readonly number[] | undefined;
  /** Why the match succeeded, failed, or was truncated. */
  readonly diagnostics: MatchDiagnostics;

  constructor(
    matching: boolean,
    options: {
      emptyMatch?: boolean;
      interpretations?: readonly (readonly Annotation[])[];
      store: AnnotationStore;
      truncated?: boolean;
      scores?: readonly number[];
      diagnostics?: MatchDiagnostics;
    },
  ) {
    this.matching = matching;
    this.emptyMatch = options.emptyMatch ?? false;
    this.interpretations = options.interpretations;
    this.store = options.store;
    this.truncated = options.truncated ?? false;
    this.scores = options.scores;
    this.diagnostics = options.diagnostics ?? defaultDiagnostics(options.store);
  }

  /** Alias for {@link matching}, convenient in boolean checks. */
  get isMatching(): boolean {
    return this.matching;
  }

  /** Whether the match came from an empty pattern. */
  get isEmptyMatch(): boolean {
    return this.emptyMatch;
  }

  /** Return the substring covered by each interpretation. */
  matchingStrings(text: string): string[] {
    if (this.interpretations === undefined) {
      return [];
    }
    return this.interpretations.map((sequence) => {
      if (sequence.length === 0) {
        return "";
      }
      return text.slice(sequence[0].start, sequence[sequence.length - 1].end);
    });
  }

  /** Return a human-readable description of each interpretation. */
  highlightedStrings(text: string): string[] {
    if (this.interpretations === undefined) {
      return [];
    }
    return this.interpretations.map((sequence) =>
      sequence
        .map((annotation) => {
          const covered = text.slice(annotation.start, annotation.end);
          const data =
            annotation.data === undefined
              ? "no annotation"
              : JSON.stringify(annotation.data);
          return `${annotation.type}:${covered} (${data})`;
        })
        .join(", "),
    );
  }

  /** Iterate over every annotation appearing in any interpretation. */
  *flatAnnotations(): Generator<Annotation> {
    if (this.interpretations === undefined) {
      return;
    }
    for (const sequence of this.interpretations) {
      yield* sequence;
    }
  }

  /** Alias for {@link flatAnnotations}. */
  *annotations(): Generator<Annotation> {
    yield* this.flatAnnotations();
  }

  toString(): string {
    if (!this.matching) {
      return "MatchResult(no match)";
    }
    if (this.emptyMatch) {
      return "MatchResult(empty match)";
    }
    const count = this.interpretations === undefined ? "?" : this.interpretations.length;
    return `MatchResult(match, interpretations=${count})`;
  }
}

/**
 * One level of nested matching.
 *
 * The root frame has depth 0.  Every time a rule asks the matcher to match a
 * sub-pattern a child frame is created.  Frames are mostly diagnostic (they
 * appear in maximum-nesting errors and explanations), but they also give rules
 * a convenient way to see how a match was reached.
 */
export class MatchFrame {
  readonly matcher: string;
  readonly annotationsAtCreation: number;
  readonly parent: MatchFrame | null;
  readonly depth: number;

  constructor(matcher: string, annotationsAtCreation: number, parent: MatchFrame | null = null) {
    this.matcher = matcher;
    this.annotationsAtCreation = annotationsAtCreation;
    this.parent = parent;
    this.depth = parent === null ? 0 : parent.depth + 1;
  }

  child(matcher: string, annotationsAtCreation = 0): MatchFrame {
    return new MatchFrame(matcher, annotationsAtCreation, this);
  }

  toString(): string {
    return `MatchFrame(depth=${this.depth}, matcher=${JSON.stringify(this.matcher)}, annotations=${this.annotationsAtCreation})`;
  }
}

export interface AnnotatorMatchOptions {
  matchWhole?: boolean;
  populateResult?: boolean;
  fullyAnnotate?: boolean;
}

/**
 * The handle a rule uses to add annotations and run nested matches.
 *
 * Rules receive an annotator bound to the rule chunk that invoked them, so
 * `annotator.add(start, end)` automatically tags the span with that chunk
 * (for example `"[i:pear]"`).  Rules never need to know their own name.
 */
export class Annotator {
  readonly store: AnnotationStore;
  readonly matcher: FlexiMatcher;
  readonly frame: MatchFrame;
  readonly type: string;
  readonly text: string;
  readonly budget: Budget;

  constructor(
    store: AnnotationStore,
    matcher: FlexiMatcher,
    frame: MatchFrame,
    type: string,
    text: string,
    budget: Budget = new Budget(),
  ) {
    this.store = store;
    this.matcher = matcher;
    this.frame = frame;
    this.type = type;
    this.text = text;
    this.budget = budget;
  }

  /** Whether the caller asked for explanations (`__explain` fields). */
  get explain(): boolean {
    return this.store.explain;
  }

  /** Annotate `text[start:end]` with optional JSON-like data. */
  add(start: number, end: number, data?: unknown): boolean {
    this.budget.check();
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
      return false;
    }
    if (start < 0 || end > this.text.length) {
      throw new RuleError(
        `Rule ${JSON.stringify(this.type)} tried to annotate ${start}:${end}, outside the text (length ${this.text.length})`,
      );
    }
    return this.store.addAnnotation(start, end, this.type, data);
  }

  /**
   * Match a sub-pattern against the same text and annotation store.
   *
   * The text must be the one this annotator was created for; mixing texts in a
   * single store would corrupt every offset.
   */
  match(
    text: string,
    pattern: string | CompiledPattern,
    options: AnnotatorMatchOptions = {},
  ): MatchResult {
    if (text !== this.text) {
      throw new RuleError(
        "A rule can only match the text it is annotating; offsets are relative to a single string",
      );
    }
    const patternText = typeof pattern === "string" ? pattern : pattern.pattern;
    const frame = this.frame.child(patternText, this.store.size);
    const internal = {
      store: this.store,
      frame,
      fullyAnnotate: options.fullyAnnotate ?? true,
      matchWhole: options.matchWhole ?? false,
      populateResult: options.populateResult ?? true,
      budget: this.budget,
    };

    if (typeof pattern === "string") {
      return this.matcher._match(text, pattern, internal);
    }
    if (pattern.matcher !== this.matcher) {
      throw new RuleError(
        "A compiled pattern can only be used with the matcher that created it",
      );
    }
    return this.matcher._matchCompiled(text, pattern, internal);
  }

  toString(): string {
    return `Annotator(type=${JSON.stringify(this.type)}, ${this.frame.toString()})`;
  }
}
