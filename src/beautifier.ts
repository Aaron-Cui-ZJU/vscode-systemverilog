// TypeScript port of verilogutil/verilog_beautifier.py from the Sublime SystemVerilog plugin.

import { reBw, portDir, cleanComment } from './parser';

function splitlines(s: string): string[] {
  if (s === '') {
    return [];
  }
  const parts = s.split(/\r\n|\r|\n/);
  if (parts.length && parts[parts.length - 1] === '' && /(\r\n|\r|\n)$/.test(s)) {
    parts.pop();
  }
  return parts;
}

export function splitOnComma(txt: string): string[] {
  const l: string[] = [];
  let s = '';
  let lvl = 0;
  for (const c of txt) {
    if (c === ',' && lvl === 0) {
      l.push(s);
      s = '';
    } else {
      s += c;
      if (c === '(') {
        lvl += 1;
      } else if (c === ')' && lvl > 0) {
        lvl -= 1;
      }
    }
  }
  s = s.trim();
  if (s.length > 0) {
    l.push(s);
  }
  return l;
}

export interface BeautifierSettings {
  nbSpace?: number;
  useTab?: boolean;
  oneBindPerLine?: boolean;
  oneDeclPerLine?: boolean;
  paramOneLine?: boolean;
  indentSyle?: string;
  reindentOnly?: boolean;
  stripEmptyLine?: boolean;
  instAlignPort?: boolean;
  importSameLine?: boolean;
  ignoreTick?: boolean;
  alignComma?: boolean;
}

export class VerilogBeautifier {
  settings: Required<BeautifierSettings>;
  indentSpace: string;
  indent: string;
  states: string[] = [];
  state = '';
  state_ = '';
  block_state = '';
  always_state = '';
  re_decl: RegExp;
  re_inst: RegExp;
  kw_block: string[];

  constructor(opts: BeautifierSettings = {}) {
    this.settings = {
      nbSpace: opts.nbSpace ?? 3,
      useTab: opts.useTab ?? false,
      oneBindPerLine: opts.oneBindPerLine ?? true,
      oneDeclPerLine: opts.oneDeclPerLine ?? false,
      paramOneLine: opts.paramOneLine ?? true,
      indentSyle: opts.indentSyle ?? '1tbs',
      reindentOnly: opts.reindentOnly ?? false,
      stripEmptyLine: opts.stripEmptyLine ?? true,
      instAlignPort: opts.instAlignPort ?? true,
      importSameLine: opts.importSameLine ?? false,
      ignoreTick: opts.ignoreTick ?? false,
      alignComma: opts.alignComma ?? true,
    };
    this.indentSpace = ' '.repeat(this.settings.nbSpace);
    this.indent = this.settings.useTab ? '\t' : this.indentSpace;
    this.re_decl = new RegExp(
      '^[ \\t]*(?:(?<param>localparam|parameter|local|protected)\\s+)?(?<scope>\\w+\\:\\:)?(?<type>[A-Za-z_]\\w*)[ \\t]+(?<sign>signed\\b|unsigned\\b)?[ \\t]*(?<bw>(?:\\[(' +
        reBw +
        ')\\][ \\t]*)*)[ \\t]*(?<name>[A-Za-z_]\\w*)[ \\t]*(?<array>(?:\\[(' +
        reBw +
        ')\\][ \\t]*)*)(=\\s*(?<init>[^;]+))?(?<sig_list>,[\\w, \\t]*)?;[ \\t]*(?<comment>.*)'
    );
    this.re_inst = new RegExp(
      '^[ \\t]*\\b(?<itype>\\w+)\\s*(#\\s*\\([^;]+\\))?\\s*\\b(?<iname>\\w+)\\s*\\(',
      'm'
    );
    this.kw_block = [
      'module',
      'class',
      'interface',
      'program',
      'function',
      'task',
      'package',
      'case',
      'casex',
      'casez',
      'generate',
      'covergroup',
      'property',
      'sequence',
      'checker',
      'fork',
      'begin',
      '{',
      '(',
    ];
    if (!this.settings.ignoreTick) {
      this.kw_block = this.kw_block.concat(['`ifdef', '`ifndef', '`elsif', '`else']);
    }
  }

  getIndentLevel(txt: string): number {
    const idx = txt.indexOf('\n');
    let line = idx >= 0 ? txt.slice(0, idx) : txt.slice(0, -1);
    if (this.settings.useTab) {
      line = line.split(this.indentSpace).join('\t');
    } else {
      line = line.replace(/\t/g, this.indentSpace);
    }
    const cnt = line.length - line.replace(/^\s+/, '').length;
    if (!this.settings.useTab) {
      return Math.floor(cnt / this.settings.nbSpace);
    }
    return cnt;
  }

  stateUpdate(newState?: string): void {
    if (newState) {
      this.states.push(newState);
    } else {
      this.states.pop();
    }
    this.state = this.states.length === 0 ? '' : this.states[this.states.length - 1];
  }

  isStateEnd(w: string): boolean {
    if (this.state === 'begin' && w === 'end') {
      return true;
    }
    if (this.state === 'covergroup' && w === 'endgroup') {
      return true;
    }
    if (this.state === 'fork' && w.startsWith('join')) {
      return true;
    }
    if (this.state === '{' && w === '}') {
      return true;
    }
    if (this.state === '(' && w === ')') {
      return true;
    }
    if (this.state.startsWith('`') && ['`elsif', '`else', '`endif'].includes(w)) {
      return true;
    }
    if (this.state && w === 'end' + this.state) {
      return true;
    }
    return false;
  }

  beautifyText(txt: string): string {
    this.states = [];
    const w_d: string[] = ['\n', '\n', '\n', '\n'];
    const wd = (n: number) => w_d[4 + n];
    let line = '';
    let block = '';
    let original_indent = '';
    this.block_state = '';
    let block_handled = false;
    let block_ended = false;
    let txt_new = '';
    let ilvl = this.getIndentLevel(txt);
    let ilvl_prev = ilvl;
    let has_indent = ilvl !== 0;
    let line_cnt = 1;
    const split = new Map<number, [number, string]>();
    let split_always = 0;
    let last_split: [number, string] = [0, ''];
    let split_else = false;
    this.always_state = '';
    const words = txt.match(/`?\w+|[^\w\s]|[ \t]+|\n/g) || [];
    for (const w of words) {
      const state_end = this.isStateEnd(w);
      if (w === 'else' && split_else) {
        split.set(ilvl, last_split);
      } else if (w.trim()) {
        split_else = false;
      }
      if (wd(-1) === '\n') {
        ilvl_prev = ilvl;
        if (!w.trim()) {
          if (w !== '\n' && this.block_state === 'module') {
            block += w;
          }
          has_indent = w !== '\n';
        }
        if (state_end) {
          this.stateUpdate();
          if (ilvl <= 0) {
            console.warn(
              `[Beautify] Block end with already no indentation ! Line ${String(line_cnt).padStart(4)}`
            );
          }
          ilvl -= 1;
        }
        if (this.block_state === 'assign' && w !== 'assign' && !/^[\t ]+/.test(w)) {
          txt_new += this.alignAssign(block, 2);
          block = '';
          this.block_state = '';
        } else if (
          this.block_state === 'decl' &&
          ['always', 'always_ff', 'always_comb', 'always_latch', 'constraint', 'assign'].includes(w)
        ) {
          if (this.settings.reindentOnly) {
            txt_new += block;
          } else {
            txt_new += this.alignDecl(block);
          }
          block = '';
          this.block_state = '';
        }
        if (
          this.settings.ignoreTick &&
          ['`ifdef', '`ifndef', '`elsif', '`else', '`endif'].includes(w)
        ) {
          this.stateUpdate('ignore_line');
          line += original_indent;
        } else if (!has_indent && this.state.startsWith('`')) {
          has_indent = true;
        }
        if (
          this.block_state !== 'module' &&
          w.trim() &&
          (!['comment_block', 'attribute'].includes(this.state) || has_indent) &&
          this.state !== 'ignore_line'
        ) {
          let ilvl_tmp = ilvl + split_always;
          for (const x of split.values()) {
            ilvl_tmp += x[0];
          }
          line = this.indent.repeat(ilvl_tmp);
        }
      }
      // Handle end of split
      if (split.has(ilvl)) {
        if (
          !['comment_line', 'ignore_line', 'comment_block', 'attribute', 'string'].includes(this.state) &&
          ([';', 'end', 'endcase'].includes(w) || line.trim().startsWith('`'))
        ) {
          last_split = split.get(ilvl)!;
          split.delete(ilvl);
          split_else = w === 'end' && last_split[1].includes(':');
        }
      }
      // Identify split statement
      if (w === '\n') {
        block_ended = false;
        if (['comment_line', 'ignore_line'].includes(this.state)) {
          this.stateUpdate();
          if (!this.block_state) {
            block_handled = true;
          }
        }
        if (
          !['comment_block', 'attribute', '{'].includes(this.state) &&
          !['module', 'instance', 'struct'].includes(this.block_state)
        ) {
          const block_c = cleanComment(block);
          const idx_eol = block_c.lastIndexOf('\n');
          let last_line = line;
          if (idx_eol > -1 && idx_eol < block_c.length - 2) {
            last_line = block_c.slice(idx_eol + 1) + line;
          }
          const tmp = cleanComment(last_line).trim();
          if (tmp) {
            const m = tmp.match(
              /(;|\{|\bend|\bendcase|\bendgenerate)$|^\}$|(begin(\s*\:\s*[\w\$]+)?)$|(case(?:x|z)?)\s*\(.*\)$|(`\w+)\s*(\(.*\))?$|^ *(`\w+)\b/
            );
            if (!m) {
              if (tmp.startsWith('always')) {
                split_always = 1;
              } else if (ilvl === ilvl_prev && this.state !== '(') {
                if (!split.has(ilvl)) {
                  if (this.state === 'case' && /\s*\w+\s*,$/.test(tmp)) {
                    // multiple state case
                  } else {
                    split.set(ilvl, [1, tmp]);
                  }
                } else if (!split.get(ilvl)![1].trim().startsWith('@')) {
                  let mm = split.get(ilvl)![1].match(/^\s*(assign\s+)?\w+\s*(<?=)\s*(.*)/);
                  if (!mm) {
                    mm = split.get(ilvl)![1].match(/^\s*(localparam|parameter)\b/);
                  }
                  if (!mm) {
                    split.get(ilvl)![0] += 1;
                  }
                }
              }
            }
          }
        }
        if (this.block_state === 'decl' && !this.re_decl.test(line.trim())) {
          if (this.settings.reindentOnly) {
            txt_new += block;
          } else {
            txt_new += this.alignDecl(block);
          }
          block = '';
          this.block_state = '';
        }
        block += line.replace(/\s+$/, '') + '\n';
        line = '';
        original_indent = '';
        has_indent = false;
        line_cnt += 1;
      } else if (wd(-1) === '\n' && !w.trim()) {
        original_indent += w;
      } else {
        if (
          !['comment_line', 'ignore_line', 'comment_block', 'attribute', 'string'].includes(this.state) &&
          this.settings.indentSyle === 'gnu'
        ) {
          if (w === 'begin' && line.trim() !== '') {
            let ilvl_tmp = ilvl + split_always + 1;
            for (const x of split.values()) {
              ilvl_tmp += x[0];
            }
            if (!split.has(ilvl)) {
              const tmp = cleanComment(line).trim();
              split.set(ilvl, [1, tmp]);
            } else {
              split.get(ilvl)![0] += 1;
            }
            line += '\n' + this.indent.repeat(ilvl_tmp);
          } else if (w === 'else' && wd(-1) !== '\n' && wd(-2) === 'end') {
            let ilvl_tmp = ilvl + split_always;
            for (const x of split.values()) {
              ilvl_tmp += x[0];
            }
            line += '\n' + this.indent.repeat(ilvl_tmp);
          }
        }
        if (block_ended && w.trim() && (w !== '/' || wd(-1) !== '/')) {
          line = line.replace(/\s+$/, '') + '\n';
          block_ended = false;
        }
        line += w;
        if (
          !['comment_line', 'ignore_line', 'comment_block', 'attribute', 'string'].includes(this.state)
        ) {
          const action = this.processWord(w, w_d, state_end, block + line);
          if (action.startsWith('incr_ilvl')) {
            ilvl += 1;
            if (action === 'incr_ilvl_flush') {
              txt_new += block;
              block = line;
              line = '';
            }
          }
        }
      }
      // Check that a module block gets the whole port declaration
      let mod_import = false;
      if (this.block_state === 'module' && w === ';') {
        const tmp = cleanComment(block + line).trim();
        const m = tmp.match(/;\s*\(/m);
        const m2 = tmp.match(/\bimport\b/m);
        mod_import = !!(m2 && !m);
      }
      // Handle the block_state and call the appropriate alignment function
      if (
        w === ';' &&
        !['comment_line', 'ignore_line', 'comment_block', 'attribute', 'string', '('].includes(this.state) &&
        !mod_import
      ) {
        if (
          ['text', 'decl', 'struct_assign'].includes(this.block_state) &&
          this.re_decl.test(line.trim())
        ) {
          this.block_state = 'decl';
        } else if (
          ['module', 'instance', 'text', 'package', 'decl'].includes(this.block_state) ||
          (['struct', 'struct_assign', 'enum'].includes(this.block_state) && this.state !== '{')
        ) {
          let block_tmp: string;
          if (this.block_state === 'module') {
            block_tmp = this.alignModulePort(block + line, ilvl - 1);
            line = '';
            block_ended = true;
          } else if (this.settings.reindentOnly) {
            block_tmp = block + line;
            line = '';
          } else if (this.block_state === 'instance') {
            block_tmp = this.alignInstance(block + line, ilvl);
            line = '';
          } else if (this.block_state === 'struct') {
            block_tmp = this.alignDecl(block + line);
            line = '';
          } else if (this.block_state === 'struct_assign') {
            block_tmp = this.alignAssign(block + line, 1);
            line = '';
          } else if (this.block_state === 'enum') {
            block_tmp = this.alignAssign(block + line, 4);
            line = '';
          } else if (this.block_state === 'decl') {
            block_tmp = this.alignDecl(block);
          } else {
            block_tmp = block + line;
            line = '';
          }
          if (!block_tmp) {
            console.warn(`[Beautify: ERROR] Unable to extract a ${this.block_state} from "${block}"`);
          } else {
            block = block_tmp;
          }
          this.block_state = '';
          block_handled = true;
        }
      }
      // Handle end of state
      if (state_end) {
        if (this.block_state === 'generate') {
          let block_tmp = block;
          if (!this.settings.reindentOnly) {
            const rx = new RegExp(this.re_inst.source, 'gm');
            let m: RegExpExecArray | null;
            while ((m = rx.exec(block.slice(9))) !== null) {
              if (
                m.groups &&
                !['else', 'begin', 'end'].includes(m.groups.itype) &&
                !['if', 'for', 'foreach'].includes(m.groups.iname)
              ) {
                const inst_start = 9 + m.index;
                const inst_end = block.indexOf(';', inst_start) + 1;
                if (inst_end > inst_start) {
                  const inst_block = block.slice(inst_start, inst_end);
                  const inst_ilvl = this.getIndentLevel(inst_block);
                  const inst_block_aligned = this.alignInstance(inst_block, inst_ilvl);
                  block_tmp = block_tmp.split(inst_block).join(inst_block_aligned);
                }
              }
            }
          }
          block = block_tmp;
          block_handled = true;
        } else if (['endtask', 'endfunction', 'endsequence', 'endproperty', 'endclass'].includes(w)) {
          if (this.settings.reindentOnly) {
            block = block + line;
          } else {
            block = this.alignAssign(block + line, 1);
          }
          line = '';
          block_handled = true;
        }
        if (wd(-1) !== '\n') {
          this.stateUpdate();
          if (ilvl <= 0) {
            console.warn(
              `[Beautify] Block end with already no indentation ! Line ${String(line_cnt).padStart(4)}`
            );
          }
          ilvl -= 1;
          if (split.has(ilvl) && ['end', 'endcase'].includes(w)) {
            last_split = split.get(ilvl)!;
            split.delete(ilvl);
            split_else = w === 'end' && last_split[1].includes(':');
          }
        }
      } else if (this.state === 'comment_block') {
        if (wd(-1) === '*' && w === '/') {
          this.stateUpdate();
          block += line;
          line = '';
          if (!this.block_state) {
            block_handled = true;
          }
        }
      } else if (this.state === 'attribute') {
        if (wd(-1) === '*' && w === ')') {
          if (ilvl > 0) {
            ilvl -= 1;
          }
          this.stateUpdate();
          block += line;
          line = '';
          if (!this.block_state) {
            block_handled = true;
          }
        }
      } else if (this.state === 'string') {
        if (w === '"') {
          this.stateUpdate();
          block += line;
          line = '';
          if (!this.block_state) {
            block_handled = true;
          }
        }
      } else if (!['comment_line', 'ignore_line', 'attribute'].includes(this.state)) {
        if (wd(-1) === '/') {
          if (w === '/') {
            this.stateUpdate('comment_line');
            block_ended = false;
          } else if (w === '*') {
            this.stateUpdate('comment_block');
            block_ended = false;
          }
          if (['//', '/*'].includes(line.trim()) && !has_indent) {
            line = line.trim();
          }
        } else if (wd(-1) === '(' && w === '*') {
          if (this.states.length > 0 && this.states[this.states.length - 1] === '(') {
            this.states.pop();
          }
          this.stateUpdate('attribute');
          block_ended = false;
        } else if (w === '"') {
          this.stateUpdate('string');
        }
      }
      // Handle always block_state
      if (this.block_state === 'always' && (!this.state || ['module', 'interface'].includes(this.state))) {
        const tmp = cleanComment(block + line).trim();
        const m = tmp.match(/^\s*always\w*\s+(@\s*(\*|\([^\)]*\)))?\s*begin/);
        if ((m && w === 'end') || (['else', ''].includes(this.always_state) && ['end', ';'].includes(w))) {
          if (this.settings.reindentOnly) {
            block += line;
          } else {
            block = this.alignAssign(block + line, 7);
          }
          line = '';
          block_handled = true;
          this.always_state = '';
          split_always = 0;
        } else if (!m) {
          if (w === 'else') {
            this.always_state = 'else';
          } else if (this.always_state === 'expect_else' && w.trim() && w !== '/') {
            block = block + line;
            const last_sc = block.lastIndexOf(';') + 1;
            let last_end = block.lastIndexOf('end') + 3;
            if (last_end < last_sc) {
              last_end = last_sc;
            }
            line = block.slice(last_end);
            block = block.slice(0, last_end);
            // remove extra indent when the always end block is discovered too late
            if (split_always === 1) {
              line = line.replace(new RegExp('^' + this.indent, 'gm'), '');
              this.block_state = '';
              const action = this.processWord(w, w_d, state_end, line);
              if (action.startsWith('incr_ilvl')) {
                ilvl += 1;
                if (action === 'incr_ilvl_flush') {
                  txt_new += block;
                  block = line;
                  line = '';
                }
              }
            }
            if (!this.settings.reindentOnly) {
              block = this.alignAssign(block, 7);
            }
            if (!w.startsWith('always')) {
              this.always_state = '';
            }
            txt_new += block;
            block = '';
            split_always = 0;
          } else if (w === 'if') {
            this.always_state = 'if';
          } else if (this.always_state === 'if' && ['end', ';'].includes(w)) {
            this.always_state = 'expect_else';
          }
        }
      }
      // Add block to the text
      if (block_handled) {
        txt_new += block;
        block = '';
        this.block_state = '';
        block_handled = false;
      }
      // Keep previous words
      if (w.trim() || wd(-1) !== '\n') {
        w_d[0] = w_d[1];
        w_d[1] = w_d[2];
        w_d[2] = w_d[3];
        w_d[3] = w;
      }
    }
    block = block + line;
    if (
      ['module', 'instance', 'text', 'package', 'decl', 'assign'].includes(this.block_state) ||
      (['struct', 'struct_assign', 'enum'].includes(this.block_state) && this.state !== '{')
    ) {
      let block_tmp: string;
      if (this.block_state === 'module') {
        block_tmp = this.alignModulePort(block, ilvl - 1);
      } else if (this.settings.reindentOnly) {
        block_tmp = block;
      } else if (this.block_state === 'instance') {
        block_tmp = this.alignInstance(block, ilvl);
      } else if (this.block_state === 'struct') {
        block_tmp = this.alignDecl(block);
      } else if (this.block_state === 'assign') {
        block_tmp = this.alignAssign(block, 2);
      } else if (this.block_state === 'struct_assign') {
        block_tmp = this.alignAssign(block, 1);
      } else if (this.block_state === 'decl') {
        block_tmp = this.alignDecl(block);
      } else {
        block_tmp = block;
      }
      if (!block_tmp) {
        console.warn(`[Beautify: ERROR] Unable to extract a ${this.block_state} from "${block}"`);
      } else {
        block = block_tmp;
      }
    }
    txt_new += block;
    return txt_new;
  }

  processWord(w: string, w_prev: string[], state_end: boolean, txt: string): string {
    const wp = (n: number) => w_prev[4 + n];
    if (this.kw_block.includes(w)) {
      if (
        ['extern', 'cover', 'assert', 'pure'].includes(wp(-2)) ||
        (['extern', 'pure'].includes(wp(-4)) && wp(-2) === 'virtual') ||
        wp(-2) === '"'
      ) {
        return '';
      }
      if (['function', 'task'].includes(w) && ['import', 'export'].includes(wp(-2))) {
        return '';
      }
      if (w.startsWith('case')) {
        this.stateUpdate('case');
      } else {
        this.stateUpdate(w);
      }
      if (['module', 'package', 'generate', 'function', 'task', 'property', 'sequence', 'checker'].includes(w)) {
        this.block_state = w;
        return 'incr_ilvl_flush';
      } else {
        return 'incr_ilvl';
      }
    }
    if (!this.block_state) {
      if (w === 'assign') {
        this.block_state = w;
      } else if (w.startsWith('always')) {
        this.block_state = 'always';
        this.always_state = '';
      } else if (wp(-1) === '\n' && w !== '/' && !state_end) {
        this.block_state = 'text';
      }
    } else if (this.block_state === 'text') {
      const tmp = cleanComment(txt).trim();
      const m = tmp.match(this.re_inst);
      if (
        m &&
        m.index === 0 &&
        m.groups &&
        !['else', 'begin', 'end', 'assert', 'cover'].includes(m.groups.itype) &&
        !['if', 'for', 'foreach'].includes(m.groups.iname)
      ) {
        this.block_state = 'instance';
      } else if (/^\s*\b(typedef\s+)?(struct|union)\b/.test(tmp)) {
        this.block_state = 'struct';
      } else if (/^\s*\b(typedef\s+)?(enum)\b/.test(tmp)) {
        this.block_state = 'enum';
      } else if (/^[\s\S]*=\s*'\{/.test(tmp)) {
        this.block_state = 'struct_assign';
      }
    }
    return '';
  }

  alignModulePort(txt: string, ilvl: number): string {
    const m = txt.match(
      /(?<module>^[ \t]*module)\s*(?<mname>\w+)(?<import>\s+import\s+[\s\S]*?;)?\s*(?<paramsfull>#\s*\(\s*(?<params>[\s\S]*?)\s*\))?\s*(\(\s*(?<ports>[\s\S]*)\s*\))?\s*;$/m
    );
    if (!m || !m.groups) {
      return '';
    }
    let txt_new = this.indent.repeat(ilvl) + 'module ' + m.groups.mname.trim();
    if (m.groups.import) {
      const imports = m.groups.import.trim().split('\n');
      if (imports.length === 1 && this.settings.importSameLine) {
        txt_new += ' ' + imports[0].trim() + ' ';
      } else {
        txt_new += '\n';
        for (const i of imports) {
          txt_new += this.indent.repeat(ilvl + 1) + i.trim() + '\n';
        }
      }
    }
    if (m.groups.params) {
      const param_txt = m.groups.params.trim();
      const re_param_str =
        '^[ \\t]*(?:(?<parameter>parameter|localparam)\\s+)?(?<type>[\\w\\:]+\\b)?[ \\t]*(?<sign>signed|unsigned\\b)?[ \\t]*(?<bw>(?:\\[' +
        reBw +
        '\\][ \\t]*)*)[ \\t]*(?<param>\\w+)\\b\\s*=\\s*(?<value>[^\\n]*?)(?<comment>$|//.*?$)';
      const re_param = new RegExp(re_param_str, 'gm');
      const re_param_search = new RegExp(re_param_str, 'm');
      const decl: (string | undefined)[][] = [];
      let mm: RegExpExecArray | null;
      while ((mm = re_param.exec(param_txt)) !== null) {
        const gd = mm.groups as any;
        decl.push([
          gd.parameter ?? '',
          gd.type ?? '',
          gd.sign ?? '',
          gd.bw ?? '',
          gd.param ?? '',
          gd.value ?? '',
          gd.comment ?? '',
        ]);
      }
      const len_bw_a: number[] = [];
      let len_kw = 0;
      let len_type = 0;
      let len_sign = 0;
      let len_param = 0;
      let len_value = 0;
      let len_comment = 0;
      let has_param = false;
      let last_param = 'parameter';
      let has_param_all = false;
      if (decl.length === 0) {
        len_kw = 0;
        len_type = 0;
        len_sign = 0;
        len_param = 0;
        len_value = 0;
        len_comment = 0;
        has_param = false;
        last_param = 'parameter';
      } else {
        const values = decl.map((x) => cleanComment(splitOnComma(x[5] as string)[0]).trim());
        len_kw = Math.max(...decl.map((x) => (x[0] as string).length));
        len_type = Math.max(...decl.map((x) => (x[1] as string).length));
        len_sign = Math.max(...decl.map((x) => (x[2] as string).length));
        len_param = Math.max(...decl.map((x) => (x[4] as string).length));
        len_value = Math.max(...values.map((x) => x.length));
        len_comment = Math.max(...decl.map((x) => (x[6] as string).length));
        const has_param_list = decl.map((x) => x[0]).filter((x) => x !== '');
        has_param_all = has_param_list.length === decl.length;
        has_param = has_param_list.length > 0;
        last_param = has_param_list.length === 0 ? 'parameter' : (has_param_list[0] as string);
        const port_bw_l = decl.map((x) =>
          innerGroups((x[3] as string).replace(/\s/g, ''), /\[(.+?)\]/g)
        );
        if (port_bw_l.length > 0) {
          for (const x of port_bw_l) {
            x.forEach((y, i) => {
              if (i >= len_bw_a.length) {
                len_bw_a.push(y.length);
              } else if (len_bw_a[i] < y.length) {
                len_bw_a[i] = y.length;
              }
            });
          }
        }
      }
      const len_bw = len_bw_a.reduce((a, b) => a + b, 0) + 2 * len_bw_a.length;

      if (m.groups.import) {
        txt_new += this.indent.repeat(ilvl) + '#(';
      } else {
        txt_new += ' #(';
      }
      if (has_param && !has_param_all) {
        txt_new += 'parameter';
      }
      if (param_txt.includes('\n') || !this.settings.paramOneLine) {
        txt_new += '\n';
        const lines = splitlines(param_txt);
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i].trim();
          if (i === 0 && l === last_param) {
            continue;
          }
          let l_new = this.indent.repeat(ilvl + 1);
          const m_param = re_param_search.exec(l);
          if (!m_param || !m_param.groups || this.settings.reindentOnly) {
            l_new += l;
          } else {
            const gp = m_param.groups as any;
            if (gp.parameter) {
              last_param = gp.parameter;
            }
            if (has_param_all) {
              l_new += last_param.padEnd(len_kw + 1);
            }
            if (len_type > 0) {
              if (gp.type) {
                if (!['signed', 'unsigned'].includes(gp.type)) {
                  l_new += gp.type.padEnd(len_type + 1);
                } else {
                  l_new += ''.padEnd(len_type + 1) + gp.type.padEnd(len_sign + 1);
                }
              } else {
                l_new += ''.padEnd(len_type + 1);
              }
            }
            if (len_sign > 0) {
              if (gp.sign) {
                l_new += gp.sign.padEnd(len_sign + 1);
              } else {
                l_new += ''.padEnd(len_sign + 1);
              }
            }
            if (len_bw > 0) {
              let s = '';
              if (gp.bw) {
                const bw_a = innerGroups(gp.bw.replace(/\s/g, ''), /\[(.+?)\]/g);
                bw_a.forEach((bw, k) => {
                  s += '[' + bw.padStart(len_bw_a[k]) + ']';
                });
              }
              l_new += s.padEnd(len_bw + 1);
            }
            l_new += gp.param.padEnd(len_param);
            const values = splitOnComma(gp.value).map((x) => cleanComment(x).trim());
            const v = cleanComment(gp.value).trim();
            const has_sep = v.endsWith(',');
            l_new += ' = ' + values[0].padEnd(len_value);
            if (this.settings.alignComma) {
              if ((has_sep && i !== lines.length - 1) || values.length > 1) {
                l_new += ',';
              } else {
                l_new += ' ';
              }
            } else {
              const l_tmp = l_new.replace(/\s+$/, '');
              const nb_pad = l_new.length - l_tmp.length;
              let sep: string;
              if (i !== lines.length - 1 || values.length > 1) {
                sep = ',';
              } else {
                sep = ' ';
              }
              l_new = l_tmp + sep + ' '.repeat(nb_pad);
            }
            if (values.length > 1) {
              for (let j = 0; j < values.length - 1; j++) {
                l_new += ' ' + values[j + 1];
              }
            }
            if (gp.comment) {
              l_new += ' ' + gp.comment;
            }
          }
          if (!this.settings.stripEmptyLine || l_new.trim() !== '') {
            txt_new += l_new.replace(/\s+$/, '') + '\n';
          }
        }
      } else {
        if (has_param && !has_param_all) {
          txt_new += ' ';
        }
        txt_new += param_txt;
        if (len_comment > 0) {
          txt_new += '\n' + this.indent.repeat(ilvl);
        }
      }
      txt_new += ')';
    }
    if (!m.groups.ports) {
      if (!this.settings.reindentOnly) {
        txt_new += ' ()';
      }
      return txt_new + ';';
    }
    if (txt_new[txt_new.length - 1] !== '\n') {
      txt_new += ' ';
    }
    txt_new += '(\n';
    const re_str =
      '^[ \\t]*(?<dir>[\\w\\.]+)[ \\t]+(?<var>var|ref\\b)?[ \\t]*(?<type>[\\w\\:]+\\b)?[ \\t]*(?<sign>signed|unsigned\\b)?[ \\t]*(?<bw>(?:\\[' +
      reBw +
      '\\][ \\t]*)*)[ \\t]*(?<ports>(?<port1>\\w+)[\\w, \\t\\[\\]\\*\\-\\+\\$\\(\\)\\\'\\:)]*)[ \\t]*(?<comment>.*)';
    const regex = new RegExp(re_str, 'gm');
    const txt_port = m.groups.ports.replace(/[ \t]*,[ \t]*(input|output|inout)\b[ \t]+/g, ',\n$1 ');
    const decl: any[] = [];
    let dm: RegExpExecArray | null;
    while ((dm = regex.exec(txt_port)) !== null) {
      const gd = dm.groups as any;
      decl.push({
        dir: gd.dir ?? '',
        var: gd.var ?? '',
        type: gd.type ?? '',
        sign: gd.sign ?? '',
        bw: gd.bw ?? '',
        ports: gd.ports ?? '',
        port1: gd.port1 ?? '',
        comment: gd.comment ?? '',
      });
    }
    const port_dir_l = decl.filter((x) => portDir.includes(x.dir)).map((x) => x.dir);
    const port_if_l = decl.filter((x) => !portDir.includes(x.dir)).map((x) => x.dir);
    let len_dir = 0;
    if (port_dir_l.length) {
      len_dir = Math.max(...port_dir_l.map((x) => x.length));
    }
    let len_if = 0;
    if (port_if_l.length) {
      len_if = Math.max(...port_if_l.map((x) => x.length));
    }
    let len_var = 0;
    for (const x of decl) {
      if (x.var !== '') {
        len_var = 3;
      }
    }
    const port_bw_l = decl.map((x) =>
      innerGroups((x.bw as string).replace(/\s/g, ''), /\[(.+?)\]/g)
    );
    const len_bw_a: number[] = [];
    if (port_bw_l.length > 0) {
      for (const x of port_bw_l) {
        x.forEach((y, i) => {
          if (i >= len_bw_a.length) {
            len_bw_a.push(y.length);
          } else if (len_bw_a[i] < y.length) {
            len_bw_a[i] = y.length;
          }
        });
      }
    }
    const len_bw = len_bw_a.reduce((a, b) => a + b, 0) + 2 * len_bw_a.length;
    let max_port_len = 0;
    const port_l: string[] = [];
    for (const x of decl) {
      let s = (x.ports as string).trim();
      if (s.endsWith(',')) {
        s = s.slice(0, -1).trim();
      }
      if (s.includes(',')) {
        s = x.port1;
      }
      port_l.push(s);
    }
    max_port_len = Math.max(...port_l.map((x) => x.length));
    let len_sign = 0;
    let len_type = 0;
    let len_type_user = 0;
    for (const x of decl) {
      if (x.sign === '' && x.bw === '' && !['logic', 'wire', 'reg', 'signed', 'unsigned'].includes(x.type)) {
        if (len_type_user < (x.type as string).length) {
          len_type_user = (x.type as string).length;
        }
      } else {
        if (len_type < (x.type as string).length && !['signed', 'unsigned'].includes(x.type)) {
          len_type = (x.type as string).length;
        }
      }
      if (['signed', 'unsigned'].includes(x.type) && len_sign < (x.type as string).length) {
        len_sign = (x.type as string).length;
      } else if (['signed', 'unsigned'].includes(x.sign) && len_sign < (x.sign as string).length) {
        len_sign = (x.sign as string).length;
      }
    }
    let len_type_full = len_type;
    if (len_var > 0 || len_bw > 0 || len_sign > 0) {
      if (len_type > 0) {
        len_type_full += 1;
      }
      if (len_var > 0) {
        len_type_full += 4;
      }
      if (len_bw > 0) {
        len_type_full += len_bw;
      }
      if (len_sign > 0) {
        len_type_full += 1 + len_sign;
      }
    }
    let max_len = len_type_full;
    if (len_type_user < len_type_full) {
      len_type_user = len_type_full;
    } else {
      max_len = len_type_user;
    }
    if (len_if < max_len + len_dir + 1) {
      len_if = max_len + len_dir + 1;
    } else {
      max_len = len_if - len_dir - 1;
    }
    if (len_type_user < max_len) {
      len_type_user = max_len;
    }
    if (len_var > 0) {
      len_type_user -= len_var + 1;
    }
    const lines = splitlines(txt_port);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const l = line.trim();
      if (this.settings.ignoreTick && l.startsWith('`')) {
        txt_new += line + '\n';
      } else if ((i !== lines.length - 1 && i !== 0 && (!this.settings.stripEmptyLine || l !== '')) || l !== '') {
        const m_port = new RegExp(re_str).exec(l);
        let l_new = this.indent.repeat(ilvl + 1);
        if (this.settings.reindentOnly) {
          l_new += l;
        } else if (m_port && m_port.groups) {
          const gp = m_port.groups as any;
          if (portDir.includes(gp.dir)) {
            l_new += gp.dir.padEnd(len_dir);
            if (len_var > 0) {
              if (gp.var) {
                l_new += ' ' + gp.var;
              } else {
                l_new += ' '.padEnd(len_var + 1);
              }
            }
            if (gp.sign || gp.bw || ['logic', 'wire', 'reg', 'signed', 'unsigned'].includes(gp.type)) {
              if (len_type > 0) {
                if (gp.type) {
                  if (!['signed', 'unsigned'].includes(gp.type)) {
                    l_new += ' ' + gp.type.padEnd(len_type);
                  } else {
                    l_new += ''.padEnd(len_type + 1) + ' ' + gp.type.padEnd(len_sign);
                  }
                } else {
                  l_new += ''.padEnd(len_type + 1);
                }
                if (len_sign > 0) {
                  if (gp.sign) {
                    l_new += ' ' + gp.sign.padEnd(len_sign);
                  } else if (!['signed', 'unsigned'].includes(gp.type)) {
                    l_new += ''.padEnd(len_sign + 1);
                  }
                }
              } else if (len_sign > 0) {
                if (['signed', 'unsigned'].includes(gp.type)) {
                  l_new += ' ' + gp.type.padEnd(len_sign);
                } else if (gp.sign) {
                  l_new += ' ' + gp.sign.padEnd(len_sign);
                } else {
                  l_new += ''.padEnd(len_sign + 1);
                }
              }
              if (len_bw > 1) {
                let s = '';
                if (gp.bw) {
                  s = ' ';
                  const bw_a = innerGroups((gp.bw as string).replace(/\s/g, ''), /\[(.+?)\]/g);
                  bw_a.forEach((bw, k) => {
                    s += '[' + bw.padStart(len_bw_a[k]) + ']';
                  });
                }
                l_new += s.padEnd(len_bw + 1);
              }
              if (max_len > len_type_full) {
                l_new += ''.padEnd(max_len - len_type_full);
              }
            } else if (gp.type) {
              l_new += ' ' + gp.type.padEnd(len_type_user);
            } else if (len_type_user > 0) {
              l_new += ' '.padEnd(len_type_user + 1);
            }
          } else {
            l_new += gp.dir.padEnd(len_if);
          }
          const s = (gp.ports as string).replace(/\s+$/, '').replace(/\s*,\s*/g, ', ');
          l_new += ' ';
          if (s.endsWith(', ')) {
            let nb_pad = 0;
            if (this.settings.alignComma) {
              l_new += s.slice(0, -2).padEnd(max_port_len);
            } else {
              l_new += s.slice(0, -2);
              nb_pad = max_port_len - s.slice(0, -2).length;
            }
            if (i !== lines.length - 1) {
              l_new += ',';
            }
            if (nb_pad > 0) {
              l_new += ' '.repeat(nb_pad);
            }
          } else {
            l_new += s.padEnd(max_port_len) + ' ';
          }
          if (gp.comment) {
            l_new += ' ' + gp.comment;
          }
        } else {
          const m_comment = l.match(/\s*\/\/.*/);
          if (m_comment) {
            const ilvl_comment = this.getIndentLevel(line);
            if (ilvl_comment > ilvl + 2) {
              l_new += ''.padStart(len_if + 1 + max_port_len + 2) + l;
            } else {
              l_new += l;
            }
          } else {
            l_new += l;
          }
        }
        txt_new += l_new.replace(/[ \t]+$/, '') + '\n';
      }
    }
    txt_new += this.indent.repeat(ilvl) + ');';
    return txt_new;
  }

  alignAssign(txt: string, mask_op: number): string {
    const re_str_l: string[] = [];
    if (mask_op & 1) {
      re_str_l.push(
        '^[ \\t]*(?<scope>\\w+\\:\\:)?(?<name>[\\w`\'"\\.\\?]+)[ \\t]*(\\[(?<bitslice>.*?)\\])?\\s*(?<op>\\:(?!\\:))\\s*(?<statement>.*)$'
      );
    }
    if (mask_op & 2) {
      re_str_l.push(
        '^[ \\t]*(?<scope>assign)\\s+(?<name>[\\w`\'"\\.]+)[ \\t]*(\\[(?<bitslice>.*?)\\])?\\s*(?<op>=)\\s*(?<statement>.*)$'
      );
    }
    if (mask_op & 4) {
      re_str_l.push(
        '^[ \\t]*(?<scope>)(?<name>[\\w`\'"\\.]+)[ \\t]*(\\[(?<bitslice>.*?)\\])?\\s*(?<op>(<)?=)\\s*(?<statement>.*)$'
      );
    }
    let txt_new = txt;
    for (let i = 0; i < re_str_l.length; i++) {
      const re_str = re_str_l[i];
      const lines = splitlines(txt_new);
      const lines_match: [string, RegExpExecArray | null, number, number][] = [];
      let matched = false;
      let ilvl = -1;
      let ilvl_prev = -1;
      const max_len: Record<number, number> = {};
      let max_len_idx = -1;
      let ilvl_glob = false;
      if (mask_op & 1 && i === 0 && txt.trim().endsWith(';') && !txt.trim().startsWith('always')) {
        ilvl_glob = true;
      }
      for (const l of lines) {
        const m = new RegExp(re_str).exec(l);
        ilvl_prev = ilvl;
        ilvl = this.getIndentLevel(l);
        if (ilvl_glob) {
          max_len_idx = ilvl;
        } else if (ilvl !== ilvl_prev) {
          max_len_idx += 1;
        }
        if (!(max_len_idx in max_len)) {
          max_len[max_len_idx] = 0;
        }
        if (m && m.groups) {
          matched = true;
          let len_c = m.groups.name.length;
          if (m.groups.scope) {
            len_c += m.groups.scope.length;
            if (m.groups.scope === 'assign') {
              len_c += 1;
            }
          }
          if (m.groups.bitslice) {
            len_c += m.groups.bitslice.replace(/\s/g, '').length + 2;
          }
          if (len_c > max_len[max_len_idx]) {
            max_len[max_len_idx] = len_c;
          }
        }
        lines_match.push([l, m, ilvl, max_len_idx]);
      }
      if (matched) {
        txt_new = '';
        for (const [line, m, t_ilvl, len_idx] of lines_match) {
          let l: string;
          if (m && m.groups) {
            l = '';
            if (m.groups.scope) {
              l += m.groups.scope;
              if (m.groups.scope === 'assign') {
                l += ' ';
              }
            }
            l += m.groups.name;
            if (m.groups.bitslice) {
              l += '[' + m.groups.bitslice.replace(/\s/g, '') + ']';
            }
            l = this.indent.repeat(t_ilvl) + l.padEnd(max_len[len_idx]) + ' ' + m.groups.op + ' ' + m.groups.statement;
          } else {
            l = line;
          }
          txt_new += l.replace(/\s+$/, '') + '\n';
        }
        if (!txt.endsWith('\n')) {
          txt_new = txt_new.slice(0, -1);
        }
      }
    }
    return txt_new;
  }

  alignInstance(txt: string, ilvl: number): string {
    const m = txt.match(
      /(?<emptyline>\n*)(?<mtype>^[ \t]*(bind\s+[\w\.]+\s+)?\w+)\s*(?<paramsfull>#\s*\((?<params>[\s\S]*)\s*\))?\s*(?<mname>\w+)\s*\(\s*(?<ports>[\s\S]*)\s*\)\s*;(?<comment>.*)$/m
    );
    if (!m || !m.groups) {
      return '';
    }
    let txt_new = m.groups.emptyline + this.indent.repeat(ilvl) + m.groups.mtype.trim();
    if (m.groups.params) {
      txt_new += ' #(';
      if (m.groups.params.trim().includes('\n') || !this.settings.paramOneLine) {
        txt_new += '\n' + this.alignInstanceBinding(m.groups.params, ilvl + 1) + this.indent.repeat(ilvl);
      } else {
        let p = m.groups.params.trim();
        p = p.replace(/\s+/g, '');
        p = p.replace(/\),/g, '), ');
        txt_new += p;
      }
      txt_new += ')';
    }
    txt_new += ' ' + m.groups.mname + ' (';
    if (m.groups.ports) {
      if (!m.groups.ports.startsWith('.*') && m.groups.ports.replace(/\s+$/, '').includes('\n')) {
        txt_new += '\n';
      }
      if (m.groups.ports.trim().includes('\n')) {
        txt_new += this.alignInstanceBinding(m.groups.ports, ilvl + 1);
        txt_new += this.indent.repeat(ilvl);
      } else {
        let p = m.groups.ports.trim();
        p = p.replace(/\s+/g, '');
        p = p.replace(/\),/g, '), ');
        txt_new += p;
      }
    }
    txt_new += ');';
    if (m.groups.comment) {
      txt_new += ' ' + m.groups.comment;
    }
    return txt_new;
  }

  alignInstanceBinding(txt: string, ilvl: number): string {
    let was_split = false;
    if (this.settings.oneBindPerLine) {
      txt = txt.replace(/\)[ \t]*,[ \t]*\./g, '), \n.');
    }
    const re_str_bind_port = '^[ \\t]*(?<lcomma>,)?[ \\t]*\\.\\s*(?<port>\\w+)\\s*\\(\\s*';
    const re_str_bind_sig = '(?<signal>.*?)\\s*\\)\\s*(?<comma>,)?\\s*(?<comment>\\/\\/.*?|\\/\\*.*?)?$';
    const re_str_bind_implicit = '^[ \\t]*(?<lcomma>,)?[ \\t]*\\.\\s*(?<port>\\w+)\\s*(,|\\/\\/.*?|$(?![\\s\\S]))';
    const binds = findAllGroups(new RegExp(re_str_bind_port + re_str_bind_sig, 'gm'), txt);
    let max_port_len = 0;
    let max_sig_len = 0;
    const ports_len = binds.map((x) => (x[1] ? x[1].length : 0));
    const sigs_len = binds.map((x) => (x[2] ? x[2].trim().length : 0));
    let ports_impl: string[] | null = null;
    const binds_impl = findAllGroups(new RegExp(re_str_bind_implicit, 'gm'), txt);
    if (binds_impl.length) {
      ports_impl = binds_impl.map((x) => x[1] as string);
    }
    if (ports_len.length && this.settings.instAlignPort) {
      max_port_len = Math.max(...ports_len);
      if (binds_impl.length) {
        const ports_impl_len = binds_impl.map((x) => (x[1] ? x[1].length : 0));
        const max_port_len_impl = Math.max(...ports_impl_len);
        if (max_port_len_impl > max_port_len) {
          max_port_len = max_port_len_impl;
        }
      }
    }
    if (sigs_len.length && this.settings.instAlignPort) {
      max_sig_len = Math.max(...sigs_len);
    }
    const lines = splitlines(txt.trim());
    let txt_new = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const l = line.trim();
      let is_split = false;
      if ((i !== lines.length - 1 && i !== 0) || l !== '') {
        let m = new RegExp('^' + re_str_bind_port + re_str_bind_sig).exec(l);
        if (!m) {
          m = new RegExp(re_str_bind_port + '(?<signal>.*?)\\s*(?<comma>)(?<comment>)$').exec(l);
          if (m) {
            is_split = true;
          } else if (ports_impl) {
            m = new RegExp('^[ \\t]*\\.\\s*(?<port>\\w+)\\s*(?<comma>,)?(?<comment>\\/\\/.*?|\\/\\*.*?)?').exec(l);
            if (m) {
              if (!ports_impl.includes(m.groups!.port)) {
                m = null;
              }
            }
          }
        }
        if (m && m.groups) {
          const gp = m.groups as any;
          txt_new += this.indent.repeat(ilvl);
          txt_new += '.' + gp.port.padEnd(max_port_len);
          if ('signal' in gp) {
            txt_new += '(' + (gp.signal as string).trim().padEnd(max_sig_len);
          } else if (max_sig_len > 0 && i !== lines.length - 1) {
            txt_new += ''.padEnd(max_sig_len + 2);
          }
          if (!is_split) {
            if ('signal' in gp) {
              txt_new += ')';
            }
            if (i !== lines.length - 1) {
              txt_new += ',';
            }
          }
          if ('comment' in gp && gp.comment) {
            if (txt_new[txt_new.length - 1] !== ',') {
              txt_new += ' ';
            }
            txt_new += ' ' + gp.comment;
          }
        } else {
          txt_new += this.indent.repeat(ilvl);
          if (was_split) {
            txt_new += ''.padEnd(max_port_len + 2);
            const mm = new RegExp(re_str_bind_sig).exec(l);
            if (mm && mm.groups) {
              if (mm.groups.signal) {
                txt_new += (mm.groups.signal as string).trim().padEnd(max_sig_len) + ')';
              } else {
                txt_new += ''.padEnd(max_sig_len) + ')';
              }
              if (mm.groups.comma && i !== lines.length - 1) {
                txt_new += ', ';
              } else {
                txt_new += '  ';
              }
              if (mm.groups.comment) {
                txt_new += mm.groups.comment;
              }
            } else {
              txt_new += l;
            }
          } else {
            txt_new += l;
          }
        }
        was_split = is_split;
        txt_new += '\n';
      }
    }
    return txt_new;
  }

  alignDecl(txt: string): string {
    const lines = splitlines(txt);
    const lines_match: [string, RegExpExecArray | null, number][] = [];
    const len_max: Record<number, any> = {};
    const one_decl_per_line = this.settings.oneDeclPerLine;
    for (const l of lines) {
      const m = this.re_decl.exec(l);
      if (m && m.groups) {
        const ilvl = this.getIndentLevel(l);
        if (!(ilvl in len_max)) {
          len_max[ilvl] = {
            param: 0,
            scope: 0,
            type: 0,
            type_full: 0,
            type_user: 0,
            type_user_pa: 0,
            sign: 0,
            bw: [],
            name: 0,
            array: [],
            array_sum: 0,
            bw_sum: 0,
            sig_list: 0,
            comment: 0,
            init: 0,
          };
        }
        let len_full = 0;
        const len_ba: Record<string, number> = { bw: 0, array: 0 };
        let typeKind = 'type';
        for (const [k, g] of Object.entries(m.groups)) {
          if (g) {
            const w = (g as string).trim();
            if (k === 'array' || k === 'bw') {
              const port_bw_l = innerGroups(w.replace(/\s/g, ''), /\[(.+?)\]/g);
              port_bw_l.forEach((y, i) => {
                len_ba[k] += y.length + 2;
                if (i >= len_max[ilvl][k].length) {
                  len_max[ilvl][k].push(y.length);
                } else if (len_max[ilvl][k][i] < y.length) {
                  len_max[ilvl][k][i] = y.length;
                }
              });
            } else if (k === 'type') {
              len_full = w.length;
              if (!['logic', 'wire', 'reg', 'bit', 'int', 'integer'].includes(w)) {
                typeKind = m.groups.bw ? 'type_user_pa' : 'type_user';
              } else {
                typeKind = 'type';
              }
              if (len_full > len_max[ilvl][typeKind]) {
                len_max[ilvl][typeKind] = len_full;
              }
            } else if (w.length > len_max[ilvl][k]) {
              len_max[ilvl][k] = w.length;
            }
            if (k === 'sig_list' && one_decl_per_line) {
              for (const s of w.split(',')) {
                if (s.trim().length > len_max[ilvl]['name']) {
                  len_max[ilvl]['name'] = s.trim().length;
                }
              }
            }
          }
        }
        if (len_full > 0) {
          if (m.groups.sign) {
            len_full += 1 + m.groups.sign.trim().length;
          }
          if (len_ba['bw'] !== 0) {
            len_full += 1 + len_ba['bw'];
          }
          if (typeKind !== 'type' && m.groups.scope) {
            len_full += m.groups.scope.trim().length;
          }
          if (len_full > len_max[ilvl]['type_full']) {
            len_max[ilvl]['type_full'] = len_full;
          }
        }
        lines_match.push([l, m, ilvl]);
      } else {
        lines_match.push([l, m, 0]);
      }
    }
    for (const k of Object.keys(len_max)) {
      const x = len_max[k as any];
      x.array_sum = 0;
      x.bw_sum = 0;
      for (const y of x.array) {
        x.array_sum += 2 + y;
      }
      for (const y of x.bw) {
        x.bw_sum += 2 + y;
      }
      if (x.type_user_pa > x.type) {
        x.type = x.type_user_pa;
      }
    }
    let txt_new = '';
    for (const [line, m, ilvl] of lines_match) {
      let l: string;
      if (m && m.groups) {
        const g = m.groups as any;
        l = this.indent.repeat(ilvl);
        const is_usertype = !['logic', 'wire', 'reg', 'bit', 'int', 'integer'].includes(g.type);
        let len_type_full = len_max[ilvl]['type_full'] + 1;
        let len_type = len_max[ilvl]['type'] + 1;
        let t = '';
        if (g.param) {
          t += (g.param as string).padEnd(len_max[ilvl]['param'] + 1);
          len_type_full += len_max[ilvl]['param'] + 1;
        } else if (len_max[ilvl]['param'] !== 0) {
          len_type += len_max[ilvl]['param'] + 1;
        }
        if (is_usertype) {
          if (g.scope) {
            t += g.scope + g.type;
          } else {
            t += g.type;
          }
          if (g.bw) {
            t = t.padEnd(len_type);
            let s = '';
            const bw_a = innerGroups((g.bw as string).replace(/\s/g, ''), /\[(.+?)\]/g);
            bw_a.forEach((bw, i) => {
              s += '[' + bw.padStart(len_max[ilvl]['bw'][i]) + ']';
            });
            t += s.padEnd(len_max[ilvl]['bw_sum'] + 1);
          }
        } else {
          t += (g.type as string).padEnd(len_type);
          if (len_max[ilvl]['sign'] > 0) {
            if (g.sign) {
              t += (g.sign as string).padEnd(len_max[ilvl]['sign'] + 1);
            } else {
              t += ''.padEnd(len_max[ilvl]['sign'] + 1);
            }
          }
          if (len_max[ilvl]['bw_sum'] > 0) {
            let s = '';
            if (g.bw) {
              const bw_a = innerGroups((g.bw as string).replace(/\s/g, ''), /\[(.+?)\]/g);
              bw_a.forEach((bw, i) => {
                s += '[' + bw.padStart(len_max[ilvl]['bw'][i]) + ']';
              });
            }
            t += s.padEnd(len_max[ilvl]['bw_sum'] + 1);
          }
        }
        l += t.padEnd(len_type_full);
        const d = l;
        if (g.sig_list) {
          l += g.name;
          if (g.array) {
            l += (g.array as string).replace(/\s/g, '').padStart(len_max[ilvl]['array_sum']) + ']';
          }
          if (g.init) {
            l += ' = ' + (g.init as string).trim().padEnd(len_max[ilvl]['init']);
          }
          if (one_decl_per_line) {
            for (const s of (g.sig_list as string).split(',')) {
              if (s !== '') {
                if (this.settings.alignComma) {
                  l += ';\n' + d + s.trim().padEnd(len_max[ilvl]['name']);
                } else {
                  l += ';\n' + d + s.trim();
                }
              }
            }
          } else {
            l += (g.sig_list as string).trim();
          }
        } else {
          l += (g.name as string).padEnd(len_max[ilvl]['name']);
          if (len_max[ilvl]['array_sum'] > 0) {
            let s = '';
            if (g.array) {
              const bw_a = innerGroups((g.array as string).replace(/\s/g, ''), /\[(.+?)\]/g);
              bw_a.forEach((bw, i) => {
                s += '[' + bw.padStart(len_max[ilvl]['array'][i]) + ']';
              });
            }
            l += s.padEnd(len_max[ilvl]['array_sum']);
          }
          if (len_max[ilvl]['init'] > 0) {
            if (g.init) {
              l += ' = ' + (g.init as string).trim().padEnd(len_max[ilvl]['init']);
            } else {
              l += ''.padStart(len_max[ilvl]['init'] + 3);
            }
          }
        }
        if (this.settings.alignComma) {
          l += ';';
        } else {
          const l_tmp = l.replace(/\s+$/, '');
          const nb_pad = l.length - l_tmp.length;
          l = l_tmp + ';' + ' '.repeat(nb_pad);
        }
        if (g.comment) {
          l += ' ' + (g.comment as string).trim();
        }
      } else {
        l = line;
      }
      txt_new += l + '\n';
    }
    if (!txt.endsWith('\n')) {
      txt_new = txt_new.slice(0, -1);
    }
    return txt_new;
  }
}

function innerGroups(s: string, re: RegExp): string[] {
  const out: string[] = [];
  const rx = new RegExp(re.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = rx.exec(s)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function findAllGroups(re: RegExp, s: string): (string | undefined)[][] {
    const out: (string | undefined)[][] = [];
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = rx.exec(s)) !== null) {
      const groups: (string | undefined)[] = [];
      for (let i = 1; i < m.length; i++) {
        groups.push(m[i] === undefined ? '' : m[i]);
      }
      out.push(groups);
    if (m.index === rx.lastIndex) {
      rx.lastIndex++;
    }
  }
  return out;
}
