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
