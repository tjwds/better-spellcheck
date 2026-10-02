import { describe, expect, test } from 'claude-code/testing'

import {
  distinctWords,
  findMisspellings,
  lookup,
  matchCase,
  parseAspell,
  parseWordList,
  replaceMisspelling,
} from '../hooks/spell'

const WORDS = new Set(['the', 'quick', 'brown', 'fox', 'joe', "don't", 'receive', 'is', 'a', 'it'])
const known = (w: string) => lookup(WORDS, w)
const words = (text: string, cursor = -1) => findMisspellings(text, cursor, known).map(m => m.word)

describe('findMisspellings', () => {
  test('flags unknown words with their offsets', () => {
    expect(findMisspellings('the qiuck fox', -1, known)).toEqual([{ word: 'qiuck', start: 4, end: 9 }])
  })

  test('skips the word the cursor is at the end of', () => {
    expect(words('the qiuck', 9)).toEqual([])
    expect(words('the qiuck ', 10)).toEqual(['qiuck'])
  })

  test('skips inline code, fenced code and an unclosed backtick', () => {
    expect(words('the `qiuck` fox')).toEqual([])
    expect(words('the\n```\nqiuck zzzz\n```\nfox')).toEqual([])
    expect(words('the `qiuck')).toEqual([])
  })

  test('skips paths, URLs, mentions, commands and identifiers', () => {
    expect(
      words('/spellcheck @src/foo.ts ~/qiuck https://zzz.io file.tsx snake_case a=b getUser() v2 #123 $HOME'),
    ).toEqual([])
  })

  test('skips acronyms and camelCase but checks capitalized words', () => {
    expect(words('LLM PRs useState TypeScript')).toEqual([])
    expect(words('Qiuck fox')).toEqual(['Qiuck'])
  })

  test('checks each part of a hyphenated word, and handles punctuation', () => {
    expect(words('quick-brwn fox.')).toEqual(['brwn'])
    expect(words('"qiuck," (fox)')).toEqual(['qiuck'])
  })

  test('keeps emphasis words checkable', () => {
    expect(words('the *qiuck* fox')).toEqual(['qiuck'])
  })

  test('accepts contractions, possessives and curly apostrophes', () => {
    expect(words("don't Joe's it’s don’t foxes'")).toEqual(['foxes'])
  })
})

describe('helpers', () => {
  test('parseWordList skips comments and blanks', () => {
    expect(parseWordList('# note\nrepo\n\n  config \n')).toEqual(['repo', 'config'])
  })

  test('parseAspell reads suggestions, no-suggestion lines and correct words', () => {
    const out = [
      '@(#) International Ispell Version 3.1.20 (but really Aspell 0.60.8.1)',
      '& teh 44 1: the, tech, Te',
      '',
      '*',
      '',
      '# xqzzvvq 1',
      '',
    ].join('\n')
    const parsed = parseAspell(out)
    expect(parsed.get('teh')).toEqual(['the', 'tech', 'Te'])
    expect(parsed.get('xqzzvvq')).toEqual([])
    expect(parsed.size).toBe(2)
  })

  test('matchCase capitalizes to match the original', () => {
    expect(matchCase('Teh', 'the')).toBe('The')
    expect(matchCase('teh', 'the')).toBe('the')
  })

  test('replaceMisspelling fixes every occurrence, keeping case', () => {
    const text = 'Teh fox and teh dog'
    const found = findMisspellings(text, -1, w => ['fox', 'and', 'dog'].includes(w.toLowerCase()))
    expect(replaceMisspelling(text, found, 'teh', 'the')).toBe('The fox and the dog')
  })

  test('distinctWords dedupes case-insensitively, first seen wins', () => {
    const found = findMisspellings('Teh teh zzq', -1, () => false)
    expect(distinctWords(found)).toEqual(['Teh', 'zzq'])
  })
})
