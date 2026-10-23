# Concept Explorer for Zotero

Understand unfamiliar concepts while reading papers in Zotero. Select text for an explanation, explore related concepts, and retain your reading history as a local knowledge tree.

[简体中文](README.md) · [Download](https://github.com/Purushka/zotero-concept-explorer/releases/latest) · [Report an issue](https://github.com/Purushka/zotero-concept-explorer/issues)

![Explanations, child popovers and a knowledge tree using synthetic example data](docs/images/concept-tree.png)

## Install

1. Open [Releases](https://github.com/Purushka/zotero-concept-explorer/releases/latest) and download `concept-explorer-0.2.9.xpi` from **Assets**.
2. In Zotero, open **Tools → Plugins**. Drag the `.xpi` into that window, or choose **Install Plugin From File** from its gear menu.
3. Restart Zotero and open **Tools → Concept Explorer · Model settings**. Menu labels follow the selected language.

GitHub's automatically generated source archives are for development; install the `.xpi` asset. To upgrade, install the newer `.xpi` over the existing plugin. You do not need to delete the knowledge tree or model settings. This version uses manual updates.

The manifest declares Zotero **8–10** compatibility. This release was tested on **Windows with Zotero 10.0.6**. Other host versions, macOS, and Linux have not been individually verified.

## Set up your model

Bring your own API provider, model, and API key. The plugin does not include a model subscription, API credits, or a key.

| Field | What to enter |
| --- | --- |
| API format | Chat Completions, Responses, or Anthropic Messages, as supported by your provider |
| API base URL | A base URL, `/v1` URL, custom prefix, or full endpoint; the form previews the final request URL |
| Model name | The exact model identifier available from your provider |
| API key | Your own key; leaving this blank on later saves retains the saved key |

Save the settings, then optionally choose **Test connection**. A test sends only a short message, without paper content. Tests, explanations, and follow-up questions may incur API charges.

Remote APIs require HTTPS; loopback services may use HTTP. A Responses root URL receives `/responses`; an explicitly supplied `/v1` receives `/v1/responses`.

## Read and explore

1. Select a concept or sentence in Zotero's PDF reader and choose **Explain concept**. `Ctrl+Alt+E` also explains the most recent selection.
2. Read the summary in a popover, then expand it into a native Zotero tab. One streaming request generates both summary and detail; expanding the view does not send another detail request.
3. Click a marked concept, or select text in an AI explanation or answer, to create a child concept. Parent pages and child branches remain available.
4. Ask follow-up questions. `Ctrl/Cmd+Enter` sends a question. Each concept retains its own conversation, draft, and scroll position.
5. Asking about a selection retains a native Zotero highlight. Click the highlight or its annotation sidebar card to restore the saved conversation. The sidebar also offers **View conversation**; reopening does not make another model request.
6. Open **Knowledge tree** to revisit earlier concepts, then **Reading** to resume. Saved explanations can be read offline.

Streaming output is a temporary preview until it completes. Cancellation, interrupted output, or service errors preserve existing complete explanations and questions. Answer quality depends on the model and supplied context; check important claims against the paper.

## Formulas and source highlights

Source selections, summaries, detailed explanations, follow-up messages, and model answers support math. The question editor shows a live formula preview and sends the original TeX. For example:

- Inline: `$S(x,y)=-\lVert x-y\rVert_2$`.
- Display: wrap TeX in `$$`, such as `$$\mathcal{L}=-\sum_{b=1}^{B}\log p_b$$`.

Bundled KaTeX renders fractions, sums, subscripts, superscripts, and other common notation. Long equations scroll horizontally. Model instructions request complete TeX. Symbols, fraction structure, or superscripts already lost during PDF text extraction cannot be reconstructed reliably; supply corrected TeX in a follow-up when necessary. Failed rendering preserves the formula source.

A new question creates or reuses a native highlight for the same selection and links it to its conversation. Repeating the selection restores the existing session and preserves annotation text and comments. Highlights and conversations survive restart. Annotation editing must be allowed for the PDF. Older text-only records without selection coordinates do not receive highlights retroactively.

Deleting a highlight in Zotero also deletes its linked conversations and descendant branches, including follow-ups and drafts, and cancels their running requests. When the plugin is re-enabled, it cleans up sessions whose highlights were deleted while it was disabled. There is no one-click undo; back up important records first.

## Language and popover controls

Settings offers **Follow Zotero / 简体中文 / 繁體中文 / English**. The choice applies immediately, is saved independently of model settings, and survives restart.

Menus, reader buttons, settings, knowledge-tree controls, popovers, and deletion dialogs change together. New explanations and answers use the chosen language. Saved answers, paper titles, concept names, and drafts retain their original text. Automatic matching supports Simplified and Traditional Chinese, falling back to English for other untranslated locales.

Drag the left side of the popover title bar to move it. Releasing near an edge docks it inside Zotero's content area. Position is remembered, and arrow-key movement is supported.

![English settings using synthetic model information](docs/images/settings-english.png)

## Deletion and backups

Deletion is available from tree rows and explanation pages. Confirmation defaults to Cancel.

- **Delete only this node** promotes its children and keeps their explanations, conversations, and drafts.
- **Delete entire branch** removes the node and its descendants; the dialog shows the affected count.

The original paper is retained. There is no one-click undo. The archive's `.bak` file is the backup before the most recent write and changes on subsequent saves; keep separate backups for important trees.

## Data and privacy

- Keys stay in Zotero/Mozilla's local credential store, outside knowledge-tree files and exports, and are not displayed again.
- Explanation requests send the selected text, paper title, available nearby text, and ancestor explanations to your configured provider. Follow-ups include the current concept's explanation and conversation.
- The plugin does not automatically upload entire papers or libraries and has no additional plugin telemetry service. UI libraries, Markdown, math, fonts, and translations are bundled locally.
- The archive lives at `[Zotero data directory]/concept-explorer/knowledge-tree.json`, using a separate file, backups, and atomic writes. Uninstalling keeps it.
- Archives are local plaintext. There is no automatic cloud synchronization or cross-device merging. Corrupt, unknown, or conflicting archive data is reported rather than silently reset.

## Develop

Use Node.js **22.19+** and pnpm **10+**:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

The output is `dist/concept-explorer-0.2.9.xpi`, including editable source and third-party licenses. Existing packages are preserved; use `node scripts/build.mjs --replace-test-build` only for an unpublished development build.

Browser checks require a separate Playwright and Chromium installation. Tests resolve `playwright` from the project by default. `PLAYWRIGHT_MODULE_PATH` and `CHROMIUM_EXECUTABLE_PATH` can select existing installations.

```sh
pnpm test:ui
pnpm test:deletion-ui
pnpm test:floating-ui
pnpm test:language-ui
pnpm test:formula-ui
```

On Windows, `node tests/gecko-rollback/run-isolated.mjs` runs the isolated native harness. Set `ZOTERO_EXECUTABLE` if needed. It uses a disposable profile, synthetic papers, dummy credentials, and a localhost mock service.

Version 0.2.9's feature validation includes **133 Node tests, 70 Chromium checks, and 34 native Zotero checks**. Native coverage includes process restart, annotation sidebar clicks, highlight deletion, generation cancellation, and cleanup after deletion while disabled. The PDF canvas click fallback is covered in Chromium. These do not establish paid-provider availability or real-model answer quality. See the [release notes](docs/releases/v0.2.9.md) and [validation scope](VALIDATION.md).

## License and reused components

[AGPL-3.0-or-later](LICENSE). Reused components include p-limit, yocto-queue, markdown-it, Floating UI, eventsource-parser, jsonrepair, KaTeX, texmath, interact.js, and i18next. Versions, sources, and local modifications are listed in [vendor/NOTICE.md](vendor/NOTICE.md). Third-party notices are retained with the source and package.
