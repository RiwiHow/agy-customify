# agy-customify

Inject custom terminal fonts into Antigravity via CDP and extend its native file viewer with editing, saving, file creation, and deletion capabilities. Runs on Bun with no additional dependencies.

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

   > Keep the process running to automatically watch for new windows and page reloads. Common options: `--exe <path>`, `--port <port>`, `--no-launch` (disable automatic launch), `--list` (list pages only), `--once` (inject once), and `--match <text>` (filter by URL).

## Key Features

- **Terminal fonts**: Inject custom monospace fonts (configurable in `src/injections/styles.css`).
- **Native file editing**:
  - Seamlessly switch between **Preview / Raw / Edit** modes in the native viewer.
  - Save with `Ctrl+S` / `Cmd+S`, with line numbers and Prism syntax highlighting.
  - Automatically retain unsaved drafts, prompt for confirmation when closing, and protect against conflicts caused by external file changes.
- **File and directory management**:
  - Create files and folders, and delete items via the context menu in the right-hand file tree.
  - Use the host's native context menus and Language Server file APIs directly, with no external service dependencies.

## Tests

```powershell
bun run test
```

## Project Structure

```text
src/
├─ cli.js                  # CDP connection and injection management
└─ injections/
   ├─ styles.css           # Terminal fonts, editor styles, and UI enhancements
   ├─ native-files.js      # Host environment and file/menu API adapters
   ├─ raw-text-editor.js   # Editor core (line numbers, highlighting, shortcuts)
   └─ file-editor-entry.js # Native viewer entry point and UI enhancements
```
