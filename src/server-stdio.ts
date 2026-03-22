#!/usr/bin/env node
/**
 * Stdio entrypoint for Claude Desktop, Cline, Continue, and other clients
 * that launch MCP servers via stdin/stdout.
 *
 * Automatically injects --stdio into argv so the main server starts in
 * stdio mode (MCP on stdin/stdout + web console on HTTP).
 *
 * Claude Desktop config example:
 *   {
 *     "mcpServers": {
 *       "turn-mcp-web": {
 *         "command": "npx",
 *         "args": ["turn-mcp-web-stdio"]
 *       }
 *     }
 *   }
 */
if (!process.argv.includes('--stdio')) {
  process.argv.push('--stdio');
}

require('./server');
