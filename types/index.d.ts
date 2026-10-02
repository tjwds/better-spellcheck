/** One misspelled word in the draft and aspell's suggestions for it. */
export type Flagged = { word: string; suggestions: string[] }

declare module 'claude-code' {
  interface PluginState {
    'better-claude-spellcheck': { flagged: Flagged[] }
  }
}
