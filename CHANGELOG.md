# Changelog

## 1.1.1 — 2026-11-09

- Link hints: a key that no remaining label starts with now exits hint mode instead of
  being ignored.
- `Ctrl+W`: the fixed reservation is released only while the built-in Browser page has
  focus, so `Ctrl+W` closes that Browser page; outside the Browser it still does not
  close the application window.

## 1.1.0 — 2026-11-09

- Vimium-style link hints: `f` labels visible conversation links, typing a label opens
  the link, `Escape` cancels, and `Backspace` edits the typed prefix.
- Hints stay aligned while the conversation scrolls or resizes, and the mode badge shows
  `HINT · select link`.

## 1.0.0 — 2026-11-09

Initial public release.

- Normal/Insert Vim-style navigation for the DSH Web UI.
- Hold-to-scroll `j`/`k` with a linear, velocity-driven scrollport; stops on key release.
- `kk` at the conversation top loads one page of earlier history and releases the
  host's paging position hold on the next scroll key.
- `h`/`l` switch focus between workspace and conversation.
- `i` enters the composer; `jk` exits Insert; `dd` clears the draft.
- `Ctrl+J`/`Ctrl+K` jump to the next/previous top-level user or assistant message.
- `gg`/`G` jump to the conversation top/bottom.
- `Ctrl+F` session search, including a one-time rebind of the host's search command
  from `Ctrl+K` to `Ctrl+F` and a sidebar-button fallback.
- `Space`/`Enter` select a workspace row; the mode in effect before entering a
  conversation is preserved.
- `Ctrl+W` no longer closes the window.
- Never consumes Win/Super/Meta combinations.
