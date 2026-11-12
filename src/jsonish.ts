/**
 * A small, permissive JSON reader.
 *
 * The original Java library used `org.json`, which is more forgiving than the
 * JSON standard: it accepts single-quoted strings and bare (unquoted) values.
 * Annotation templates relied on that leniency:
 *
 * ```text
 * {'internal_fruit':${1.fruit},article:an}
 * ```
 *
 * This module accepts the same dialect and returns ordinary JavaScript values.
 * It is only used for annotation templates and for validating them; it is not
 * meant as a general-purpose JSON parser.
 */

export class JsonishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonishError";
  }
}

const WHITESPACE = " \t\r\n";
const END_OF_BARE = new Set([
  ",",
  ":",
  "]",
  "}",
  "/",
  "\\",
  '"',
  "[",
  "{",
  ";",
  "=",
  "#",
]);
const NUMBER_RE = /[-+]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/y;

/**
 * Parse `source` as lenient JSON and return the equivalent JavaScript value.
 *
 * @throws {@link JsonishError} when the input is not valid lenient JSON.
 */
export function loads(source: string): unknown {
  const parser = new Parser(source);
  const value = parser.parseValue();
  parser.skipWhitespace();
  if (parser.index !== source.length) {
    throw parser.error("Unexpected trailing content");
  }
  return value;
}

class Parser {
  readonly source: string;
  index = 0;

  constructor(source: string) {
    this.source = source;
  }

  error(message: string): JsonishError {
    return new JsonishError(
      `${message} at position ${this.index} in ${JSON.stringify(this.source)}`,
    );
  }

  skipWhitespace(): void {
    while (
      this.index < this.source.length &&
      WHITESPACE.includes(this.source[this.index])
    ) {
      this.index += 1;
    }
  }

  peek(): string {
    if (this.index >= this.source.length) {
      throw this.error("Unexpected end of input");
    }
    return this.source[this.index];
  }

  expect(character: string): void {
    if (this.peek() !== character) {
      throw this.error(`Expected ${JSON.stringify(character)}`);
    }
    this.index += 1;
  }

  parseValue(): unknown {
    this.skipWhitespace();
    const character = this.peek();

    if (character === "{") {
      return this.parseObject();
    }
    if (character === "[") {
      return this.parseArray();
    }
    if (character === '"' || character === "'") {
      return this.parseString(character);
    }

    NUMBER_RE.lastIndex = this.index;
    const number = NUMBER_RE.exec(this.source);
    if (number !== null) {
      this.index = NUMBER_RE.lastIndex;
      const text = number[0];
      return text.includes(".") || text.includes("e") || text.includes("E")
        ? Number.parseFloat(text)
        : Number.parseInt(text, 10);
    }

    return this.parseBare();
  }

  parseObject(): Record<string, unknown> {
    this.expect("{");
    const result: Record<string, unknown> = {};
    this.skipWhitespace();
    if (this.peek() === "}") {
      this.index += 1;
      return result;
    }

    while (true) {
      this.skipWhitespace();
      const key = this.parseValue();
      this.skipWhitespace();
      this.expect(":");
      result[typeof key === "string" ? key : String(key)] = this.parseValue();
      this.skipWhitespace();
      const character = this.peek();
      if (character === ",") {
        this.index += 1;
        continue;
      }
      if (character === "}") {
        this.index += 1;
        return result;
      }
      throw this.error("Expected ',' or '}' in object");
    }
  }

  parseArray(): unknown[] {
    this.expect("[");
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.peek() === "]") {
      this.index += 1;
      return result;
    }

    while (true) {
      result.push(this.parseValue());
      this.skipWhitespace();
      const character = this.peek();
      if (character === ",") {
        this.index += 1;
        continue;
      }
      if (character === "]") {
        this.index += 1;
        return result;
      }
      throw this.error("Expected ',' or ']' in array");
    }
  }

  parseString(quote: string): string {
    this.expect(quote);
    const chunks: string[] = [];
    const escapes: Record<string, string> = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      "\\": "\\",
      "/": "/",
      '"': '"',
      "'": "'",
    };

    while (true) {
      if (this.index >= this.source.length) {
        throw this.error("Unterminated string");
      }
      const character = this.source[this.index];
      this.index += 1;
      if (character === quote) {
        return chunks.join("");
      }
      if (character !== "\\") {
        chunks.push(character);
        continue;
      }
      if (this.index >= this.source.length) {
        throw this.error("Unterminated escape sequence");
      }
      const escaped = this.source[this.index];
      this.index += 1;
      if (escaped === "u") {
        const digits = this.source.slice(this.index, this.index + 4);
        if (digits.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(digits)) {
          throw this.error("Invalid unicode escape");
        }
        chunks.push(String.fromCharCode(Number.parseInt(digits, 16)));
        this.index += 4;
      } else if (escaped in escapes) {
        chunks.push(escapes[escaped]);
      } else {
        throw this.error(`Unknown escape sequence \\${escaped}`);
      }
    }
  }

  parseBare(): unknown {
    const start = this.index;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character < " " || END_OF_BARE.has(character)) {
        break;
      }
      this.index += 1;
    }
    const text = this.source.slice(start, this.index).trim();
    if (!text) {
      throw this.error("Expected a value");
    }
    const lowered = text.toLowerCase();
    if (lowered === "true") {
      return true;
    }
    if (lowered === "false") {
      return false;
    }
    if (lowered === "null") {
      return null;
    }
    return text;
  }
}
