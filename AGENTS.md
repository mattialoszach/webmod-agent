# AGENTS.md

## Project overview

WebMod is a Chrome Extension Manifest V3 MVP that modifies the currently displayed webpage locally from natural-language instructions.

Keep the product focused on this flow:

```text
User prompt → semantic DOM analysis → AI planning → validated operations → local DOM patch
```

Do not expand WebMod into an autonomous browser agent, navigation tool, fictional-world system, collaboration platform, or cloud account product unless explicitly requested.

## Technology

- Chrome Extension Manifest V3
- TypeScript in strict mode
- React
- Vite
- Chrome Side Panel API
- Content scripts
- Zod
- Vitest with jsdom

Keep dependencies minimal. Do not introduce `any`; use `unknown` plus explicit validation when handling untrusted data.

## Architecture boundaries

### Side panel

Files live in `src/sidepanel/`.

- Owns presentation and user interaction.
- Sends typed requests to the service worker.
- Must not access or mutate the webpage DOM directly.
- Must not call an AI provider directly.

### Service worker

Files live in `src/background/`.

- Orchestrates page analysis, provider calls, validation, and patch application.
- Is the trust boundary for AI-provider communication.
- Keeps API credentials out of the content script and webpage context.
- Must validate operations and verify referenced element IDs before applying them.

### Content script

Files live in `src/content/`.

- Owns all webpage DOM access.
- Produces the compact semantic DOM representation.
- Maintains the `wm_*` ID-to-element registry.
- Owns element selection and patch history.
- Only the patch engine may mutate the webpage.

### Agent layer

Files live in `src/agent/`.

- Providers implement the `AIProvider` interface.
- Provider-specific behavior must remain isolated behind that interface.
- The AI planner returns structured operations only.
- Model output is always untrusted, even when structured-output mode is enabled.

### Shared protocol

Files live in `src/shared/`.

- Keep extension messages and shared data types centralized here.
- Messages between the panel, service worker, and content script must be typed.
- Avoid duplicating message shapes in individual layers.

## Security requirements

Never execute or inject model-generated:

- JavaScript
- HTML
- CSS selectors
- `<script>` or `<iframe>` elements
- Inline event handlers
- `javascript:` URLs
- Extension API calls

All operations must pass the Zod schemas in `src/agent/schemas.ts`.

- Keep style properties allowlisted.
- Keep mutable attributes allowlisted.
- Reject executable or unsafe CSS and URL values.
- Accept only `wm_*` IDs present in the latest semantic analysis.
- Do not add generic HTML insertion operations.
- Keep changes local; never modify the remote website or its backend.

WebMod is a local experimentation tool. Do not add topic- or keyword-based blocklists on user instructions; the security boundary is the operation schema (no code execution, no injection), not the subject matter of the request.

## Semantic DOM guidelines

- Never send the complete page HTML to a model.
- Prefer visible and near-viewport elements.
- Prioritize headings, text, navigation, buttons, links, images, forms, cards, sections, and major containers.
- Preserve selected-element context, including useful parent and sibling information.
- Limit repetitive elements and cap the total representation.
- Do not expose framework internals or irrelevant implementation metadata.
- Do not make the analyzer continuously rescan the entire DOM.

## Patch engine requirements

- Every prompt that changes the page is one atomic history transaction.
- Capture state before mutation.
- If one operation in a transaction fails, restore all earlier operations from that transaction.
- `undo()` restores the previous transaction.
- `redo()` reapplies the undone transaction.
- `reset()` restores the page state from before WebMod's first active transaction.
- Preserve existing child markup when restoring snapshots.
- Analyze the current DOM for every new instruction; do not assume the original DOM is still displayed.

## Extension build constraints

The project uses separate Vite builds:

- Side panel: normal React application
- Background: ES-module service worker
- Content script: self-contained classic IIFE bundle

The content script must not contain runtime `import` statements. The production extension is emitted to `dist/`, and `public/manifest.json` is copied into it.

Chrome internal pages, the Chrome Web Store, and some browser-controlled viewers cannot be modified by content scripts. Treat this as a platform limitation, not a WebMod error.

## Development commands

Install dependencies:

```bash
npm install
```

Run all unit tests:

```bash
npm test
```

Run strict TypeScript validation:

```bash
npm run typecheck
```

Create the complete production extension:

```bash
npm run build
```

After source changes, rebuild and reload the extension from `chrome://extensions`. Reload open test webpages when content-script code changes.

## Testing expectations

Before considering an implementation complete, run:

```bash
npm test
npm run build
```

Add or update tests when changing:

- Operation schemas or safety validation
- Semantic DOM selection and prioritization
- Patch application or snapshot restoration
- Undo, redo, or reset behavior
- Mock-provider intent handling
- Real-provider response parsing
- Typed messaging behavior where practical

For production bundles, ensure `dist/manifest.json` parses and `dist/content.js` remains self-contained.

## Working conventions

- Inspect existing code before editing.
- Preserve the separation between planning and DOM mutation.
- Prefer a small complete vertical slice over unused abstractions.
- Keep user-facing errors actionable and concise.
- Avoid unrelated refactors while implementing a focused change.
- Update `README.md` when setup, permissions, architecture, provider configuration, or known limitations change.
- Do not commit `dist/`, `node_modules/`, API keys, or other credentials.

## Definition of done for feature changes

A feature is complete when:

1. The side panel can initiate it through typed messages.
2. Untrusted input is validated at the correct boundary.
3. DOM changes occur only through the patch engine.
4. Undo, redo, and reset remain correct.
5. Errors are visible in the side panel.
6. Relevant tests pass.
7. Strict TypeScript and the production build pass.
