/**
 * auto-configure.ts
 *
 * Writes turn-mcp-web server URL into the config files of known MCP clients,
 * or into system-wide locations so new clients can discover it automatically.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Logger } from './config.js';

const logger = new Logger('AutoConfigure');

export type ConfigAction = 'created' | 'updated' | 'already-configured' | 'not-configured' | 'not-found' | 'error';

export interface ConfigResult {
  target: string;
  name: string;
  displayPath: string;
  action: ConfigAction;
  error?: string;
}

type MergeFn = (existing: Record<string, unknown>, serverUrl: string) => Record<string, unknown>;

interface ClientDef {
  name: string;
  resolvePath: () => string;
  merge: MergeFn;
}

// ─── Platform helpers ────────────────────────────────────────────────────────

function tildify(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

function claudeDesktopPath(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'win32')  return path.join(process.env['APPDATA'] || home, 'Claude', 'claude_desktop_config.json');
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

function vscodePath(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
  if (process.platform === 'win32')  return path.join(process.env['APPDATA'] || home, 'Code', 'User', 'mcp.json');
  return path.join(home, '.config', 'Code', 'User', 'mcp.json');
}

function antigravityPath(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Antigravity', 'mcp.json');
  if (process.platform === 'win32')  return path.join(process.env['APPDATA'] || home, 'Antigravity', 'mcp.json');
  return path.join(home, '.config', 'Antigravity', 'mcp.json');
}

// ─── Client definitions ──────────────────────────────────────────────────────

const CLIENT_DEFS: Record<string, ClientDef> = {
  windsurf: {
    name: 'Windsurf',
    resolvePath: () => path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
    merge: (e, url) => ({ ...e, mcpServers: { ...(e['mcpServers'] as object || {}), 'turn-mcp-web': { serverUrl: url } } }),
  },
  cursor: {
    name: 'Cursor',
    resolvePath: () => path.join(os.homedir(), '.cursor', 'mcp.json'),
    merge: (e, url) => ({ ...e, mcpServers: { ...(e['mcpServers'] as object || {}), 'turn-mcp-web': { url } } }),
  },
  'claude-desktop': {
    name: 'Claude Desktop',
    resolvePath: claudeDesktopPath,
    merge: (e, url) => ({ ...e, mcpServers: { ...(e['mcpServers'] as object || {}), 'turn-mcp-web': { url } } }),
  },
  vscode: {
    name: 'VS Code',
    resolvePath: vscodePath,
    merge: (e, url) => ({ ...e, servers: { ...(e['servers'] as object || {}), 'turn-mcp-web': { type: 'http', url } } }),
  },
  'claude-code': {
    name: 'Claude Code',
    resolvePath: () => path.join(os.homedir(), '.claude.json'),
    merge: (e, url) => ({ ...e, mcpServers: { ...(e['mcpServers'] as object || {}), 'turn-mcp-web': { type: 'http', url } } }),
  },
  opencode: {
    name: 'OpenCode',
    resolvePath: () => path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
    merge: (e, url) => ({
      ...e,
      '$schema': 'https://opencode.ai/config.json',
      mcp: { ...(e['mcp'] as object || {}), 'turn-mcp-web': { type: 'remote', url, enabled: true } },
    }),
  },
  antigravity: {
    name: 'Antigravity',
    resolvePath: antigravityPath,
    merge: (e, url) => ({ ...e, mcpServers: { ...(e['mcpServers'] as object || {}), 'turn-mcp-web': { url } } }),
  },
  openclaw: {
    name: 'OpenClaw',
    resolvePath: () => path.join(os.homedir(), 'openclaw.json'),
    merge: (e, url) => ({ ...e, mcpServers: { ...(e['mcpServers'] as object || {}), 'turn-mcp-web': { type: 'http', url } } }),
  },
};

export const TARGETED_CLIENTS = Object.keys(CLIENT_DEFS);

// ─── JSON helpers ─────────────────────────────────────────────────────────────

function readJson(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeJson(filePath: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function hasTurnMcpWeb(config: Record<string, unknown>): boolean {
  for (const key of ['mcpServers', 'servers', 'mcp']) {
    const section = config[key] as Record<string, unknown> | undefined;
    if (section && typeof section === 'object' && 'turn-mcp-web' in section) return true;
  }
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Check the current status of a client config without modifying it. */
export function checkClientStatus(
  target: string,
  _serverUrl: string
): 'configured' | 'not-configured' | 'not-found' {
  if (target === 'system-shell') {
    const home = os.homedir();
    for (const p of ['.zshrc', '.bashrc', '.profile'].map(f => path.join(home, f))) {
      if (fs.existsSync(p) && fs.readFileSync(p, 'utf-8').includes('TURN_MCP_SERVER=')) return 'configured';
    }
    return 'not-configured';
  }
  if (target === 'system-mcp') {
    const p = path.join(os.homedir(), '.config', 'mcp', 'servers.json');
    if (!fs.existsSync(p)) return 'not-configured';
    return hasTurnMcpWeb(readJson(p)) ? 'configured' : 'not-configured';
  }

  const def = CLIENT_DEFS[target];
  if (!def) return 'not-found';
  const filePath = def.resolvePath();
  if (!fs.existsSync(filePath)) return 'not-found';
  return hasTurnMcpWeb(readJson(filePath)) ? 'configured' : 'not-configured';
}

/** Write turn-mcp-web into a specific client's config file. */
export function configureClient(target: string, serverUrl: string): ConfigResult {
  const def = CLIENT_DEFS[target];
  if (!def) {
    return { target, name: target, displayPath: target, action: 'error', error: `Unknown client: ${target}` };
  }
  const filePath = def.resolvePath();
  const displayPath = tildify(filePath);

  try {
    const existing = readJson(filePath);
    if (hasTurnMcpWeb(existing)) {
      return { target, name: def.name, displayPath, action: 'already-configured' };
    }
    const merged = def.merge(existing, serverUrl);
    writeJson(filePath, merged);
    const action: ConfigAction = Object.keys(existing).length === 0 ? 'created' : 'updated';
    logger.info(`Configured ${def.name} → ${filePath} (${action})`);
    return { target, name: def.name, displayPath, action };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`configure ${def.name}`, err);
    return { target, name: def.name, displayPath, action: 'error', error };
  }
}

/**
 * Write TURN_MCP_SERVER env var to the user's shell profile (~/.zshrc etc.).
 * Used for "system environment" mode so any client that inherits env can find it.
 */
export function configureSystemShell(serverUrl: string): ConfigResult {
  const home = os.homedir();
  const profiles = ['.zshrc', '.bashrc', '.profile'].map(f => path.join(home, f));
  const marker = 'TURN_MCP_SERVER=';
  const lines = `\n# turn-mcp-web – auto-added by turn-mcp-web server\nexport TURN_MCP_SERVER="${serverUrl}"\n`;

  // Prefer the first profile that already exists
  let target = path.join(home, '.zshrc');
  for (const p of profiles) {
    if (fs.existsSync(p)) { target = p; break; }
  }
  const displayPath = tildify(target);

  try {
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : '';
    if (existing.includes(marker)) {
      return { target: 'system-shell', name: 'Shell Profile', displayPath, action: 'already-configured' };
    }
    fs.appendFileSync(target, lines, 'utf-8');
    logger.info(`Added TURN_MCP_SERVER to ${target}`);
    return { target: 'system-shell', name: 'Shell Profile', displayPath, action: 'updated' };
  } catch (err) {
    return { target: 'system-shell', name: 'Shell Profile', displayPath, action: 'error', error: String(err) };
  }
}

/**
 * Write to ~/.config/mcp/servers.json — a generic discovery file
 * that some clients and tooling scan for available MCP servers.
 */
export function configureSystemMcp(serverUrl: string): ConfigResult {
  const filePath = path.join(os.homedir(), '.config', 'mcp', 'servers.json');
  const displayPath = tildify(filePath);

  try {
    const existing = readJson(filePath);
    if (hasTurnMcpWeb(existing)) {
      return { target: 'system-mcp', name: 'System MCP Registry', displayPath, action: 'already-configured' };
    }
    const merged = {
      ...existing,
      mcpServers: { ...(existing['mcpServers'] as object || {}), 'turn-mcp-web': { url: serverUrl } },
    };
    writeJson(filePath, merged);
    logger.info(`Updated system MCP registry → ${filePath}`);
    return { target: 'system-mcp', name: 'System MCP Registry', displayPath, action: Object.keys(existing).length === 0 ? 'created' : 'updated' };
  } catch (err) {
    return { target: 'system-mcp', name: 'System MCP Registry', displayPath, action: 'error', error: String(err) };
  }
}

/** Bulk configure: run configureClient for every listed target. */
export function configureBatch(
  targets: string[],
  serverUrl: string
): ConfigResult[] {
  return targets.map(t => {
    if (t === 'system-shell') return configureSystemShell(serverUrl);
    if (t === 'system-mcp')   return configureSystemMcp(serverUrl);
    return configureClient(t, serverUrl);
  });
}

// ─── Unconfigure (remove turn-mcp-web from configs) ──────────────────────────

/** Remove turn-mcp-web entry from a specific client's config file. */
export function unconfigureClient(target: string): ConfigResult {
  const def = CLIENT_DEFS[target];
  if (!def) {
    return { target, name: target, displayPath: target, action: 'error', error: `Unknown client: ${target}` };
  }
  const filePath = def.resolvePath();
  const displayPath = tildify(filePath);

  if (!fs.existsSync(filePath)) {
    return { target, name: def.name, displayPath, action: 'not-found' };
  }

  try {
    const config = readJson(filePath);
    let changed = false;
    for (const key of ['mcpServers', 'servers', 'mcp'] as const) {
      const section = config[key] as Record<string, unknown> | undefined;
      if (section && 'turn-mcp-web' in section) {
        const copy = { ...section };
        delete copy['turn-mcp-web'];
        config[key] = copy;
        changed = true;
      }
    }
    if (!changed) {
      return { target, name: def.name, displayPath, action: 'not-configured' };
    }
    writeJson(filePath, config);
    logger.info(`Removed turn-mcp-web from ${def.name} → ${filePath}`);
    return { target, name: def.name, displayPath, action: 'updated' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error(`unconfigure ${def.name}`, err);
    return { target, name: def.name, displayPath, action: 'error', error };
  }
}

/** Remove TURN_MCP_SERVER line from shell profile. */
export function unconfigureSystemShell(): ConfigResult {
  const home = os.homedir();
  const profiles = ['.zshrc', '.bashrc', '.profile'].map(f => path.join(home, f));
  const marker = 'TURN_MCP_SERVER=';
  let cleaned = 0;
  let lastTarget = path.join(home, '.zshrc');

  for (const p of profiles) {
    if (!fs.existsSync(p)) continue;
    lastTarget = p;
    const content = fs.readFileSync(p, 'utf-8');
    if (!content.includes(marker)) continue;
    // Remove the export line and the comment line immediately before it
    const cleaned_content = content
      .split('\n')
      .filter((line, idx, arr) => {
        if (line.includes(marker)) return false;
        // also remove the auto-added comment line right before the env line
        if (line.trim().startsWith('# turn-mcp-web') &&
            idx + 1 < arr.length && arr[idx + 1].includes(marker)) return false;
        return true;
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n'); // collapse excessive blank lines
    fs.writeFileSync(p, cleaned_content, 'utf-8');
    cleaned++;
    logger.info(`Removed TURN_MCP_SERVER from ${p}`);
  }

  const displayPath = tildify(lastTarget);
  if (cleaned === 0) {
    return { target: 'system-shell', name: 'Shell Profile', displayPath, action: 'not-configured' };
  }
  return { target: 'system-shell', name: 'Shell Profile', displayPath, action: 'updated' };
}

/** Remove turn-mcp-web from ~/.config/mcp/servers.json. */
export function unconfigureSystemMcp(): ConfigResult {
  const filePath = path.join(os.homedir(), '.config', 'mcp', 'servers.json');
  const displayPath = tildify(filePath);

  if (!fs.existsSync(filePath)) {
    return { target: 'system-mcp', name: 'System MCP Registry', displayPath, action: 'not-found' };
  }

  try {
    const config = readJson(filePath);
    if (!hasTurnMcpWeb(config)) {
      return { target: 'system-mcp', name: 'System MCP Registry', displayPath, action: 'not-configured' };
    }
    const section = config['mcpServers'] as Record<string, unknown>;
    if (section) {
      const copy = { ...section };
      delete copy['turn-mcp-web'];
      config['mcpServers'] = copy;
    }
    writeJson(filePath, config);
    logger.info(`Removed turn-mcp-web from system MCP registry`);
    return { target: 'system-mcp', name: 'System MCP Registry', displayPath, action: 'updated' };
  } catch (err) {
    return { target: 'system-mcp', name: 'System MCP Registry', displayPath, action: 'error', error: String(err) };
  }
}

/** Bulk unconfigure. */
export function unconfigureBatch(targets: string[]): ConfigResult[] {
  return targets.map(t => {
    if (t === 'system-shell') return unconfigureSystemShell();
    if (t === 'system-mcp')   return unconfigureSystemMcp();
    return unconfigureClient(t);
  });
}
