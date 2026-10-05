# SystemVerilog for Visual Studio Code

SystemVerilog / Verilog language support for VS Code, ported from the Sublime Text
[SystemVerilog plugin](https://github.com/TheClams/SystemVerilog) (documentation at
<https://sv-doc.readthedocs.io/en/latest/>).

It provides syntax highlighting, code navigation, smart completion, alignment,
module instantiation and lightweight linting for `.v`, `.vh`, `.sv` and `.svh`
files.

## Features

### Syntax highlighting
Full Verilog / SystemVerilog TextMate grammar, plus language configuration
(brackets, comments, folding).

### Code navigation
- **Show declaration** (`F10`): declaration of the symbol under the cursor,
  including struct / enum / interface / class field information.
- **Goto declaration** (`Shift+F12`): jump to the declaration of a signal,
  module, interface, package, class or function.
- **Goto driver** (`Ctrl+F12`): jump to the driver of a signal (output port,
  assignment, `assign` or sub-module output connection).
- **Show hierarchy**: open the complete module hierarchy of the current module.
- **Find instance**: list every place the current module is instantiated.
- **Move / select block** (`Ctrl+M` / `Ctrl+Shift+M`): move to or select the
  enclosing `begin/end`, `module/endmodule`, `case/endcase`, ... block.
- Hover provider showing declaration information.
- Hovering a port binding (`.name(sig)`) shows the port direction, color-coded
  per direction (input / output / inout / ref). Use **Configure Port Hover
  Colors** to pick the colors in a UI.

### Completion
- Smart `always` / `always_ff` / `always_comb` snippets that adapt to the
  clock/reset names found in the current buffer.
- Intellisense-like completion after `.` for struct, union, enum, class,
  interface, module instance and built-in container/string members.
- Scope (`::`) completion for packages and enum values.
- `case` completion (fill all enum/vector values).
- System tasks (`$`), compiler directives (`` ` ``), UVM functions, modport and
  simple keyword snippets.

### Alignment / formatting
- **Alignment** (`Ctrl+Shift+A`): align ports, module instantiations, signal
  declarations and assignments.
- **Reindent** (`Alt+Shift+A`).

### Instantiation
- **Instantiate module** (`Ctrl+F10`): pick a module, fill parameters, and let
  the extension auto-connect and auto-declare signals.
- **Toggle .\*** (`Ctrl+Shift+F10`): expand/collapse SystemVerilog implicit port
  connections.

### FSM & linting
- **Insert FSM template**: generate a two-process state machine from an
  enum/vector signal.
- **Find unused signals** / **Linting**: find unused and undeclared signals.

## Commands

All commands are available from the Command Palette under the `Verilog:`
category (and from the editor context menu).

| Command | Default key |
| --- | --- |
| Verilog: Show Signal/Variable Type | `F10` |
| Verilog: Instantiate Module | `Ctrl+F10` |
| Verilog: Toggle .* | `Ctrl+Shift+F10` |
| Verilog: Alignment | `Ctrl+Shift+A` |
| Verilog: Reindent | `Alt+Shift+A` |
| Verilog: GoTo Driver | `Ctrl+F12` |
| Verilog: GoTo Declaration | `Shift+F12` |
| (move to block boundary) | `Ctrl+M` |
| (select block boundary) | `Ctrl+Shift+M` |
| Verilog: Configure Port Hover Colors | |

## Settings

Every setting of the original plugin is available under the `systemverilog.*`
namespace (e.g. `systemverilog.clkName`, `systemverilog.autoconnect`,
`systemverilog.alignmentIgnoreTick`, `systemverilog.completionSystemtaskUser`,
...). See the Settings UI for the full list with descriptions.

## Building

```sh
npm install
npm run compile
```

Run the tests for the ported parser and beautifier:

```sh
npm test
```

Consistency of the parser / beautifier port is verified against the test data of
the original project (17 parser cases and 27 beautifier cases pass).

## License and attribution

Derived from the Sublime Text SystemVerilog plugin by TheClams, licensed under
the Apache License 2.0. See `NOTICE` and `LICENSE`.
