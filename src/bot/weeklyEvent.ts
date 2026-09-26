import { config } from '../config.js';
import type { FluxerClient } from '../fluxer/client.js';
import { TournamentFormat, UserError } from '../lib/types.js';
import { cancelTournament, createTournament, dueWeeklyEvents, startTournament } from '../services/tournaments.js';
import { announceTournamentProgress } from './announcer.js';
import { sendTo } from './channels.js';
import { announceTournament, JOIN_EMOJI, refreshTournamentMessage } from './tournamentView.js';

/** Posta o evento semanal em #eventos; quem reagir com ✅ entra na chave. */
export async function openWeeklyEvent(client: FluxerClient, createdById = 'bot') {
  const t = await createTournament({
    name: config.weeklyEvent.name,
    game: config.weeklyEvent.game,
    format: TournamentFormat.SINGLE_ELIM,
    teamSize: 1,
    createdById,
    isWeekly: true,
    closesAt: new Date(Date.now() + config.weeklyEvent.registrationMinutes * 60_000),
  });
  await announceTournament(client, t.id, `@here 🎮 **${config.weeklyEvent.name} começou!** Reaja com ${JOIN_EMOJI} para participar.`);
  return t;
}

/** Fecha as inscrições vencidas e gera as chaves. */
export async function closeDueWeeklyEvents(client: FluxerClient) {
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
