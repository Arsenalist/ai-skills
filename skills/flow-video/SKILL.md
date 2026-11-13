---
name: flow-video
description: Make a silent, text-led HyperFrames video that explains how a code change works by following one Flow (a click, request, webhook or job) as a sequence diagram — the feature from the user's side, then the call trace at method-signature level, edge cases and error codes, complexity hotspots, and a human-review checklist. Takes a GitHub PR, uncommitted changes, a commit, or a commit range. Wraps hyperframes:pr-to-video. Person-invoked only.
disable-model-invocation: true
---

# Flow video

A diff shows which lines changed. It doesn't show what happens when someone clicks the button, what can go wrong, or where a reviewer should look hardest. This skill makes a short silent video that does: one request drawn as a sequence diagram, traced call by call at the level of function signatures, with its error paths, its most complex functions and the spots that need a human.

It's a thin wrapper around `hyperframes:pr-to-video`. This skill handles the input, finds the Flow, gathers the facts and shapes the story. `pr-to-video` handles the design system, the frame workers, assembly, checks and rendering.

## Terms

- **Flow**: one end-to-end path through the system, started by a single Trigger.
- **Trigger**: what starts a Flow. A user click, an HTTP/API request, a webhook, a scheduled or queued job, a CLI call.
- **Participant**: one lifeline on the sequence diagram. Typed as **actor** (a person), **module** (our code: a view, controller, domain module), **infra** (database, queue, cache, object store, job runner) or **external** (a third-party service reached over the network).
- **Hop**: one call between participants. A **changed Hop** is one this change touches.

Never call a Flow a "workflow". That word already means GitHub Actions, HyperFrames' own pipelines and Claude's Workflow tool.

## Fixed choices

Don't ask about these. They are settled:

- **Silent.** No voice, no music, no SFX. Text carries the explanation (see Text below). Use pr-to-video's canonical silent marker: `music: none`, no `SCRIPT.md`, no `sfx:` cues. Never run `audio.mjs`.
- **Little code.** On screen: modules, function signatures, return shapes, error codes, `file:line`. Never a function body, never a diff hunk, never a `code-*` block, never the navy code surface.
- **Run shape:** `flow: automation`, `storyboard: no` (autonomous). The person approves exactly two things: the Flow pick together with the review list (step 3), and the final preview (pr-to-video's Step 6).
- **Aspect** 16:9, **audience** developers, **style** code-editorial (pr-to-video's fixed preset).
- **Length:** at most **150s**. Beat lengths come from reading time (see Pacing). Over budget → trim (step 4), never stretch the cap.
- **Tested against** HyperFrames plugin `0.8.166`. Read the installed version from the plugin's `.claude-plugin/plugin.json`. If it differs, warn once ("flow-video was tested on 0.8.166, you have X; pr-to-video's capture format may have changed") and carry on.

## 1. Resolve the change

The argument is one of:

| Input | Source |
|---|---|
| `#N`, PR URL, `owner/repo#N` | GitHub PR |
| `uncommitted` | staged + unstaged + untracked |
| a SHA or ref | that one commit |
| `A..B` | that range |
| nothing | `uncommitted` if the tree is dirty, else default-branch merge-base`..HEAD` |

Resolve `PROJECT_DIR` and fetch the capture. Run every command from the **repo being explained**; never create files in it. `<PTV>` is the installed `pr-to-video` skill directory; `<SKILL_DIR>` is this one.

**PR** (`project-dir.mjs` needs a full URL or `owner/repo#N`, not a bare number):

```bash
PROJECT_DIR="$(node <PTV>/scripts/project-dir.mjs --pr "$PR_URL")"
```

**Anything else:**

```bash
PROJECT_DIR="$(node <SKILL_DIR>/scripts/local-change.mjs --source "$SRC" --project-dir-only)"
```

(Omit `--source` for the default.) Directories are `<repo>-pr-N`, `<repo>-<sha7>`, `<repo>-<a7>-<b7>` or `<repo>-wip-<diffhash>`, so running again on the same change resumes that project.

If `$PROJECT_DIR/hyperframes.json` exists, this is a resume: skip to pr-to-video's resume rules and don't redo steps 1–4. Otherwise:

```bash
node <PTV>/scripts/preflight.mjs
npx hyperframes init "$PROJECT_DIR" --non-interactive --example=blank --skill=pr-to-video
```

Then the capture:

- **PR:** run pr-to-video's Step 1 `fetch-pr.mjs` and `ingest.mjs` as written. Skip `fetch-people-avatars.mjs` — there is no credits close. If `fetch-pr.mjs` reports `diff: MISSING` (GitHub refuses diffs over ~20k lines) and the PR head is checked out locally (`git rev-parse HEAD` equals the PR's `headRefOid`), write the diff yourself and re-run `ingest.mjs`:
  ```bash
  git diff "$(git merge-base origin/<base> HEAD)" HEAD > "$PROJECT_DIR/capture/diff.patch"
  ```
  If the head isn't local, say so and stop.
- **Local:**
  ```bash
  node <SKILL_DIR>/scripts/local-change.mjs --source "$SRC" --out-dir "$PROJECT_DIR/capture"
  ```
  Then rewrite `title` and `body` in `capture/pr.json` from the diff and the commit messages: a plain title of under 70 characters, plus two or three sentences on what changed and why. Then run pr-to-video's `ingest.mjs`.

If a fetch fails, report the error and stop. Never make up the change.

## 2. Find the Flows

Read the diff, then read the code around it (callers, routes, handlers, the modules the changed code calls) until you can trace each Flow the change sits on from Trigger to end. Read in the repo, not the capture: the capture only holds the diff.

Rules for a Flow:

- **Every Hop is backed by code.** Each Hop cites the `file:line` where the call happens. An external service is a participant only if there is a client call to it in the code; infra only if there is a real read/write/enqueue. If you can't find the code, leave it out instead of guessing.
- **At most 8 module participants** (the actor, infra and external participants don't count toward the cap). Merge runs of unchanged module participants into one ("… 2 more"). Never merge away infra or external participants.
- **Mark each Hop** `changed`, `added` or `removed`, or leave it unmarked.

Present 1–4 candidates as a numbered list:

```
1. Customer buys a ticket   Trigger: click "Pay" (checkout_live.ex:212)
   CheckoutLive → Orders [changed] → Payments → Stripe (external) → Postgres (infra) → Oban [added] → Mailer
2. ...
```

Recommend one. Don't stop yet: gather step 3's facts for the recommended Flow first, so the person approves the Flow and the review list in one go.

## 3. Gather the facts for the Flow

For the recommended Flow (redo for the picked one if the person picks another):

**a. Call trace.** For each Hop, the callee's signature: `Module.function(args) → return shape`, its mark, its `file:line`. Include a **private function** only when it holds a decision — a branch that changes the outcome, a side effect (write, send, enqueue, rollback), or a non-obvious transform — at most 2 per Hop, each with a one-line note. Skip formatting helpers, getters and thin wrappers.

**b. Edge cases and error codes.** On the traced path only: every `{:error, …}` / thrown error / rollback / rescue, every guard or early return that changes the outcome. For each: the condition, the error code or value (`{:answers_missing, ids}`, `422`, `StaleEntryError`), **what the user sees** (the toast, the HTTP status, the email that doesn't send), and whether a test exercises it (`tested` / `untested` — grep the test suite). Keep the top 5 by consequence if there are more.

**c. Complexity.** For every function on the Flow the change touched, measure: cyclomatic complexity, max nesting depth, length in lines, arity, fan-out (distinct calls made). Use the repo's own tooling first — Credo's `Refactor.CyclomaticComplexity` / `Refactor.Nesting` / `Refactor.FunctionArity` with thresholds lowered so every function reports (Elixir), `radon cc -s` (Python), ESLint `complexity` / `max-depth` (JS/TS), `gocyclo` (Go), `lizard` (cross-language fallback). If none runs, count decision points by hand and record that. Where the function existed before the change, measure the base version too (`git show <base>:<file>`) for a before → after delta. Call out the top 3–5, plus anything over cyclomatic > 10, nesting > 3 or length > 40.

**d. Review hotspots.** Things a person must double-check, each as one question with its location: auth and permission checks, money and fees, personal data, deletes and migrations, transactions / locks / concurrency, external calls and webhooks, boundary or dependency workarounds, every `untested` path from (b), and the over-threshold functions from (c). Phrase each as a question to verify, not an assertion of risk.

Then present, below the Flow list:

```
Review hotspots for Flow 1 — confirm, edit or drop:
  1. Transactions · Performer.answer_all!/3 (performer.ex:633) — does the rollback cover media already uploaded to S3?
  2. Untested · {:answers_missing, ids} when the page is bypassed (bookings.ex:1226)
  ...
Complexity: Bookings.claim/5 CC 9 ↑3 · GigsLive.handle_event/3 CC 14 ↑6 (credo)
```

**Wait** for the person to pick the Flow and confirm the hotspot list. This is the first of the two approvals. The video shows only the hotspots they kept.

## 4. Write the brief and the storyboard spine

Write `$PROJECT_DIR/BRIEF.md` (format: pr-to-video's `../hyperframes/references/brief-format.md`):

```markdown
---
workflow: pr-to-video
flow: automation
storyboard: no
message: "<one sentence: what this Flow now does differently>"
destination: <pr | local>
aspect: 1920x1080
language: en
audience: developers
length: <sum of beat durations, ≤150s>
angle: <feature-reveal | fix-explainer | refactor-walkthrough>
---

## Intent

How <Trigger> travels through the system after this change, as a sequence diagram: the calls, what can fail, what's complex, what needs a human.

## Customizations

- Silent: no voice, no music, no SFX. Text carries it (callouts + one caption sentence per beat).
- Signatures only — no function bodies, no diff hunks, no code-* blocks.

## Notes

<the Flow: participants with their type; each Hop with signature, mark and file:line; the private functions kept;
the edge cases with codes, user-visible result and tested/untested; the complexity table with tool and deltas;
the confirmed review hotspots>
```

Record the preference-backed fields with `/media-use`'s `prefs.mjs record --hyperframes . --key <k> --value <v>` (one call per key: `destination`, `aspect`, `language`, `flow`, `storyboard`).

Then write `STORYBOARD.md` yourself (pr-to-video's Step 3 format, frontmatter `music: none`, `mode: autonomous`, no `SCRIPT.md`, every `voiceover` empty) with these sections in this order. These override pr-to-video's story-design defaults (narration budgets, code-* beats, credits close):

1. **Title (1–2s).** The PR title or change in one line, `#N · owner/repo` (or the SHA/range), `+A / −D`. Type only.
2. **The feature from the user's side (≤15s total, 1–3 frames).** An invented UI sketch in code-editorial's style — the card, the button, the result — with captions in outcome language: who the user is, what they do, what they get. No module, function or file names.
3. **The sequence diagram.** The whole Flow drawn once as a UML sequence diagram: participants across the top, time running down, messages labelled with function names. Participant glyphs by type: actor = person glyph; module = plain hairline box; infra = cylinder/stack glyph on its own tint; external = dashed box with a cloud glyph on a second tint. Changed messages coral, added messages drawing in, removed messages ghosted. A legend for the four types and three marks. **This diagram is the stage for every later section** — sections 4–6 are camera moves over it (zoom to a region, scroll down the lifelines), never a cut to a different picture.
4. **The call trace (one beat per changed Hop; unchanged Hops batched, one beat per run).** The camera follows the message down the diagram; a signature card pins beside it: `Module.function(args) → return shape`, the mark, `file:line`, and a complexity badge (`CC 12 ↑6 · nest 3`, coral when over threshold). Kept private functions hang under their caller as smaller indented cards with their one-line note.
5. **Edge cases and error codes (one beat each, top 5).** Each drawn on the diagram as an `alt` / `opt` fragment at the point it branches: the condition in the fragment header, the error code on the return arrow, a callout with what the user sees, and a `tested` / `untested` tag (`untested` coral).
6. **Complexity.** One ranked table of the called-out functions: the five metrics, before → after delta, `file:line`, footnote "measured by <tool>" or "counted by hand".
7. **Human review — closes the video.** The confirmed hotspots as a checklist, one line each: `<category> · Module.function/arity (file:line) — <question>`. No credits, no "shipped by".

### Text

- **Callouts** say what an element *is*: short labels anchored to a diagram element with a hairline leader ("validates with the Forms validator", `{:answers_missing, ids}`).
- **One caption sentence per beat** says what is *happening now*, following the request ("The claim opens one transaction…"), in a fixed bar in the bottom band. At most 16 words. Frame workers draw it inside the frame (pr-to-video's caption builder is skipped in a silent film).
- Callouts and captions never repeat each other.

### Pacing

Each beat's `duration` = (words of new on-screen text ÷ 3) + 1s, minimum 2.5s, title 1.5s. Reveal pieces in reading order across the beat; end on a still hold. Sum the beats; if over 150s, trim in this order: merge unchanged Hops, drop kept private functions, cap edge cases at 3, shorten captions. Never cut a review hotspot the person confirmed.

### Frames for the workers

Each frame's `focal` names an invented diagram, table or checklist — never a `code-*` block (so pr-to-video's packet builder needs no Source excerpt). Write a `## Video direction` block with: the participant table (x position, label, type, mark) and the message table (y position, from → to, signature label, mark) in world coordinates, the caption-bar spec, the signature-card spec, Text and Pacing. pr-to-video's frame packets carry only the frame's own block, **not** `## Video direction` — so copy that section to `.hyperframes/frame-packets/_direction.md` and point every worker at it.

## 5. Hand over to pr-to-video

Load `hyperframes:pr-to-video` and run it from **Step 2** (design system) on in `$PROJECT_DIR`, then **Step 4** (visual design onto your storyboard), **Step 5** without the audio sub-steps (no `sync-durations`, no `fetch-sfx`, no `captions.mjs`), and **Step 6**. Skip Step 3 (you wrote the storyboard) and Step 3.1 (silent).

In every worker's dispatch context add:

- The template's **first child must be the root** `<div id="root" data-composition-id=…>`; `<style>`, `<script>` and the GSAP tag go inside the root, never before it, or `assemble-index.mjs` refuses the frame.
- Prefix ids and classes `f<NN>-` (a CSS selector can't start with a digit).
- A typing caret or any element that deliberately sits over text gets `data-layout-allow-occlusion`.
- The frame's `duration` is authoritative; fit every reveal inside it.
- Read `_direction.md`; the film is silent and shows no code bodies, which overrides the role's narration and `code-*` assumptions.
- Text under 24px needs 4.5:1 contrast: coral on cream fails it, so coral goes on strokes, tags with ink text, and large type only.

Give one worker every sequence-diagram frame (the full diagram first, then the zooms) so the stage stays identical; split the rest across up to two more workers.

At Step 6, show the final preview: the person's second and last approval.

## 6. Deliver

The video is at `$PROJECT_DIR/renders/video.mp4`. Ask:

- **Keep it local** (default): print the full path.
- **PR only. Attach to the PR**: GitHub has no API for video attachments. Run `gh pr view <N> --web`, print the mp4 path, and print a suggested comment for the person to paste with the file dragged in:
  ```
  How <Trigger> flows after this change: <drag video here>
  Please double-check:
  - <each confirmed review hotspot, one line>
  ```
  Note GitHub's upload limit (10 MB on free plans, 100 MB on paid). If the file is too big, offer a re-render at a lower bitrate.

Never commit the video to the repo.
