/**
 * A deliberately small word tokenizer for lexicon lookup.
 *
 * It recognizes Unicode letters with combining marks, keeps internal
 * apostrophes (Italian elisions such as `l'uomo`), and emits both the whole
 * run and its apostrophe-separated pieces.  That lets the lexicon contain both
 * `l'` + `uomo` and, if it ever needs to, a combined entry.
 */

export interface WordToken {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const WORD_RUN = /\p{L}[\p{L}\p{M}]*(?:['\u2018\u2019\u02bc][\p{L}\p{M}]*)*/gu;
const APOSTROPHE = new Set(["'", "\u2018", "\u2019", "\u02bc"]);

/** Return non-overlapping-by-construction word tokens, sorted by position. */
export function tokenizeWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const seen = new Set<string>();

  const add = (start: number, end: number): void => {
    if (end <= start) {
      return;
    }
    const key = `${start}:${end}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    tokens.push({ start, end, text: text.slice(start, end) });
  };

  for (const match of text.matchAll(WORD_RUN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    add(start, end);

    let segmentStart = start;
    for (let index = start; index < end; index += 1) {
      if (APOSTROPHE.has(text[index])) {
        add(segmentStart, index + 1);
        segmentStart = index + 1;
      }
    }
    if (segmentStart < end) {
      add(segmentStart, end);
    }
  }

  tokens.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  return tokens;
}
