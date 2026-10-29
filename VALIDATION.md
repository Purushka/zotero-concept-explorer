# 0.2.12 validation scope — 2026-10-29

PDF selection popups and generated-text selections now offer Explain and Explain
with full paper. The native reader integration reuses Zotero's documented
renderTextSelectionPopup append API; extraction reuses the existing PDFWorker
full-text path. There are no new third-party dependencies.

The full-paper entry starts one combined explanation request using all text from
the bound attachment. It does not first generate a local-context explanation.
Both entries share the original highlight and conversation. Ordinary Explain
reopens a saved answer; full-paper selection reuses the node and updates its
explanation. Selecting full-paper context during a local job cancels the prior
job; identity and transaction guards prevent stale results from committing.

Original PDF and generated-text selections share a 20,000-character limit, up
from the previous 1,200/600 limits. Selected text, equations and trailing lines
are preserved in the archive and request. Oversized input is refused instead of
clipped. Long passages have short navigation labels and a Selected passage
heading while their source remains complete. Paragraph prompts cover the whole
argument instead of selecting only a term. Existing generated-content boundary
checks still exclude drafts, user messages and cross-reply/cross-session ranges.

Node tests cover long-paragraph capture, boundaries, exact request content,
native-highlight session reuse, archive round trips and prior model/storage
behavior. Six Chromium suites cover the actual bundled panel: reading, deletion,
floating windows, localization, formulas/annotations, and composer/full-paper.
The expanded composer suite checks both paragraph buttons, complete full-paper
requests, compact labels, shared sessions, oversize refusal and all languages.
Exact outcomes and local artifact references are in the separate release
validation JSON; documentation is not a substitute for these test results.

Native validation uses the final XPI in an independent Windows / Zotero 10.0.6
profile. Added scenarios invoke the actual PDF selection hook and both entry
buttons, extract the real fixture PDF through PDFWorker, compare complete long
selections in highlights and requests, switch an active request to full-paper
context, select a generated paragraph in Gecko, reuse the child session, reject
oversized input, and restore the results after complete process restart. Native
annotation click regressions use the sidebar; canvas fallbacks use Chromium.

Responses use synthetic localhost SSE with dummy credentials. The user's working
profile and library are not modified. Other Zotero versions/platforms, real API
availability and answer quality are not verified. The manifest declares Zotero
8–10; archive schema remains 1. Scanned PDFs need OCR and long full papers remain
subject to the provider's context limit. Full text is sent only when explicitly
chosen and is never written into the knowledge archive. Prior math/newline,
Send/Stop, localization, highlight deletion and persistence checks remain.

## Historical 0.2.11 validation scope — 2026-10-24

The composer uses a blue circular up-arrow and switches to a solid Stop square
while a job reads the PDF or streams an answer. Live previews remain visible
without the old green status strip. Enter sends once, Shift+Enter inserts a line
break, and IME composition does not submit. Enter during generation keeps the
next draft; the Stop button cancels the job. The textarea has no manual resize
grip and grows/retracts from 40 to 176 CSS pixels, then scrolls internally.

The full-paper action reuses Zotero's PDFWorker.getFullText(itemID, null) for the
attachment identified by the saved library/key pair. It sends all extracted text
only after the user chooses the action. It does not truncate the text or archive
it. A successful result replaces the targeted explanation or assistant message;
message IDs, creation times, later conversation, and the next draft remain.
Cancellation, extraction failures, deleted/replaced jobs, and provider context
errors retain the old answer. Only safe provider error codes are inspected.

The Node suite passed 163 tests, including extraction, question/history selection,
in-place replacement, asynchronous cancellation, transactional commit guards,
and safe context-limit handling. Six Chromium suites passed 88 checks: reading
32, deletion 12, floating windows 17, localization 5, formulas/annotations 5, and
composer/full-paper 17. They check the real rendered controls, auto-sizing,
keyboard and IME behavior, repeated Enter, synchronized Stop icons, non-truncated
full-text requests, answer replacement, failure preservation, and math layout.

The isolated Windows / Zotero 10.0.6 harness targets the final packaged XPI. Its
composer/full-paper cases exercise actual Gecko events and SVG visibility, native
PDFWorker extraction, the exact full-paper request, in-place answer replacement,
HTTP 413 errors, cross-surface cancellation, and persistence after full process
restart. Existing formula, newline, highlight, deletion, language, and rollback
checks remain. The exact first-run/restart outcomes and package hashes are in the
separate 0.2.11 validation JSON; both phases must pass against those bytes before
publication. Native annotation clicks use the sidebar; the canvas fallback is
covered by Chromium.

Model responses use synthetic localhost SSE and dummy credentials. The native
harness uses independent profile/data directories and does not install into the
user's working profile. Other host versions/platforms, real API services, and
answer quality are not verified. The archive schema remains 1. Math, newline
recovery, localization, and the logo-free interface are retained. Full-paper
context is bounded by the configured provider; scanned PDFs require OCR.

## Historical 0.2.10 validation scope — 2026-10-23

This release repairs model-generated prose whose newlines were escaped one extra
time, including literal `\n` / `\r\n` and Markdown wrapped in one or two JSON
strings. The explanation normalizer requires Markdown layout evidence before
recovering over-escaped prose. It skips inline and fenced code, Windows/UNC
paths, known n-prefixed TeX commands, and literal escapes followed by sentence
punctuation. It reuses the existing jsonrepair envelope parser. User input and
PDF source selections do not receive this model-output normalization.

Structured explanations, follow-up answers, and reopened historical content use
the same normalizer. JSON newline escapes before ordinary text inside display
math are decoded while commands such as \nu and \nabla remain intact. Prompts
request actual Markdown line breaks and one layer of JSON escaping. This is
conservative recovery: unmarked literal line breaks without layout evidence,
unclosed code, or ambiguous path suffixes may remain as source text. It cannot
reconstruct math lost during PDF extraction.

The Node suite contains 138 tests. The five Chromium suites contain 71 checks:
reading 32, deletion 12, floating windows 17, localization 5, formulas/annotations
5. They cover saved malformed explanations, JSON-wrapped follow-ups, real heading,
paragraph, list and formula DOM, literal code/path preservation, formula input,
and existing highlight and conversation behavior.

The isolated Windows / Zotero 10.0.6 harness targets the exact packaged XPI through
26 first-run and 9 full-process-restart checks (35 total). Its newline case uses
over-escaped localhost SSE for the explanation and JSON-string-wrapped follow-up,
then checks the completed Gecko layout. Individual intermediate SSE frames are
covered by Node normalization tests; native newline assertions inspect completed
output. The native annotation sidebar click and Chromium PDF canvas fallback
coverage from 0.2.9 still apply.

All model responses use synthetic localhost SSE and dummy credentials. The
harness uses independent profile/data directories and does not install into the
user's working profile. Other host versions/platforms, real API services, and
answer quality are not verified. The archive schema remains 1. Exact check
outcomes, package/source consistency, and hashes are recorded separately in the
0.2.10 validation JSON. Both native phases must pass against those exact bytes
before publication.

## Historical 0.2.9 validation scope — 2026-10-23

This release renders TeX in source selections, explanations, live question
previews, and both conversation roles. It links PDF questions to native Zotero
highlights, restores their saved conversations on click, and removes associated
sessions and descendant branches when a highlight is deleted. Deletion cancels
running requests and repairs the retained workspace. The archive schema remains 1.

Math parsing reuses vendored markdown-it-texmath and KaTeX. Escaped placeholders
are hydrated with KaTeX's DOM API for privileged Gecko compatibility. Trust stays
disabled, macros are isolated, expansion and size are bounded, and raw model HTML
remains inert. Malformed TeX falls back to readable source. Instructions request
complete math delimiters; they cannot recover notation already lost by PDF text
extraction.

The Node suite covers native annotation geometry, repeated selections, preserved
comments, document/library isolation, linked branch deletion, cancellation,
startup reconciliation, database failures, and formula safety and prompting.
There are 133 Node tests. The five Chromium suites total 70 checks: reading 32,
deletion 12, floating windows 17, localization 5, and formulas/annotations 4.
The formula suite checks actual fraction/sum/subscript/superscript layout and
MathML across source, answer, question preview and both message roles, inert HTML,
one send per question, narrow-window scrolling, and Reader click filtering and
iframe lifecycle. The PDF canvas fallback is exercised in Chromium.

The isolated Windows / Zotero 10.0.6 harness runs the exact packaged XPI through
25 first-run and 9 full-process-restart checks (34 total). It checks real Gecko
math layout, native highlight persistence, repeated selection reuse, existing
annotation comments, actual annotation-sidebar clicks without new model calls,
native eraseTx deletion of linked branches, cancellation of a live descendant
SSE request, restart restoration, and disable/delete/re-enable cleanup. Native
PDF canvas coordinate clicks are not separately simulated.

All model responses are synthetic localhost SSE using dummy credentials. The
harness uses disposable profile/data directories and does not install into the
user's working profile. These checks do not verify real model services or answer
quality. The manifest declares Zotero 8–10; other host versions, macOS, and Linux
are not verified. Historical records without PDF geometry are retained as-is.

Exact package hashes, command outcomes and runtime asset hashes are recorded in
this release's separate validation JSON. After the final package is built, both
native phases must pass against those exact bytes before publication.

## Historical 0.2.8 validation scope — 2026-10-19

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
