window.__ModuleLoader__.load({
  id: '@local/dsh-vim-nav',
  factory(require) {
    const React = require('react');

    /** Locale namespace owned by this plugin. */
    const NS = 'vim-nav';
    /** How long a typed `j` stays eligible as the first half of the `jk` escape. */
    const JK_TIMEOUT_MS = 280;
    /** Throttle for the layout sampler that follows panel/sidebar geometry changes. */
    const SAMPLE_INTERVAL_MS = 120;
    /** Short tail after releasing Super so a late letter from the combo stays ignored. */
    const META_GRACE_MS = 150;
    /** Clear a Super state whose keyup was swallowed by the OS/compositor. */
    const META_SAFETY_MS = 3000;
    /** j/k glides at a constant velocity derived from the viewport height. */
    const SCROLL_SPEED_RATIO = 2.2;
    const SCROLL_SPEED_MIN = 800;
    const SCROLL_SPEED_MAX = 1400;
    /** Longest frame delta applied so a main-thread stall cannot teleport the view. */
    const SCROLL_FRAME_CAP_MS = 20;
    /** How long a first `d` waits for the second one in Normal mode. */
    const DD_TIMEOUT_MS = 700;
    /** How long a first `g` waits for the second one in Normal mode. */
    const GG_TIMEOUT_MS = 600;
    /** How long a first `k` at the top waits for the second one to load older history. */
    const KK_TIMEOUT_MS = 500;

    /** Labels used for Vimium-style `f` link hints, home row first. */
    const HINT_ALPHABET = 'asdfghjklqwertyuiopzxcvbnm';

    /** Key/code spellings of the Windows/Super/OS modifier across engines. */
    const META_KEY_NAMES = new Set(['Meta', 'OS', 'Super', 'Win']);
    const META_KEY_CODES = new Set(['MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);
    /** Modifier states that mean "the user is talking to the OS, not to us". */
    const SYSTEM_MODIFIER_STATES = ['Meta', 'OS', 'Super', 'Win', 'AltGraph'];

    const en = {
      'mode.normal': 'NORMAL',
      'mode.insert': 'INSERT',
      'mode.hint': 'HINT',
      'mode.edit': 'editing',
      'hint.select': 'select link',
      'panel.workspace': 'Workspace',
      'panel.conversation': 'Conversation',
      'ctrlW.keep': 'Keep Ctrl+W (do not close the window)',
    };
    const zh = {
      'mode.normal': 'NORMAL',
      'mode.insert': 'INSERT',
      'mode.hint': 'HINT',
      'mode.edit': '编辑中',
      'hint.select': '选择链接',
      'panel.workspace': '工作区',
      'panel.conversation': '对话',
      'ctrlW.keep': '保留 Ctrl+W（不关闭窗口）',
    };

    /** Conversation scrollport inside the central panel (never the rightbar's). */
    const CONVERSATION_SCROLL_SELECTOR = '[data-slot="main"] [data-conversation-scroll]';
    /** Lexical contenteditable that owns the central panel's resident composer. */
    const COMPOSER_SELECTOR = '[data-slot="main"] [data-composer-input]';
    /** Sidebar session/workspace rows, in visual order. */
    const SIDEBAR_ROW_SELECTOR = '[data-row-key]';
    /** Central conversation body carrying the mounted session id. */
    const CONVERSATION_CONTENT_SELECTOR = '[data-slot="main"] [data-conversation-content]';

    // #region DOM helpers

    function isVisible(element) {
      if (!(element instanceof Element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    }

    function isMetaKeyEvent(event) {
      if (META_KEY_NAMES.has(event.key)) return true;
      if (META_KEY_CODES.has(event.code)) return true;
      return event.keyCode === 91 || event.keyCode === 92;
    }

    /**
     * True when a system-level modifier is plausibly part of this event.
     *
     * `metaKey` alone is not enough: Chromium does not expose the Windows key on
     * every platform, and a remapper or compositor may deliver the letter with
     * only `getModifierState` reflecting the real key state.
     */
    function hasSystemModifier(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return true;
      if (typeof event.getModifierState !== 'function') return false;
      for (const name of SYSTEM_MODIFIER_STATES) {
        try {
          if (event.getModifierState(name)) return true;
        } catch {
          // Unknown modifier names are allowed to throw on older engines.
        }
      }
      return false;
    }

    function editableAncestor(node) {
      if (!(node instanceof Element)) return null;
      return node.closest(
        'input, textarea, select, [contenteditable="true"], [role="textbox"]',
      );
    }

    function conversationScroller() {
      const element = document.querySelector(CONVERSATION_SCROLL_SELECTOR);
      return element instanceof HTMLElement && isVisible(element) ? element : null;
    }

    function composerInput() {
      const element = document.querySelector(COMPOSER_SELECTOR);
      return element instanceof HTMLElement && isVisible(element) ? element : null;
    }

    /**
     * Resolve the laid-out column around one shell slot.
     *
     * Slot anchors are `display: contents`, so they own no box of their own: the
     * shell puts each anchor straight inside its column wrapper, which is the
     * rectangle the user thinks of as the panel.
     */
    function panelElement(slotKey) {
      const anchor = document.querySelector(`[data-slot="${slotKey}"]`);
      if (!(anchor instanceof HTMLElement)) return null;
      const parent = anchor.parentElement;
      if (parent instanceof HTMLElement && isVisible(parent)) return parent;
      for (const child of anchor.children) {
        if (isVisible(child)) return child;
      }
      return null;
    }

    function sidebarCollapsed() {
      const frame = document.querySelector('[data-sidebar-collapsed]');
      return frame !== null && frame.getAttribute('data-sidebar-collapsed') === 'true';
    }

    function hasOpenModal() {
      for (const element of document.querySelectorAll('[aria-modal="true"], dialog[open]')) {
        if (isVisible(element)) return true;
      }
      return false;
    }

    function hasOpenPopup() {
      for (const element of document.querySelectorAll('[role="listbox"]')) {
        if (isVisible(element)) return true;
      }
      return false;
    }

    function rectOf(element) {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }

    function sameRect(left, right) {
      if (left === null || right === null) return left === right;
      return (
        Math.abs(left.left - right.left) < 0.5 &&
        Math.abs(left.top - right.top) < 0.5 &&
        Math.abs(left.width - right.width) < 0.5 &&
        Math.abs(left.height - right.height) < 0.5
      );
    }

    function workspaceRows() {
      const sidebar = panelElement('sidebar');
      if (sidebar === null) return [];
      const rows = [];
      for (const element of sidebar.querySelectorAll(SIDEBAR_ROW_SELECTOR)) {
        if (!(element instanceof HTMLElement)) continue;
        const key = element.dataset.rowKey;
        if (key === undefined) continue;
        if (!key.startsWith('session:') && !key.startsWith('workspace:')) continue;
        if (!isVisible(element)) continue;
        rows.push(element);
      }
      return rows;
    }

    function findWorkspaceRow(key) {
      if (key === null) return null;
      for (const row of workspaceRows()) {
        if (row.dataset.rowKey === key) return row;
      }
      return null;
    }

    // #endregion

    // #region State

    function createStore(initial) {
      let state = initial;
      const listeners = new Set();
      return {
        get() {
          return state;
        },
        set(patch) {
          let changed = false;
          for (const key of Object.keys(patch)) {
            if (state[key] !== patch[key]) {
              changed = true;
              break;
            }
          }
          if (!changed) return;
          state = { ...state, ...patch };
          for (const listener of listeners) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
    }

    // #endregion

    // #region Conversation scrolling

    /**
     * j/k scroll speed from the viewport height. The same velocity is used while
     * the key is held, so the movement is a single linear glide.
     */
    function scrollSpeedFor(scroller) {
      return Math.max(
        SCROLL_SPEED_MIN,
        Math.min(SCROLL_SPEED_MAX, Math.round(scroller.clientHeight * SCROLL_SPEED_RATIO)),
      );
    }

    /**
     * One scrollport rider for both j/k hold-to-scroll and Ctrl+J/K message jumps.
     *
     * Continuous mode moves at a constant px/s while the key is held. Glide mode
     * moves linearly to a message offset over a short fixed duration, so a jump
     * is a linear glide rather than an instant teleport.
     */
    function createScrollDriver() {
      let frame = 0;
      let element = null;
      let mode = 'idle';
      let direction = 0;
      let speed = 0;
      let last = 0;
      let from = 0;
      let to = 0;
      let startedAt = 0;
      let duration = 0;
      let session = '';

      function currentSession() {
        return document.querySelector(CONVERSATION_CONTENT_SELECTOR)?.getAttribute('data-conversation-session') ?? '';
      }

      function stop() {
        if (frame !== 0) window.cancelAnimationFrame(frame);
        frame = 0;
        element = null;
        mode = 'idle';
        direction = 0;
        speed = 0;
        last = 0;
        from = 0;
        to = 0;
        startedAt = 0;
        duration = 0;
      }

      function tick(now) {
        frame = 0;
        if (element === null || !element.isConnected || currentSession() !== session) {
          stop();
          return;
        }
        const max = Math.max(0, element.scrollHeight - element.clientHeight);
        if (mode === 'glide') {
          const progress = duration === 0 ? 1 : Math.min(1, Math.max(0, (now - startedAt) / duration));
          const next = Math.max(0, Math.min(max, from + (to - from) * progress));
          element.scrollTop = next;
          if (progress >= 1) {
            element.scrollTop = Math.max(0, Math.min(max, to));
            stop();
            return;
          }
          frame = window.requestAnimationFrame(tick);
          return;
        }
        const elapsed = Math.min(SCROLL_FRAME_CAP_MS, Math.max(0, now - last)) / 1000;
        last = now;
        const current = element.scrollTop;
        const next = Math.max(0, Math.min(max, current + direction * speed * elapsed));
        element.scrollTop = next;
        if (next === current && (direction > 0 ? current >= max : current <= 0)) {
          stop();
          return;
        }
        frame = window.requestAnimationFrame(tick);
      }

      function start(scroller, nextDirection) {
        if (mode === 'glide') stop();
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        if (nextDirection > 0 && scroller.scrollTop >= max) return false;
        if (nextDirection < 0 && scroller.scrollTop <= 0) return false;
        if (element !== scroller) {
          stop();
          element = scroller;
        }
        session = currentSession();
        mode = 'scroll';
        direction = nextDirection;
        speed = scrollSpeedFor(scroller);
        if (frame !== 0) return true;
        last = performance.now();
        frame = window.requestAnimationFrame(tick);
        return true;
      }

      function glideTo(scroller, target, milliseconds = 220) {
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const destination = Math.max(0, Math.min(max, target));
        const current = scroller.scrollTop;
        if (Math.abs(destination - current) < 0.5) return false;
        stop();
        element = scroller;
        session = currentSession();
        mode = 'glide';
        from = current;
        to = destination;
        startedAt = performance.now();
        duration = Math.max(80, milliseconds);
        last = startedAt;
        frame = window.requestAnimationFrame(tick);
        return true;
      }

      function activeTarget() {
        return mode === 'glide' ? to : null;
      }

      return { start, glideTo, stop, activeTarget };
    }

    // #endregion

    // #region Workspace navigation

    function ensureWorkspaceCursor(store) {
      const rows = workspaceRows();
      if (rows.length === 0) return;
      const current = store.get().cursor;
      if (current !== null && rows.some((row) => row.dataset.rowKey === current)) return;
      const selected = rows.find((row) => row.getAttribute('aria-selected') === 'true');
      const row = selected ?? rows[0];
      store.set({ cursor: row.dataset.rowKey });
    }

    function moveWorkspace(store, direction) {
      const rows = workspaceRows();
      if (rows.length === 0) return false;
      let index = rows.findIndex((row) => row.dataset.rowKey === store.get().cursor);
      if (index < 0) {
        index = rows.findIndex((row) => row.getAttribute('aria-selected') === 'true');
        if (index < 0) index = direction > 0 ? -1 : rows.length;
      }
      const next = Math.max(0, Math.min(rows.length - 1, index + direction));
      const row = rows[next];
      store.set({ cursor: row.dataset.rowKey });
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }

    function activateWorkspaceCursor(store) {
      const row = findWorkspaceRow(store.get().cursor);
      if (row === null) return false;
      row.click();
      return true;
    }

    // #endregion

    // #region Mode transitions

    function placeCaretAtEnd(element) {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const end = element.value.length;
        try {
          element.setSelectionRange(end, end);
        } catch {
          // Some input types reject selection ranges; focus alone is enough there.
        }
        return;
      }
      if (!element.isContentEditable) return;
      const selection = window.getSelection();
      if (selection === null) return;
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    function enterInsert(store) {
      const input = composerInput();
      if (input === null) return false;
      // Explicit intent first: the focusin guard only lets the composer take the
      // caret when Insert was already the mode before the focus arrived.
      store.set({ mode: 'insert', panel: 'conversation' });
      try {
        input.focus({ preventScroll: true });
      } catch {
        input.focus();
      }
      if (document.activeElement !== input) {
        store.set({ mode: 'normal', panel: 'conversation' });
        return false;
      }
      placeCaretAtEnd(input);
      return true;
    }

    function exitInsert(store) {
      const input = composerInput();
      store.set({ mode: 'normal', panel: 'conversation' });
      if (
        input !== null &&
        document.activeElement instanceof Node &&
        input.contains(document.activeElement)
      ) {
        input.blur();
      }
    }

    /** Count consecutive `j`s immediately before a collapsed caret, walking one level for element anchors. */
    function countJBeforeCaret(element) {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const end = element.selectionEnd ?? element.value.length;
        const start = element.selectionStart ?? end;
        if (start !== end) return 0;
        let count = 0;
        for (let index = start - 1; index >= 0 && element.value[index] === 'j'; index -= 1) count += 1;
        return count;
      }
      const selection = window.getSelection();
      if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) return 0;
      const node = selection.anchorNode;
      if (node === null) return 0;
      let text = '';
      if (node.nodeType === Node.TEXT_NODE) {
        text = node.data.slice(0, selection.anchorOffset);
      } else if (node.nodeType === Node.ELEMENT_NODE && selection.anchorOffset > 0) {
        text = node.childNodes[selection.anchorOffset - 1]?.textContent ?? '';
      }
      let count = 0;
      for (let index = text.length - 1; index >= 0 && text[index] === 'j'; index -= 1) count += 1;
      return count;
    }

    /**
     * Delete the `j` run left by a `jk` escape.
     *
     * Synthetic Backspace keydowns go through Lexical's own delete command, so
     * they also work across paragraphs and hard line breaks, where a DOM
     * selection + execCommand('delete') silently did nothing. The events are
     * queued by the editor, so blur only after dispatching the whole run.
     */
    function removeTrailingJs(element, max) {
      if (max <= 0) return false;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        let removed = 0;
        for (let index = 0; index < max; index += 1) {
          const end = element.selectionEnd ?? element.value.length;
          const start = element.selectionStart ?? end;
          if (start !== end || start === 0 || element.value[start - 1] !== 'j') break;
          element.setRangeText('', start - 1, start, 'end');
          element.dispatchEvent(new Event('input', { bubbles: true }));
          removed += 1;
        }
        return removed > 0;
      }
      const count = Math.min(max, countJBeforeCaret(element));
      if (count === 0) return false;
      for (let index = 0; index < count; index += 1) {
        element.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Backspace',
          code: 'Backspace',
          keyCode: 8,
          which: 8,
          bubbles: true,
          cancelable: true,
        }));
      }
      return true;
    }

    /**
     * Clear the composer draft through the input facade.
     *
     * Lexical owns the document model, so DOM selection + execCommand is not
     * enough: the editor cancels the native edit and re-renders its own state.
     * `inputActions.setDraft('')` is the supported programmatic write.
     */
    function clearComposerDraft(store, draftHolder) {
      const actions = draftHolder.actions;
      if (actions === null) return false;
      actions.setDraft('');
      const input = composerInput();
      if (input !== null && document.activeElement instanceof Node && input.contains(document.activeElement)) {
        input.blur();
      }
      store.set({ mode: 'normal', panel: 'conversation' });
      return true;
    }

    // #endregion

    /** Session search is normally a sidebar button; used when Ctrl+F is not host-bound. */
    function sessionSearchButton() {
      const direct = document.querySelector('button[aria-label="搜索会话"], button[aria-label="Search sessions"]');
      if (direct instanceof HTMLElement) return direct;
      for (const button of document.querySelectorAll('[data-slot="sidebar"] button')) {
        if (/搜索|search/iu.test(button.getAttribute('aria-label') ?? '')) return button;
      }
      return null;
    }

    /**
     * Tell the chat's reading policy that a reader gesture is taking over.
     *
     * A session that just opened can still own a native follow-to-bottom
     * animation; without this intent it would keep pulling the scrollport back
     * and swallow the message jump. A zero-delta wheel is the cheapest intent
     * the host recognizes (it only cancels follow, it does not scroll).
     */
    function notifyReaderIntent(scroller) {
      try {
        scroller.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 0,
          deltaX: 0,
          bubbles: true,
          cancelable: true,
        }));
      } catch {
        // Older engines without WheelEvent constructors simply keep native follow.
      }
    }

    /** The host's "load earlier" control, rendered only while older history exists. */
    function loadOlderButton() {
      for (const button of document.querySelectorAll('[data-slot="main"] button')) {
        if (!(button instanceof HTMLButtonElement) || button.disabled) continue;
        const label = (button.textContent ?? '').trim();
        if (label === '加载更早' || label === 'Load earlier') return button;
      }
      return null;
    }

    /**
     * Top-level user/assistant message rows in the current conversation, as
     * offsets from the top of the scroll content.
     */
    function messageOffsets(scroller) {
      const scrollerRect = scroller.getBoundingClientRect();
      const offsets = [];
      for (const element of scroller.querySelectorAll('[data-chat-anchor-key]:not([hidden])')) {
        if (!(element instanceof HTMLElement)) continue;
        if (element.parentElement?.closest('[data-chat-anchor-key]') !== null) continue;
        const kind = element.getAttribute('data-chat-flow-kind');
        if (kind !== 'user' && kind !== 'assistant-step') continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        offsets.push(scroller.scrollTop + (rect.top - scrollerRect.top));
      }
      offsets.sort((left, right) => left - right);
      const unique = [];
      for (const offset of offsets) {
        if (unique.length === 0 || offset - unique[unique.length - 1] > 2) unique.push(offset);
      }
      return unique;
    }

    /** Vimium-style labels: one character for a few links, two for a crowd. */
    function hintLabels(count) {
      if (count <= 0) return [];
      if (count <= HINT_ALPHABET.length) return HINT_ALPHABET.slice(0, count).split('');
      const labels = [];
      const limit = Math.min(count, HINT_ALPHABET.length * HINT_ALPHABET.length);
      for (let index = 0; index < limit; index += 1) {
        labels.push(
          HINT_ALPHABET[index % HINT_ALPHABET.length] +
          HINT_ALPHABET[Math.floor(index / HINT_ALPHABET.length) % HINT_ALPHABET.length],
        );
      }
      return labels;
    }

    // #region Input controller

    function createController(store, layout, draftHolder, driver) {
      let scrollKey = null;
      let lastJAt = 0;
      let jRun = 0;
      let pendingGAt = 0;
      let pendingKAt = 0;
      let pagingReleaseNeeded = false;
      /** Active Vimium-style link hint session, or null. */
      let hintSession = null;
      let expansionTimer = 0;
      let metaHeld = false;
      let metaReleasedAt = 0;
      let metaSafetyTimer = 0;
      let pendingDeleteAt = 0;

      function clearMetaSafety() {
        if (metaSafetyTimer !== 0) window.clearTimeout(metaSafetyTimer);
        metaSafetyTimer = 0;
      }

      function noteKeyState(event) {
        if (!isMetaKeyEvent(event)) return false;
        if (event.type === 'keyup') {
          metaHeld = false;
          metaReleasedAt = performance.now();
          clearMetaSafety();
        } else {
          metaHeld = true;
          clearMetaSafety();
          // A compositor can swallow the Super keyup; never stay suspended forever.
          metaSafetyTimer = window.setTimeout(() => {
            metaSafetyTimer = 0;
            metaHeld = false;
            metaReleasedAt = 0;
          }, META_SAFETY_MS);
        }
        return true;
      }

      function modifiersActive(event) {
        if (metaHeld) return true;
        if (metaReleasedAt !== 0 && performance.now() - metaReleasedAt < META_GRACE_MS) return true;
        return hasSystemModifier(event);
      }

      function resetModifiers() {
        metaHeld = false;
        metaReleasedAt = 0;
        pendingDeleteAt = 0;
        clearMetaSafety();
      }

      function handleDelete() {
        const now = performance.now();
        if (pendingDeleteAt !== 0 && now - pendingDeleteAt <= DD_TIMEOUT_MS) {
          pendingDeleteAt = 0;
          return clearComposerDraft(store, draftHolder);
        }
        pendingDeleteAt = now;
        return true;
      }

      function focusWorkspace() {
        if (panelElement('sidebar') === null) return false;
        const collapsed = sidebarCollapsed();
        if (collapsed && layout !== undefined) layout.toggleSidebar();
        store.set({ panel: 'workspace' });
        ensureWorkspaceCursor(store);
        if (collapsed) {
          // Rows mount after the expand transition; pick a cursor again then.
          if (expansionTimer !== 0) window.clearTimeout(expansionTimer);
          expansionTimer = window.setTimeout(() => {
            expansionTimer = 0;
            ensureWorkspaceCursor(store);
          }, 320);
        }
        return true;
      }

      function focusConversation() {
        if (conversationScroller() === null) return false;
        store.set({ panel: 'conversation' });
        return true;
      }

      function moveWithinPanel(direction) {
        if (store.get().panel === 'workspace' && panelElement('sidebar') !== null) {
          return moveWorkspace(store, direction);
        }
        const scroller = conversationScroller();
        if (scroller === null) return false;
        if (!driver.start(scroller, direction)) return false;
        scrollKey = direction > 0 ? 'j' : 'k';
        return true;
      }

      function handleG() {
        const now = performance.now();
        if (pendingGAt !== 0 && now - pendingGAt <= GG_TIMEOUT_MS) {
          pendingGAt = 0;
          return jumpToBoundary(-1);
        }
        pendingGAt = now;
        return true;
      }

      /** gg / G: top/bottom of the current conversation. */
      function jumpToBoundary(direction) {
        const scroller = conversationScroller();
        if (scroller === null) return false;
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const target = direction > 0 ? max : 0;
        if (Math.abs(target - scroller.scrollTop) < 0.5) return false;
        pagingReleaseNeeded = false;
        notifyReaderIntent(scroller);
        return driver.glideTo(scroller, target, 220);
      }

      /** Ctrl+J/K: jump to the next/previous user or assistant message in this conversation. */
      function jumpMessage(direction) {
        const scroller = conversationScroller();
        if (scroller === null) return false;
        const offsets = messageOffsets(scroller);
        if (offsets.length === 0) return false;
        // Consecutive Ctrl+J/K presses arrive while the previous glide is still in
        // flight; continue from its pending target instead of the mid-glide
        // position, otherwise the second press would re-target the same message.
        const base = driver.activeTarget() ?? scroller.scrollTop;
        const target = direction > 0
          ? offsets.find((offset) => offset > base + 16)
          : offsets.slice().reverse().find((offset) => offset < base - 1);
        if (target === undefined) return false;
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const destination = Math.max(0, Math.min(max, target - 12));
        if (Math.abs(destination - base) < 0.5) return false;
        pagingReleaseNeeded = false;
        notifyReaderIntent(scroller);
        return driver.glideTo(scroller, destination, 220);
      }

      function handleInsertKey(event) {
        const input = composerInput();
        if (input === null) {
          store.set({ mode: 'normal' });
          return;
        }
        const target = event.target;
        if (!(target instanceof Node) || !input.contains(target)) return;
        if (event.key === 'Escape') {
          if (!hasOpenPopup()) {
            event.preventDefault();
            lastJAt = 0;
            jRun = 0;
            exitInsert(store);
          }
          return;
        }
        if (event.key === 'j') {
          lastJAt = performance.now();
          jRun += 1;
          return;
        }
        if (event.key === 'k') {
          if (performance.now() - lastJAt <= JK_TIMEOUT_MS) {
            event.preventDefault();
            lastJAt = 0;
            removeTrailingJs(input, Math.max(1, jRun));
            jRun = 0;
            exitInsert(store);
          } else {
            jRun = 0;
          }
          return;
        }
        lastJAt = 0;
        jRun = 0;
      }

      function conversationSessionId() {
        return document.querySelector(CONVERSATION_CONTENT_SELECTOR)?.getAttribute('data-conversation-session') ?? '';
      }

      function hintItems() {
        if (hintSession === null) return [];
        const scroller = conversationScroller();
        if (scroller === null) return [];
        const scrollerRect = scroller.getBoundingClientRect();
        const typed = hintSession.typed;
        const items = [];
        for (const target of hintSession.targets) {
          if (typed !== '' && !target.label.startsWith(typed)) continue;
          const element = target.element;
          if (!element.isConnected) continue;
          const rects = element.getClientRects();
          const rect = rects.length > 0 ? rects[0] : element.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) continue;
          if (rect.bottom < scrollerRect.top + 1 || rect.top > scrollerRect.bottom - 1) continue;
          if (rect.right < scrollerRect.left + 1 || rect.left > scrollerRect.right - 1) continue;
          items.push({
            label: target.label,
            left: Math.max(scrollerRect.left + 2, Math.min(rect.left, scrollerRect.right - 24)),
            top: Math.max(scrollerRect.top + 2, Math.min(rect.top, scrollerRect.bottom - 20)),
          });
        }
        return items;
      }

      function endHints() {
        if (hintSession === null) return;
        hintSession = null;
        store.set({ hintActive: false, hints: [], hintTyped: '' });
      }

      function startHints() {
        if (hintSession !== null || hasOpenModal()) return false;
        const scroller = conversationScroller();
        if (scroller === null) return false;
        const scrollerRect = scroller.getBoundingClientRect();
        const anchors = [];
        for (const element of scroller.querySelectorAll('a[href]')) {
          if (!(element instanceof HTMLElement)) continue;
          const href = element.getAttribute('href') ?? '';
          if (href === '' || href.toLowerCase().startsWith('javascript:')) continue;
          const rect = element.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) continue;
          if (rect.bottom < scrollerRect.top + 1 || rect.top > scrollerRect.bottom - 1) continue;
          if (rect.right < scrollerRect.left + 1 || rect.left > scrollerRect.right - 1) continue;
          anchors.push(element);
        }
        if (anchors.length === 0) return false;
        anchors.sort((left, right) => {
          const a = left.getBoundingClientRect();
          const b = right.getBoundingClientRect();
          return a.top - b.top || a.left - b.left;
        });
        const limited = anchors.slice(0, HINT_ALPHABET.length * HINT_ALPHABET.length);
        const labels = hintLabels(limited.length);
        hintSession = {
          targets: limited.map((element, index) => ({ element, label: labels[index] })),
          typed: '',
          session: conversationSessionId(),
        };
        store.set({ hintActive: true, hintTyped: '', hints: hintItems() });
        return true;
      }

      function refreshHints() {
        if (hintSession === null) return;
        if (conversationScroller() === null || hintSession.session !== conversationSessionId()) {
          endHints();
          return;
        }
        store.set({ hints: hintItems(), hintTyped: hintSession.typed });
      }

      function handleHintKey(event) {
        if (hintSession === null) return false;
        if (event.isComposing || event.keyCode === 229) {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        if (event.key === 'Shift') {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        if (event.ctrlKey || event.altKey || event.metaKey) {
          endHints();
          return false;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          endHints();
          return true;
        }
        if (event.key === 'Backspace') {
          event.preventDefault();
          event.stopPropagation();
          hintSession.typed = hintSession.typed.slice(0, -1);
          store.set({ hints: hintItems(), hintTyped: hintSession.typed });
          return true;
        }
        if (event.key.length !== 1) {
          endHints();
          return false;
        }
        const typed = hintSession.typed + event.key.toLowerCase();
        const matches = hintSession.targets.filter((target) => target.label.startsWith(typed));
        if (matches.length === 0) {
          // Keep the session and ignore a key that no remaining label starts with.
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        event.preventDefault();
        event.stopPropagation();
        hintSession.typed = typed;
        if (matches.length === 1 && matches[0].label === typed) {
          const target = matches[0];
          endHints();
          try {
            target.element.click();
          } catch {
            // A target removed between collection and activation is a no-op.
          }
          return true;
        }
        store.set({ hints: hintItems(), hintTyped: typed });
        return true;
      }

      function isHinting() {
        return hintSession !== null;
      }

      function handleKeyDown(event) {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
        if (hintSession !== null) return;
        if (noteKeyState(event)) return;
        if (modifiersActive(event)) return;
        if (store.get().mode === 'insert') {
          handleInsertKey(event);
          return;
        }
        const strayComposer = composerInput();
        const strayFocused = strayComposer !== null &&
          document.activeElement instanceof Node &&
          strayComposer.contains(document.activeElement);
        if (strayFocused) strayComposer.blur();
        if (!strayFocused && editableAncestor(event.target) !== null) return;
        if (hasOpenModal()) return;
        if (conversationScroller() === null) return;
        if (event.key !== 'd') pendingDeleteAt = 0;
        if (event.key !== 'g') pendingGAt = 0;
        if (event.key !== 'k') pendingKAt = 0;
        if (event.key !== 'j' && event.key !== 'k') {
          scrollKey = null;
          driver.stop();
        }
        if (pagingReleaseNeeded && (event.key === 'j' || event.key === 'k')) {
          pagingReleaseNeeded = false;
          const scroller = conversationScroller();
          if (scroller !== null) notifyReaderIntent(scroller);
        }

        let handled = false;
        switch (event.key) {
          case 'j':
            handled = moveWithinPanel(1);
            break;
          case 'k': {
            const scroller = store.get().panel === 'conversation' ? conversationScroller() : null;
            if (scroller !== null && scroller.scrollTop <= 4) {
              const now = performance.now();
              if (pendingKAt !== 0 && now - pendingKAt <= KK_TIMEOUT_MS) {
                pendingKAt = 0;
                const button = loadOlderButton();
                if (button !== null) {
                  button.click();
                  // The host starts preserving the semantic position for the
                  // page it is inserting above; release that hold on the next
                  // scroll key, otherwise j/k appear stuck at the loaded offset.
                  pagingReleaseNeeded = true;
                  handled = true;
                }
                break;
              }
              // First k at the top: consume it so a second k within the window
              // can request one older page instead of scrolling nowhere.
              pendingKAt = now;
              handled = true;
              break;
            }
            pendingKAt = 0;
            handled = moveWithinPanel(-1);
            break;
          }
          case 'h':
            handled = focusWorkspace();
            break;
          case 'l':
            handled = focusConversation();
            break;
          case 'i':
            jRun = 0;
            handled = enterInsert(store);
            break;
          case 'd':
            handled = handleDelete();
            break;
          case 'f':
            handled = startHints();
            break;
          case 'g':
            handled = handleG();
            break;
          case 'G':
            handled = jumpToBoundary(1);
            break;
          case 'Enter':
          case ' ':
            handled = store.get().panel === 'workspace' && activateWorkspaceCursor(store);
            break;
          default:
            return;
        }
        if (handled) event.preventDefault();
      }

      function handleFocusIn(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const input = composerInput();
        if (input !== null && input.contains(target)) {
          // Programmatic autofocus (session open, new session, host focus) must
          // never change the mode. It may only take the caret when Insert was
          // already the mode before entering the conversation.
          if (store.get().mode !== 'insert') {
            input.blur();
            return;
          }
          jRun = 0;
          return;
        }
        if (store.get().mode === 'insert') store.set({ mode: 'normal' });
        const sidebar = panelElement('sidebar');
        if (sidebar !== null && sidebar.contains(target)) {
          if (store.get().panel !== 'workspace') store.set({ panel: 'workspace' });
          return;
        }
        const main = panelElement('main');
        if (main !== null && main.contains(target)) {
          if (store.get().panel !== 'conversation') store.set({ panel: 'conversation' });
        }
      }

      function handleKeyUp(event) {
        noteKeyState(event);
        if (scrollKey === null) return;
        if (event.key !== scrollKey) return;
        scrollKey = null;
        driver.stop();
      }

      function handleWindowBlur() {
        endHints();
        resetModifiers();
        scrollKey = null;
        driver.stop();
      }

      function handlePointerDown(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (hintSession !== null) endHints();
        const input = composerInput();
        const inComposer = input !== null && input.contains(target);
        if (inComposer) {
          if (store.get().mode !== 'insert') store.set({ mode: 'insert', panel: 'conversation' });
        } else if (store.get().mode === 'insert') {
          if (input !== null && document.activeElement instanceof Node && input.contains(document.activeElement)) {
            input.blur();
          }
          store.set({ mode: 'normal' });
        }
        const sidebar = panelElement('sidebar');
        if (sidebar !== null && sidebar.contains(target)) {
          if (store.get().panel !== 'workspace') store.set({ panel: 'workspace' });
          ensureWorkspaceCursor(store);
          return;
        }
        const main = panelElement('main');
        if (main !== null && main.contains(target)) {
          if (store.get().panel !== 'conversation') store.set({ panel: 'conversation' });
        }
      }

      function cancelScroll() {
        scrollKey = null;
        driver.stop();
      }

      function dispose() {
        endHints();
        if (expansionTimer !== 0) window.clearTimeout(expansionTimer);
        expansionTimer = 0;
        clearMetaSafety();
        scrollKey = null;
        driver.stop();
      }

      return { handleKeyDown, handleKeyUp, handleFocusIn, handlePointerDown, handleWindowBlur, cancelScroll, jumpMessage, handleHintKey, refreshHints, isHinting, dispose };
    }

    // #endregion

    // #region Overlay

    const PANEL_RING_STYLE = {
      position: 'fixed',
      boxSizing: 'border-box',
      pointerEvents: 'none',
      zIndex: 1,
      border: '2px solid var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary))',
      borderRadius: '10px',
      opacity: 0.6,
      transition: 'left 120ms ease, top 120ms ease, width 120ms ease, height 120ms ease',
    };

    const CURSOR_RING_STYLE = {
      position: 'fixed',
      boxSizing: 'border-box',
      pointerEvents: 'none',
      zIndex: 2,
      border: '1.5px solid var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary))',
      borderRadius: '6px',
      opacity: 0.9,
      transition: 'left 90ms ease, top 90ms ease, width 90ms ease, height 90ms ease',
    };

    const BADGE_STYLE = {
      position: 'fixed',
      left: '12px',
      bottom: '10px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '3px 9px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-overlay)',
      color: 'var(--dsw-alias-label-secondary)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '10px',
      lineHeight: '14px',
      letterSpacing: '0.06em',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: 3,
      opacity: 0.85,
    };

    const BADGE_MODE_STYLE = {
      color: 'var(--dsw-alias-label-primary)',
      fontWeight: 600,
    };

    const BADGE_SEPARATOR_STYLE = { opacity: 0.5 };

    const HINT_STYLE = {
      position: 'fixed',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box',
      minWidth: '16px',
      height: '18px',
      padding: '0 4px',
      borderRadius: '3px',
      background: 'var(--dsw-alias-state-warning-primary, #f2c94c)',
      color: '#101828',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '12px',
      fontWeight: 700,
      lineHeight: '18px',
      letterSpacing: '0.02em',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
      pointerEvents: 'none',
      zIndex: 1000,
    };

    function ringStyle(rect, base, inset) {
      return {
        ...base,
        left: `${Math.round(rect.left) + inset}px`,
        top: `${Math.round(rect.top) + inset}px`,
        width: `${Math.max(0, Math.round(rect.width) - inset * 2)}px`,
        height: `${Math.max(0, Math.round(rect.height) - inset * 2)}px`,
      };
    }

    function VimOverlay(props) {
      const store = props.store;
      const t = props.t;
      const state = React.useSyncExternalStore(store.subscribe, store.get, store.get);
      const hinting = state.hintActive === true;
      const [frames, setFrames] = React.useState({ active: false, panel: null, cursor: null, main: null });

      const measure = React.useCallback(() => {
        const current = store.get();
        const active = conversationScroller() !== null && !hasOpenModal();
        const mainElement = panelElement('main');
        const main = mainElement === null ? null : rectOf(mainElement);
        let panel = null;
        let cursor = null;
        if (active && current.mode === 'normal') {
          if (current.panel === 'workspace') {
            const sidebar = panelElement('sidebar');
            if (sidebar !== null) panel = rectOf(sidebar);
            const row = findWorkspaceRow(current.cursor);
            if (row !== null) cursor = rectOf(row);
          } else {
            panel = main;
          }
        }
        setFrames((previous) => (
          previous.active === active &&
          sameRect(previous.panel, panel) &&
          sameRect(previous.cursor, cursor) &&
          sameRect(previous.main, main)
            ? previous
            : { active, panel, cursor, main }
        ));
      }, [store]);

      React.useLayoutEffect(() => {
        measure();
      }, [measure, state.mode, state.panel, state.cursor]);

      React.useEffect(() => {
        const onViewportChange = () => measure();
        window.addEventListener('resize', onViewportChange);
        document.addEventListener('scroll', onViewportChange, true);
        return () => {
          window.removeEventListener('resize', onViewportChange);
          document.removeEventListener('scroll', onViewportChange, true);
        };
      }, [measure]);

      // Sample continuously: modal close, panel animation, and list reflow all move
      // or hide the ring without a store change to trigger a one-shot measure.
      React.useEffect(() => {
        let frame = 0;
        let last = 0;
        const tick = (time) => {
          if (time - last >= SAMPLE_INTERVAL_MS) {
            last = time;
            measure();
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
      }, [measure]);

      const children = [];
      if (frames.active && state.mode === 'normal' && !hinting && frames.panel !== null) {
        children.push(React.createElement('div', {
          key: 'panel',
          'data-vim-nav': 'panel',
          'aria-hidden': true,
          style: ringStyle(frames.panel, PANEL_RING_STYLE, 1),
        }));
      }
      if (frames.active && state.mode === 'normal' && !hinting && frames.cursor !== null) {
        children.push(React.createElement('div', {
          key: 'cursor',
          'data-vim-nav': 'cursor',
          'aria-hidden': true,
          style: ringStyle(frames.cursor, CURSOR_RING_STYLE, 1),
        }));
      }
      if (frames.active) {
        const insert = state.mode === 'insert';
        const detail = hinting
          ? t('hint.select')
          : insert
            ? t('mode.edit')
            : t(state.panel === 'workspace' ? 'panel.workspace' : 'panel.conversation');
        children.push(React.createElement('div', {
          key: 'badge',
          'data-vim-nav': 'badge',
          'aria-hidden': true,
          style: frames.main === null ? BADGE_STYLE : { ...BADGE_STYLE, left: `${Math.round(frames.main.left) + 12}px` },
        }, [
          React.createElement('span', { key: 'mode', style: BADGE_MODE_STYLE }, t(hinting ? 'mode.hint' : insert ? 'mode.insert' : 'mode.normal')),
          React.createElement('span', { key: 'separator', style: BADGE_SEPARATOR_STYLE }, '·'),
          React.createElement('span', { key: 'detail' }, detail),
        ]));
      }
      if (hinting) {
        for (const hint of state.hints ?? []) {
          children.push(React.createElement('div', {
            key: `hint-${hint.label}`,
            'data-vim-nav': 'hint',
            'aria-hidden': true,
            style: {
              ...HINT_STYLE,
              left: `${Math.round(hint.left)}px`,
              top: `${Math.round(hint.top)}px`,
            },
          }, hint.label));
        }
      }
      return React.createElement(React.Fragment, null, children);
    }

    // #endregion

    /**
     * Session-scoped contact point with the composer's input facade. It renders
     * nothing; it only hands the latest `inputActions` to the global controller
     * and releases it when the composer occurrence unmounts.
     */
    function DraftActionsBridge(props) {
      const inputActions = props.inputActions;
      const bind = props.bindDraftActions;
      React.useEffect(() => {
        bind(inputActions);
        return () => bind(null);
      }, [inputActions, bind]);
      return null;
    }

    function apply(ctx) {
      const store = createStore({ mode: 'normal', panel: 'conversation', cursor: null, hintActive: false, hints: [], hintTyped: '' });
      const draftHolder = { actions: null };
      const bindDraftActions = (actions) => {
        draftHolder.actions = actions;
      };
      const driver = createScrollDriver();
      const controller = createController(store, ctx.layout, draftHolder, driver);

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'vim-nav: dictionaries');
      const t = ctx.locale.bind(NS);

      // Reserve Ctrl+W so the page-close command (`page.close`) is conflicted and
      // Electron drops its Close Window menu accelerator. The key then does nothing.
      const mac = ctx.shortcuts.platform === 'macos';
      const windows = ctx.shortcuts.platform === 'windows';
      const primary = mac ? '⌘' : 'Ctrl';
      ctx.effect(() => ctx.shortcuts.registerFixed({
        id: 'vim-nav.keep-ctrl-w',
        label: () => t('ctrlW.keep'),
        keys: windows ? [primary, '+', 'W'] : [primary, 'W'],
        group: 'application',
        bindings: [{ code: 'KeyW', modifiers: ['primary'] }],
      }), 'vim-nav: reserve ctrl+w');

      const handleGlobalShortcut = (event) => {
        if (event.isComposing || event.keyCode === 229) return false;
        if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
        const target = event.target;
        if (target instanceof Element && target.closest('[data-terminal]') !== null) return false;
        const key = event.key.toLowerCase();
        if (key === 'f') {
          if (hasOpenModal()) return false;
          const row = ctx.shortcuts.catalog.getSnapshot().find((entry) => entry.id === 'session.search');
          const hostHandles = row !== undefined &&
            row.binding !== null &&
            row.binding.code === 'KeyF' &&
            row.binding.modifiers.length === 1 &&
            row.issue === null &&
            row.conflicts.length === 0;
          if (hostHandles) return false;
          const button = sessionSearchButton();
          if (button === null) return false;
          event.preventDefault();
          button.click();
          return true;
        }
        if (event.defaultPrevented) return false;
        if (key === 'j' || key === 'k') {
          if (hasOpenModal()) return false;
          if (!controller.jumpMessage(key === 'j' ? 1 : -1)) return false;
          event.preventDefault();
          return true;
        }
        return false;
      };

      // Move the host's session search from Ctrl+K to Ctrl+F once. This frees
      // Ctrl+K for "next conversation" and is visible/reversible in Settings.
      let bindingSessionSearch = false;
      const bindSessionSearch = async () => {
        if (bindingSessionSearch) return;
        bindingSessionSearch = true;
        try {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const config = ctx.shortcuts.config.getSnapshot();
            if (config.status !== 'ready') return;
            const row = ctx.shortcuts.catalog.getSnapshot().find((entry) => entry.id === 'session.search');
            if (row === undefined) return;
            if (row.modified || row.binding === null) return;
            if (row.binding.code === 'KeyF' && row.binding.modifiers.length === 1) return;
            const result = await ctx.shortcuts.edit({
              type: 'set',
              id: 'session.search',
              binding: { code: 'KeyF', modifiers: ['primary'] },
            }, config.revision);
            if (result.status === 'saved') return;
            if (result.status !== 'stale') return;
          }
        } finally {
          bindingSessionSearch = false;
        }
      };
      ctx.effect(() => {
        const schedule = () => {
          void bindSessionSearch();
        };
        const offConfig = ctx.shortcuts.config.subscribe(schedule);
        const offCatalog = ctx.shortcuts.catalog.subscribe(schedule);
        schedule();
        return () => {
          offConfig();
          offCatalog();
        };
      }, 'vim-nav: move session search to ctrl+f');

      ctx.effect(() => {
        const onKeyDown = (event) => {
          if (handleGlobalShortcut(event)) return;
          controller.handleKeyDown(event);
        };
        const onHintKeyDown = (event) => {
          controller.handleHintKey(event);
        };
        const onHintViewport = () => controller.refreshHints();
        const onKeyUp = (event) => controller.handleKeyUp(event);
        const onFocusIn = (event) => controller.handleFocusIn(event);
        const onPointerDown = (event) => controller.handlePointerDown(event);
        const onBlur = () => controller.handleWindowBlur();
        const onManualScroll = (event) => {
          const target = event.target;
          if (target instanceof Element && target.closest(CONVERSATION_SCROLL_SELECTOR) !== null) {
            controller.cancelScroll();
          }
        };
        // Hint mode owns the keyboard while a label is being typed; capture runs
        // before the page's own shortcut handlers and before the normal handler.
        document.addEventListener('keydown', onHintKeyDown, true);
        document.addEventListener('scroll', onHintViewport, true);
        window.addEventListener('resize', onHintViewport);
        // Bubble phase: let the page's own shortcut handlers run first and honor
        // their preventDefault before this plugin claims a single letter.
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        document.addEventListener('focusin', onFocusIn, true);
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('wheel', onManualScroll, { passive: true, capture: true });
        document.addEventListener('touchstart', onManualScroll, { passive: true, capture: true });
        window.addEventListener('blur', onBlur);
        return () => {
          document.removeEventListener('keydown', onHintKeyDown, true);
          document.removeEventListener('scroll', onHintViewport, true);
          window.removeEventListener('resize', onHintViewport);
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('keyup', onKeyUp);
          document.removeEventListener('focusin', onFocusIn, true);
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('wheel', onManualScroll, { capture: true });
          document.removeEventListener('touchstart', onManualScroll, { capture: true });
          window.removeEventListener('blur', onBlur);
          controller.dispose();
        };
      }, 'vim-nav: keyboard');

      queueMicrotask(() => {
        const input = composerInput();
        if (store.get().mode === 'normal' && input !== null && document.activeElement instanceof Node && input.contains(document.activeElement)) {
          input.blur();
        }
      });

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'vim-nav-draft-bridge',
        order: 100,
        inject: () => ({ bindDraftActions }),
      }, DraftActionsBridge));

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'vim-nav',
        order: 100,
        locale: NS,
        inject: () => ({ store }),
      }, VimOverlay));
    }

    return {
      inject: ['slots', 'locale', 'layout', 'shortcuts'],
      apply,
    };
  },
});
