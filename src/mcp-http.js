import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMCPServer } from './server.js';

const PORT = process.env.PORT ?? 3000;
const BASE_URL = (process.env.BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');
const OAUTH_TOKEN = process.env.OAUTH_TOKEN ?? 'cej-token-2026';
const GIT_REPOS = (process.env.GIT_REPOS ?? '').split(',').map(s => s.trim()).filter(Boolean);

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.use(express.json());

// ─── OAuth 2.0 (auto-approve — usage perso uniquement) ───────────────────────

app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
  });
});

app.get('/authorize', (req, res) => {
  const { redirect_uri, state } = req.query;
  if (!redirect_uri) { res.status(400).send('Missing redirect_uri'); return; }
  const url = new URL(String(redirect_uri));
  url.searchParams.set('code', 'cej-auth-code');
  if (state) url.searchParams.set('state', String(state));
  res.redirect(url.toString());
});

app.post('/token', express.urlencoded({ extended: true }), (req, res) => {
  res.json({ access_token: OAUTH_TOKEN, token_type: 'Bearer', expires_in: 31536000 });
});

// ─── MCP endpoint ─────────────────────────────────────────────────────────────

app.all('/mcp', async (req, res) => {
  const auth = req.headers['authorization'] ?? '';
  if (auth !== `Bearer ${OAUTH_TOKEN}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const server = createMCPServer(GIT_REPOS);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
  res.on('close', () => server.close().catch(() => {}));
});

app.get('/health', (req, res) => res.json({ ok: true, tools: 16 }));

app.listen(PORT, () => {
  console.error(`CEJ MCP server on port ${PORT} — ${BASE_URL}`);
});
