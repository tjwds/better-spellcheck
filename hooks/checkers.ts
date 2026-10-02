// The programs that supply suggestions, tried in order; the first that runs
// is used for the rest of the session. Which words get flagged never depends
// on them: that's the bundled word list.

import { parseAspell } from './spell'

export type Checker = {
  /** What `/spellcheck` calls it. */
  name: string
  /** Where to find it: a bare name is looked up on PATH. */
  paths: readonly string[]
  args: (words: readonly string[]) => string[]
  stdin: (words: readonly string[]) => string | undefined
  parse: (stdout: string) => Map<string, string[]>
}

// NSSpellChecker, the checker macOS apps use, through JavaScript for
// Automation: the words arrive as arguments, the guesses leave as JSON.
const MACOS_SCRIPT = `function run(argv) {
  ObjC.import('AppKit')
  const checker = $.NSSpellChecker.sharedSpellChecker
  const out = {}
  for (const word of argv) {
    const guesses = checker.guessesForWordRangeInStringLanguageInSpellDocumentWithTag(
      $.NSMakeRange(0, word.length), word, 'en_US', 0)
    out[word] = ObjC.deepUnwrap(guesses) || []
  }
  return JSON.stringify(out)
}`

export function parseMacGuesses(stdout: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return out
  }
  if (typeof parsed !== 'object' || parsed === null) return out
  for (const [word, guesses] of Object.entries(parsed)) {
    if (Array.isArray(guesses)) out.set(word, guesses.filter((g): g is string => typeof g === 'string'))
  }
  return out
}

// aspell and hunspell share ispell's pipe protocol (`-a`); `^` makes each
// line text to check, never a command.
const pipeInput = (words: readonly string[]) => words.map(w => `^${w}\n`).join('')

export const CHECKERS: readonly Checker[] = [
  {
    name: 'the macOS spell checker',
    paths: ['/usr/bin/osascript'],
    args: words => ['-l', 'JavaScript', '-e', MACOS_SCRIPT, ...words],
    stdin: () => undefined,
    parse: parseMacGuesses,
  },
  {
    name: 'aspell',
    paths: ['aspell', '/opt/homebrew/bin/aspell', '/usr/local/bin/aspell'],
    args: () => ['-a', '--lang=en_US'],
    stdin: pipeInput,
    parse: parseAspell,
  },
  {
    name: 'hunspell',
    paths: ['hunspell', '/opt/homebrew/bin/hunspell', '/usr/local/bin/hunspell'],
    args: () => ['-a', '-d', 'en_US'],
    stdin: pipeInput,
    parse: parseAspell,
  },
]
