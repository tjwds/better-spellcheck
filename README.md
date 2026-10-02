# better-spellcheck

A Claude Code mod that spellchecks the prompt box as you type.

- **Underlines**: misspelled words are drawn in your terminal's own red (palette color 1) and underlined once you finish them; the word under the cursor is left alone while you type it.
- **Suggestions band**: above the prompt:
  ```
  Spelling  1: teh → the  2: recieve → receive  a: add teh to dictionary
  ctrl+x f fixes teh · ctrl+x a adds teh to your dictionary · ctrl+x tab to pick with the keys above
  ```
  - `ctrl+x f` fixes the first misspelling (every occurrence, matching capitalization); press it again for the next one.
  - `ctrl+x a` adds the first flagged word to your dictionary.
  - To pick a different word, press `ctrl+x tab` (or click the band), then its number. `Esc` returns to the prompt.
  - Whatever other mods draw in the band stays above it.
- **`/spellcheck`**: `on`, `off`, `add <word…>`, `remove <word…>`, `list`. The on/off switch and personal dictionary persist across sessions.

Skipped: inline and fenced code, URLs, paths, `@mentions`, `/commands`, `file.ext`, `snake_case`, camelCase, ALLCAPS acronyms and their plurals (`PRs`), words with digits, and words with non-ASCII letters.

## Keyboard shortcuts

Mods can't define keybinding actions, so the band's buttons borrow two of Claude Code's that do nothing at the prompt (both only act on the pre-mod `/diff` panel, and neither has a default key). Bind them in `keybindings.json` in your config directory (`$CLAUDE_CONFIG_DIR`, or `~/.claude`):

```json
{
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+x f": "app:toggleDiffNoiseFilter",
        "ctrl+x a": "app:toggleDiffPreSession"
      }
    }
  ]
}
```

Any key works; the band's hint shows whatever you bind. A `ctrl+x` chord reaches Claude Code in every terminal. Cmd and Option combinations depend on the terminal: many reserve Cmd+digit for their own tabs or panes, and Option types characters unless it is set to act as Meta.

## How it works

| Piece | Mod API |
| --- | --- |
| Underlines | `prompt.edit` hook returns `decorations` for each unknown word |
| Band | `ui.render` on `AbovePrompt`, reading a `$.state` value the edit hook writes |
| Suggestions | `aspell -a` via `$.process.run`, 250 ms after typing pauses, cached per word |
| Fixes | `$.prompt.read` + `$.prompt.fill`, from Buttons with a `hotkey` and an `action` |
| Dictionary, on/off | `$.store` |

Which words get flagged is decided by `hooks/words.txt` (aspell's en_US master list, 123,679 words including inflections) plus `hooks/extra-words.txt` (software terms) plus your personal dictionary. aspell is only used for suggestions; without it, words are still underlined and listed in the band with no fix buttons.

## Files

- `hooks/register.tsx`: the hooks
- `hooks/spell.ts`: tokenizing, lookup, aspell parsing, replacement (no `$`)
- `hooks/keys.ts`: the borrowed actions, and reading which keys are bound to them
- `hooks/words.txt`: regenerate with `scripts/build-dictionary.sh`
- `hooks/extra-words.txt`: add common technical words here
- `tests/`: run with `claude plugin test .`

## Install

This directory is also a local marketplace (`.claude-plugin/marketplace.json`):

```bash
claude plugin marketplace add ~/projects/better-spellcheck
claude plugin install better-spellcheck@better-spellcheck-local
```

The marketplace points at this directory, so edits take effect on the next session start or after `/reload-plugins`.

Validate with `claude plugin validate .claude-plugin/plugin.json` (the plugin and hooks module) and `claude plugin validate .` (the marketplace).
