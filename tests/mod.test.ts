import { expect, mock, test } from 'claude-code/testing'

const WORDS = 'the\nquick\nbrown\nfox\njumps\nover\nlazy\ndog\n'
const KEYBINDINGS = JSON.stringify({
  bindings: [
    { context: 'Chat', bindings: { 'ctrl+x f': 'app:toggleDiffNoiseFilter', 'ctrl+x a': 'app:toggleDiffPreSession' } },
  ],
})
const ASPELL_OUT = '@(#) International Ispell Version 3.1.20\n& teh 3 0: the, tech, Te\n\n'

const BAND = {
  plugin: 'better-claude-spellcheck',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

type Edit = { text: string; start: number; end: number; inputText: string }
type Box = { text: string; cursor: number; decorations?: Array<{ start: number; end: number }> }

const ran = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

// The kit fills in origin and presentation, as the docs' examples rely on.
function spellcheck($: { command: { run: unknown } }, args: string): Promise<{ text?: string }> {
  const run = $.command.run as (e: { command: string; args: string }) => Promise<{ text?: string }>
  return run({ command: 'spellcheck', args })
}

// The test kit's typed `$` doesn't list prompt.edit; it fires like any event.
function typeInto($: unknown, edit: Edit): Promise<Box> {
  const prompt = ($ as { prompt: { edit: (e: unknown) => Promise<Box> } }).prompt
  return prompt.edit({ origin: { kind: 'composer' }, cursor: edit.start, ...edit })
}

test('underlines a misspelling once the word is finished, and the band offers the fix', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on, {})
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg' })
  on('fs.read', ($, e) => {
    if (e.path === '/cfg/keybindings.json') return { value: KEYBINDINGS }
    return { value: e.path.endsWith('/words.txt') ? WORDS : '# none\n' }
  })
  const runs: string[][] = []
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    return ran(ASPELL_OUT)
  })
  // Claude Code's own editing: apply the splice, cursor after it.
  on('prompt.edit', ($, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  let box = { text: '', cursor: 0 }
  on('prompt.read', () => ({ value: box }))
  const fills: Array<{ text: string; decorations?: unknown[] }> = []
  on('prompt.fill', ($, e) => {
    fills.push({ text: e.text, decorations: e.decorations })
    box = { text: e.text, cursor: e.text.length }
    return { isFilled: true }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))

  // Still typing "teh": nothing flagged yet.
  const typing = await typeInto($, { text: 'the quick ', start: 10, end: 10, inputText: 'teh' })
  expect(typing.decorations ?? []).toEqual([])

  // A space finishes the word.
  const done = await typeInto($, { text: 'the quick teh', start: 13, end: 13, inputText: ' ' })
  expect(done.text).toBe('the quick teh ')
  expect(done.decorations).toMatchObject([{ start: 10, end: 13, underline: true }])
  box = { text: done.text, cursor: done.cursor }

  // Suggestions arrive once typing pauses.
  expect(runs).toEqual([])
  await clock.advance(250)
  expect(runs.length).toBe(1)
  expect(runs[0]).toContain('-a')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // A plain button, so the terminal shows its key: `1: teh → the`.
  expect(await ui.find({ key: 'fix-1' })).toMatchObject({
    props: { hotkey: '1', plain: true, label: 'teh → the', action: 'app:toggleDiffNoiseFilter' },
  })
  expect(await ui.find({ key: 'learn' })).toMatchObject({
    props: { hotkey: 'a', label: 'add teh to dictionary', action: 'app:toggleDiffPreSession' },
  })
  // The keys bound in keybindings.json, each under the control it presses.
  expect(await ui.find({ type: 'Text', text: 'ctrl+x f fix' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'ctrl+x a add' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctrl\+x tab/ })).toBeUndefined()
  // What other mods draw in the band stays.
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
  await ui.press({ key: 'fix-1' })
  expect(fills.map(f => f.text)).toEqual(['the quick the '])
  expect(fills[0]?.decorations).toEqual([])
  expect(done.decorations).toMatchObject([{ color: 'ansi256(1)' }])

  // Nothing is left to flag, so the band gives way to Claude Code's own.
  expect(await ui.find({ key: 'fix-1' })).toBeUndefined()
  await ui.unmount()
})

test('/spellcheck add learns a word, and off stops underlining', async ($, on) => {
  mock.clock(on)
  const saved = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.read', ($, e) => ({ value: e.path.endsWith('/words.txt') ? WORDS : '' }))
  on('process.run', () => ran(''))
  on('prompt.edit', ($, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))

  const before = await typeInto($, { text: '', start: 0, end: 0, inputText: 'the zorp fox' })
  expect(before.decorations).toMatchObject([{ start: 4, end: 8 }])

  const added = await spellcheck($, 'add Zorp')
  expect(added.text).toBe('Added to your dictionary: zorp')
  expect(saved.get('learned')).toEqual(['zorp'])
  const listed = await spellcheck($, 'list')
  expect(listed.text).toBe('Your dictionary (1): zorp')

  const after = await typeInto($, { text: '', start: 0, end: 0, inputText: 'the zorp fox' })
  expect(after.decorations ?? []).toEqual([])

  await spellcheck($, 'off')
  expect(saved.get('disabled')).toBe(true)
  const off = await typeInto($, { text: '', start: 0, end: 0, inputText: 'the blarg fox' })
  expect(off.decorations ?? []).toEqual([])

  const removed = await spellcheck($, 'remove zorp nope')
  expect(removed.text).toBe('Removed from your dictionary: zorp')
})

test('without aspell, words are still underlined and the band lists them', async ($, on) => {
  const clock = mock.clock(on)
  let learned: unknown
  on('store.get', () => ({ value: undefined }))
  on('store.set', ($, e) => {
    if (e.key === 'learned') learned = e.value
    return { value: undefined }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('/words.txt') ? WORDS : '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  let attempts = 0
  on('process.run', () => {
    attempts += 1
    return { deny: 'not installed' }
  })
  on('prompt.edit', ($, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))

  const box = await typeInto($, { text: '', start: 0, end: 0, inputText: 'the qwzx fox' })
  expect(box.decorations).toMatchObject([{ start: 4, end: 8 }])
  await clock.advance(250)
  expect(attempts).toBe(3)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'qwzx' })).toBeDefined()
  // No keybindings file: the hint names only the focus chord.
  expect(await ui.find({ type: 'Text', text: 'ctrl+x tab to pick with the keys above' })).toBeDefined()
  await ui.press({ key: 'learn' })
  await ui.unmount()

  expect(learned).toEqual(['qwzx'])

  // aspell is not looked for again this session.
  await typeInto($, { text: 'the qwzx fox', start: 12, end: 12, inputText: ' blorp ' })
  await clock.advance(250)
  expect(attempts).toBe(3)
})
