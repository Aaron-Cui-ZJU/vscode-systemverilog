import * as vscode from 'vscode';

export interface SvConfig {
  vExt: string[];
  svExt: string[];
  vhExt: string[];
  svhExt: string[];
  tooltip: boolean;
  hoverMaxSize: number;
  tooltipShowModuleOnPort: boolean;
  tooltipShowRefs: boolean;
  tooltipShowSignalLinks: boolean;
  portDirectionColors: Record<string, string>;
  oneBindPerLine: boolean;
  oneDeclPerLine: boolean;
  maxLineLength: number;
  stripEmptyLine: boolean;
  modImportSameLine: boolean;
  alignmentIgnoreTick: boolean;
  alignCommaSemicolon: boolean;
  paramPortAlignment: boolean;
  indentStyle: string;
  clkName: string;
  rstName: string;
  rstNName: string;
  alwaysNameAuto: boolean;
  alwaysFfBeginEnd: boolean;
  alwaysOneCursor: boolean;
  alwaysLabel: boolean;
  alwaysSvOnly: boolean;
  clkEnName: string;
  alwaysCeAuto: boolean;
  endLabelComment: string[];
  fillparam: boolean;
  paramOneline: boolean;
  instOneline: boolean;
  autoconnect: boolean;
  paramExplicit: boolean;
  paramPropagate: boolean;
  autoconnectAllowPrefix: boolean;
  autoconnectAllowSuffix: boolean;
  autoconnectPortPrefix: string[];
  autoconnectPortSuffix: string[];
  instancePrefix: string;
  instanceSuffix: string;
  declStart: string;
  declEnd: string;
  declIndent: number;
  autocompleteMaxLvl: number;
  disableAutocomplete: boolean;
  debug: boolean;
  hierarchyNewWindow: boolean;
  completionSystemtask: CompletionEntry[];
  completionSystemtaskUser: CompletionEntry[];
  completionTick: CompletionEntry[];
  completionTickUser: CompletionEntry[];
  completionUvm: CompletionEntry[];
  completionUvmUser: CompletionEntry[];
}

export type CompletionEntry = [string, string, string];

// CSS colors used for the port direction badge in the hover. Values may be any
// CSS color, including VS Code theme variables such as var(--vscode-charts-blue).
export const DEFAULT_PORT_DIRECTION_COLORS: Record<string, string> = {
  input: 'var(--vscode-charts-blue)',
  output: 'var(--vscode-charts-orange)',
  inout: 'var(--vscode-charts-purple)',
  ref: 'var(--vscode-charts-green)',
};

// Fill any missing or invalid user entries with the built-in defaults.
function mergePortDirectionColors(v: unknown): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_PORT_DIRECTION_COLORS };
  if (v && typeof v === 'object') {
    for (const key of Object.keys(out)) {
      const value = (v as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) {
        out[key] = value;
      }
    }
  }
  return out;
}

export function getConfig(): SvConfig {
  const c = vscode.workspace.getConfiguration('systemverilog');
  const arr = (v: any): string[] => (Array.isArray(v) ? v.map(String) : []);
  const cl = (v: any): CompletionEntry[] =>
    Array.isArray(v) ? (v.filter((x) => Array.isArray(x)) as CompletionEntry[]) : [];
  return {
    vExt: arr(c.get('vExt')),
    svExt: arr(c.get('svExt')),
    vhExt: arr(c.get('vhExt')),
    svhExt: arr(c.get('svhExt')),
    tooltip: c.get('tooltip', true),
    hoverMaxSize: c.get('hoverMaxSize', -1),
    tooltipShowModuleOnPort: c.get('tooltipShowModuleOnPort', false),
    tooltipShowRefs: c.get('tooltipShowRefs', true),
    tooltipShowSignalLinks: c.get('tooltipShowSignalLinks', false),
    portDirectionColors: mergePortDirectionColors(c.get('portDirectionColors')),
    oneBindPerLine: c.get('oneBindPerLine', true),
    oneDeclPerLine: c.get('oneDeclPerLine', false),
    maxLineLength: c.get('maxLineLength', 120),
    stripEmptyLine: c.get('stripEmptyLine', true),
    modImportSameLine: c.get('modImportSameLine', false),
    alignmentIgnoreTick: c.get('alignmentIgnoreTick', false),
    alignCommaSemicolon: c.get('alignCommaSemicolon', true),
    paramPortAlignment: c.get('paramPortAlignment', true),
    indentStyle: c.get('indentStyle', '1tbs'),
    clkName: c.get('clkName', 'clk'),
    rstName: c.get('rstName', 'rst'),
    rstNName: c.get('rstNName', 'rst_n'),
    alwaysNameAuto: c.get('alwaysNameAuto', true),
    alwaysFfBeginEnd: c.get('alwaysFfBeginEnd', true),
    alwaysOneCursor: c.get('alwaysOneCursor', false),
    alwaysLabel: c.get('alwaysLabel', true),
    alwaysSvOnly: c.get('alwaysSvOnly', true),
    clkEnName: c.get('clkEnName', 'clk_en'),
    alwaysCeAuto: c.get('alwaysCeAuto', true),
    endLabelComment: arr(c.get('endLabelComment')),
    fillparam: c.get('fillparam', true),
    paramOneline: c.get('paramOneline', true),
    instOneline: c.get('instOneline', true),
    autoconnect: c.get('autoconnect', true),
    paramExplicit: c.get('paramExplicit', false),
    paramPropagate: c.get('paramPropagate', false),
    autoconnectAllowPrefix: c.get('autoconnectAllowPrefix', true),
    autoconnectAllowSuffix: c.get('autoconnectAllowSuffix', true),
    autoconnectPortPrefix: arr(c.get('autoconnectPortPrefix')),
    autoconnectPortSuffix: arr(c.get('autoconnectPortSuffix')),
    instancePrefix: c.get('instancePrefix', 'i_'),
    instanceSuffix: c.get('instanceSuffix', ''),
    declStart: c.get('declStart', 'Signals declaration'),
    declEnd: c.get('declEnd', '/*----'),
    declIndent: c.get('declIndent', 1),
    autocompleteMaxLvl: c.get('autocompleteMaxLvl', 5),
    disableAutocomplete: c.get('disableAutocomplete', false),
    debug: c.get('debug', false),
    hierarchyNewWindow: c.get('hierarchyNewWindow', false),
    completionSystemtask: cl(c.get('completionSystemtask')),
    completionSystemtaskUser: cl(c.get('completionSystemtaskUser')),
    completionTick: cl(c.get('completionTick')),
    completionTickUser: cl(c.get('completionTickUser')),
    completionUvm: cl(c.get('completionUvm')),
    completionUvmUser: cl(c.get('completionUvmUser')),
  };
}

export const DEFAULT_SYSTEMTASK: CompletionEntry[] = [
  ['display', '$display()', 'display("$0",);'],
  ['monitor', '$monitor()', 'monitor("$0",);'],
  ['monitoron', '$monitoron', 'monitoron;'],
  ['monitoroff', '$monitoroff', 'monitoroff;'],
  ['sformatf', '$sformatf()', 'sformatf("$0",)'],
  ['testplusargs', '$test$plusargs()', 'test\\$plusargs("$0")'],
  ['valueplusargs', '$value$plusargs()', 'value\\$plusargs("$1",$2)'],
  ['finish', '$finish', 'finish;'],
  ['time', '$time', 'time()'],
  ['realtime', '$realtime()', 'realtime()'],
  ['random', '$random()', 'random()'],
  ['urandom_range', '$urandom_range()', 'urandom_range($1,$2)'],
  ['cast', '$cast()', 'cast($0)'],
  ['unsigned', '$unsigned()', 'unsigned($0)'],
  ['signed', '$signed()', 'signed($0)'],
  ['itor', '$itor()', 'itor($0)'],
  ['rtoi', '$rtoi()', 'rtoi($0)'],
  ['bitstoreal', '$bitstoreal()', 'bitstoreal($0)'],
  ['realtobits', '$realtobits()', 'realtobits($0)'],
  ['assertoff', '$assertoff()', 'assertoff($0,)'],
  ['info', '$info()', 'info("$0");'],
  ['error', '$error()', 'error("$0");'],
  ['warning', '$warning()', 'warning("$0");'],
  ['stable', '$stable()', 'stable($0)'],
  ['fell', '$fell()', 'fell($0)'],
  ['rose', '$rose()', 'rose($0)'],
  ['past', '$past()', 'past($0)'],
  ['isunknown', '$isunknown()', 'isunknown($0)'],
  ['onehot', '$onehot()', 'onehot($0)'],
  ['onehot0', '$onehot0()', 'onehot0($0)'],
  ['size', '$size()', 'size($0)'],
  ['countones', '$countones()', 'countones($0)'],
  ['high', '$high()', 'high($0)'],
  ['low', '$low()', 'low($0)'],
  ['clog2', '$clog2()', 'clog2($0)'],
  ['log', '$log()', 'ln($0)'],
  ['log10', '$log10()', 'log10($0)'],
  ['exp', '$exp()', 'exp($0)'],
  ['sqrt', '$sqrt()', 'sqrt($0)'],
  ['pow', '$pow()', 'pow($1,$2)'],
  ['floor', '$floor()', 'floor($0)'],
  ['ceil', '$ceil()', 'ceil($0)'],
  ['sin', '$sin()', 'sin($0)'],
  ['cos', '$cos()', 'cos($0)'],
  ['tan', '$tan()', 'tan($0)'],
  ['asin', '$asin()', 'asin($0)'],
  ['acos', '$acos()', 'acos($0)'],
  ['atan', '$atan()', 'atan($0)'],
  ['atan2', '$atan2()', 'atan2($1,$2)'],
  ['hypot', '$hypot()', 'hypot($1,$2)'],
  ['sinh', '$sinh()', 'sinh($0)'],
  ['cosh', '$cosh()', 'cosh($0)'],
  ['tanh', '$tanh()', 'tanh($0)'],
  ['asinh', '$asinh()', 'asinh($0)'],
  ['acosh', '$acosh()', 'acosh($0)'],
  ['atanh', '$atanh()', 'atanh($0)'],
  ['fopen', '$fopen()', 'fopen($0,"r")'],
  ['fclose', '$fclose()', 'fclose($0);'],
  ['fflush', '$fflush()', 'fflush;'],
  ['fgetc', '$fgetc()', 'fgetc($0,)'],
  ['fgets', '$fgets()', 'fgets($0,)'],
  ['fwrite', '$fwrite()', 'fwrite($0,"")'],
  ['readmemb', '$readmemb()', 'readmemb("$1",$2)'],
  ['readmemh', '$readmemh()', 'readmemh("$1",$2)'],
  ['sscanf', '$sscanf()', 'sscanf($1,"$2",$3)'],
];

export const DEFAULT_TICK: CompletionEntry[] = [
  ['include', '`include …', 'include "$0"'],
  ['define', '`define …', 'define $0'],
  ['ifdef', '`ifdef …', 'ifdef $0'],
  ['ifndef', '`ifndef …', 'ifndef $0\n\n`endif'],
  [
    'ifndef',
    '`ifndef … `define',
    'ifndef ${1/([A-Za-z0-9_]+).*/$1/}\n\t`define ${1:SYMBOL} ${2:value}\n`endif',
  ],
  ['else', '`else ', 'else '],
  ['elsif', '`elsif …', 'elsif $0'],
  ['endif', '`endif', 'endif'],
  ['celldefine', '`celldefine …', 'celldefine\n\t$0\n`endcelldefine'],
  ['endcelldefine', '`endcelldefine ', 'endcelldefine '],
  ['line', '`line ', 'line '],
  ['resetall', '`resetall ', 'resetall'],
  ['timescale', '`timescale …', 'timescale $0'],
  ['undef', '`undef …', 'undef $0'],
];

export const DEFAULT_UVM: CompletionEntry[] = [
  ['uvm_config_db_get', 'uvm_config_db_get', 'uvm_config_db#()::get(this, "$1", "$0", $0);'],
  ['uvm_config_db_set', 'uvm_config_db_set', 'uvm_config_db#()::set(this, "$1", "$0", $0);'],
  ['uvm_report_info', 'uvm_report_info', 'uvm_report_info("$1", "$0", UVM_NONE);'],
  ['uvm_report_warning', 'uvm_report_warning', 'uvm_report_warning("$1", "$0");'],
  ['uvm_report_error', 'uvm_report_error', 'uvm_report_error("$1", "$0");'],
  ['uvm_report_fatal', 'uvm_report_fatal', 'uvm_report_fatal("$1", "$0");'],
];

export function mergeCompletion(
  base: CompletionEntry[],
  override: CompletionEntry[],
  user: CompletionEntry[]
): CompletionEntry[] {
  let list = override.length ? override : base;
  if (user.length) {
    list = list.slice();
    for (const u of user) {
      const idx = list.findIndex((x) => x[0] === u[0]);
      if (idx >= 0) {
        list[idx] = u;
      } else {
        list.push(u);
      }
    }
  }
  return list;
}
