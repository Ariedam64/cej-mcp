import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import { listActions, createAction, updateAction, deleteAction } from './api.js';

const DATE_FIN_CEJ = new Date('2026-07-21');
const GIT_REPOS = (process.env.GIT_REPOS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const PORT = process.env.PORT ?? 3000;
const BASE_URL = (process.env.BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');
const OAUTH_TOKEN = process.env.OAUTH_TOKEN ?? 'cej-token-2026';

function getGitActivity(dateFrom, dateTo) {
  const commits = [];
  for (const repo of GIT_REPOS) {
    try {
      const output = execSync(
        `git -C "${repo}" log --after="${dateFrom}T00:00:00" --before="${dateTo}T23:59:59" --format="%ad|%s" --date=short`,
        { encoding: 'utf8', timeout: 10000 }
      );
      for (const line of output.trim().split('\n').filter(Boolean)) {
        const pipeIdx = line.indexOf('|');
        commits.push({ date: line.slice(0, pipeIdx), message: line.slice(pipeIdx + 1), repo: repo.split(/[/\\]/).pop() });
      }
    } catch { /* inaccessible — skip */ }
  }
  const byDate = {};
  for (const { date, message, repo } of commits) {
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(`[${repo}] ${message}`);
  }
  return Object.fromEntries(Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)));
}

function createMCPServer() {
  const server = new Server(
    { name: 'cej-actions', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'cej_stats',
        description: 'Statistiques CEJ : jours restants, actions faites, objectif hebdomadaire.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'cej_list_actions',
        description: 'Liste toutes les actions CEJ triées par date décroissante.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'cej_create_actions',
        description: [
          'Crée une ou plusieurs actions CEJ. Règles :',
          '- Sport (CULTURE_SPORT_LOISIRS) est un bonus — TOUJOURS accompagné d\'une action dev/emploi le même jour.',
          '- status est toujours "done".',
          '- dateEcheance format ISO 8601 : "2026-07-01T12:00:00.000Z".',
        ].join('\n'),
        inputSchema: {
          type: 'object',
          properties: {
            actions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  content: { type: 'string' },
                  comment: { type: 'string' },
                  dateEcheance: { type: 'string' },
                  codeQualification: {
                    type: 'string',
                    enum: ['PROJET_PROFESSIONNEL', 'CULTURE_SPORT_LOISIRS', 'EMPLOI', 'FORMATION', 'SANTE', 'LOGEMENT', 'CITOYENNETE'],
                  },
                },
                required: ['content', 'comment', 'dateEcheance', 'codeQualification'],
              },
            },
          },
          required: ['actions'],
        },
      },
      {
        name: 'cej_delete_action',
        description: 'Supprime une action CEJ (remet à not_started puis supprime).',
        inputSchema: {
          type: 'object',
          properties: { idAction: { type: 'string' } },
          required: ['idAction'],
        },
      },
      {
        name: 'cej_git_activity',
        description: 'Récupère les commits git des repos configurés sur une plage de dates.',
        inputSchema: {
          type: 'object',
          properties: {
            dateFrom: { type: 'string', description: 'YYYY-MM-DD' },
            dateTo: { type: 'string', description: 'YYYY-MM-DD' },
          },
          required: ['dateFrom', 'dateTo'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      if (name === 'cej_stats') {
        const actions = await listActions();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysLeft = Math.ceil((DATE_FIN_CEJ - today) / 86400000);
        const weeksLeft = Math.floor(daysLeft / 7);
        const thisMonth = today.toISOString().slice(0, 7);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              finCEJ: '21 juillet 2026',
              joursRestants: daysLeft,
              semainesRestantes: weeksLeft,
              actionsFaites: actions.filter(a => a.status === 'done').length,
              actionsPrevues: actions.filter(a => a.status !== 'done').length,
              faitCeMois: actions.filter(a => a.status === 'done' && (a.dateEcheance ?? '').startsWith(thisMonth)).length,
              objectifRestant: `~${weeksLeft * 5} actions (5/sem)`,
              total: actions.length,
            }, null, 2),
          }],
        };
      }

      if (name === 'cej_list_actions') {
        const actions = await listActions();
        const sorted = [...actions].sort((a, b) => (b.dateEcheance ?? '').localeCompare(a.dateEcheance ?? ''));
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(sorted.map(a => ({
              id: a.id,
              status: a.status,
              date: (a.dateEcheance ?? '').slice(0, 10),
              content: a.content,
              comment: a.comment,
              qualification: a.codeQualification,
            })), null, 2),
          }],
        };
      }

      if (name === 'cej_create_actions') {
        const { actions } = args;
        const results = [];
        for (const action of actions) {
          try {
            await createAction({ ...action, status: 'done' });
            results.push({ ok: true, date: action.dateEcheance.slice(0, 10), content: action.content });
          } catch (err) {
            results.push({ ok: false, date: action.dateEcheance.slice(0, 10), content: action.content, error: err.message });
          }
        }
        const ok = results.filter(r => r.ok).length;
        return { content: [{ type: 'text', text: `${ok}/${actions.length} actions créées.\n\n${JSON.stringify(results, null, 2)}` }] };
      }

      if (name === 'cej_delete_action') {
        const { idAction } = args;
        await updateAction(idAction, { status: 'not_started' });
        await deleteAction(idAction);
        return { content: [{ type: 'text', text: `Action ${idAction} supprimée.` }] };
      }

      if (name === 'cej_git_activity') {
        const { dateFrom, dateTo } = args;
        if (GIT_REPOS.length === 0) {
          return { content: [{ type: 'text', text: 'Git activity non disponible en mode cloud. Décris tes activités directement.' }] };
        }
        const activity = getGitActivity(dateFrom, dateTo);
        const commitCount = Object.values(activity).flat().length;
        return { content: [{ type: 'text', text: `${commitCount} commits sur ${Object.keys(activity).length} jours\n\n${JSON.stringify(activity, null, 2)}` }] };
      }

      return { content: [{ type: 'text', text: `Outil inconnu : ${name}` }], isError: true };
    } catch (err) {
      return { content: [{ type: 'text', text: `Erreur : ${err.message}` }], isError: true };
    }
  });

  return server;
}

// ─── Express app ──────────────────────────────────────────────────────────────

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
  const server = createMCPServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
  res.on('close', () => server.close().catch(() => {}));
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.error(`CEJ MCP server on port ${PORT} — ${BASE_URL}`);
});
