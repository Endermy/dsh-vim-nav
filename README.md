# dsh-vim-nav

Vim-style keyboard navigation for the [DeepSeek Harness](https://github.com/deepseek-ai) Web UI.

`j`/`k` to scroll, `h`/`l` to move focus between the workspace and the conversation, `i` to
write, and message-level jumps that stay inside the current session. The plugin also keeps
the mode you were in when a conversation opens, so the host's composer autofocus never
drops you into Insert unexpectedly.


## Features

- **Linear, hold-to-scroll `j`/`k`** — no queued smooth scroll, no acceleration, no
  post-release glide. Releasing the key stops on the next frame.
- **`kk` at the top loads earlier history** — uses the host's own "load earlier" control
  and releases the host's paging position hold on the next scroll key.
- **Panel focus** — `h`/`l` move left/right across the workspace, the conversation, and
  the built-in Browser. From the conversation, `l` focuses the Browser and `h` the
  workspace; from the Browser, `h` returns to the conversation when the main page has
  focus. The badge shows `NORMAL · Browser` while the Browser panel is active.
- **Composer** — `i` enters Insert; `jk` (quick `j` then `k`) or `Escape` leaves it;
  `dd` clears the draft.
- **Message jumps** — `Ctrl+J` / `Ctrl+K` jump to the next / previous top-level
  user or assistant message in the current conversation, with a short linear glide.
- **`gg` / `G`** — jump to the top / bottom of the conversation.
- **Vimium-style link hints** — `f` labels the visible conversation links; type a label to
  open the link. `Escape` cancels, `Backspace` edits the label prefix, and a key that no
  remaining label starts with exits hint mode.
- **Archive from the workspace list** — with the workspace panel focused and the cursor
  on a session, `c` then `x` invokes that row's archive action (the same button as the
  row UI). Running sessions go through the host's stop-and-archive confirmation. When
  the row disappears, the cursor moves to a neighboring row.
- **Built-in Browser Vim layer** — on desktop, the right-Sidebar Browser's Electron
  `<webview>` gets an injected page-level Vim layer: `j`/`k` linear scroll, `gg`/`G`,
  `f` link hints (same hint behavior), and `Escape`/`Backspace` for hints. Editable fields
  are left alone. Web Browser iframes are cross-origin, so the layer applies only where the
  page is scriptable (desktop webview and same-origin iframes).
- **Session search** — `Ctrl+F` opens the host's session search. The plugin moves the
  host's built-in binding from `Ctrl+K` to `Ctrl+F` once (visible and reversible in
  Settings → Shortcuts); if that binding cannot be applied, it falls back to clicking
  the sidebar search button.
- **Mode preservation** — opening or switching a conversation never changes Normal into
  Insert. If you were in Insert before switching (for example while typing, then
  `Ctrl+J`), the new composer keeps focus and stays in Insert.
- **`Space` / `Enter` select** a workspace row in Normal mode, with the same
  mode-preservation rule.
- **`Ctrl+W` is neutralized** so it does not close the window, except inside the built-in
  Browser page. There the reservation is released only while the Browser (its webview,
  iframe, toolbar, or address bar) has focus, so `Ctrl+W` closes that Browser page through
  the host's close-page command. Everywhere else the fixed reservation keeps it inert.
- **No visual mode** — Normal and Insert only.
- **Never consumes Win / Super / Meta combinations** — those remain for the compositor
  or OS.

## Keymap

| Key | Mode | Action |
| --- | --- | --- |
| `j` / `k` | Normal | Hold to scroll down / up (constant speed, linear) |
| `kk` | Normal | At the conversation top: load one page of earlier history |
| `h` / `l` | Normal | Focus left / right: workspace ↔ conversation ↔ Browser |
| `i` | Normal | Enter the composer (Insert) |
| `j` `k` (quickly) | Insert | Exit Insert |
| `Escape` | Insert | Exit Insert |
| `dd` | Normal | Clear the composer draft |
| `c` `x` | Normal (workspace) | Archive the session under the cursor |
| `Ctrl+J` | Any | Next top-level message in this conversation |
| `Ctrl+K` | Any | Previous top-level message in this conversation |
| `gg` | Normal | Conversation top |
| `G` | Normal | Conversation bottom |
| `f` | Normal | Show hint labels on visible conversation links; type a label to open |
| `Backspace` | Hint | Delete the typed hint prefix |
| `Escape` | Hint | Cancel link hints |
| `Ctrl+F` | Any | Session search |
| `Space` / `Enter` | Normal (workspace) | Select the row under the workspace cursor |
| `Ctrl+W` | Any | Reserved in the app; inside the built-in Browser it closes that page |

`Ctrl+J`/`Ctrl+K` target top-level `user` and `assistant-step` rows. Tool calls, process
rows, and turn tails are skipped. At the first/last message the jump stops.

### Built-in Browser page

Keys inside the Browser page go to the page (the desktop webview / same-origin iframe),
not to the main conversation. The injected layer provides:

| Key | Action |
| --- | --- |
| `j` / `k` | Scroll down / up (linear, 35% of the viewport) |
| `gg` / `G` | Top / bottom |
| `f` | Hint the visible page links; type a label to click |
| `h` / `l` | Disabled: consumed by the layer, not forwarded to the page |
| `Escape` / `Backspace` | Cancel hints / edit the typed label |

Editable fields (`input`, `textarea`, `select`, `contenteditable`) are not intercepted.
`h`/`l` are intentionally consumed inside the Browser page (they do not reach the visited
page); the main `h`/`l` panel focus is unchanged. Click the conversation to return to the
main Vim surface.

## Install

Requirements: a working DSH profile and a DSH desktop/web runtime that supports local
Cordis bundles.

```bash
git clone https://github.com/Endermy/dsh-vim-nav.git
```

Then register this directory as a bundle in your DSH profile with the Harness plugin
manager ("install local bundle" / `install_bundle` targeting the absolute package
directory). The profile records it as `@local/dsh-vim-nav`; the plugin appears as
**Vim Navigation** in the plugin list.

Rebuild/reload the Web UI once after installing. On desktop, reload the page (or restart
the app if your build only syncs shortcut definitions at launch).

The package is a local bundle, not an npm release. To publish it on npm, rename it to a
scope you own and update `cordis.patch.yml` accordingly.

## Package layout

| File | Purpose |
| --- | --- |
| `package.json` | Bundle manifest (`dsh.bundle`, `dsh.client`) and exports |
| `cordis.patch.yml` | Inserts the `vim-nav` Loader row |
| `index.js` | Host half (display/row entry) |
| `client.js` | Browser half: overlay, keyboard controller, scroll driver |
| `locale/*.json` | English/Chinese plugin title and description |
| `icon.svg` | Plugin icon |

There is no build step: `client.js` is loaded directly by the DSH client module loader.
The DOM hooks are DSH-specific (`[data-conversation-scroll]`,
`[data-composer-input]`, `[data-chat-anchor-key]`, `[data-row-key]`, and the client
services `slots`/`locale`/`layout`/`shortcuts`), so a future DSH DOM change may require a
matching update.

## Development

```bash
node --check client.js
node --check index.js
python3 -m json.tool package.json >/dev/null
```

Edit `client.js`, then reinstall/reload the bundle in the profile. The UI is rendered by a
`shell.overlay` slot; there is no separate dev server.

## Compatibility notes

- Tested on DSH Desktop (Linux) in November 2026.
- `Win`/`Super` shortcuts are outside the page's control; the plugin only ignores them.
- On a plain browser the `Ctrl+F` rebinding may not be available; the plugin then clicks
  the sidebar search button instead.
- The `Ctrl+F` rebinding is a persistent shortcut-setting change. It only runs once when
  the setting is unmodified; you can change it back in Settings → Shortcuts.

## 中文说明

这是一个给 DSH Web UI 用的 Vim 风格导航插件：

- `j`/`k` 按住线性滚动，松开即停；对话顶部连按 `kk` 加载更早历史
- `h`/`l` 切换工作区/对话焦点，`i` 进入输入框，`jk` 退出编辑，`dd` 清空草稿
- `Ctrl+J`/`Ctrl+K` 跳当前会话的下一条/上一条消息，`gg`/`G` 到会话顶部/底部
- `f` 显示当前可见对话链接的提示字母，输入字母即可打开；输入不成提示的键会退出提示模式，Esc 取消
- 工作区列表里 `c` `x` 归档光标所在会话（走该行的归档按钮；运行中的会话会弹宿主的停止并归档确认；归档后光标移到相邻行）
- `h`/`l` 在 工作区 ← 对话 → 内置浏览器 之间移动焦点；对话里 `l` 聚焦浏览器，浏览器里 `h` 回对话（主界面有焦点时）
- 桌面端内置浏览器页注入 Vim 层：`j`/`k` 线性滚动、`gg`/`G`、`f` 链接提示；输入框不拦截；页内 `h`/`l` 被禁用（不再传给页面），主界面 `h`/`l` 三栏焦点不变
- `Ctrl+F` 搜索会话（会把宿主原本的 `Ctrl+K` 搜索改绑到 `Ctrl+F`，可在设置里改回）
- `Space`/`Enter` 选中工作区行；进入会话时保持进入前的模式（Normal 不会因为自动聚焦变成 Insert）
- `Ctrl+W` 在普通界面不关闭窗口；只有焦点在内置 Browser 页（webview / iframe / 地址栏）时才解禁，用来关闭该浏览页；不占用 Win/Super 系统快捷键
- 内置浏览器页内的按键由页面脚本处理，`h`/`l` 不会传回主界面；点一下对话即可返回

安装：克隆仓库后，用 DSH 的插件管理器把该目录作为本地 bundle 安装，刷新页面即可。

## License

MIT © 2026 Endermy
