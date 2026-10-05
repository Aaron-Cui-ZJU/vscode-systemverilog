# Change Log

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
