import { getSettings } from '../core/settings.js';
import { motionOff } from '../core/settings.js';
import * as host from '../editor/host.js';

/**
 * The live writer (AG-6) — types generated content into a real Monaco model.
 *
 * The critical design decisions (TRD §4.3.3):
 *   · A rAF loop with a time-derived character budget, so pace is correct at any
 *     frame rate and the main thread is never blocked.
 *   · ONE applyEdits per frame, not per character. This is the difference
 *     between 60 fps and 6 fps.
 *   · Syntax-aware micro-pauses, so the output reads as composition, not paste.
 *   · The caret is a content widget, so the user's own cursor is never hijacked.
 *   · Frame-budget backpressure: degrade pace before degrading frame rate.
 */

const PAUSE_AFTER = {
  '\n': 14,
  ';': 10,
  '{': 18,
  '}': 18,
  ',': 5,
  ')': 4,
  ':': 6,
};

export class LiveWriter {
  constructor(editor, monaco) {
    this.editor = editor;
    this.monaco = monaco;
    this.decorations = [];
    this.caretWidget = null;
    this.freshLines = [];
  }

  /**
   * Type `content` into `file`'s model starting at the end of the buffer.
   * Resolves when finished; rejects with AbortError if the signal fires.
   */
  write(file, content, { signal, onProgress, onLine } = {}) {
    return new Promise((resolve, reject) => {
      const model = file.model;
      const settings = getSettings();
      const cps = Math.max(10, settings.agentTypingSpeed || 70);

      // Reduced motion: place the whole thing at once. The state still changes,
      // only the theatre is skipped.
      if (motionOff()) {
        const end = model.getFullModelRange().getEndPosition();
        model.applyEdits([
          { range: new this.monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column), text: content },
        ]);
        onProgress?.(content.length, content.length);
        resolve();
        return;
      }

      let index = 0;
      let carry = 0;           // fractional characters owed from the last frame
      let pauseMs = 0;
      let budget = 1;          // backpressure multiplier
      let lastTime = performance.now();
      let lastLine = -1;
      let rafId = null;
      let fallbackId = null;

      /**
       * Race a frame against a timer. requestAnimationFrame is the right clock
       * when frames are flowing, but it is starved in a hidden or occluded
       * window — and a write that silently stops half way is far worse than one
       * that ticks slightly less smoothly. Whichever fires first wins.
       */
      const schedule = (fn) => {
        let fired = false;
        const go = (t) => {
          if (fired) return;
          fired = true;
          cancelAnimationFrame(rafId);
          clearTimeout(fallbackId);
          fn(t);
        };
        rafId = requestAnimationFrame(go);
        fallbackId = setTimeout(() => go(performance.now()), 100);
      };

      const unschedule = () => {
        cancelAnimationFrame(rafId);
        clearTimeout(fallbackId);
      };

      const onAbort = () => {
        unschedule();
        this.clearDecorations();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const finish = () => {
        unschedule();
        signal?.removeEventListener('abort', onAbort);
        this.clearCaret();
        this.coolFreshLines();
        resolve();
      };

      const step = (now) => {
        if (signal?.aborted) return;

        const dt = Math.min(now - lastTime, 120);
        lastTime = now;

        if (pauseMs > 0) {
          pauseMs -= dt;
          schedule(step);
          return;
        }

        // Characters owed for the elapsed time, scaled by the backpressure budget.
        const owed = (dt / 1000) * cps * budget + carry;
        let take = Math.floor(owed);
        carry = owed - take;
        if (take <= 0) {
          schedule(step);
          return;
        }

        // Stop the chunk at the first character that earns a pause, so the
        // rhythm survives even at high speeds.
        let chunkEnd = index;
        let pauseAfter = 0;
        while (chunkEnd < content.length && take > 0) {
          const ch = content[chunkEnd];
          chunkEnd++;
          take--;
          const p = PAUSE_AFTER[ch];
          if (p) {
            // Blank lines get a longer beat — that is where a writer thinks.
            pauseAfter = ch === '\n' && content[chunkEnd] === '\n' ? p * 3 : p;
            break;
          }
        }

        const chunk = content.slice(index, chunkEnd);
        if (!chunk) return finish();

        const t0 = performance.now();

        const end = model.getFullModelRange().getEndPosition();
        model.applyEdits([
          {
            range: new this.monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column),
            text: chunk,
          },
        ]);

        index = chunkEnd;
        const elapsed = performance.now() - t0;

        // Backpressure: if the edit itself blew the frame budget, slow the pace
        // rather than let the frame rate collapse.
        if (elapsed > 6) budget = Math.max(0.3, budget * 0.85);
        else if (budget < 1) budget = Math.min(1, budget * 1.06);

        const pos = model.getFullModelRange().getEndPosition();
        this.updateCaret(pos);

        // Scroll and decorate on line change only, never per character.
        if (pos.lineNumber !== lastLine) {
          lastLine = pos.lineNumber;
          this.editor.revealLineInCenterIfOutsideViewport(pos.lineNumber, 0);
          this.markActiveLine(pos.lineNumber);
          onLine?.(pos.lineNumber, index / content.length);
        }

        onProgress?.(index, content.length);

        if (index >= content.length) return finish();

        pauseMs = pauseAfter * (1000 / cps) * 0.35;
        schedule(step);
      };

      this.editor.setModel(model);
      const start = model.getFullModelRange().getEndPosition();
      this.updateCaret(start);
      schedule(step);
    });
  }

  /* ── Decorations ────────────────────────────────────────────────────── */

  markActiveLine(line) {
    const R = this.monaco.Range;

    // Keep a short trail of recently written lines, cooling from accent to clear.
    this.freshLines.unshift(line);
    if (this.freshLines.length > 5) this.freshLines.pop();

    const decos = [
      {
        range: new R(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'nova-write-line',
          linesDecorationsClassName: 'nova-write-glyph',
        },
      },
    ];

    this.freshLines.slice(1).forEach((l, i) => {
      decos.push({
        range: new R(l, 1, l, 1),
        options: { isWholeLine: true, className: `nova-fresh-${Math.min(i, 3)}` },
      });
    });

    this.decorations = this.editor.deltaDecorations(this.decorations, decos);
  }

  coolFreshLines() {
    // Let the trail linger a beat after the last character, then clear it.
    setTimeout(() => this.clearDecorations(), 900);
  }

  clearDecorations() {
    if (this.decorations.length) {
      this.decorations = this.editor.deltaDecorations(this.decorations, []);
    }
    this.freshLines = [];
    this.clearCaret();
  }

  /* ── Glow caret ─────────────────────────────────────────────────────── */

  updateCaret(position) {
    if (!this.caretWidget) {
      const node = document.createElement('div');
      node.className = 'nova-caret';
      this.caretWidget = {
        _pos: position,
        getId: () => 'nova.writeCaret',
        getDomNode: () => node,
        getPosition: () => ({
          position: this.caretWidget._pos,
          preference: [this.monaco.editor.ContentWidgetPositionPreference.EXACT],
        }),
      };
      this.editor.addContentWidget(this.caretWidget);
    } else {
      this.caretWidget._pos = position;
      this.editor.layoutContentWidget(this.caretWidget);
    }
  }

  clearCaret() {
    if (this.caretWidget) {
      this.editor.removeContentWidget(this.caretWidget);
      this.caretWidget = null;
    }
  }

  dispose() {
    this.clearDecorations();
  }
}

/** Convenience: open (or create) a file and type content into it. */
export async function writeToFile(path, content, opts = {}) {
  const file = await host.openOrCreate(path);
  if (!file) throw new Error(`Could not open ${path}`);
  const writer = new LiveWriter(host.getEditor(), host.getMonaco());
  try {
    await writer.write(file, content, opts);
  } finally {
    writer.dispose();
  }
  return file;
}
