# Marp Inline Preview Plus for Obsidian

Render [Marp](https://marp.app/) slide decks directly inside Obsidian — inline beneath each `---` slide separator while editing, and as the full deck in reading mode. Works on desktop and mobile.

| Mode | What you see |
| --- | --- |
| **Edit / Live Preview** | A rendered slide widget appears under each slide break. Updates as you type. |
| **Reading** | The entire page is replaced by the rendered Marp deck. |

Only files whose YAML frontmatter contains `marp: true` are touched. Everything else renders as ordinary Markdown.

## Features

- **Marp Core 4 under the hood** — same renderer as the official Marp tooling, in pure JavaScript so it works on Obsidian Mobile (iOS & Android).
- **Presentation & Presenter Views** — dual-screen audience presentation with auto-scaling, keyboard/touch navigation, screen blanking, and a dedicated speaker dashboard (timer, clock, upcoming slide preview, markdown notes, two-way sync).
- **Zero-external-dependency PDF export on desktop** — exports vector PDFs with slide dimensions, optional presenter note annotations, and configurable image DPI downsampling presets without requiring Chrome or external CLI tools.
- **Customizable edit preview width** — configure the maximum width of inline slide widgets (match editor line width, 800px, 1000px, full width 100%, or custom CSS dimensions).
- **Vault images & background support** — vault-relative paths in Markdown images (`![](...)`), Marp background images (`![bg](...)`), and custom stylesheet URLs are automatically rewritten to Obsidian resource URLs.
- **Custom theme support** through `.marprc.yml` (vault-root, with a fallback to the slide file's folder), plus the standard frontmatter `theme:` directive.
- **Bundled KaTeX math** — no network roundtrips, no broken formulae offline.
- **Encapsulated styles** — Marp's per-slide CSS is mounted inside Shadow DOM, so it can't leak into Obsidian's own UI.
- **Pluggable settings** — configure edit/reading previews, preview width, math rendering, PDF export options, and presentation defaults from Settings.

## Quick start

```yaml
---
marp: true
theme: default
---

# My deck

- Slide one
- Beautiful presentations directly in Obsidian

<!-- Speaker notes appear in Presenter View and PDF export annotations! -->

---

<!-- _class: lead -->

## Slide two

![bg right:40%](attachments/photo.jpg)

- Supports vault-relative images and backgrounds (`![bg](...)`)
- Custom CSS styles and themes
- Bundled KaTeX math: $e^{i\pi} + 1 = 0$
```

Save the file. Switch between edit and reading mode to see the previews.

## Custom themes via `.marprc.yml`

Place a `.marprc.yml` at the vault root (preferred) or next to your slide file:

```yaml
themeSet:
  - themes/my-theme.css
theme: my-theme
```

Each entry in `themeSet` is a vault-relative path resolved against the `.marprc.yml` location. The plugin reads those CSS files via the Obsidian Vault API (no Node `fs`), so it works on mobile too. Your CSS must have a header comment such as `/* @theme my-theme */` to be selectable by name.

Slides can opt in per-file via frontmatter:

```yaml
---
marp: true
theme: my-theme
---
```

## Export to PDF

You can export your presentation slides to a clean vector PDF directly inside Obsidian Desktop without installing Google Chrome or external tools:

1. Open a slide file with `marp: true` in its frontmatter.
2. Open the Command Palette (`Ctrl/Cmd + P`) and select **Marp: Export slide deck to PDF...** (or right-click the note in the file explorer and choose **Export Marp to PDF...**).
3. Configure your export options:
   - **Output file path**: Vault-relative path for the exported `.pdf` file (defaults to `<note-name>.pdf`).
   - **Image quality / DPI**:
     - *Original*: No downsampling or re-compression.
     - *High (~300 DPI, 4K max)*: High-resolution output for physical printing.
     - *Medium (~150 DPI, 1080p max)*: Recommended balance for digital presentations and email (reduces file size by 70–90% for photo-heavy decks).
     - *Low (~96 DPI, 720p max)*: Smallest file size.
   - **Include presenter notes**: Embeds speaker notes (HTML comments `<!-- ... -->`) as standard PDF sticky note annotations on each slide page, matching `marp-cli --pdf-notes`.
   - **Open after export**: Opens the generated PDF in Obsidian upon completion.
4. Click **Export**.

## Presentation & Presenter View

Present your slide deck directly within Obsidian or across dual monitors with a dedicated speaker companion screen:

1. Open any slide file with `marp: true` in its frontmatter.
2. Open the Command Palette (`Ctrl/Cmd + P`) and choose **Marp: Start presentation** (or right-click the note and select **Start Marp presentation**).

### Features

- **Audience Presentation View**:
  - Automatically launches in fullscreen (on the second screen when dual displays are detected, leaving your main Obsidian window free).
  - Maintains 16:9 aspect ratio with auto-scaling and letterboxing.
  - Auto-hiding HUD toolbar with slide progress and navigation buttons.
  - Keyboard navigation: `Space` / `ArrowRight` / `PageDown` to advance; `ArrowLeft` / `PageUp` to go back; `Home` / `End` for first/last slide.
  - Screen blanking: press `B` or `.` for blackout, `W` for whiteout.
  - Fullscreen toggle with `F`.
  - Touch swipe navigation support on mobile and tablets.
  - Live reload: edits to the slide file automatically update the presentation in real time.


- **Presenter View (Speaker Dashboard)**:
  - Opens conveniently in an Obsidian tab by pressing `P` or selecting **Marp: Open presenter view** (or right-clicking the note and choosing **Open Marp presenter view**).
  - **Current & Next Slide Previews**: See what the audience sees plus an upcoming preview of the next slide.
  - **Rich Speaker Notes**: Slide comments (`<!-- ... -->`) are rendered as formatted Markdown with adjustable font sizes (`A-` / `A+`).
  - **Timer & Wall Clock**: Built-in stopwatch with Start/Pause/Reset controls plus local wall clock.
  - **Slide Jump Selector**: Dropdown to instantly jump to any slide in the deck.
  - **Two-Way Synchronization**: Advancing slides or toggling blank screens in either view synchronizes immediately.
  - Option to automatically open the Presenter View in an Obsidian tab whenever a presentation starts (configured in Settings).

## Settings

### Preview & Math
- **Inline preview in edit mode** — toggle the CodeMirror slide widgets.
- **Preview slide maximum width** — choose the maximum width of preview slides in edit mode (`Match editor line width (default)`, `800px`, `1000px`, `Full width (100%)`, or `Custom width...`).
- **Custom maximum width** — specify any CSS width (e.g. `850px`, `50rem`, `75%`) when "Custom width..." is chosen.
- **Full preview in reading mode** — toggle the full deck render in reading mode.
- **Math rendering** — `KaTeX` (bundled) or `Off`.

### PDF Export
- **Include presenter notes** — add presenter notes as PDF sticky note annotations by default.
- **Open PDF after export** — open the exported PDF in Obsidian by default after completion.
- **Default image quality / DPI** — default raster image downsampling preset (`Original`, `High`, `Medium`, or `Low`).

### Presentation
- **Auto-open presenter view** — automatically open the Presenter View in an Obsidian tab when starting a presentation (Desktop only).

### Commands
- `Marp: Refresh Marp previews` — forces a full reload of previews and custom themes.
- `Marp: Start presentation` — launches the presentation view (in fullscreen popout window on secondary monitor if available on Desktop, or tab on Mobile).
- `Marp: Open presenter view` — opens the speaker dashboard companion tab.
- `Marp: Export slide deck to PDF...` — opens the PDF export dialog for the active Marp note (Desktop only).

### Context Menu Actions
Right-clicking any note with `marp: true` in its frontmatter provides:
- **Start Marp presentation**
- **Open Marp presenter view**
- **Export Marp to PDF...** (Desktop only)

## Install: build locally and copy into another vault

The plugin ships as three files (`main.js`, `manifest.json`, `styles.css`). You build them once in this repo, then drop them into any vault.

### 1. Build the plugin

Requires Node.js 18 or newer.

```bash
git clone https://github.com/<you>/obsidian-marp-inline-preview-plugin.git
cd obsidian-marp-inline-preview-plugin
npm install
npm run build
```

After `npm run build` the repo root contains:

```
main.js        # bundled plugin code (~1.9 MB, includes Marp Core + KaTeX)
manifest.json  # plugin metadata (checked in)
styles.css     # host-side styles (checked in)
```

### 2. Find the target vault's plugin folder

Inside your Obsidian vault there is a hidden `.obsidian/` directory. Plugins live under `.obsidian/plugins/<plugin-id>/`. For this plugin the folder is `marp-inline-preview-plus`.

> [!NOTE]
> If you are migrating from the earlier `marp-inline-preview` plugin, disable it first and replace the folder with `marp-inline-preview-plus`.

Typical full paths:

| OS | Example path |
|---|---|
| macOS / Linux | `/path/to/MyVault/.obsidian/plugins/marp-inline-preview-plus/` |
| Windows | `C:\Users\you\Documents\MyVault\.obsidian\plugins\marp-inline-preview-plus\` |
| iOS | `On My iPhone → Obsidian → MyVault → .obsidian → plugins → marp-inline-preview-plus` (Files.app, "Show Hidden Files" on) |
| Android | `/storage/emulated/0/MyVault/.obsidian/plugins/marp-inline-preview-plus/` (any file manager) |

Create the directory if it doesn't exist yet.

### 3. Copy the three files

From the repo root, with `TARGET_VAULT` set to your vault directory:

```bash
# macOS / Linux
TARGET_VAULT="/path/to/MyVault"
mkdir -p "$TARGET_VAULT/.obsidian/plugins/marp-inline-preview-plus"
cp main.js manifest.json styles.css "$TARGET_VAULT/.obsidian/plugins/marp-inline-preview-plus/"
```

```powershell
# Windows PowerShell
$TARGET_VAULT = "C:\Users\you\Documents\MyVault"
New-Item -ItemType Directory -Force -Path "$TARGET_VAULT\.obsidian\plugins\marp-inline-preview-plus" | Out-Null
Copy-Item main.js, manifest.json, styles.css "$TARGET_VAULT\.obsidian\plugins\marp-inline-preview-plus\"
```

On mobile, sync the three files via iCloud / Obsidian Sync / a USB transfer to the same path. Obsidian Sync replicates `.obsidian/plugins/` automatically if you enable it.

### 4. Enable it in Obsidian

1. Open the target vault.
2. **Settings → Community plugins**. If you see "Restricted mode", turn it off.
3. Reload the plugin list (the circular-arrow icon next to "Installed plugins"), or run **Reload app without saving** from the command palette.
4. Toggle **Marp Inline Preview Plus** on.

Open a markdown file with `marp: true` in its frontmatter — you should see slide widgets in edit mode and the full deck in reading mode.

### Updating

Re-run `npm run build`, then re-copy the same three files (step 3) and reload Obsidian.

### Uninstalling

Disable the plugin in Settings → Community plugins, then delete `<vault>/.obsidian/plugins/marp-inline-preview-plus/`.

## Development

```bash
npm install
npm run dev:vault    # symlinks build outputs into test-vault/ and starts esbuild watch
```

Then in Obsidian: `File → Open vault…` and pick the `test-vault/` folder in this repo. Enable the plugin and open one of the files in `slides/`.

`npm run build` produces a production bundle (~1.9 MB).

Available scripts:
- `npm run dev` — runs esbuild in watch mode.
- `npm run dev:vault` — links plugin files into `test-vault/.obsidian/plugins/` and starts watch mode.
- `npm run build` — type checks and builds production bundle (`main.js`).
- `npm test` — runs Vitest test suites (unit, DOM, snapshots, bundle smoke).
- `npm run test:bundle` — validates bundle compatibility with `check-bundle.mjs` and `es-check`.
- `npm run ci` — runs type checks, build, test suites, and bundle checks.

Project layout:

```
src/
├── main.ts              Plugin entry: register processors, settings, events, commands
├── settings.ts          Settings model + PluginSettingTab
├── export/              In-app PDF export subsystem
│   ├── service.ts       Pipeline orchestrator
│   ├── printer.ts       Electron <webview> manager + pre-print image optimization
│   ├── notes.ts         PDF annotation injector (pdf-lib)
│   ├── exportModal.ts   Export options modal dialog
│   ├── template.ts      Printable HTML payload builder
│   └── types.ts         Export options and presets
├── presentation/        Presentation & Presenter View subsystem
│   ├── service.ts       Launch orchestration & multi-display window management
│   ├── session.ts       Bidirectional state synchronization & event bus
│   ├── presentationView.ts Fullscreen audience display view & HUD
│   ├── presenterView.ts Speaker dashboard (notes, timer, upcoming slide)
│   └── types.ts         Presentation state & view interfaces
├── marp/
│   ├── engine.ts        Marp Core wrapper (themes, render helpers, comments)
│   ├── themes.ts        .marprc.yml discovery and theme registration
│   └── slides.ts        Slide-break detection (frontmatter & fence aware)
├── reading/
│   └── postProcessor.ts MarkdownPostProcessor that replaces the preview section
├── editor/
│   ├── extension.ts     CM6 ViewPlugin that coordinates slide widgets
│   ├── stage.ts         Persistent iframe stage container
│   └── widget.ts        Block widget declarations
└── util/
    ├── debounce.ts
    ├── frame.ts         Iframe mounting and layout helpers
    ├── hash.ts          FNV-1a hash
    └── images.ts        Vault asset path & CSS background rewriting
```

## Mobile notes

- Everything goes through `app.vault.adapter` — no Node `fs`, no Electron-only APIs.
- `mathjax-full` is aliased out at bundle time so the plugin stays small.
- KaTeX fonts are loaded from the bundle, not a CDN. Math works offline.
- Twemoji is disabled; OS Unicode emoji are used instead, so no CDN fetch.

## TODO: Marp CLI parity

- Size preview iframes from each rendered SVG's `viewBox` instead of assuming Marp's default 1280x720 slide. Decks using `size: 4:3` or custom theme `@size` rules can currently be clipped or shown with the wrong aspect ratio compared with Marp CLI output.
- Rework theme reloads so modified custom theme CSS replaces the existing Marp Core theme registration. The current cache invalidation re-reads CSS, but Marp Core may keep the first registered theme with the same name, leaving edit/reading previews stale after theme edits.
- Include rendered CSS or a theme revision in the reading-mode render hash. At the moment the hash is based on markdown plus theme name, so a CSS-only theme update can be skipped even after requesting a reading preview rerender.
- Decide how much of `.marprc.yml` CLI configuration should be supported beyond `theme` and `themeSet`. Options such as `html`, `math`, and other Marp CLI/Core settings can make the plugin preview differ from `marp` command output.
- Preserve query strings and fragments when rewriting local resource URLs. Paths like `image.svg#fragment` or `image.png?cache=...` are resolved by stripping the suffix today, which can change rendered output versus Marp CLI.

## Limitations / known issues

- **Mermaid** isn't supported — Marp Core itself doesn't ship Mermaid integration.
- Reading-mode rendering replaces the preview section wholesale, so plugins that mutate that section (e.g. some outline plugins) may not work on Marp files.
- The CodeMirror plugin uses `editor.cm` to associate a `ViewPlugin` with the active `TFile`; this is an internal property and could break in a future Obsidian release.

## License

MIT — see [`LICENSE`](./LICENSE).
