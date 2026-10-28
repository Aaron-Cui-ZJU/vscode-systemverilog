# Change Log

## 1.3.0 (2026-10-28)

- Support `*`, `?` and `**` wildcards in `systemverilog.includeDirs`
- Ignore commented-out `` `include `` directives when following includes
- Follow link files (a file whose content is a path) to the referenced source
- Go to Driver follows pass-through instance connections to the module that drives an output
- Go to Driver on an input port walks up to the parent binding, listing up to `maxSignalUsers` instantiations
- Hover link on an instance input jumps to the modules that ultimately use the signal, skipping forwarding levels
- Add `systemverilog.maxSignalUsers` (default 5, max 20) for the signal-user list
- Fix port parsing for ranges containing sized literals (e.g. `1'b1`), so hover and jump-to-module work on those ports


## 1.2.7 (2026-10-28)

- Save `fileLists` and `includeDirs` per workspace so each project keeps its own filelists


## 1.2.6 (2026-10-25)

- Simplify README and remove unused settings


## 1.2.5 (2026-10-25)

- Cache instantiations to speed up instance navigation


## 1.2.4 (2026-10-07)

- Optimize extension icon (256x256, transparent background)


## 1.2.3 (2026-10-07)

- Add activation smoke test guarding against unshipped runtime dependencies
- Update extension icon


## 1.2.2 (2026-10-07)

- Load vscode-languageclient lazily so the published extension activates without it


## 1.2.1 (2026-10-07)

- Add indexed-file check to the settings panel
- Speed up indexing and parsing, fix concatenation driver lookup
- Add disabled language-server integration; fix concatenation driver in port hover; serve verilog language id


## 1.2.0 (2026-10-06)

- Preserve unsaved settings panel edits across tab switches
- Add Go to Instantiating Module navigation


## 1.1.1 (2026-10-06)

- Add -incfile support to filelists


## 1.1.0 (2026-10-06)

- docs: document port hover colors and configure command
- Add filelist-based indexing, include search dirs and settings panel


## 1.0.3 (2026-10-05)

- Add CHANGELOG entry for v1.0.2
- chore: auto-update CHANGELOG on release and tag
- Add configurable port hover colors with a settings UI


## 1.0.2

- Add class support: classes are indexed even when declared with leading
  modifiers (`virtual`, `local`, `protected`, `static`, `pure`, `interface`).
- Hover a variable whose type is a class or interface to jump to the type
  definition; hover a class name (for example the base in `extends Base`) to
  jump to the class.
- Resolve class members and functions inherited across files through the
  `extends` chain; hovering an inherited member or function offers a link to
  its declaration/definition.
- Handle out-of-body method definitions (`function void Class::method(...)`)
  when resolving the enclosing class.
- Fix extern function parsing whose capture groups were misaligned, so
  `extern` function/method names are indexed correctly.
- Build a resident workspace symbol index in the background and keep it in
  sync on file create, change, delete and save for fast lookups.

## 1.0.1

- Add module instance outline: the Outline view / Go to Symbol shows the
  current module and the modules it instantiates, including instances inside
  generate blocks.
- Add "Verilog: Show Module Instances" command.
- Add clickable links in hover popups to jump to the definition of an
  instantiated module.
- Add port-aware hover for instantiations: hovering a named port binding
  (`.port(sig)`) shows the port direction and offers to jump to the first use
  (input) or the driver (output) of that port inside the module.
- Add extension icon.

## 1.0.0

- Initial release: port of the Sublime Text SystemVerilog plugin to Visual
  Studio Code.
- Syntax highlighting, navigation, completion, alignment, module instantiation,
  FSM template and linting.
