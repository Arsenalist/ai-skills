---
name: trim-scope
description: Trim agreed scope. Takes a ticket, a spec or the current conversation, finds what the scope doesn't need (work that duplicates a mechanism that already exists, speculative YAGNI features, one-off special cases, and big-picture over-reach), proposes numbered cuts, then applies the ones the user picks. Person-invoked only.
disable-model-invocation: true
---

# Trim scope

Scope that has been agreed tends to gain weight while it is written up. Each story sounds reasonable alone. Together they add surfaces, kinds, tables and tests that the core job never needed. This skill finds that weight and removes it, without reopening the decisions the user made on purpose.

The target is whatever the user points at: a GitHub issue (`gh issue view N --comments`), a spec or plan file, or the scope agreed earlier in this conversation. If they point at nothing, use the most recent scope in the conversation and name the one you picked.

## 1. Understand before cutting

Read all of the target, including comments and any status notes or memory about it. Find out:

- **The core job.** The one problem this solves for the people it serves, in a sentence. Every cut is judged against it.
- **What was decided on purpose.** Look for "settled", "moved into scope", "decided", grilling or review rounds, and dates. These decisions belong to the user. The skill lists them as trade-offs and does not argue against them (section 3).
- **What already exists.** Open the code, or the product as it stands, for every "an existing mechanism covers this" claim you plan to make. A cut that relies on a mechanism that turns out not to exist puts the cost back, and the user loses trust in the whole list. If you can't verify a claim, say so on that item.

## 2. Hunt

Go through the scope story by story and decision by decision, and ask what each one costs: new surfaces, new kinds or types, new tables, new branches in shared code, new tests. Then look for these patterns:

**Duplication: something that already exists does the job.** This is the main target. Examples:
- A new notification when a status or warning the user already sees changes with the same event.
- Audit or history entries when the domain rows are already insert-only evidence of who did what and when.
- A special rule for one kind (a questionnaire-only soft delete) when the general rule already protects what matters.
- A new type, field or setting when an existing one, or a plain link or text field, covers the need.
- A new editor, page or flow when an existing one can be reused or linked to.

**Speculation (YAGNI): nobody has asked for it yet.** Copy or duplicate, bulk actions, exports, settings and toggles, "for later" hooks, and cases with no real user behind them. Cut these and add them back when someone asks.

**Special cases.** Any behaviour that applies to one kind only creates a divergence that stays forever. Prefer the general rule unless the special case protects data or money.

**Big picture.** Step back from the stories:
- What is the smallest version that does the core job? Name the stories it leaves out.
- How do mature products in this category handle it? Where the scope builds more than the usual practice (in-house video hosting when a link would do, review workflows where "submitted means done" is normal), say so.
- Which risky integration points (transactions, payments, auth, claim or checkout paths, shared components) could ship as a follow-up rather than in v1?
- Will two parts of the scope drift apart because they duplicate each other? Point out the seam.

Never propose cutting: validation at trust boundaries, protection against data loss, security, accessibility basics, or anything that keeps existing data correct (merges, migrations).

## 3. Propose

Write a numbered list, largest saving first, so the user can answer with numbers ("cut 3, 4, 5"). Use these groups and leave out any that are empty:

- **Big cuts** and **Smaller cuts.** Each item gives: what it is (with story or section references), what already covers it or the cheaper path, and what the cut removes (surfaces, types, tests). Keep each to two or three lines.
- **Decided on purpose: your call.** Big items the user chose deliberately. State the cost, the cheaper alternative and when the decision was made, once and without pushing. Number these too, so they can still be picked.
- **Look at, not cut.** Something worth checking (a refactor that might be avoidable) that isn't a scope cut.
- **Keep.** One line naming what carries the value, so the user can see the core stays.

Close with the overall effect of the top cuts in one sentence, and ask which to apply. Stop there. The user chooses.

## 4. Apply the picks

Edit the source itself. For a GitHub issue, write the body to a scratch file, edit it with a script whose replacements each assert exactly one match, then run `gh issue edit N --body-file <file>`. Don't post comments unless asked.

For each cut:
- Remove the story, or rewrite it to the cheaper behaviour.
- Rewrite every implementation, testing and notes passage that mentions it. Where a reader would otherwise add it back, leave a one-line reason in the place they would look ("No new notice: the board warning clearing tells the booker").
- Add it to Out of Scope. Remove any Out of Scope entries that the cut makes meaningless.
- Renumber numbered stories if any were removed.

Afterwards, grep the result for the cut terms to catch leftovers. Update any status note or memory that records the scope. Report what changed per cut in a short list, and say what is still in scope from the items the user didn't pick.
