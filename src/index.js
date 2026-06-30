import { listActions, createAction, updateAction, deleteAction } from './api.js';

const DATE_FIN_CEJ = new Date('2026-07-21');

const STATUS_LABEL = {
  done: '✅ fait',
  not_started: '⏳ prévu',
  in_progress: '🔄 en cours',
};

function datesInRange(from, to) {
  const dates = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function groupByMonth(actions) {
  const groups = new Map();
  for (const action of actions) {
    const month = (action.dateEcheance ?? action.dateCreation ?? '').slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(action);
  }
  return new Map([...groups.entries()].sort());
}

// ─── Commandes ────────────────────────────────────────────────────────────────

async function cmdList() {
  const actions = await listActions();
  const sorted = [...actions].sort((a, b) =>
    (b.dateEcheance ?? b.dateCreation ?? '').localeCompare(a.dateEcheance ?? a.dateCreation ?? '')
  );

  for (const [month, list] of groupByMonth(sorted)) {
    const doneCount = list.filter(a => a.status === 'done').length;
    console.log(`\n📅 ${month}  (${doneCount}/${list.length} faites)`);
    console.log('─'.repeat(60));
    for (const action of list) {
      const label = STATUS_LABEL[action.status] ?? action.status;
      console.log(`  ${label}  ${(action.dateEcheance ?? '').slice(0, 10)}  ${action.content}`);
      if (action.comment) console.log(`            └─ ${action.comment.trim()}`);
    }
  }
  console.log(`\nTotal : ${actions.length} actions`);
}

async function cmdStats() {
  const actions = await listActions();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysLeft = Math.ceil((DATE_FIN_CEJ - today) / 86400000);
  const weeksLeft = Math.floor(daysLeft / 7);
  const TARGET_PER_WEEK = 5;

  const thisMonth = today.toISOString().slice(0, 7);
  const doneThisMonth = actions.filter(
    a => a.status === 'done' && (a.dateEcheance ?? a.dateCreation ?? '').startsWith(thisMonth)
  ).length;

  console.log('\n═══════════════════ CEJ — STATS ═══════════════════');
  console.log(`📅 Fin CEJ           : 21 juillet 2026`);
  console.log(`⏳ Jours restants    : ${daysLeft} jours (${weeksLeft} semaines)`);
  console.log(`✅ Actions faites    : ${actions.filter(a => a.status === 'done').length}`);
  console.log(`⏳ Actions prévues   : ${actions.filter(a => a.status !== 'done').length}`);
  console.log(`📆 Faites ce mois    : ${doneThisMonth}`);
  console.log(`🎯 Objectif restant  : ~${weeksLeft * TARGET_PER_WEEK} actions (${TARGET_PER_WEEK}/sem)`);
  console.log(`📊 Total actions     : ${actions.length}`);
  console.log('═══════════════════════════════════════════════════\n');
}

async function cmdCreate(args) {
  if (args.length < 4) {
    console.log('Usage: node src/index.js create "<contenu>" "<commentaire>" <dateDebut> <dateFin> [codeQualif]');
    console.log('\nCodes : PROJET_PROFESSIONNEL | CULTURE_SPORT_LOISIRS | EMPLOI | FORMATION | SANTE | LOGEMENT | CITOYENNETE');
    process.exit(1);
  }

  const [content, comment, fromStr, toStr, codeQualification = 'PROJET_PROFESSIONNEL'] = args;
  const from = new Date(fromStr);
  const to = new Date(toStr);

  if (isNaN(from) || isNaN(to)) {
    console.error('Dates invalides — format attendu : YYYY-MM-DD');
    process.exit(1);
  }

  const dates = datesInRange(from, to);
  console.log(`\nCréation de ${dates.length} actions (${fromStr} → ${toStr})`);
  console.log(`  ${content} — ${comment} [${codeQualification}]\n`);

  let created = 0;
  for (const date of dates) {
    try {
      await createAction({ content, comment, dateEcheance: `${date}T12:00:00.000Z`, status: 'done', codeQualification });
      console.log(`  ✅ ${date}`);
      created++;
    } catch (err) {
      console.log(`  ❌ ${date} — ${err.message}`);
    }
  }
  console.log(`\n${created}/${dates.length} actions créées.`);
}

async function cmdDelete(args) {
  if (!args[0]) {
    console.error('Usage: node src/index.js delete <idAction>');
    process.exit(1);
  }
  const id = args[0];
  try {
    await updateAction(id, { status: 'not_started' });
    await deleteAction(id);
    console.log(`Supprimée : ${id}`);
  } catch (err) {
    console.error(`Erreur : ${err.message}`);
  }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

const [, , cmd, ...rest] = process.argv;

const commands = { list: cmdList, stats: cmdStats, create: cmdCreate, delete: cmdDelete };

if (commands[cmd]) {
  await commands[cmd](rest);
} else {
  console.log('Commandes disponibles : list | stats | create | delete');
}
