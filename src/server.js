import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import {
  listActions, createAction, updateAction, deleteAction,
  getActionsByDateRange, getActionDetails, getActionComments, addActionComment,
  getProfile, getConseillers, getNotifications, getAgenda,
  getAnimationsCollectives, searchMessages, sendMessage,
} from './api.js';

const DATE_FIN_CEJ = new Date('2026-07-21');

const ALL_TOOLS = [
  {
    name: 'cej_stats',
    description: 'Statistiques CEJ : jours restants, actions faites ce mois, objectif hebdomadaire.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cej_profile',
    description: 'Profil du jeune (nom, email, situation) + historique des conseillers.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cej_agenda',
    description: 'Agenda à venir : rendez-vous et actions planifiées.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cej_notifications',
    description: 'Liste les notifications récentes (messages, actions, rendez-vous).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cej_animations',
    description: 'Liste les animations collectives (ateliers, événements) disponibles.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cej_list_actions',
    description: 'Liste toutes les actions CEJ triées par date décroissante (id, status, date, content, comment, qualification).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cej_actions_by_date',
    description: 'Liste les actions CEJ sur une plage de dates précise.',
    inputSchema: {
      type: 'object',
      properties: {
        dateDebut: { type: 'string', description: 'Date de début YYYY-MM-DD' },
        dateFin: { type: 'string', description: 'Date de fin YYYY-MM-DD' },
      },
      required: ['dateDebut', 'dateFin'],
    },
  },
  {
    name: 'cej_create_actions',
    description: [
      'Crée une ou plusieurs actions CEJ. Règles importantes :',
      '- Sport (CULTURE_SPORT_LOISIRS) est un bonus — TOUJOURS accompagné d\'une action dev/emploi le même jour.',
      '- status est toujours "done".',
      '- dateEcheance au format ISO 8601 : "2026-07-01T12:00:00.000Z".',
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
    description: 'Supprime une action CEJ par son ID (remet à not_started puis supprime).',
    inputSchema: {
      type: 'object',
      properties: { idAction: { type: 'string' } },
      required: ['idAction'],
    },
  },
  {
    name: 'cej_action_details',
    description: 'Affiche le détail complet d\'une action CEJ (titre, statut, commentaires, qualification).',
    inputSchema: {
      type: 'object',
      properties: { idAction: { type: 'string' } },
      required: ['idAction'],
    },
  },
  {
    name: 'cej_action_comments',
    description: 'Liste les commentaires d\'une action CEJ.',
    inputSchema: {
      type: 'object',
      properties: { idAction: { type: 'string' } },
      required: ['idAction'],
    },
  },
  {
    name: 'cej_add_comment',
    description: 'Ajoute un commentaire à une action CEJ.',
    inputSchema: {
      type: 'object',
      properties: {
        idAction: { type: 'string' },
        comment: { type: 'string', description: 'Texte du commentaire' },
      },
      required: ['idAction', 'comment'],
    },
  },
  {
    name: 'cej_search_messages',
    description: 'Cherche un mot-clé dans la conversation avec le conseiller.',
    inputSchema: {
      type: 'object',
      properties: { recherche: { type: 'string', description: 'Mot-clé à chercher' } },
      required: ['recherche'],
    },
  },
  {
    name: 'cej_send_message',
    description: 'Envoie un message au conseiller. Nécessite l\'idConversation (visible dans cej_profile).',
    inputSchema: {
      type: 'object',
      properties: {
        idConversation: { type: 'string', description: 'ID de la conversation (obtenu via cej_profile)' },
        message: { type: 'string', description: 'Texte du message à envoyer' },
      },
      required: ['idConversation', 'message'],
    },
  },
  {
    name: 'cej_git_activity',
    description: 'Récupère les commits git des repos de Romann sur une plage de dates. Utile pour décrire les activités dev avant de créer les actions CEJ.',
    inputSchema: {
      type: 'object',
      properties: {
        dateFrom: { type: 'string', description: 'Date de début YYYY-MM-DD' },
        dateTo: { type: 'string', description: 'Date de fin YYYY-MM-DD' },
      },
      required: ['dateFrom', 'dateTo'],
    },
  },
];

function getGitActivity(dateFrom, dateTo, gitRepos) {
  const commits = [];
  for (const repo of gitRepos) {
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

export function createMCPServer(gitRepos = []) {
  const server = new Server(
    { name: 'cej-actions', version: '2.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ALL_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // ── Stats ──────────────────────────────────────────────────────────────
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

      // ── Profil ─────────────────────────────────────────────────────────────
      if (name === 'cej_profile') {
        const [profile, conseillers] = await Promise.all([getProfile(), getConseillers()]);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ profile, conseillers }, null, 2),
          }],
        };
      }

      // ── Agenda ─────────────────────────────────────────────────────────────
      if (name === 'cej_agenda') {
        const agenda = await getAgenda();
        return { content: [{ type: 'text', text: JSON.stringify(agenda, null, 2) }] };
      }

      // ── Notifications ──────────────────────────────────────────────────────
      if (name === 'cej_notifications') {
        const notifs = await getNotifications();
        return { content: [{ type: 'text', text: JSON.stringify(notifs, null, 2) }] };
      }

      // ── Animations collectives ─────────────────────────────────────────────
      if (name === 'cej_animations') {
        const animations = await getAnimationsCollectives();
        return { content: [{ type: 'text', text: JSON.stringify(animations, null, 2) }] };
      }

      // ── Liste actions ──────────────────────────────────────────────────────
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

      // ── Actions par date ───────────────────────────────────────────────────
      if (name === 'cej_actions_by_date') {
        const { dateDebut, dateFin } = args;
        const actions = await getActionsByDateRange(dateDebut, dateFin);
        return { content: [{ type: 'text', text: JSON.stringify(actions, null, 2) }] };
      }

      // ── Créer actions ──────────────────────────────────────────────────────
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

      // ── Supprimer action ───────────────────────────────────────────────────
      if (name === 'cej_delete_action') {
        const { idAction } = args;
        await updateAction(idAction, { status: 'not_started' });
        await deleteAction(idAction);
        return { content: [{ type: 'text', text: `Action ${idAction} supprimée.` }] };
      }

      // ── Détail action ──────────────────────────────────────────────────────
      if (name === 'cej_action_details') {
        const { idAction } = args;
        const detail = await getActionDetails(idAction);
        return { content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }] };
      }

      // ── Commentaires action ────────────────────────────────────────────────
      if (name === 'cej_action_comments') {
        const { idAction } = args;
        const comments = await getActionComments(idAction);
        return { content: [{ type: 'text', text: JSON.stringify(comments, null, 2) }] };
      }

      // ── Ajouter commentaire ────────────────────────────────────────────────
      if (name === 'cej_add_comment') {
        const { idAction, comment } = args;
        await addActionComment(idAction, comment);
        return { content: [{ type: 'text', text: `Commentaire ajouté à l'action ${idAction}.` }] };
      }

      // ── Recherche messages ─────────────────────────────────────────────────
      if (name === 'cej_search_messages') {
        const { recherche } = args;
        const results = await searchMessages(recherche);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      // ── Envoyer message ────────────────────────────────────────────────────
      if (name === 'cej_send_message') {
        const { idConversation, message } = args;
        await sendMessage(idConversation, message);
        return { content: [{ type: 'text', text: `Message envoyé dans la conversation ${idConversation}.` }] };
      }

      // ── Git activity ───────────────────────────────────────────────────────
      if (name === 'cej_git_activity') {
        const { dateFrom, dateTo } = args;
        if (gitRepos.length === 0) {
          return { content: [{ type: 'text', text: 'Git activity non disponible en mode cloud. Décris tes activités directement.' }] };
        }
        const activity = getGitActivity(dateFrom, dateTo, gitRepos);
        const commitCount = Object.values(activity).flat().length;
        return {
          content: [{
            type: 'text',
            text: `${commitCount} commits sur ${Object.keys(activity).length} jours\n\n${JSON.stringify(activity, null, 2)}`,
          }],
        };
      }

      return { content: [{ type: 'text', text: `Outil inconnu : ${name}` }], isError: true };

    } catch (err) {
      return { content: [{ type: 'text', text: `Erreur : ${err.message}` }], isError: true };
    }
  });

  return server;
}
