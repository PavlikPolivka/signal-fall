#!/usr/bin/env -S npx tsx
/**
 * Signal Fall agent server (MCP).
 *
 *   signal-fall-agent                  stdio: one agent, e.g. in Claude Code or Claude Desktop
 *   signal-fall-agent --http 7777      Streamable HTTP at http://localhost:7777/mcp: several agents
 *                                      share the matches (agent vs agent)
 *   signal-fall-agent --spectate 7778  (stdio) also serve live spectating on that port
 *
 * Spectating: http://localhost:<port>/matches lists matches with links that open the game
 * following the match live.
 */
import { createServer as createHttpServer } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MatchManager, createServer } from './server';
import { spectate } from './spectate';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? null : Number(args[i + 1]);
};
const httpPort = flag('--http');
const spectatePort = flag('--spectate');

if (httpPort === null) {
  const manager = new MatchManager();
  if (spectatePort !== null) {
    const base = `http://localhost:${spectatePort}`;
    manager.spectateBase = base;
    createHttpServer((req, res) => {
      if (!spectate(manager, base, req, res)) res.writeHead(404).end();
    }).listen(spectatePort, () => console.error(`Spectate: ${base}/matches`));
  }
  await createServer(manager).connect(new StdioServerTransport());
} else {
  const port = httpPort;
  const manager = new MatchManager();
  const base = `http://localhost:${port}`;
  manager.spectateBase = base;
  createHttpServer(async (req, res) => {
    if (spectate(manager, base, req, res)) return;
    if (req.url !== '/mcp') {
      res.writeHead(404).end('MCP endpoint is /mcp\n');
      return;
    }
    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400).end('invalid JSON\n');
        return;
      }
    }
    // Stateless: a fresh protocol session per request; matches live in the shared manager.
    const server = createServer(manager);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }).listen(port, () => console.error(`Signal Fall agent server: ${base}/mcp · spectate: ${base}/matches`));
}
