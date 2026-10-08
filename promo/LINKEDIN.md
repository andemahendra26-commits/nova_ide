# LinkedIn post — Nova IDE

Attach `nova-ide-ad-square.mp4` (square gets more feed real estate on mobile),
or `nova-ide-ad-1080p.mp4` for the wide version. `nova-ide-ad-vertical.mp4` is
the 9:16 cut, and `nova-ide-ad.gif` is there for anywhere that will not take
video.

The cut is 10 seconds and already carries its own on-screen copy, so the post
text below does not need to repeat it.

There is a voiceover, generated locally with the Windows SAPI voice (Microsoft
David) by `scripts/promo-vo.ps1`. Only the legacy Windows voices are installed
on this machine, so it sounds dated — for a real campaign, re-record those four
lines with a human or a neural TTS and remux; the script prints each line and
its timing. LinkedIn autoplays muted anyway, and the cut carries its own
on-screen copy, so it works fine silent.

Nothing is cut to audio, so any music track can go underneath it.

---

## Option A — the thought experiment (recommended)

> What if Claude had a place of its own?
>
> Not a chat window. Not a sidebar bolted onto someone else's editor. An actual
> workspace, where you can watch it work.
>
> So I built one.
>
> Nova IDE renders the part every other AI tool hides. Understanding. Thinking.
> Planning. Writing. Reviewing — each phase on screen, at a speed a human can
> actually read. The code doesn't appear as a diff you have to trust. It gets
> typed into a real buffer, character by character, under a live caret.
>
> Under the hood it's Electron + Monaco, an offline codegen engine that needs no
> API key, an MCP server so other agents can drive it, a built-in test studio,
> and a terminal. Ships as a Windows .exe.
>
> Everything in this video is real screen capture. No mockups, no After Effects.
>
> Repo + installer: github.com/andemahendra26-commits/nova_ide
>
> #AI #DeveloperTools #Claude #Electron #BuildInPublic

## Option B — shorter, punchier

> Every AI coding tool gives you an answer.
>
> I wanted one that shows its work.
>
> Nova IDE puts the model's process on screen — understanding, thinking,
> planning, writing, reviewing — and types the code into a real buffer instead
> of dropping a diff on you.
>
> Electron + Monaco. Offline agent, no API key needed. MCP server built in.
> Ships as a .exe.
>
> All real capture. github.com/andemahendra26-commits/nova_ide
>
> #AI #DeveloperTools #BuildInPublic

## Option C — the builder angle

> I gave myself a deadline and built an IDE.
>
> The idea: stop hiding what the model is doing. Nova IDE renders the agent's
> whole process — reading the request, reasoning, committing to a plan, writing,
> then checking its own work — and a small pixel character acts out every phase
> while it happens.
>
> Hardest part wasn't the UI. It was discovering Chromium starves
> requestAnimationFrame in an unfocused window, which silently stalled the typing
> engine mid-run. Fixed by racing the frame clock against a timer.
>
> Electron + Monaco, no bundler, no native modules. Offline agent. MCP server on
> :4319. Test studio. Windows .exe in the repo.
>
> github.com/andemahendra26-commits/nova_ide
>
> #BuildInPublic #DeveloperTools #AI

---

## First comment (post this yourself, right after)

Pin a comment with the direct download so the link isn't buried:

> Installer and portable build are both in the repo under `release/` —
> no prerequisites, Windows x64.
