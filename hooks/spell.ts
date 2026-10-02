// Pure spelling logic: no `$`, so the tests can call it directly.

export type Misspelling = { word: string; start: number; end: number }

// A run of letters, with inner apostrophes kept (don't, Joe's).
const WORD = /\p{L}+(?:['’]\p{L}+)*/gu

// A whitespace-delimited chunk that reads as code, a path or a reference
// rather than prose: /commands, @mentions, ~/paths, #123, $VARS, URLs,
// a/b paths, file.ts and example.com, snake_case, x=y, <tags>, f(x), digits.
const CODE_LIKE = [
  /^[/@~#$\\]/,
  /:\/\//,
  /[/\\]/,
  /\p{L}\.\p{L}/u,
  /[_=<>{}[\]|^+]/,
  /\p{L}\(/u,
  /\d/,
]

/**
 * Character ranges of `text` inside markdown code: fenced blocks and inline
 * spans. An unclosed fence runs to the end of the text, and an unclosed
 * backtick to the end of its line, since the person is still typing it.
 */
export function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const fences = /```[\s\S]*?(?:```|$)/g
  for (const m of text.matchAll(fences)) ranges.push([m.index, m.index + m[0].length])
  // Inline spans, outside the fences: `$` here is the end of a line.
  const outside = text.replace(fences, f => ' '.repeat(f.length))
  for (const m of outside.matchAll(/`[^`\n]*(?:`|$)/gm)) ranges.push([m.index, m.index + m[0].length])
  return ranges
}

function overlaps(ranges: Array<[number, number]>, start: number, end: number): boolean {
  return ranges.some(([s, e]) => start < e && end > s)
}

/** True for a word worth looking up; false for acronyms and identifiers. */
export function isCheckable(word: string): boolean {
  if (word.length < 2) return false
  // Non-ASCII letters (café, naïve): the dictionary is plain en_US.
  if (/[^\x00-\x7F’]/.test(word)) return false
  // ALLCAPS: acronyms (PR, LLM, TODO), and their plurals (PRs, APIs).
  if (word === word.toUpperCase()) return false
  if (/^\p{Lu}{2,}s$/u.test(word)) return false
  // camelCase or PascalCase with an inner capital (useState, TypeScript).
  if (/\p{Ll}\p{Lu}/u.test(word)) return false
  return true
}

/**
 * The misspelled words of `text`, in order. The word the cursor sits at the
 * end of is skipped, since the person is still typing it.
 */
export function findMisspellings(
  text: string,
  cursor: number,
  isKnown: (word: string) => boolean,
): Misspelling[] {
  const code = codeRanges(text)
  const found: Misspelling[] = []
  for (const chunk of text.matchAll(/\S+/g)) {
    const chunkStart = chunk.index
    if (overlaps(code, chunkStart, chunkStart + chunk[0].length)) continue
    if (CODE_LIKE.some(re => re.test(chunk[0]))) continue
    for (const w of chunk[0].matchAll(WORD)) {
      const start = chunkStart + w.index
      const end = start + w[0].length
      if (end === cursor) continue
      if (!isCheckable(w[0])) continue
      if (!isKnown(w[0])) found.push({ word: w[0], start, end })
    }
  }
  return found
}

/** Looks a word up in a lowercase word set, allowing possessives. */
export function lookup(words: ReadonlySet<string>, word: string): boolean {
  const w = word.toLowerCase().replace(/’/g, "'")
  if (words.has(w)) return true
  if (w.endsWith("'s")) return words.has(w.slice(0, -2))
  if (w.endsWith("s'")) return words.has(w.slice(0, -1))
  return false
}

/** Parses a word list: one word per line, `#` comments and blanks skipped. */
export function parseWordList(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
}

/**
 * Parses `aspell -a` output into suggestions per word: `& word n off: a, b`
 * carries suggestions, `# word off` has none, `*` lines are correct words.
 */
export function parseAspell(stdout: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const line of stdout.split('\n')) {
    const withSuggestions = /^& (\S+) \d+ \d+: (.*)$/.exec(line)
    if (withSuggestions) {
      out.set(withSuggestions[1]!, withSuggestions[2]!.split(', ').filter(s => s !== ''))
      continue
    }
    const without = /^# (\S+) \d+$/.exec(line)
    if (without) out.set(without[1]!, [])
  }
  return out
}

/** `replacement`, capitalized to match `original`'s first letter. */
export function matchCase(original: string, replacement: string): string {
  const first = original[0] ?? ''
  if (first !== first.toUpperCase() || first === first.toLowerCase()) return replacement
  return replacement.charAt(0).toUpperCase() + replacement.slice(1)
}

/**
 * Replaces each misspelling of `word` in `text` with `replacement`, matching
 * each occurrence's capitalization.
 */
export function replaceMisspelling(
  text: string,
  misspellings: readonly Misspelling[],
  word: string,
  replacement: string,
): string {
  const target = word.toLowerCase()
  let next = text
  const hits = misspellings.filter(m => m.word.toLowerCase() === target)
  for (const m of [...hits].reverse()) {
    next = next.slice(0, m.start) + matchCase(m.word, replacement) + next.slice(m.end)
  }
  return next
}

/** The distinct misspelled words, in first-seen order, compared lowercase. */
export function distinctWords(misspellings: readonly Misspelling[]): string[] {
  const seen = new Set<string>()
  const words: string[] = []
  for (const m of misspellings) {
    const key = m.word.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    words.push(m.word)
  }
  return words
}
