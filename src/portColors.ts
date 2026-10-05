import * as vscode from 'vscode';
import * as logger from './logger';
import { DEFAULT_PORT_DIRECTION_COLORS, getConfig } from './config';

const DIRECTIONS = Object.keys(DEFAULT_PORT_DIRECTION_COLORS);

let panel: vscode.WebviewPanel | undefined;

export function registerPortColors(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'systemverilog.configurePortColors',
      logger.command('systemverilog.configurePortColors', () => openPortColorPanel())
    )
  );
}

function openPortColorPanel(): void {
  if (panel) {
    panel.reveal();
    void updatePanel(panel);
    return;
  }
  panel = vscode.window.createWebviewPanel(
    'systemverilog.portColors',
    'Port Hover Colors',
    vscode.ViewColumn.Active,
    { enableScripts: true }
  );
  panel.onDidDispose(() => {
    panel = undefined;
  });
  panel.webview.onDidReceiveMessage((msg) => void onMessage(msg));
  void updatePanel(panel);
}

async function updatePanel(p: vscode.WebviewPanel): Promise<void> {
  p.webview.html = portColorHtml(getConfig().portDirectionColors);
}

async function onMessage(msg: unknown): Promise<void> {
  if (!msg || typeof msg !== 'object') {
    return;
  }
  const m = msg as { type?: unknown; colors?: unknown };
  if (m.type === 'save') {
    const colors = sanitizeColors(m.colors);
    await persist(colors);
    logger.info(`configurePortColors: saved ${JSON.stringify(colors)}`);
    vscode.window.showInformationMessage('Port hover colors saved.');
  } else if (m.type === 'reset') {
    await persist({ ...DEFAULT_PORT_DIRECTION_COLORS });
    logger.info('configurePortColors: reset to defaults');
    vscode.window.showInformationMessage('Port hover colors reset to defaults.');
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

async function persist(colors: Record<string, string>): Promise<void> {
  await vscode.workspace
    .getConfiguration('systemverilog')
    .update('portDirectionColors', colors, vscode.ConfigurationTarget.Global);
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

// Render the settings webview. Each row exposes a native color picker, a free
// text field (for CSS colors such as var(--vscode-charts-blue)) and a live
// preview of the badge as it appears in the hover.
function portColorHtml(colors: Record<string, string>): string {
  const nonce = getNonce();
  const initial = JSON.stringify(colors).replace(/</g, '\\u003c');
  const defaults = JSON.stringify(DEFAULT_PORT_DIRECTION_COLORS).replace(/</g, '\\u003c');
  const directions = JSON.stringify(DIRECTIONS);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px 20px; }
  h1 { font-size: 1.2em; font-weight: 600; margin: 0 0 4px; }
  .hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 16px; }
  table { border-collapse: collapse; }
  td { padding: 5px 12px 5px 0; vertical-align: middle; }
  .dir { min-width: 56px; font-family: var(--vscode-editor-font-family); }
  input[type=text] { width: 280px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 6px; }
  input[type=color] { width: 44px; height: 26px; padding: 0; border: 1px solid var(--vscode-input-border, transparent); background: none; cursor: pointer; }
  .badge { font-weight: bold; }
  .preview { margin-top: 20px; border: 1px solid var(--vscode-panel-border); padding: 12px; }
  .preview code { font-family: var(--vscode-editor-font-family); }
  .preview-line { margin-top: 8px; line-height: 1.9; }
  .buttons { margin-top: 20px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; cursor: pointer; margin-right: 8px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
</style>
</head>
<body>
  <h1>Port Hover Direction Colors</h1>
  <p class="hint">Pick a color or type any CSS color, e.g. <code>#ff8800</code> or <code>var(--vscode-charts-blue)</code>.</p>
  <table id="rows"></table>
  <div class="preview">
    <div class="hint">Preview</div>
    <div class="preview-line" id="preview"></div>
  </div>
  <div class="buttons">
    <button id="save">Save</button>
    <button id="reset" class="secondary">Reset to defaults</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const DIRECTIONS = ${directions};
  const DEFAULTS = ${defaults};
  let colors = ${initial};

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
    });
    row.text.addEventListener('input', () => {
      colors[row.dir] = row.text.value;
      apply(row.dir);
    });
  }

  document.getElementById('save').addEventListener('click', () => {
    vscode.postMessage({ type: 'save', colors });
  });
  document.getElementById('reset').addEventListener('click', () => {
    colors = Object.assign({}, DEFAULTS);
    for (const dir of DIRECTIONS) {
      apply(dir);
    }
    vscode.postMessage({ type: 'reset' });
  });

  for (const dir of DIRECTIONS) {
    apply(dir);
  }
</script>
</body>
</html>`;
}
