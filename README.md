# better-spellcheck

A Claude Code mod that spellchecks your prompt as you type, and fixes typos from the keyboard.

```
Spelling  1: teh → the  2: recieve → receive  a: add teh to dictionary
          ctrl+x f fix                        ctrl+x a add
────────────────────────────────────────────────────────────────────────
❯ please fix teh bug and recieve it
```

- Misspelled words in the prompt are underlined in your terminal's red, once you've finished typing them.
- The band above the prompt lists each one with a suggested fix.
- `ctrl+x f` fixes the first misspelling, everywhere it appears in the prompt, keeping its capitalization. Press it again for the next one.
- `ctrl+x a` adds the first flagged word to your personal dictionary instead.

Requires Claude Code 2.1.287 or later.

## Install

```bash
# 1. Get the code
git clone https://github.com/tjwds/better-spellcheck.git
cd better-spellcheck

# 2. Install the mod (the repo is its own plugin marketplace)
claude plugin marketplace add .
claude plugin install better-spellcheck@better-spellcheck-local

# 3. Bind ctrl+x f and ctrl+x a in your keybindings.json
claude -p "/spellcheck keys"

# 4. For suggestions, install aspell (macOS shown; on Debian/Ubuntu: sudo apt install aspell aspell-en)
brew install aspell
```

Then start a new Claude Code session, or run `/reload-plugins` in an open one.

- **Step 3** adds two bindings to the `Chat` block of `keybindings.json` in your config directory (`$CLAUDE_CONFIG_DIR`, or `~/.claude`). It creates the file if there isn't one, and doesn't change your other bindings. If `ctrl+x f` or `ctrl+x a` is already bound to something else, it leaves that key alone and tells you.
- **Without aspell**, misspellings are still underlined and listed, but with no suggested fix; `ctrl+x a` still works.

To update, run `git pull` in the clone, then `/reload-plugins`. The marketplace points at the clone, so don't move or delete it. To uninstall, run `claude plugin marketplace remove better-spellcheck-local`.

## Usage

### The band

The band appears above the prompt while the draft has misspellings:

- `ctrl+x f` applies the fix shown above it, the first misspelling with a suggestion.
- `ctrl+x a` adds the first flagged word to your dictionary.
- To pick a different word, press `ctrl+x tab` (or click the band) to move the keyboard to it, then press that word's number. `Esc` returns you to the prompt.

A word with no suggestion is listed in red without a number. Anything other mods draw in the band stays above this row.

### `/spellcheck`

| Command | What it does |
| --- | --- |
| `/spellcheck` | Show whether checking is on, and the usage |
| `/spellcheck on`, `/spellcheck off` | Turn checking on or off; remembered across sessions |
| `/spellcheck add <word…>` | Add words to your personal dictionary |
| `/spellcheck remove <word…>` | Remove words from your personal dictionary |
| `/spellcheck list` | Show your personal dictionary |
| `/spellcheck keys` | Bind `ctrl+x f` and `ctrl+x a` (install step 3) |

### What isn't checked

Inline and fenced code, URLs, paths, `@mentions`, `/commands`, `file.ext`, `snake_case`, camelCase, ALLCAPS acronyms and their plurals (`PRs`), words with digits, and words with non-ASCII letters.

## Keyboard shortcuts

Mods can't define their own keybinding actions, so the band's buttons borrow two of Claude Code's that do nothing at the prompt: both act only on the `/diff` panel Claude Code used before its built-in diff mod, and neither has a default key. `/spellcheck keys` binds them:

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

To use other keys, change them in `keybindings.json`; the band shows whichever keys are bound. `ctrl+x` chords reach Claude Code in every terminal. Cmd and Option combinations depend on the terminal: many keep Cmd+digit for their own tabs or panes, and Option types characters unless it's set to act as Meta.

## How it works

| Piece | Mod API |
| --- | --- |
| Underlines | A `prompt.edit` hook returns `decorations` for each unknown word, in `ansi256(1)`: palette slot 1, the terminal's own red |
| Band | `ui.render` on `AbovePrompt`, reading a `$.state` value the edit hook writes |
| Suggestions | `aspell -a` through `$.process.run`, 250 ms after typing pauses, cached per word |
| Fixes | `$.prompt.read` + `$.prompt.fill`, from Buttons with a `hotkey` and an `action` |
| Dictionary, on/off | `$.store` |

What gets flagged is decided by `hooks/words.txt` (aspell's en_US master list, 123,679 words including inflections), `hooks/extra-words.txt` (software terms), and your personal dictionary. aspell only supplies suggestions.

The underline is drawn in the same color as the word: decorations have no separate underline color.

## Development

| Path | What's in it |
| --- | --- |
| `hooks/register.tsx` | The hooks |
| `hooks/spell.ts` | Tokenizing, lookup, aspell parsing, replacement |
| `hooks/keys.ts` | The borrowed actions, reading and adding their keybindings |
| `hooks/words.txt` | The word list; regenerate with `scripts/build-dictionary.sh` |
| `hooks/extra-words.txt` | Extra technical words, one per line |
| `tests/` | Run with `claude plugin test .` |

Check the plugin and hooks module with `claude plugin validate .claude-plugin/plugin.json`, and the marketplace with `claude plugin validate .`. Edits take effect after `/reload-plugins`.
