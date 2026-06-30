import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import { listActions, createAction, updateAction, deleteAction } from './api.js';

const DATE_FIN_CEJ = new Date('2026-07-21');

const GIT_REPOS = [
  'C:/Users/Romann/Desktop/Codage/magicGarden - Copie',
  'C:/Users/Romann/Desktop/Codage/mgafk-android',
  'F:/FridaIL2CPPToolkit',
  'C:/Users/Romann/Desktop/Codage/cej',
];

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
        const date = line.slice(0, pipeIdx);
        const message = line.slice(pipeIdx + 1);
        const repoName = repo.split(/[/\\]/).pop();
        commits.push({ date, message, repo: repoName });
      }
    } catch {
      // repo inaccessible ou vide — on skip
    }
  }

  const byDate = {};
  for (const { date, message, repo } of commits) {
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(`[${repo}] ${message}`);
  }
  return Object.fromEntries(Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)));
}

// ─── Serveur MCP ──────────────────────────────────────────────────────────────

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
      description: 'Liste toutes les actions CEJ triées par date décroissante (id, status, date, content, comment, qualification).',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'cej_create_actions',
      description: [
        'Crée une ou plusieurs actions CEJ. Règles importantes :',
        '- Sport (CULTURE_SPORT_LOISIRS) est un bonus — il doit TOUJOURS être accompagné d\'une action dev/emploi le même jour.',
        '- status est toujours "done".',
        '- dateEcheance au format ISO 8601 : "2026-07-01T12:00:00.000Z".',
      ].join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            description: 'Liste des actions à créer',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Ex: "Developpement", "Sport", "Candidature", "Recherche d\'emploi"' },
                comment: { type: 'string', description: 'Court et factuel, 1-2 phrases max' },
                dateEcheance: { type: 'string', description: 'ISO 8601 ex: "2026-07-01T12:00:00.000Z"' },
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
      description: 'Supprime une action CEJ par son ID (remet à not_started puis supprime). Utiliser cej_list_actions pour trouver l\'ID.',
      inputSchema: {
        type: 'object',
        properties: {
          idAction: { type: 'string', description: 'ID de l\'action à supprimer' },
        },
        required: ['idAction'],
      },
    },
    {
      name: 'cej_git_activity',
      description: 'Récupère les commits git de tous les repos de Romann sur une plage de dates. Utile pour décrire concrètement les activités dev avant de créer les actions CEJ.',
      inputSchema: {
        type: 'object',
        properties: {
          dateFrom: { type: 'string', description: 'Date de début YYYY-MM-DD (incluse)' },
          dateTo: { type: 'string', description: 'Date de fin YYYY-MM-DD (incluse)' },
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
      const sorted = [...actions].sort((a, b) =>
        (b.dateEcheance ?? '').localeCompare(a.dateEcheance ?? '')
      );
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
      return {
        content: [{
          type: 'text',
          text: `${ok}/${actions.length} actions créées.\n\n${JSON.stringify(results, null, 2)}`,
        }],
      };
    }

    if (name === 'cej_delete_action') {
      const { idAction } = args;
      await updateAction(idAction, { status: 'not_started' });
      await deleteAction(idAction);
      return { content: [{ type: 'text', text: `Action ${idAction} supprimée.` }] };
    }

    if (name === 'cej_git_activity') {
      const { dateFrom, dateTo } = args;
      const activity = getGitActivity(dateFrom, dateTo);
      const dayCount = Object.keys(activity).length;
      const commitCount = Object.values(activity).flat().length;
      return {
        content: [{
          type: 'text',
          text: `${commitCount} commits sur ${dayCount} jours (${dateFrom} → ${dateTo})\n\n${JSON.stringify(activity, null, 2)}`,
        }],
      };
    }

    return { content: [{ type: 'text', text: `Outil inconnu : ${name}` }], isError: true };

  } catch (err) {
    return { content: [{ type: 'text', text: `Erreur : ${err.message}` }], isError: true };
  }
});

// ─── Démarrage ────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
