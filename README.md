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
  (`Ctrl+F12`); the driver jump follows wrapper levels that only pass a signal
  along, descends to the module that drives an output, and from an input port walks
  up to the parent binding (listing up to `maxSignalUsers` instantiations); module
  hierarchy; find instances; jump to the instantiating module; show module instances
  and outline entries.
- **Hover**: links to module, interface, class and member definitions; port
  direction with driver and signal-user links (an input links to the modules that
  actually use the signal, skipping the levels that only forward it); configurable
  direction colors.
- **Completion**: adaptive `always` / `always_ff` / `always_comb` snippets; dot and
  `::` completion; missing-port completion inside module/interface instantiations
  (type `.` in the port list to list ports not yet bound); enum/vector `case`
  completion; system tasks, directives, UVM functions and keyword snippets.
  Declarations visible in the current scope also complete — module, interface and
  package ports, parameters, signals and variables, instance names, typedefs, enum
  members, function and task names, function-local variables, and members of
  packages pulled in with `import pkg::*`; these symbol rows are ranked above the
  snippets, and no declarations are offered inside comments or string literals.
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
| `includeDirs` | Extra directories searched for `` `include `` directives. Supports `*`, `?` and `**` wildcards such as `rtl/*/include`. |
| `vExt` / `svExt` / `vhExt` / `svhExt` | File extensions indexed for each language/header type. |
| `hoverMaxSize` / `portDirectionColors` | Limit automatic hover by file size; set port direction colors. |
| `maxSignalUsers` | How many modules the **Go to modules using …** hover link lists (default 5, max 20). |
| `autoconnect` / `fillparam` / `paramOneline` / `instOneline` | Module instantiation and parameter behavior. |
| `instancePrefix` / `instanceSuffix` / `declStart` / `declEnd` | Generated instance names and auto-declaration location. |
| `clkName` / `rstName` / `rstNName` / `disableAutocomplete` | Snippet clock/reset names and smart completion toggle. |
| `maxLineLength` / `paramPortAlignment` / `alignCommaSemicolon` / `alignmentIgnoreTick` | Alignment behavior. |
| `debug` | Log index and command details to the **SystemVerilog** output channel. |

Leave `fileLists` empty to index the whole workspace. Includes are resolved from
the including file's directory first, then from the configured include directories.

A file whose entire content is the path of another file (a checked-in link to a
generated source) is followed transparently when it is reached through a filelist
or an `` `include ``, so navigation and hover land in the real file.

## Building

```sh
npm install
npm run compile
npm test
```

`npm test` covers the parser, beautifier, filelists, directory globbing, instance
lookup, port completion, scope symbols, the completion provider and activation.
Compile before testing. The activation test simulates the published environment,
where `node_modules` is not shipped.

## License and attribution

Derived from the Sublime Text SystemVerilog plugin by TheClams, licensed under the
Apache License 2.0. See `NOTICE` and `LICENSE`.
