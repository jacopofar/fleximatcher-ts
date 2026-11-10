/**
 * Expansion of tag annotation templates.
 *
 * A tag definition may carry a template describing the metadata to attach to
 * the span it matches.  Three forms are supported:
 *
 * * a string in lenient JSON syntax with `${N}` and `${N.path}` placeholders:
 *
 *   ```ts
 *   "{'internal_fruit':${1.fruit},'article':'${0}'}"
 *   ```
 *
 * * a native object or array whose string leaves may contain the same
 *   placeholders:
 *
 *   ```ts
 *   { internalFruit: "${1.fruit}", article: "${0}" }
 *   ```
 *
 * * a function receiving the matched sequence and returning arbitrary data:
 *
 *   ```ts
 *   ({ sequence, covered }) => ({ article: covered(0), ... })
 *   ```
 *
 * In a string template `${N}` in value position inserts a JSON literal, while
 * `${N}` inside a quoted string inserts escaped string content.  In a native
 * object an exact placeholder (`"${1.fruit}"`) preserves the original type,
 * so numbers and nested objects survive.
 */

import type { Annotation } from "./annotations.js";
import { AnnotationError } from "./errors.js";
import { loads, JsonishError } from "./jsonish.js";

/** Context passed to function templates. */
export interface AnnotationTemplateContext {
  /** The text being annotated. */
  readonly text: string;
  /** The annotations that matched the tag production, in pattern order. */
  readonly sequence: readonly Annotation[];
  /** The text covered by the N-th annotation. */
  covered(index: number): string;
  /** The annotation data of the N-th annotation, optionally at `path`. */
  value(index: number, path?: string): unknown;
}

export type AnnotationTemplateExpression =
  | string
  | ((context: AnnotationTemplateContext) => unknown)
  | { [key: string]: unknown }
  | unknown[]
  | null
  | undefined;

/**
 * Optional validation/coercion for generated annotation data.
 *
 * A schema receives the raw template result and returns the typed value.  It
 * should throw (or return a transformed value) when the data is invalid.
 */
export type AnnotationSchema<TData = unknown> = (value: unknown) => TData;

/** `${0}`, `${1.fruit}`, `${2.items[0].name}` ... */
export const PLACEHOLDER_RE = /\$\{([0-9]+)([^}]*)\}/g;
const EXACT_PLACEHOLDER_RE = /^\$\{([0-9]+)([^}]*)\}$/;

function parsePath(path: string): Array<string | number> {
  const entries: Array<string | number> = [];
  let index = 0;

  while (index < path.length) {
    const character = path[index];
    if (character === ".") {
      index += 1;
      const start = index;
      while (index < path.length && path[index] !== "." && path[index] !== "[") {
        index += 1;
      }
      if (start === index) {
        throw new AnnotationError(`Empty path segment in placeholder path ${JSON.stringify(path)}`);
      }
      entries.push(path.slice(start, index));
      continue;
    }

    if (character === "[") {
      index += 1;
      const start = index;
      while (index < path.length && path[index] !== "]") {
        index += 1;
      }
      if (index >= path.length) {
        throw new AnnotationError(`Unclosed '[' in placeholder path ${JSON.stringify(path)}`);
      }
      const raw = path.slice(start, index);
      if (!/^[0-9]+$/.test(raw)) {
        throw new AnnotationError(
          `Array indices in placeholder paths must be decimal, got ${JSON.stringify(raw)}`,
        );
      }
      entries.push(Number.parseInt(raw, 10));
      index += 1;
      continue;
    }

    // A bare first segment is allowed for convenience, so contexts can call
    // value(1, "name") instead of value(1, ".name").
    if (index === 0) {
      const start = index;
      while (index < path.length && path[index] !== "." && path[index] !== "[") {
        index += 1;
      }
      if (start === index) {
        throw new AnnotationError(`Empty path segment in placeholder path ${JSON.stringify(path)}`);
      }
      entries.push(path.slice(start, index));
      continue;
    }

    throw new AnnotationError(
      `Invalid placeholder path ${JSON.stringify(path)}; use dots and [N] indices`,
    );
  }

  return entries;
}

function lookup(
  sequence: readonly Annotation[],
  index: number,
  path: string,
): { annotation: Annotation; value: unknown } {
  if (!Number.isInteger(index) || index < 0 || index >= sequence.length) {
    throw new AnnotationError(
      `The template refers to element #${index}, but the match has only ${sequence.length} element(s)`,
    );
  }
  const annotation = sequence[index];
  const entries = parsePath(path);
  let value: unknown = annotation.data;

  for (const entry of entries) {
    if (typeof entry === "number") {
      if (!Array.isArray(value)) {
        throw new AnnotationError(
          `Cannot find ${JSON.stringify(path)} in the annotation of element #${index}: the value is not an array`,
        );
      }
      if (entry >= value.length) {
        throw new AnnotationError(
          `Cannot find ${JSON.stringify(path)} in the annotation of element #${index}: index ${entry} is out of range`,
        );
      }
      value = value[entry];
      continue;
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new AnnotationError(
        `Cannot find ${JSON.stringify(path)} in the annotation of element #${index}`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(value, entry)) {
      throw new AnnotationError(
        `Cannot find ${JSON.stringify(path)} in the annotation of element #${index}: missing key ${JSON.stringify(entry)}`,
      );
    }
    value = (value as Record<string, unknown>)[entry];
  }

  return { annotation, value };
}

function jsonStringContent(value: unknown, quote: string): string {
  const asText =
    typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  let escaped = JSON.stringify(asText).slice(1, -1);
  if (quote === "'") {
    escaped = escaped.replace(/'/g, "\\'");
  }
  return escaped;
}

function jsonLiteral(value: unknown): string {
  const rendered = JSON.stringify(value);
  return rendered === undefined ? "null" : rendered;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateStringTemplate(template: string): void {
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    parsePath(match[2] ?? "");
  }
  const probe = template.replace(PLACEHOLDER_RE, "0");
  try {
    loads(probe);
  } catch (error) {
    if (error instanceof JsonishError) {
      throw new AnnotationError(
        `Annotation template ${JSON.stringify(template)} is not valid JSON-ish after replacing placeholders: ${JSON.stringify(probe)}`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * A reusable annotation template bound to a tag definition.
 *
 * Instances validate their expression eagerly, so a malformed grammar is
 * rejected when it is defined rather than in the middle of a match.
 */
export class AnnotationTemplate<TData = unknown> {
  readonly expression: AnnotationTemplateExpression;
  private readonly isString: boolean;
  private readonly isFunction: boolean;
  private readonly schema: AnnotationSchema<TData> | null;

  constructor(
    expression: AnnotationTemplateExpression,
    schema: AnnotationSchema<TData> | null = null,
  ) {
    this.schema = schema;
    if (expression === undefined || expression === null) {
      this.expression = null;
      this.isString = false;
      this.isFunction = false;
      return;
    }

    if (typeof expression === "string") {
      if (expression.trim() === "") {
        this.expression = null;
        this.isString = false;
        this.isFunction = false;
        return;
      }
      validateStringTemplate(expression);
      this.expression = expression;
      this.isString = true;
      this.isFunction = false;
      return;
    }

    if (typeof expression === "function") {
      this.expression = expression;
      this.isString = false;
      this.isFunction = true;
      return;
    }

    if (Array.isArray(expression) || isPlainObject(expression)) {
      this.expression = expression;
      this.isString = false;
      this.isFunction = false;
      return;
    }

    throw new AnnotationError(
      `An annotation template must be a JSON-ish string, an object, an array or a function, got ${typeof expression}`,
    );
  }

  get isEmpty(): boolean {
    return this.expression === null;
  }

  /** Expand the template against a matched annotation sequence. */
  build(text: string, sequence: readonly Annotation[]): TData {
    if (this.expression === null) {
      return this.applySchema(undefined);
    }

    if (this.isFunction) {
      const context: AnnotationTemplateContext = {
        text,
        sequence,
        covered: (index: number) => lookup(sequence, index, "").annotation.coveredText(text),
        value: (index: number, path = "") => lookup(sequence, index, path).value,
      };
      const result = (this.expression as (context: AnnotationTemplateContext) => unknown)(
        context,
      );
      if (result !== null && typeof result === "object" && "then" in result) {
        throw new AnnotationError("Annotation templates must be synchronous");
      }
      return this.applySchema(result);
    }

    if (this.isString) {
      const template = this.expression as string;
      const rendered = this.substituteString(template, text, sequence);
      try {
        return this.applySchema(loads(rendered));
      } catch (error) {
        if (error instanceof JsonishError) {
          throw new AnnotationError(
            `Could not create an annotation from ${JSON.stringify(template)}: the rendered template ${JSON.stringify(rendered)} is not valid JSON-ish`,
            { cause: error },
          );
        }
        throw error;
      }
    }

    return this.applySchema(this.substituteNative(this.expression, text, sequence));
  }

  private applySchema(value: unknown): TData {
    if (this.schema === null) {
      return value as TData;
    }
    try {
      return this.schema(value);
    } catch (error) {
      if (error instanceof AnnotationError) {
        throw error;
      }
      throw new AnnotationError(
        "Annotation schema rejected the generated data",
        { cause: error },
      );
    }
  }

  private substituteString(
    template: string,
    text: string,
    sequence: readonly Annotation[],
  ): string {
    const pieces: string[] = [];
    let position = 0;
    let quote: string | null = null;
    let escaped = false;

    for (const match of template.matchAll(PLACEHOLDER_RE)) {
      const matchIndex = match.index ?? 0;

      for (let offset = position; offset < matchIndex; offset += 1) {
        const character = template[offset];
        if (escaped) {
          escaped = false;
        } else if (quote !== null) {
          if (character === "\\") {
            escaped = true;
          } else if (character === quote) {
            quote = null;
          }
        } else if (character === '"' || character === "'") {
          quote = character;
        }
      }

      const index = Number.parseInt(match[1], 10);
      const path = match[2] ?? "";
      const found = lookup(sequence, index, path);
      const value = path === "" ? found.annotation.coveredText(text) : found.value;
      const rendered = quote !== null ? jsonStringContent(value, quote) : jsonLiteral(value);

      pieces.push(template.slice(position, matchIndex));
      pieces.push(rendered);
      position = matchIndex + match[0].length;
    }

    pieces.push(template.slice(position));
    return pieces.join("");
  }

  private substituteNative(
    value: unknown,
    text: string,
    sequence: readonly Annotation[],
  ): unknown {
    if (typeof value === "string") {
      const exact = EXACT_PLACEHOLDER_RE.exec(value);
      if (exact !== null) {
        const index = Number.parseInt(exact[1], 10);
        const path = exact[2] ?? "";
        const found = lookup(sequence, index, path);
        return path === "" ? found.annotation.coveredText(text) : found.value;
      }

      return value.replace(PLACEHOLDER_RE, (whole, rawIndex: string, path: string) => {
        const found = lookup(sequence, Number.parseInt(rawIndex, 10), path ?? "");
        const extracted = path === "" ? found.annotation.coveredText(text) : found.value;
        if (typeof extracted === "string") {
          return extracted;
        }
        if (extracted === undefined) {
          return "";
        }
        return typeof extracted === "object"
          ? (JSON.stringify(extracted) ?? String(extracted))
          : String(extracted);
      });
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.substituteNative(item, text, sequence));
    }

    if (isPlainObject(value)) {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] = this.substituteNative(item, text, sequence);
      }
      return result;
    }

    return value;
  }

  toString(): string {
    return `AnnotationTemplate(${String(this.expression)})`;
  }
}
