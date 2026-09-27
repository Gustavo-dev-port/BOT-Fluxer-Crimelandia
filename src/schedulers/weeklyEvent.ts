/**
 * Night Fluxer (evento semanal, sexta 20h por padrão):
 * 1. abre a votação do jogo e a inscrição em #eventos (1️⃣–5️⃣ votam, ✅ inscreve);
 * 2. no fim do prazo, conta os votos e sorteia as equipes;
 * 3. cria uma sala de voz por equipe e gera a chave;
 * 4. resultados e ranking seguem o fluxo normal de campeonato (!resultado);
 * 5. quando o campeonato termina, apaga as salas de voz.
 */
import { config } from '../config.js';
import type { FluxerClient } from '../fluxer/client.js';
import { ChannelType } from '../fluxer/types.js';
import { UserError } from '../types/domain.js';
import { cancelTournament, dueWeeklyEvents, startTournament } from '../services/tournaments.js';
import { announceTournamentProgress } from '../services/notifications/announcer.js';
import { getChannelId, sendTo } from '../services/channels.js';
import { announceTournament, refreshTournamentMessage } from '../services/notifications/tournamentAnnouncer.js';
import { JOIN_EMOJI } from '../embeds/tournamentEmbed.js';
import { cmd } from '../embeds/format.js';
import { closeNight, createNightEvent, nightByTournament, optionsOf, setTeamVoiceChannel, settleEndedNights } from '../services/night.js';
import { VOTE_EMOJIS } from '../services/rules/night.js';
import { errorMeta, scoped } from '../utils/logger.js';

const log = scoped('night fluxer');

/** Abre o Night Fluxer: votação do jogo + inscrição no mesmo anúncio. */
export async function openWeeklyEvent(client: FluxerClient, createdById = 'bot') {
  const { tournament, event } = await createNightEvent(createdById);
  const options = optionsOf(event);
  log.info(`aberto: #${tournament.id}, votação entre ${options.join(', ') || '(sem opções)'}`);
  const msg = await announceTournament(
    client,
    tournament.id,
    `@here 🌙 **${config.weeklyEvent.name} começou!** ${options.length ? 'Vote no jogo com o número e ' : ''}reaja com ${JOIN_EMOJI} para participar. As equipes são sorteadas quando a inscrição fechar.`,
  );
  if (msg) {
    for (const emoji of VOTE_EMOJIS.slice(0, options.length)) {
      await client.rest.addReaction(msg.channel_id, msg.id, emoji).catch(() => undefined);
    }
  }
  return tournament;
}

/** Cria as salas de voz das equipes (ou a arena, no 1v1), na mesma categoria de #eventos. */
async function createTeamRooms(client: FluxerClient, eventId: number, teams: { id: number; name: string; memberIds: string[] }[]) {
  const eventsChannel = await getChannelId(client, 'events');
  const parent = eventsChannel
    ? (await client.rest.getGuildChannels(client.guildId).catch(() => [])).find((c) => c.id === eventsChannel)?.parent_id
    : undefined;
  for (const team of teams) {
    try {
      const room = await client.rest.createGuildChannel(
        client.guildId,
        {
          name: `🔊 Night #${eventId} · ${team.name}`,
          type: ChannelType.GUILD_VOICE,
          ...(parent ? { parent_id: parent } : {}),
          ...(team.name === 'Arena' ? {} : { user_limit: team.memberIds.length }),
        },
        `${config.weeklyEvent.name} #${eventId}`,
      );
      await setTeamVoiceChannel(team.id, room.id);
      log.info(`sala criada: ${team.name}`, { channel: room.id, event: eventId });
    } catch (err) {
      log.error(`falha ao criar a sala de ${team.name}`, errorMeta(err));
    }
  }
}

/** Fecha as inscrições vencidas: votação, equipes, salas e chave. */
export async function closeDueWeeklyEvents(client: FluxerClient) {
  for (const t of await dueWeeklyEvents()) {
    const night = await nightByTournament(t.id);
    try {
      if (night) {
        const closed = await closeNight(night.id);
        log.info(`votação encerrada: ${closed.game}; ${closed.teams.length} equipe(s)`, { event: night.id });
        await createTeamRooms(client, night.id, closed.teams);
      }
      const progress = await startTournament(t.id);
      await refreshTournamentMessage(client, t.id);
      if (night) {
        const fresh = await nightByTournament(t.id);
        const rooms = (fresh?.teams ?? []).map((team) => `**${team.name}**${team.voiceChannelId ? ` → <#${team.voiceChannelId}>` : ''}`);
        await sendTo(client, 'events', {
          content:
            `🌙 **${t.name}**: o jogo escolhido foi **${fresh?.game ?? t.game}**!\n` +
            (rooms.length ? `Salas de voz:\n${rooms.join('\n')}\n` : '') +
            `Registrem os resultados com ${cmd('resultado')}. Acompanhe com ${cmd('night')}.`,
        });
      }
      await announceTournamentProgress(client, progress);
    } catch (err) {
      if (!(err instanceof UserError)) throw err;
      // Poucos inscritos: cancela o evento desta semana.
      await cancelTournament(t.id);
      // Marca o Night Fluxer como cancelado e apaga salas que já tenham sido criadas.
      await cleanupEndedNights(client);
      log.info(`cancelado: ${err.message}`, { tournament: t.id });
      await refreshTournamentMessage(client, t.id);
      await sendTo(client, 'events', { content: `😴 **${t.name}** cancelado: ${err.message}` });
    }
  }
}

/** Apaga as salas de voz dos Night Fluxer que terminaram (ou foram cancelados). */
export async function cleanupEndedNights(client: FluxerClient) {
  for (const { event, voiceChannelIds } of await settleEndedNights()) {
    for (const id of voiceChannelIds) {
      await client.rest
        .deleteChannel(id, `${config.weeklyEvent.name} #${event.id} terminou`)
        .catch((err: unknown) => log.warn('falha ao apagar sala de voz', { channel: id, ...errorMeta(err) }));
    }
    log.info(`encerrado (${event.status}); ${voiceChannelIds.length} sala(s) apagada(s)`, { event: event.id });
  }
}
