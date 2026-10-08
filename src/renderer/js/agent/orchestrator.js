import { bus } from '../core/bus.js';
import { getState, setState } from '../core/state.js';
import { getSettings } from '../core/settings.js';
import { wait, uid, joinPath, basename } from '../core/util.js';
import * as engine from './engine.js';
import { LiveWriter } from './writer.js';
import * as host from '../editor/host.js';

/**
 * The phase state machine (AG-2).
 *
 * idle → understanding → thinking → planning → writing → reviewing → done
 *                                             ↘ stopped (from any phase)
 *                                             ↘ error
 *
 * A single AbortController per run is checked at every await boundary.
 * Stopping never rolls back written text — the PRD requires partial work to
 * survive, because a user who interrupts wants what was produced so far.
 */

export const PHASES = ['understanding', 'thinking', 'planning', 'writing', 'reviewing', 'done'];

let controller = null;
let currentRun = null;

export const isRunning = () => !!controller;

export function stop() {
  if (!controller) return;
  controller.abort();
  controller = null;
  if (currentRun) {
    currentRun.status = 'stopped';
    setPhase(null, 'stopped');
    bus.emit('agent:stopped', { run: currentRun });
  }
}

function setPhase(phase, status = 'running') {
  setState({ agent: { phase, status } });
  bus.emit('agent:phase', { phase, status });
  bus.emit('agent:status', { status, phase });
}

function tick(n = 1) {
  const run = currentRun;
  if (!run) return;
  run.tokens += n;
  setState({ agent: { tokens: run.tokens } });
  bus.emit('agent:tokens', { tokens: run.tokens });
}

/* ── The run ──────────────────────────────────────────────────────────── */

export async function send(request) {
  if (isRunning()) {
    bus.emit('notify', { type: 'warn', title: 'Agent busy', message: 'Stop the current run first.' });
    return;
  }

  controller = new AbortController();
  const signal = controller.signal;

  const run = {
    id: uid(),
    request,
    startedAt: Date.now(),
    tokens: 0,
    thoughts: [],
    steps: [],
    artifacts: [],
    status: 'running',
  };
  currentRun = run;
  setState({ agent: { status: 'running', runId: run.id, tokens: 0, phase: null } });
  bus.emit('agent:start', { run });

  try {
    const settings = getSettings();
    const useClaude = settings.agentProvider === 'claude' && settings.apiKey;

    /* ── 0. Is this even a build request? ──
       "hello" is not a spec. Scaffolding a file for small talk writes junk into
       the user's workspace, so conversation answers in the transcript and stops
       before the generate/write pipeline ever runs. */
    const mode = engine.classifyMode(request);
    if (mode !== 'build') {
      setPhase('understanding');
      await wait(420, signal);
      const reply = engine.converse(mode, request);
      tick(Math.ceil(request.length / 4) + 12);
      run.status = 'done';
      run.conversational = true;
      setPhase(null, 'idle');
      bus.emit('agent:reply', { run, reply });
      bus.emit('agent:done', { run, result: null, conversational: true });
      return;
    }

    /* ── 1. Understanding ── */
    setPhase('understanding');
    await wait(520, signal);
    const ctx = engine.understand(request);
    run.ctx = ctx;
    bus.emit('agent:understood', { run, ctx });
    tick(Math.ceil(request.length / 4));
    await wait(340, signal);

    /* ── 2. Thinking ── */
    setPhase('thinking');
    const lines = useClaude
      ? await claudeThoughts(request, ctx, signal)
      : engine.thoughts(request, ctx);

    for (const line of lines) {
      if (signal.aborted) throw abortError();
      await typeThought(line, signal);
      tick(Math.ceil(line.length / 4));
      await wait(110 + Math.random() * 180, signal);
    }
    await wait(300, signal);

    /* ── 3. Planning ── */
    setPhase('planning');
    run.steps = engine.plan(request, ctx);
    bus.emit('agent:plan', { run, steps: run.steps });
    for (let i = 0; i < run.steps.length; i++) {
      if (signal.aborted) throw abortError();
      await wait(150, signal);
      bus.emit('agent:planStep', { index: i });
    }
    await wait(380, signal);

    /* ── 4. Writing ── */
    setPhase('writing');
    const root = getState().workspace?.root;
    if (!root) {
      throw new Error('Open a folder first — the agent writes into your workspace.');
    }

    const artifact = useClaude
      ? await claudeGenerate(request, ctx, root, signal)
      : engine.generate(request, ctx, root);

    await writeArtifact(artifact, run, signal);

    // React components ship with their stylesheet, so write that too.
    if (artifact.extra) {
      const extra = { ...artifact.extra, path: joinPath(root, artifact.extra.file) };
      await wait(300, signal);
      await writeArtifact(extra, run, signal);
    }

    /* ── 5. Reviewing ── */
    setPhase('reviewing');
    await wait(560, signal);
    const result = engine.review(ctx, artifact);
    tick(40);
    bus.emit('agent:review', { run, result });
    await wait(420, signal);

    /* ── 6. Done ── */
    run.status = 'done';
    setPhase('done', 'done');
    bus.emit('agent:done', { run, result });
    bus.emit('notify', {
      type: 'success',
      title: 'Agent finished',
      message: `${run.artifacts.length} file${run.artifacts.length === 1 ? '' : 's'} written.`,
    });

    // Settle back to idle so the canvas can wind down.
    setTimeout(() => {
      if (!isRunning()) setState({ agent: { status: 'idle', phase: null } });
    }, 2600);
  } catch (err) {
    if (err.name === 'AbortError') {
      // stop() emits this synchronously before aborting; without the guard the
      // abort rejection reports "Stopped" a second time a microtask later.
      if (run.status !== 'stopped') bus.emit('agent:stopped', { run });
    } else {
      run.status = 'error';
      setPhase(null, 'error');
      bus.emit('agent:error', { run, error: err.message });
    }
  } finally {
    controller = null;
  }
}

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

/** Type a thought line out character by character (AG-4). */
async function typeThought(text, signal) {
  const id = uid();
  bus.emit('agent:thoughtStart', { id });
  const speed = 13;
  for (let i = 1; i <= text.length; i++) {
    if (signal.aborted) throw abortError();
    bus.emit('agent:thoughtChar', { id, text: text.slice(0, i) });
    // Type in small bursts so long lines do not take forever.
    if (i % 3 === 0) await wait(speed, signal);
  }
  bus.emit('agent:thoughtEnd', { id, text });
  currentRun?.thoughts.push(text);
}

async function writeArtifact(artifact, run, signal) {
  const file = await host.openOrCreate(artifact.path);
  if (!file) throw new Error(`Could not open ${artifact.path}`);

  bus.emit('agent:writing', { path: artifact.path, name: basename(artifact.path) });

  const writer = new LiveWriter(host.getEditor(), host.getMonaco());
  const total = run.steps.length;
  let lastStep = -1;

  try {
    await writer.write(file, artifact.content, {
      signal,
      onProgress: (done, all) => {
        // Advance the plan board in step with how much has been written.
        const stepIndex = Math.min(total - 1, Math.floor((done / all) * total));
        if (stepIndex !== lastStep) {
          lastStep = stepIndex;
          bus.emit('agent:planStep', { index: stepIndex, done: true });
        }
        if (done % 40 === 0) tick(10);
      },
    });
  } finally {
    writer.dispose();
  }

  await host.saveFile(artifact.path);

  run.artifacts.push({ path: artifact.path, bytes: artifact.content.length });
  bus.emit('agent:artifact', {
    path: artifact.path,
    name: basename(artifact.path),
    bytes: artifact.content.length,
  });
}

/* ── Claude provider (AG-10) ──────────────────────────────────────────── */

async function claudeThoughts(request, ctx, signal) {
  const settings = getSettings();
  try {
    const res = await window.nova.agent.claude({
      apiKey: settings.apiKey,
      model: 'claude-sonnet-5',
      maxTokens: 400,
      system:
        'You are a coding agent reasoning out loud. Reply with 5-7 short lines of internal reasoning, one per line, no numbering, no preamble. Each under 70 characters.',
      messages: [{ role: 'user', content: request }],
      token: uid(),
    });
    if (signal.aborted) throw abortError();
    const lines = res.text.split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean);
    return lines.length ? lines : engine.thoughts(request, ctx);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    bus.emit('notify', { type: 'warn', title: 'Claude unavailable', message: `${err.message} — using Nova Engine.` });
    return engine.thoughts(request, ctx);
  }
}

async function claudeGenerate(request, ctx, root, signal) {
  const settings = getSettings();
  try {
    const res = await window.nova.agent.claude({
      apiKey: settings.apiKey,
      model: 'claude-sonnet-5',
      maxTokens: 4096,
      system:
        'You write a single source file. Reply with ONLY the file content, no markdown fences, no commentary. First line must be a comment naming the suggested filename in the form: FILENAME: name.ext',
      messages: [{ role: 'user', content: request }],
      token: uid(),
    });
    if (signal.aborted) throw abortError();

    let content = res.text.replace(/^```[\w]*\n?|```$/gm, '').trim();
    const match = content.match(/FILENAME:\s*([^\s\n]+)/i);
    const fallback = engine.generate(request, ctx, root);
    const file = match ? match[1] : fallback.file;
    content = content.replace(/^.*FILENAME:.*\n/i, '');

    return { file, path: joinPath(root, file), language: fallback.language, content: content + '\n' };
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    bus.emit('notify', { type: 'warn', title: 'Claude unavailable', message: `${err.message} — using Nova Engine.` });
    return engine.generate(request, ctx, root);
  }
}
