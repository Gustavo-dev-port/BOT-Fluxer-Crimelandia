import type { Client } from 'discord.js';
import { config } from '../config.js';
import { TournamentFormat, UserError } from '../lib/types.js';
import { cancelTournament, createTournament, dueWeeklyEvents, startTournament } from '../services/tournaments.js';
import { announceTournamentProgress } from './announcer.js';
import { sendTo } from './channels.js';
import { announceTournament, refreshTournamentMessage } from './tournamentView.js';

export const JOIN_EMOJI = '✅';

/** Posta o evento semanal em #eventos; quem reagir com ✅ entra na chave. */
export async function openWeeklyEvent(client: Client, createdById = 'bot') {
  const t = await createTournament({
    name: config.weeklyEvent.name,
    game: config.weeklyEvent.game,
    format: TournamentFormat.SINGLE_ELIM,
    teamSize: 1,
    createdById,
    isWeekly: true,
    closesAt: new Date(Date.now() + config.weeklyEvent.registrationMinutes * 60_000),
  });
  const msg = await announceTournament(
    client,
    t.id,
    `@here 🎮 **${config.weeklyEvent.name} começou!** Reaja com ${JOIN_EMOJI} para participar.`,
  );
  await msg?.react(JOIN_EMOJI).catch(() => undefined);
  return t;
}

/** Fecha as inscrições vencidas e gera as chaves. */
export async function closeDueWeeklyEvents(client: Client) {
  for (const t of await dueWeeklyEvents()) {
    try {
      const progress = await startTournament(t.id);
      await refreshTournamentMessage(client, t.id);
      await announceTournamentProgress(client, progress);
    } catch (err) {
      if (!(err instanceof UserError)) throw err;
      // Poucos inscritos: cancela o evento desta semana.
      await cancelTournament(t.id);
      await refreshTournamentMessage(client, t.id);
      await sendTo(client, 'events', { content: `😴 **${t.name}** cancelado: ${err.message}` });
    }
  }
}
