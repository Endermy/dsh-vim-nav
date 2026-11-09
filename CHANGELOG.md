# Changelog

## 1.3.2 — 2026-11-09

- Reverted the 1.3.1 Browser-page `h`/`l` consumption: the injected layer no longer
  intercepts `h`/`l`, so they reach the visited page normally.
- The per-document injection guard remains, so the Browser layer re-installs after an
  iframe navigation even when the window object survives.

## 1.3.1 — 2026-11-09

- The Browser page Vim layer now consumes `h`/`l`: they no longer reach the visited
  page (inputs still receive them). The main `h`/`l` workspace/conversation/Browser
  focus is unchanged.
- The injected layer uses a per-document guard, so an iframe navigation re-installs the
  layer even when the window object survives; the `f`/`j`/`k` behavior is unchanged.

## 1.3.0 — 2026-11-09

- Workspace archive: `c` then `x` with the cursor on a session row clicks that row's
  archive action. Idle sessions archive immediately; running sessions use the host's
  stop-and-archive confirmation. The cursor moves to a neighboring row when the archived
  row disappears.
- Multi-key prefixes (`dd`, `gg`, `kk`, `cx`) reset on any unrelated key, including
  modifier shortcuts consumed by the host (such as Ctrl+J/K), and on pointer input.
- Rest of the 1.2.0 Browser/Vim behavior is unchanged.

## 1.2.0 — 2026-11-09

- `h`/`l` now move left/right across the workspace, conversation, and built-in Browser
  instead of always jumping to one fixed panel. The Browser has its own `NORMAL · Browser`
  badge; `l` from the conversation focuses the Browser.
- The built-in Browser gets a page-level Vim layer injected into its desktop `<webview>`
  (and same-origin iframes): `j`/`k` linear scrolling, `gg`/`G`, Vimium-style `f` link
  hints, and `Escape`/`Backspace` for hints. Editable fields are not intercepted.
- The Browser Vim layer is plain page JavaScript: no Node, no DSH APIs, no access to the
  host page.

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
