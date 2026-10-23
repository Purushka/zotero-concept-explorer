# Reused components

The following source files were copied from their upstream repositories, with their
upstream licenses retained alongside the copies (MIT unless marked ISC):

| Local file | Upstream | Version | Changes |
| --- | --- | --- | --- |
| p-limit.mjs | https://github.com/sindresorhus/p-limit | v6.2.0 | Import changed from `yocto-queue` to `./yocto-queue.mjs` for local ES modules. |
| yocto-queue.mjs | https://github.com/sindresorhus/yocto-queue | v1.2.1 | None; only the filename extension changed. |
| markdown-it.js | https://github.com/markdown-it/markdown-it | v14.1.0 | Unmodified browser distribution; HTML, links and images are disabled by the plugin wrapper. |
| floating-ui.core.js | https://github.com/floating-ui/floating-ui | core v1.7.3 | Unmodified UMD distribution. |
| floating-ui.dom.js | https://github.com/floating-ui/floating-ui | dom v1.7.4 | Unmodified UMD distribution. |
| eventsource-parser/*.js | https://github.com/rexxars/eventsource-parser | v4.1.1 | Unmodified ESM distribution, MIT license. |
| jsonrepair/**/*.js | https://github.com/josdejong/jsonrepair | v3.15.0 | Unmodified ESM distribution, ISC license. |
| texmath.cjs | https://github.com/goessner/markdown-it-texmath | v1.0.0 | Unmodified CommonJS source; extension changed, MIT license. |
| katex/* | https://github.com/KaTeX/KaTeX | v0.19.0 | Unmodified browser distribution, stylesheet and fonts, MIT license. |

`p-limit(1)` supplies the single-writer queue for archive transactions.
Floating UI supplies anchored child windows, Range-selection explain buttons and edge avoidance in the plugin.
Range reference: https://github.com/floating-ui/floating-ui/blob/master/website/pages/docs/virtual-elements.mdx.
markdown-it supplies Markdown parsing; model-provided HTML cannot execute.
No runtime CDN or dependency download is used. esbuild and JSZip are build-only
dependencies from their upstream packages, pinned in pnpm-lock.yaml.

## Native Zotero tab integration

The tab adapter calls Zotero’s existing Zotero_Tabs API instead of reimplementing a tab bar. Interface reference: https://github.com/zotero/zotero/blob/9.0.6/chrome/content/zotero/tabs.js and Zotero’s AGPL-3.0-or-later source. No copy of the host application source is bundled.

## Reader DOM lifecycle

The Reader node tracker follows Zotero's existing Components.utils.isDeadWrapper guard before accessing retained content DOM. Interface reference: https://github.com/zotero/zotero/blob/536244c2771f590abab9c09a3c27e615e0b318ff/chrome/content/zotero/xpcom/reader.js (10.0 branch reviewed locally; not an exact 10.0.6 release tag). Gecko's native guard is reused; no additional UI framework or host source is bundled.


## Streaming and math

SSE parsing and conservative malformed-envelope recovery reuse the vendored parsers.
Math uses texmath with local KaTeX and fonts; trust is disabled, expansion/size are
bounded, macro dictionaries are isolated. No runtime CDN or network math calls.

## Floating title-bar dragging (0.2.7)

`interact.js` is the unmodified interactjs 1.10.27 UMD distribution from
https://unpkg.com/interactjs@1.10.27/dist/interact.js.
Upstream: https://github.com/taye/interact.js/tree/v1.10.27. MIT license
is retained in `interact.LICENSE` and in the bundle header. It is loaded from the local XPI; no CDN is contacted at runtime. Host-specific four-edge docking,
viewport constraints and preference persistence are in `src/floating-window.mjs`
and `src/floating-geometry.mjs`.

## Plugin languages (0.2.8)

`i18next.cjs` is the unmodified i18next v25.6.0 UMD distribution from
https://raw.githubusercontent.com/i18next/i18next/v25.6.0/i18next.js
(only the filename extension changed for local CommonJS imports).
Upstream: https://github.com/i18next/i18next/tree/v25.6.0. The MIT license
is retained in `i18next.LICENSE`. Both bootstrap and panel bundles use this
local copy with bundled translations, no runtime CDN, detector or backend.
Language preference is independent of API credentials and knowledge-tree data.
Rollback: install 0.2.7; that version ignores the independent language preference.

## Native annotations and Gecko math (0.2.9)

Highlight creation and deletion use Zotero's native Annotations.saveFromJSON and
item eraseTx APIs. Reader restoration uses navigate({annotationID}) and the
Reader's selected-annotation state. The upstream interface was reviewed in
https://github.com/zotero/zotero/tree/10.0/chrome/content/zotero/xpcom and checked
against the installed Zotero 10.0.6 sources; no host source is copied or bundled.
The existing p-limit(1) queue serializes highlight/session operations.
The existing unmodified texmath parser and KaTeX distribution also serve the
source and input previews; src/safe-markdown.mjs hydrates escaped math placeholders
with KaTeX's render API instead of injecting KaTeX HTML into privileged Gecko.
No additional runtime dependency, CDN or model service is introduced.
