#!/usr/bin/env -S npx tsx
/**
 * Signal Fall agent server (MCP).
 *
 *   signal-fall-agent              stdio: one agent, e.g. in Claude Code or Claude Desktop
 *   signal-fall-agent --http 7777  Streamable HTTP at http://localhost:7777/mcp: several agents
 *                                  share the matches (agent vs agent)
 */
import { createServer as createHttpServer } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MatchManager, createServer } from './server';

const args = process.argv.slice(2);
const httpAt = args.indexOf('--http');

if (httpAt < 0) {
  await createServer().connect(new StdioServerTransport());
} else {
  const port = Number(args[httpAt + 1] ?? 7777);
  const manager = new MatchManager();
  createHttpServer(async (req, res) => {
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
  }).listen(port, () => console.error(`Signal Fall agent server: http://localhost:${port}/mcp`));
}
