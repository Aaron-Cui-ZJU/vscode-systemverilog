# Change Log

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
