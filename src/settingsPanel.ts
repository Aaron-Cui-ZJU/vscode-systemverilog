import * as vscode from 'vscode';
import * as logger from './logger';
import { DEFAULT_PORT_DIRECTION_COLORS, getConfig } from './config';
import { FileListSetting } from './filelist';
import { validateFileLists, validateIncludeDirs } from './indexer';

const DIRECTIONS = Object.keys(DEFAULT_PORT_DIRECTION_COLORS);

let panel: vscode.WebviewPanel | undefined;

export function registerSettingsPanel(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'systemverilog.configureSettings',
      logger.command('systemverilog.configureSettings', () => openSettingsPanel())
    )
  );
}

function openSettingsPanel(): void {
  if (panel) {
    panel.reveal();
    return;
  }
  panel = vscode.window.createWebviewPanel(
    'systemverilog.settings',
    'SystemVerilog Settings',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.onDidDispose(() => {
    panel = undefined;
  });
  panel.webview.onDidReceiveMessage((msg) => void onMessage(msg));
  void updatePanel(panel);
}

async function updatePanel(p: vscode.WebviewPanel): Promise<void> {
  const cfg = getConfig();
  p.webview.html = settingsHtml(cfg.portDirectionColors, cfg.fileLists, cfg.includeDirs);
}

async function onMessage(msg: unknown): Promise<void> {
  if (!msg || typeof msg !== 'object') {
    return;
  }
  const m = msg as { type?: unknown; colors?: unknown; fileLists?: unknown; includeDirs?: unknown };
  if (m.type === 'save') {
    const colors = sanitizeColors(m.colors);
    const fileLists = sanitizeFileLists(m.fileLists);
    const includeDirs = sanitizeIncludeDirs(m.includeDirs);
    await persist(colors, fileLists, includeDirs);
    logger.info(`configureSettings: saved (${fileLists.length} filelist(s), ${includeDirs.length} include dir(s))`);
    vscode.window.showInformationMessage('SystemVerilog settings saved.');
  } else if (m.type === 'reset') {
    await persist({ ...DEFAULT_PORT_DIRECTION_COLORS }, [], []);
    logger.info('configureSettings: reset to defaults');
    vscode.window.showInformationMessage('SystemVerilog settings reset to defaults.');
  } else if (m.type === 'validate') {
    const fileLists = sanitizeFileLists(m.fileLists);
    const results = validateFileLists(fileLists);
    logger.info(`configureSettings: validated ${fileLists.length} filelist(s)`);
    void panel?.webview.postMessage({ type: 'validation', results });
  } else if (m.type === 'validateInc') {
    const fileLists = sanitizeFileLists(m.fileLists);
    const includeDirs = sanitizeIncludeDirs(m.includeDirs);
    const result = validateIncludeDirs(fileLists, includeDirs);
    logger.info(`configureSettings: validated ${includeDirs.length} include dir(s)`);
    void panel?.webview.postMessage({ type: 'incValidation', result });
  }
}

function sanitizeColors(v: unknown): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_PORT_DIRECTION_COLORS };
  if (v && typeof v === 'object') {
    for (const key of DIRECTIONS) {
      const value = (v as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) {
        out[key] = value;
      }
    }
  }
  return out;
}

function sanitizeFileLists(v: unknown): FileListSetting[] {
  if (!Array.isArray(v)) {
    return [];
  }
  const out: FileListSetting[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as { file?: unknown; base?: unknown };
    const file = typeof raw.file === 'string' ? raw.file.trim() : '';
    const base = typeof raw.base === 'string' ? raw.base.trim() : '';
    if (!file && !base) {
      continue;
    }
    out.push({ file, base });
  }
  return out;
}

function sanitizeIncludeDirs(v: unknown): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') {
      continue;
    }
    const dir = item.trim();
    if (dir) {
      out.push(dir);
    }
  }
  return out;
}

async function persist(
  colors: Record<string, string>,
  fileLists: FileListSetting[],
  includeDirs: string[]
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('systemverilog');
  await cfg.update('portDirectionColors', colors, vscode.ConfigurationTarget.Global);
  await cfg.update('fileLists', fileLists, vscode.ConfigurationTarget.Global);
  await cfg.update('includeDirs', includeDirs, vscode.ConfigurationTarget.Global);
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

// Single settings webview hosting both the port hover colors and the index file
// lists. Each color row exposes a native color picker, a free text field (for
// CSS colors such as var(--vscode-charts-blue)) and a live preview; each file
// list row pairs a filelist path with the base directory its entries resolve
// against.
function settingsHtml(
  colors: Record<string, string>,
  fileLists: FileListSetting[],
  includeDirs: string[]
): string {
  const nonce = getNonce();
  const initial = JSON.stringify(colors).replace(/</g, '\\u003c');
  const defaults = JSON.stringify(DEFAULT_PORT_DIRECTION_COLORS).replace(/</g, '\\u003c');
  const directions = JSON.stringify(DIRECTIONS);
  const initialLists = JSON.stringify(fileLists).replace(/</g, '\\u003c');
  const initialIncDirs = JSON.stringify(includeDirs).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px 20px; }
  h1 { font-size: 1.3em; font-weight: 600; margin: 0 0 16px; }
  h2 { font-size: 1.05em; font-weight: 600; margin: 24px 0 6px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
  .hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 12px; }
  table { border-collapse: collapse; }
  td, th { padding: 5px 12px 5px 0; vertical-align: middle; text-align: left; font-weight: 400; }
  th { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .dir { min-width: 56px; font-family: var(--vscode-editor-font-family); }
  input[type=text] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 6px; }
  .color-text { width: 280px; box-sizing: border-box; }
  .list-file { width: 280px; box-sizing: border-box; font-family: var(--vscode-editor-font-family); }
  .list-base { width: 200px; box-sizing: border-box; font-family: var(--vscode-editor-font-family); }
  input[type=color] { width: 44px; height: 26px; padding: 0; border: 1px solid var(--vscode-input-border, transparent); background: none; cursor: pointer; }
  .badge { font-weight: bold; }
  .preview { margin-top: 16px; border: 1px solid var(--vscode-panel-border); padding: 12px; }
  .preview code { font-family: var(--vscode-editor-font-family); }
  .preview-line { margin-top: 8px; line-height: 1.9; }
  .buttons { margin-top: 24px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; cursor: pointer; margin-right: 8px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.small { padding: 2px 10px; }
  .validation { margin-top: 12px; font-size: 12px; }
  .vrow { font-family: var(--vscode-editor-font-family); margin-top: 6px; }
  .vrow.ok { color: var(--vscode-charts-green); }
  .vrow.warn { color: var(--vscode-charts-orange); }
  .vrow.err { color: var(--vscode-charts-red); }
  .sample { color: var(--vscode-descriptionForeground); margin-left: 16px; }
</style>
</head>
<body>
  <h1>SystemVerilog Settings</h1>

  <h2>Port Hover Direction Colors</h2>
  <p class="hint">Pick a color or type any CSS color, e.g. <code>#ff8800</code> or <code>var(--vscode-charts-blue)</code>.</p>
  <table id="rows"></table>
  <div class="preview">
    <div class="hint">Preview</div>
    <div class="preview-line" id="preview"></div>
  </div>

  <h2>Index File Lists</h2>
  <p class="hint">Restrict indexing to the files listed in these filelists. <code>Base</code> is the directory the listed paths are resolved against. With no entries, every supported file in the workspace is indexed.</p>
  <table id="lists">
    <thead><tr><th>Filelist</th><th>Base</th><th></th></tr></thead>
    <tbody id="listRows"></tbody>
  </table>
  <button id="addList" class="secondary small">Add filelist</button>
  <button id="validate" class="secondary small">Validate</button>
  <div id="validation" class="validation"></div>

  <h2>Include Search Directories</h2>
  <p class="hint">Extra directories searched for include directives, like the +incdir+ paths of your compile command. Absolute or relative to the workspace root. They are used in addition to the including file's directory and any +incdir+ / -I paths in the filelists.</p>
  <table id="incdirs"><tbody id="incdirRows"></tbody></table>
  <button id="addInc" class="secondary small">Add directory</button>
  <button id="validateInc" class="secondary small">Validate</button>
  <div id="incValidation" class="validation"></div>

  <div class="buttons">
    <button id="save">Save</button>
    <button id="reset" class="secondary">Reset to defaults</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const DIRECTIONS = ${directions};
  const DEFAULTS = ${defaults};
  const restore = vscode.getState();
  let colors = restore && restore.colors ? restore.colors : ${initial};
  let lists = restore && restore.lists ? restore.lists : ${initialLists};
  let incdirs = restore && restore.incdirs ? restore.incdirs : ${initialIncDirs};

  function persistDraft() {
    vscode.setState({ colors, lists, incdirs });
  }

  function resolveHex(value) {
    const probe = document.createElement('span');
    probe.style.color = value;
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    const m = rgb.match(/\\d+/g);
    if (!m || m.length < 3) {
      return '#000000';
    }
    return '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  }

  const rows = [];
  const table = document.getElementById('rows');
  for (const dir of DIRECTIONS) {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.className = 'dir';
    tdName.textContent = dir;

    const tdPicker = document.createElement('td');
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.setAttribute('aria-label', dir + ' color');
    tdPicker.appendChild(picker);

    const tdText = document.createElement('td');
    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'color-text';
    text.spellcheck = false;
    text.setAttribute('aria-label', dir + ' CSS color');
    tdText.appendChild(text);

    const tdBadge = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = dir;
    tdBadge.appendChild(badge);

    tr.append(tdName, tdPicker, tdText, tdBadge);
    table.appendChild(tr);
    rows.push({ dir, picker, text, badge });
  }

  function apply(dir) {
    const value = colors[dir];
    const row = rows.find((r) => r.dir === dir);
    if (!row) {
      return;
    }
    row.text.value = value;
    row.badge.style.color = value;
    row.picker.value = resolveHex(value);
    renderPreview();
  }

  function renderPreview() {
    const preview = document.getElementById('preview');
    preview.innerHTML = '';
    for (const dir of DIRECTIONS) {
      const line = document.createElement('div');
      line.append('direction: ');
      const span = document.createElement('span');
      span.className = 'badge';
      span.textContent = dir;
      span.style.color = colors[dir];
      line.appendChild(span);
      preview.appendChild(line);
    }
  }

  for (const row of rows) {
    row.picker.addEventListener('input', () => {
      colors[row.dir] = row.picker.value;
      apply(row.dir);
      persistDraft();
    });
    row.text.addEventListener('input', () => {
      colors[row.dir] = row.text.value;
      apply(row.dir);
      persistDraft();
    });
  }

  function renderLists() {
    const body = document.getElementById('listRows');
    body.innerHTML = '';
    lists.forEach((item, idx) => {
      const tr = document.createElement('tr');

      const tdFile = document.createElement('td');
      const file = document.createElement('input');
      file.type = 'text';
      file.className = 'list-file';
      file.spellcheck = false;
      file.placeholder = 'path/to/files.f';
      file.value = item.file;
      file.addEventListener('input', () => { lists[idx].file = file.value; persistDraft(); });
      tdFile.appendChild(file);

      const tdBase = document.createElement('td');
      const base = document.createElement('input');
      base.type = 'text';
      base.className = 'list-base';
      base.spellcheck = false;
      base.placeholder = 'e.g. . or rtl/';
      base.value = item.base;
      base.addEventListener('input', () => { lists[idx].base = base.value; persistDraft(); });
      tdBase.appendChild(base);

      const tdDel = document.createElement('td');
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'secondary small';
      del.textContent = 'Remove';
      del.addEventListener('click', () => { lists.splice(idx, 1); renderLists(); persistDraft(); });
      tdDel.appendChild(del);

      tr.append(tdFile, tdBase, tdDel);
      body.appendChild(tr);
    });
  }

  const validationBox = document.getElementById('validation');

  function renderValidation(results) {
    validationBox.innerHTML = '';
    if (!results || !results.length) {
      validationBox.textContent = 'No file lists to validate.';
      return;
    }
    results.forEach((r) => {
      const row = document.createElement('div');
      let cls = 'ok';
      let text;
      if (r.error) {
        cls = 'err';
        text = r.error;
      } else if (!r.base) {
        cls = 'warn';
        text = r.resolved + ' path(s), ' + r.supported + ' supported'
          + (r.missing.length ? ', ' + r.missing.length + ' missing' : '')
          + ' - base empty, entry is ignored';
      } else {
        if (!r.baseExists) { cls = 'warn'; }
        text = r.resolved + ' path(s), ' + r.supported + ' supported'
          + (r.missing.length ? ', ' + r.missing.length + ' missing' : '')
          + (r.baseExists ? '' : ' - base directory not found');
      }
      row.className = 'vrow ' + cls;
      row.textContent = (r.file || '(empty)') + '  ->  ' + text;
      validationBox.appendChild(row);
      if (r.sample && r.sample.length) {
        const s = document.createElement('div');
        s.className = 'sample';
        s.textContent = r.sample.join('   ');
        validationBox.appendChild(s);
      }
      if (r.missing && r.missing.length) {
        const m = document.createElement('div');
        m.className = 'sample';
        m.textContent = 'missing: ' + r.missing.join('   ');
        validationBox.appendChild(m);
      }
    });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) {
      return;
    }
    if (msg.type === 'validation') {
      renderValidation(msg.results);
    } else if (msg.type === 'incValidation') {
      renderIncValidation(msg.result);
    }
  });

  document.getElementById('validate').addEventListener('click', () => {
    validationBox.textContent = 'Validating...';
    vscode.postMessage({ type: 'validate', fileLists: lists });
  });

  document.getElementById('addList').addEventListener('click', () => {
    lists.push({ file: '', base: '' });
    renderLists();
    persistDraft();
  });

  function renderIncDirs() {
    const body = document.getElementById('incdirRows');
    body.innerHTML = '';
    incdirs.forEach((dir, idx) => {
      const tr = document.createElement('tr');

      const tdDir = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'list-file';
      input.spellcheck = false;
      input.placeholder = 'e.g. ../design/tb/vips';
      input.value = dir;
      input.addEventListener('input', () => { incdirs[idx] = input.value; persistDraft(); });
      tdDir.appendChild(input);

      const tdDel = document.createElement('td');
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'secondary small';
      del.textContent = 'Remove';
      del.addEventListener('click', () => { incdirs.splice(idx, 1); renderIncDirs(); persistDraft(); });
      tdDel.appendChild(del);

      tr.append(tdDir, tdDel);
      body.appendChild(tr);
    });
  }

  document.getElementById('addInc').addEventListener('click', () => {
    incdirs.push('');
    renderIncDirs();
    persistDraft();
  });

  const incValidationBox = document.getElementById('incValidation');

  function renderIncValidation(result) {
    incValidationBox.innerHTML = '';
    if (!result) {
      return;
    }
    const dirs = result.dirs || [];
    if (!dirs.length) {
      const d = document.createElement('div');
      d.className = 'vrow';
      d.textContent = 'No include directories.';
      incValidationBox.appendChild(d);
    }
    dirs.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'vrow ' + (s.isDirectory ? 'ok' : (s.exists ? 'warn' : 'err'));
      const status = s.isDirectory
        ? 'directory found'
        : (s.exists ? 'exists but is not a directory' : 'not found');
      row.textContent = s.dir + '  ->  ' + status;
      incValidationBox.appendChild(row);
      if (!s.isDirectory) {
        const p = document.createElement('div');
        p.className = 'sample';
        p.textContent = s.path;
        incValidationBox.appendChild(p);
      }
    });
    const unresolved = result.unresolved || [];
    const u = document.createElement('div');
    u.className = 'vrow ' + (unresolved.length ? 'warn' : 'ok');
    u.textContent = unresolved.length
      ? unresolved.length + ' include(s) could not be resolved'
      : 'all includes resolved';
    incValidationBox.appendChild(u);
    unresolved.slice(0, 10).forEach((x) => {
      const s = document.createElement('div');
      s.className = 'sample';
      s.textContent = x.from + '  :  ' + x.include;
      incValidationBox.appendChild(s);
    });
    if (unresolved.length > 10) {
      const more = document.createElement('div');
      more.className = 'sample';
      more.textContent = '... and ' + (unresolved.length - 10) + ' more';
      incValidationBox.appendChild(more);
    }
  }

  document.getElementById('validateInc').addEventListener('click', () => {
    incValidationBox.textContent = 'Validating...';
    vscode.postMessage({ type: 'validateInc', fileLists: lists, includeDirs: incdirs });
  });

  document.getElementById('save').addEventListener('click', () => {
    vscode.postMessage({ type: 'save', colors, fileLists: lists, includeDirs: incdirs });
    persistDraft();
  });
  document.getElementById('reset').addEventListener('click', () => {
    colors = Object.assign({}, DEFAULTS);
    lists = [];
    incdirs = [];
    for (const dir of DIRECTIONS) {
      apply(dir);
    }
    renderLists();
    renderIncDirs();
    persistDraft();
    vscode.postMessage({ type: 'reset' });
  });

  for (const dir of DIRECTIONS) {
    apply(dir);
  }
  renderLists();
  renderIncDirs();
</script>
</body>
</html>`;
}
