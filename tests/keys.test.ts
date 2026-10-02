import { expect, test } from 'claude-code/testing'

import { parseShortcuts } from '../hooks/keys'

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
