import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptDecoration, Register } from 'claude-code'

import type { Flagged } from '../types'
import { addShortcuts, FIX_ACTION, LEARN_ACTION, parseShortcuts } from './keys'
import type { Shortcuts } from './keys'
import {
  distinctWords,
  findMisspellings,
  lookup,
  parseAspell,
  parseWordList,
  replaceMisspelling,
} from './spell'
import type { Misspelling } from './spell'

const flaggedAtom = atom({ plugin: 'better-spellcheck', key: 'flagged' } as const, [])

// The word lists decide what is flagged; aspell only supplies suggestions.
const ASPELL_CANDIDATES = ['aspell', '/opt/homebrew/bin/aspell', '/usr/local/bin/aspell']
const SUGGESTION_DELAY_MS = 250
const MAX_SUGGESTIONS = 3
const MAX_SHOWN = 9
// Palette slot 1: the terminal's own red, as its color scheme defines it.
// A theme key such as 'error' is a fixed RGB value, a name such as 'red' is
// mapped to a fixed hex value, and 'ansi:red' is refused for plugins.
const RED = 'ansi256(1)'

const USAGE = [
  'Usage: /spellcheck [on | off | add <word…> | remove <word…> | list | keys]',
  '  on, off          turn checking on or off (remembered across sessions)',
  '  add <word…>      add words to your personal dictionary',
  '  remove <word…>   remove words from your personal dictionary',
  '  list             show your personal dictionary',
  '  keys             bind ctrl+x f (fix) and ctrl+x a (add) in your keybindings.json',
].join('\n')

// Module state: rebuilt when the module reloads; `$.store` keeps the
// personal dictionary and the on/off switch across sessions.
let dictionary = new Set<string>()
let learned = new Set<string>()
let isEnabled = true
let loading: Promise<boolean> | undefined
let aspellPath: string | null | undefined
const suggestions = new Map<string, string[]>()
let currentWords: string[] = []
let lastPublished = '[]'
let pending: { cancel: () => void } | undefined
let shortcuts: Shortcuts = {}

const isKnown = (word: string) => lookup(dictionary, word) || lookup(learned, word)

const check = (text: string, cursor: number) => findMisspellings(text, cursor, isKnown)

const decorate = (found: readonly Misspelling[]): PromptDecoration[] =>
  found.map(m => ({ start: m.start, end: m.end, color: RED, underline: true }))

async function load($: EngineInterface): Promise<boolean> {
  try {
    const [base, extra, saved, disabled] = await Promise.all([
      $.fs.read(`${$.plugin.root}/hooks/words.txt`),
      $.fs.read(`${$.plugin.root}/hooks/extra-words.txt`),
      $.store.get('learned'),
      $.store.get('disabled'),
    ])
    dictionary = new Set([...parseWordList(base), ...parseWordList(extra)].map(w => w.toLowerCase()))
    learned = new Set(Array.isArray(saved) ? saved.map(w => String(w).toLowerCase()) : [])
    isEnabled = disabled !== true
    await loadShortcuts($)
    return true
  } catch (error) {
    $.ui.log(`better-spellcheck: could not load the dictionary: ${String(error)}`)
    return false
  }
}

async function keybindingsPath($: EngineInterface): Promise<string> {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
  return `${dir}/keybindings.json`
}

// The keys bound to the band's actions, so its hint names the real ones.
async function loadShortcuts($: EngineInterface) {
  try {
    shortcuts = parseShortcuts(await $.fs.read(await keybindingsPath($)))
  } catch {
    shortcuts = {}
  }
}

// Binds the band's actions in keybindings.json, keeping everything else there.
// Claude Code picks up the change without a restart.
async function setUpKeys($: EngineInterface): Promise<string> {
  const path = await keybindingsPath($)
  const existing = (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
  const update = addShortcuts(existing)
  if (!update.ok) {
    return `${path} was left unchanged: ${update.reason}. Add these to its "Chat" bindings by hand:\n  "ctrl+x f": "${FIX_ACTION}",\n  "ctrl+x a": "${LEARN_ACTION}"`
  }
  if (update.added.length > 0) await $.fs.write(path, update.text)
  await loadShortcuts($)
  const lines = [
    update.added.length > 0 && `Bound ${update.added.join(' and ')} in ${path}.`,
    update.kept.length > 0 && `Already bound: ${update.kept.join(', ')}.`,
    update.conflicts.length > 0 &&
      `Not bound, as ${update.conflicts.join(' and ')} already ${update.conflicts.length > 1 ? 'do' : 'does'} something else in ${path}; bind ${FIX_ACTION} / ${LEARN_ACTION} to other keys there.`,
  ].filter(Boolean)
  return lines.join('\n')
}

function ensureLoaded($: EngineInterface): Promise<boolean> {
  loading ??= load($)
  return loading
}

async function saveLearned($: EngineInterface) {
  await $.store.set('learned', [...learned].sort())
}

// Shares the draft's misspelled words with the band, and asks aspell for
// suggestions for any it hasn't seen once typing pauses.
async function publish($: EngineInterface, found: readonly Misspelling[]) {
  currentWords = distinctWords(found)
  await publishFlagged($)
  const missing = currentWords.filter(w => !suggestions.has(w.toLowerCase()))
  if (missing.length === 0 || aspellPath === null) return
  pending?.cancel()
  pending = $.clock.after(SUGGESTION_DELAY_MS, () => {
    pending = undefined
    void fetchSuggestions($)
  })
}

async function publishFlagged($: EngineInterface) {
  const flagged: Flagged[] = currentWords.map(word => ({
    word,
    suggestions: suggestions.get(word.toLowerCase()) ?? [],
  }))
  const serialized = JSON.stringify(flagged)
  if (serialized === lastPublished) return
  lastPublished = serialized
  await update($, flaggedAtom, () => flagged)
}

async function runAspell($: EngineInterface, stdin: string): Promise<string | null> {
  const candidates = aspellPath ? [aspellPath] : ASPELL_CANDIDATES
  for (const path of candidates) {
    try {
      const { exitCode, stdout } = await $.process.run([path, '-a', '--lang=en_US'], {
        stdin,
        timeoutMs: 5000,
      })
      if (exitCode !== 0) continue
      aspellPath = path
      return stdout
    } catch {
      // Not installed at this path; try the next one.
    }
  }
  aspellPath = null
  return null
}

async function fetchSuggestions($: EngineInterface) {
  const missing = currentWords.filter(w => !suggestions.has(w.toLowerCase()))
  if (missing.length === 0) return
  // `^` makes aspell treat each line as text, never as a command.
  const stdout = await runAspell($, missing.map(w => `^${w.replace(/’/g, "'")}\n`).join(''))
  if (stdout === null) return
  const parsed = parseAspell(stdout)
  for (const word of missing) {
    const found = parsed.get(word.replace(/’/g, "'")) ?? []
    suggestions.set(word.toLowerCase(), found.slice(0, MAX_SUGGESTIONS))
  }
  await publishFlagged($)
}

// Puts new text in the prompt box with its misspellings underlined.
async function refill($: EngineInterface, text: string) {
  const found = check(text, -1)
  await $.prompt.fill({ text, mode: 'replace', decorations: decorate(found) })
  await publish($, found)
}

async function fix($: EngineInterface, word: string, replacement: string) {
  const box = await $.prompt.read()
  const text = replaceMisspelling(box.text, check(box.text, -1), word, replacement)
  if (text !== box.text) await refill($, text)
}

async function learn($: EngineInterface, word: string) {
  learned.add(word.toLowerCase())
  await saveLearned($)
  const box = await $.prompt.read()
  if (box.text !== '') await refill($, box.text)
  else await publish($, [])
}

async function setEnabled($: EngineInterface, enabled: boolean) {
  isEnabled = enabled
  await $.store.set('disabled', !enabled)
  if (!enabled) await publish($, [])
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  await ensureLoaded($)
  const [action = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const words = rest.map(w => w.toLowerCase())
  switch (action.toLowerCase()) {
    case '':
      return `Spellcheck is ${isEnabled ? 'on' : 'off'}; ${learned.size} word(s) in your dictionary.\n${USAGE}`
    case 'on':
      await setEnabled($, true)
      return 'Spellcheck is on.'
    case 'off':
      await setEnabled($, false)
      return 'Spellcheck is off.'
    case 'add':
      if (words.length === 0) return USAGE
      for (const w of words) learned.add(w)
      await saveLearned($)
      return `Added to your dictionary: ${words.join(', ')}`
    case 'remove': {
      if (words.length === 0) return USAGE
      const removed = words.filter(w => learned.delete(w))
      await saveLearned($)
      return removed.length
        ? `Removed from your dictionary: ${removed.join(', ')}`
        : 'None of those words are in your dictionary.'
    }
    case 'keys':
      return setUpKeys($)
    case 'list':
      return learned.size
        ? `Your dictionary (${learned.size}): ${[...learned].sort().join(', ')}`
        : 'Your dictionary is empty. Add words with /spellcheck add <word>.'
    default:
      return USAGE
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'spellcheck',
      description: 'Spellcheck the prompt: turn it on or off, or manage your dictionary',
      argumentHint: '[on|off|add <word>|remove <word>|list|keys]',
      immediate: true,
    })
    void ensureLoaded($)
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    if (!(await ensureLoaded($)) || !isEnabled) return box
    const found = check(box.text, box.cursor)
    await publish($, found)
    return { ...box, decorations: [...(box.decorations ?? []), ...decorate(found)] }
  })

  // A sent prompt empties the box, so nothing is left to flag.
  on('prompt.submit', async ($, e, next) => {
    if (currentWords.length > 0) await publish($, [])
    return next(e)
  })

  on('command.run', { command: 'spellcheck' }, async ($, e) => ({
    text: await runCommand($, e.args),
  }))

  // The band above the prompt. Fixes and "add" act on the first flagged word,
  // so pressing a key again moves on to the next. Keys: the chords bound to
  // FIX_ACTION and LEARN_ACTION work from the prompt, and each is shown under
  // the control it presses; after ctrl+x tab (or a click) focuses the band, so
  // do the digits and `a`. Esc gives the keyboard back to the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const flagged = await read($, flaggedAtom)
    if (e.props.hasSurvey || flagged.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const shown = flagged.slice(0, MAX_SHOWN)
    const hidden = flagged.length - shown.length
    const firstFixable = shown.findIndex(f => f.suggestions[0] !== undefined)
    const first = flagged[0]!.word
    // Keep what other mods draw in the band, above ours.
    const theirs = await next(e)

    const fixHint = firstFixable !== -1 && shortcuts.fix ? `${shortcuts.fix} fix` : undefined
    const learnHint = shortcuts.learn ? `${shortcuts.learn} add` : undefined
    // A control with its bound key in a dim line underneath, left-aligned.
    const withHint = (control: ReturnType<typeof Text>, hint: string | undefined) =>
      hint === undefined ? (
        control
      ) : (
        <Box flexDirection="column">
          {control}
          <Text dimColor>{hint}</Text>
        </Box>
      )

    return (
      <Box flexDirection="column">
        {theirs}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Text color={RED}>Spelling</Text>
          {shown.map((f, i) => {
            const best = f.suggestions[0]
            if (best === undefined) return <Text color={RED}>{f.word}</Text>
            const button = (
              <Button
                key={`fix-${i + 1}`}
                hotkey={String(i + 1)}
                plain
                {...(i === firstFixable ? { action: FIX_ACTION } : {})}
                label={`${f.word} → ${best}`}
                onPress={() => void fix($, f.word, best)}
              />
            )
            return withHint(button, i === firstFixable ? fixHint : undefined)
          })}
          {hidden > 0 && <Text dimColor>+{hidden} more</Text>}
          {withHint(
            <Button
              key="learn"
              hotkey="a"
              action={LEARN_ACTION}
              plain
              label={`add ${first} to dictionary`}
              onPress={() => void learn($, first)}
            />,
            learnHint,
          )}
        </Box>
        {fixHint === undefined && learnHint === undefined && (
          <Text dimColor>ctrl+x tab to pick with the keys above</Text>
        )}
      </Box>
    )
  })
}
