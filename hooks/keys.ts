// Mods can't define keybinding actions of their own, so the band's buttons
// borrow two of Claude Code's that nothing handles at the prompt: both act
// only on the diff panel that /diff opened before the cc-plugin-diff mod, and
// neither has a default key. A Button naming one is pressed by whatever key
// the person binds to it in the Chat or Global context.
export const FIX_ACTION = 'app:toggleDiffNoiseFilter'
export const LEARN_ACTION = 'app:toggleDiffPreSession'

export type Shortcuts = { fix?: string; learn?: string }

/** The keys bound to the two actions in a keybindings.json, where the prompt sees them. */
export function parseShortcuts(text: string): Shortcuts {
  const found: Shortcuts = {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return found
  }
  const blocks = (parsed as { bindings?: unknown })?.bindings
  if (!Array.isArray(blocks)) return found
  for (const block of blocks) {
    const { context, bindings } = (block ?? {}) as { context?: unknown; bindings?: unknown }
    if (context !== 'Chat' && context !== 'Global') continue
    if (typeof bindings !== 'object' || bindings === null) continue
    for (const [key, action] of Object.entries(bindings)) {
      if (action === FIX_ACTION) found.fix ??= key
      if (action === LEARN_ACTION) found.learn ??= key
    }
  }
  return found
}

// The keys `/spellcheck keys` binds: ctrl+x chords reach Claude Code from
// every terminal, where Cmd and Option combinations often don't.
export const DEFAULT_KEYS: ReadonlyArray<readonly [key: string, action: string]> = [
  ['ctrl+x f', FIX_ACTION],
  ['ctrl+x a', LEARN_ACTION],
]

export type KeysUpdate =
  | { ok: true; text: string; added: string[]; kept: string[]; conflicts: string[] }
  | { ok: false; reason: string }

/**
 * Adds DEFAULT_KEYS to a keybindings.json's Chat block, keeping everything
 * else. `existing` is the file's text, or undefined when there is no file.
 * An action already bound anywhere the prompt sees is kept as it is, and a
 * key already bound to something else is left alone and reported.
 */
export function addShortcuts(existing: string | undefined): KeysUpdate {
  let root: Record<string, unknown> = {}
  if (existing !== undefined && existing.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(existing)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, reason: 'it is not a JSON object' }
      }
      root = parsed as Record<string, unknown>
    } catch {
      return { ok: false, reason: 'it is not plain JSON' }
    }
  }
  if (root.bindings !== undefined && !Array.isArray(root.bindings)) {
    return { ok: false, reason: '"bindings" is not an array' }
  }
  const blocks = (root.bindings ?? []) as unknown[]
  let chat = blocks.find(
    (b): b is { context: string; bindings: Record<string, unknown> } =>
      typeof b === 'object' &&
      b !== null &&
      (b as { context?: unknown }).context === 'Chat' &&
      typeof (b as { bindings?: unknown }).bindings === 'object' &&
      (b as { bindings?: unknown }).bindings !== null,
  )
  if (chat === undefined) {
    chat = { context: 'Chat', bindings: {} }
    blocks.push(chat)
  }
  const bound = parseShortcuts(JSON.stringify({ bindings: blocks }))
  const added: string[] = []
  const kept: string[] = []
  const conflicts: string[] = []
  for (const [key, action] of DEFAULT_KEYS) {
    const already = action === FIX_ACTION ? bound.fix : bound.learn
    if (already !== undefined) {
      kept.push(already)
    } else if (chat.bindings[key] !== undefined && chat.bindings[key] !== action) {
      conflicts.push(key)
    } else {
      chat.bindings[key] = action
      added.push(key)
    }
  }
  const text = `${JSON.stringify({ ...root, bindings: blocks }, null, 2)}\n`
  return { ok: true, text, added, kept, conflicts }
}
