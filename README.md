# SystemVerilog for Visual Studio Code

SystemVerilog / Verilog support for VS Code, ported from the Sublime Text
[SystemVerilog plugin](https://github.com/TheClams/SystemVerilog). Supports `.v`,
`.vh`, `.sv` and `.svh` files.

## Quick start

1. Install the extension and open a workspace containing HDL files.
2. Open the Command Palette and type `Verilog` to see the commands.
3. For large projects, configure `systemverilog.fileLists` and
   `systemverilog.includeDirs`.
4. Use **Verilog: Configure Settings** for a validated settings UI.

## Features

- **Syntax**: Verilog/SystemVerilog TextMate grammar, brackets, comments and folding.
- **Navigation**: show type (`F10`), declaration (`Shift+F12`) and driver
  (`Ctrl+F12`); module hierarchy; find instances; jump to the instantiating
  module; show module instances and outline entries.
- **Hover**: links to module, interface, class and member definitions; port
  direction with first-use/driver links; configurable direction colors.
- **Completion**: adaptive `always` / `always_ff` / `always_comb` snippets; dot and
  `::` completion; enum/vector `case` completion; system tasks, directives, UVM
  functions and keyword snippets.
- **Editing**: alignment, reindent, module instantiation with parameter prompts
  and auto-connect, `.*` expansion, FSM template generation, block move/select.
- **Linting**: find unused and undeclared signals.
- **Indexing**: background workspace index, refreshed on file changes; filelists
  and include directories keep large projects fast.

## Commands

Most commands are in the Command Palette under `Verilog`. Common navigation and
editing commands are also in the editor context menu. Block boundary commands are
keybinding-only.

| Command | Default key |
| --- | --- |
| Verilog: Show Signal/Variable Type | `F10` |
| Verilog: GoTo Declaration | `Shift+F12` |
| Verilog: GoTo Driver | `Ctrl+F12` |
| Verilog: Show Module Hierarchy | |
| Verilog: Find Instance | |
| Verilog: Go to Instantiating Module | |
| Verilog: Show Module Instances | |
| Move to Block Boundary | `Ctrl+M` |
| Select Block Boundary | `Ctrl+Shift+M` |
| Verilog: Instantiate Module | `Ctrl+F10` |
| Verilog: Toggle .* | `Ctrl+Shift+F10` |
| Verilog: Alignment | `Ctrl+Shift+A` |
| Verilog: Reindent | `Alt+Shift+A` |
| Verilog: Insert FSM template | |
| Verilog: Find Unused Signals | |
| Verilog: Linting | |
| Verilog: Configure Settings | |

## Configuration

All settings are under `systemverilog.*`. **Verilog: Configure Settings** provides
the full UI and can validate filelists, include directories and indexed files.
`fileLists` and `includeDirs` describe one project's compile command, so the panel
saves them to the workspace (`.vscode/settings.json`) and other projects keep their
own lists. Port hover colors are a display preference and stay in user settings.

| Setting | Purpose |
| --- | --- |
| `fileLists` | Restrict indexing to files referenced by one or more filelists. Supports `-f`/`-F`, `-incfile`, `+incdir+`, `-I`, comments, quoted paths and environment variables. |
| `includeDirs` | Extra directories searched for `` `include `` directives. |
| `vExt` / `svExt` / `vhExt` / `svhExt` | File extensions indexed for each language/header type. |
| `hoverMaxSize` / `portDirectionColors` | Limit automatic hover by file size; set port direction colors. |
| `autoconnect` / `fillparam` / `paramOneline` / `instOneline` | Module instantiation and parameter behavior. |
| `instancePrefix` / `instanceSuffix` / `declStart` / `declEnd` | Generated instance names and auto-declaration location. |
| `clkName` / `rstName` / `rstNName` / `disableAutocomplete` | Snippet clock/reset names and smart completion toggle. |
| `maxLineLength` / `paramPortAlignment` / `alignCommaSemicolon` / `alignmentIgnoreTick` | Alignment behavior. |
| `debug` | Log index and command details to the **SystemVerilog** output channel. |

Leave `fileLists` empty to index the whole workspace. Includes are resolved from
the including file's directory first, then from the configured include directories.

## Building

```sh
npm install
npm run compile
npm test
```

`npm test` covers the parser, beautifier, filelists, instance lookup and
activation. Compile before testing. The activation test simulates the published
environment, where `node_modules` is not shipped.

## License and attribution

Derived from the Sublime Text SystemVerilog plugin by TheClams, licensed under the
Apache License 2.0. See `NOTICE` and `LICENSE`.
