# agy-customify

Inject custom terminal fonts into Antigravity via CDP, route the new-tab file entry to the native Files view, and extend the native file viewer with editing, saving, file creation, and deletion capabilities. Runs on Bun (`>=1.4.0`) with no external dependencies.

## Quick Start

1. Set the Antigravity executable path and debugging port in `config.json` at the project root:

   ```json
   {
     "executablePath": ".\\Antigravity.exe",
     "port": 9222
   }
   ```

2. Run the launcher and injector (if the CDP port is not already available, it automatically starts Antigravity with `--remote-debugging-port` and injects the customizations):

   ```powershell
   bun run start
   ```

   > Keep the process running to automatically watch for new windows and page reloads.
   > Available options: `--exe <path>`, `--port <port>`, `--cdp <url>`, `--no-launch`, `--match <text>`, `--list`, `--once`, and `-h, --help`.

## Key Features

- **Terminal fonts**: Inject custom monospace fonts (configurable in `src/injections/styles.css`).
- **New-tab Files entry**: Rename the new-tab card's **Open File** button to **Files** and open Antigravity's native Files view/sidebar instead of the file picker.
- **Native file editing**:
  - Seamlessly switch between **Preview / Raw / Edit** modes in the native viewer.
  - Save with `Ctrl+S` / `Cmd+S` or revert drafts from disk, with line numbers and Prism syntax highlighting.
  - Preserve UTF-8 BOM and LF/CRLF line endings for text files up to 2 MiB.
  - Retain unsaved drafts automatically, prompt for confirmation when closing modified tabs, and guard against external disk modifications.
- **File and directory management**:
  - Create files via the `+ New File` toolbar button or the file tree context menu, create folders, and delete files or folders.
  - Use the host's native context menus and Language Server file APIs directly, with no external service dependencies.

## Tests

Runs the unit test suite via `node --test`:

```powershell
bun run test
```

## Project Structure

```text
config.json                  # Default Antigravity executable path and CDP port
src/
├─ cli.js                    # CDP launcher, target watcher, and script injector
└─ injections/
   ├─ styles.css             # Terminal fonts, editor styles, and UI enhancements
   ├─ native-files.js        # Host environment, state store, and file/menu API adapters
   ├─ files-entry.js         # New-tab card Files button routing
   ├─ raw-text-editor.js     # Editor core (line numbers, Prism highlighting, shortcuts)
   └─ file-editor-entry.js   # File viewer/tree entry point, drafts, and context menus
tests/
├─ files-entry.test.js       # Unit tests for new-tab Files entry routing
└─ native-files.test.js      # Unit tests for URI, encoding, and file API adapters
```
