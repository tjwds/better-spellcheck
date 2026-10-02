import { expect, mock, test } from 'claude-code/testing'

import { addShortcuts, parseShortcuts } from '../hooks/keys'

test('finds the keys bound to the band actions in Chat or Global', () => {
  const text = JSON.stringify({
    bindings: [
      { context: 'Transcript', bindings: { 'ctrl+x f': 'app:toggleDiffNoiseFilter' } },
      { context: 'Global', bindings: { 'ctrl+x g': 'app:toggleDiffNoiseFilter' } },
      { context: 'Chat', bindings: { 'ctrl+x a': 'app:toggleDiffPreSession', 'ctrl+s': null } },
    ],
  })
  expect(parseShortcuts(text)).toEqual({ fix: 'ctrl+x g', learn: 'ctrl+x a' })
})

test('tolerates a missing or malformed file', () => {
  expect(parseShortcuts('')).toEqual({})
  expect(parseShortcuts('{"bindings": 3}')).toEqual({})
  expect(parseShortcuts('{"bindings": [null, {"context": "Chat"}]}')).toEqual({})
})

test('addShortcuts creates a file with a Chat block when there is none', () => {
  const update = addShortcuts(undefined)
  expect(update).toMatchObject({ ok: true, added: ['ctrl+x f', 'ctrl+x a'], kept: [], conflicts: [] })
  if (!update.ok) return
  expect(JSON.parse(update.text)).toEqual({
    bindings: [
      {
        context: 'Chat',
        bindings: { 'ctrl+x f': 'app:toggleDiffNoiseFilter', 'ctrl+x a': 'app:toggleDiffPreSession' },
      },
    ],
  })
})

test('addShortcuts keeps existing bindings and fields, and reports conflicts', () => {
  const existing = JSON.stringify({
    $schema: 'https://www.schemastore.org/claude-code-keybindings.json',
    bindings: [
      { context: 'Global', bindings: { 'ctrl+t': 'app:toggleTodos' } },
      { context: 'Chat', bindings: { 'ctrl+x a': 'chat:stash', enter: 'chat:submit' } },
    ],
  })
  const update = addShortcuts(existing)
  expect(update).toMatchObject({ ok: true, added: ['ctrl+x f'], conflicts: ['ctrl+x a'] })
  if (!update.ok) return
  const out = JSON.parse(update.text)
  expect(out.$schema).toBe('https://www.schemastore.org/claude-code-keybindings.json')
  expect(out.bindings[0]).toEqual({ context: 'Global', bindings: { 'ctrl+t': 'app:toggleTodos' } })
  expect(out.bindings[1].bindings).toEqual({
    'ctrl+x a': 'chat:stash',
    enter: 'chat:submit',
    'ctrl+x f': 'app:toggleDiffNoiseFilter',
  })
})

test('addShortcuts keeps an action already bound to another key', () => {
  const existing = JSON.stringify({
    bindings: [{ context: 'Global', bindings: { 'ctrl+x g': 'app:toggleDiffNoiseFilter' } }],
  })
  expect(addShortcuts(existing)).toMatchObject({ ok: true, added: ['ctrl+x a'], kept: ['ctrl+x g'] })
})

test('addShortcuts refuses a file it cannot read as JSON', () => {
  expect(addShortcuts('{ // comment\n }')).toEqual({ ok: false, reason: 'it is not plain JSON' })
  expect(addShortcuts('[]')).toEqual({ ok: false, reason: 'it is not a JSON object' })
  expect(addShortcuts('{"bindings": {}}')).toEqual({ ok: false, reason: '"bindings" is not an array' })
})

test('/spellcheck keys writes the bindings and the band picks them up', async ($, on) => {
  mock.store(on, {})
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg' })
  const files = new Map<string, string>()
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path) ?? (e.path.endsWith('/words.txt') ? 'the\n' : undefined)
    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  const run = $.command.run as (e: { command: string; args: string }) => Promise<{ text?: string }>

  const first = await run({ command: 'spellcheck', args: 'keys' })
  expect(first.text).toBe('Bound ctrl+x f and ctrl+x a in /cfg/keybindings.json.')
  expect(parseShortcuts(files.get('/cfg/keybindings.json') ?? '')).toEqual({ fix: 'ctrl+x f', learn: 'ctrl+x a' })

  const again = await run({ command: 'spellcheck', args: 'keys' })
  expect(again.text).toBe('Already bound: ctrl+x f, ctrl+x a.')
})
