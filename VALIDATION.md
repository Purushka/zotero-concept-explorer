# 0.2.8 validation scope — 2026-10-19

The current change adds an independent, persisted language preference (automatic,
Simplified Chinese, Traditional Chinese, English) and removes both decorative
logo marks. All translations and the MIT-licensed i18next 25.6.0 distribution
are bundled locally. Unsupported automatic locales fall back to English.

The Node suite covers locale negotiation, synchronous initialization, matching
interpolation variables across catalogs, safe API error messages, localized
deletion prompts, and language-only changes to new model request instructions.
The original model/context/streaming/storage modules are not rewritten. Existing
archived answers and user content are never translated.

`tests/localization-ui.mjs` exercises actual built panel pages in Chromium. It
checks live two-surface translation, language selection before model setup,
preservation of unsaved model fields and keys, reopen, failure recovery, automatic
locale matching, existing answers/drafts, no logo elements, and no model calls.
The original reading, deletion and floating-window UI suites also apply.

The isolated Zotero 10.0.6 harness adds native menu, Reader button, iframe and
drag-handle translation checks, plus persistence through a full process restart.
It uses disposable profile/data directories, dummy credentials and localhost SSE.
It does not install into or change the user's working profile. Outcomes and exact
package hashes belong in the separately generated validation results; this scope
document alone does not establish a passed check.

The former `audit-baseline.mjs` records the specific 0.2.7 deletion/drag patch
against 0.2.3. Its byte-identical panel/runtime assertions are historical and do
not describe 0.2.8, which intentionally localizes those interfaces and language
directives. The 0.2.7 scope below remains as historical context.

## Historical 0.2.7 validation scope — 2026-10-15

0.2.7 adds title-bar dragging and release-to-dock behavior to the retained
Zotero iframe popover. It uses a local unmodified interact.js 1.10.27 UMD
build under the MIT license, retaining the upstream license and provenance.
Only host presentation and plugin preferences change; archive schema stays 1.

## Checks for this release

- Node regression tests include pure four-edge geometry, corner docking,
  invalid/future preference rejection, normalized position restoration and
  small viewport bounds, in addition to archive, deletion, streaming,
  prompt, Markdown/math and native-tab adapter tests.
- A headless Chromium harness exercises the real panel iframe in a stationary
  host with the actual interact.js runtime. It checks all four edges, corner
  release, free positioning, stable size/draft, selection explain entry,
  Escape cancel, reload restore, host shrink, hidden handle cleanup, keyboard
  movement, failed preference saves and disposal. No real model or Key is used.
- `node scripts/audit-baseline.mjs` normalizes only the explicit deletion and
  floating-host changes before comparing the original 0.2.3 model/context
  source. This release leaves the 0.2.6 model, streaming, archive/deletion and
  panel modules byte-identical. There is no new prompt, context compaction,
  delayed detail request or model call for dragging.
- `node tests/gecko-rollback/run-isolated.mjs` is the real Zotero 10.0.6 harness.
  Its fixture adds all-four-edge pointer movement and process-restart position
  preference checks. It always uses a disposable profile/data directory,
  dummy credentials and localhost mock SSE; the user's profile is not used.

Final command outcomes are recorded in the release's validation-results.json
and the isolated artifacts referenced there. Manifest supports Zotero 8–10,
which is a compatibility declaration, not a claim that all hosts were tested.

## Behavior and limits

The draggable left title area is a transparent handle in the host document,
not an overlay over explanation text or header navigation. Host coordinates
avoid iframe movement feedback. A drag within 24 CSS pixels of an edge docks
on release with a 12-pixel gap. Top docking reserves Zotero's tab bar. Positions
are normalized in an independent Zotero preference; no archive data or Key is
included. This is an in-Zotero popover, not cross-application desktop docking.

The 0.2.6 confirmed node/subtree deletion and 0.2.4 metadata compatibility fixes
remain. Original paper attachments, independent branches, retained explanations,
Markdown/math, draft/scroll state and native tabs remain subject to the existing
regression suite. No physical multi-monitor drag or non-10.0.6 Zotero host has
been manually validated for this release. Tests use synthetic text and do not
measure the quality of real-model explanations.
