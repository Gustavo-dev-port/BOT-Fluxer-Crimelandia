import { JOIN_EMOJI, tournamentEmbed } from '../../embeds/tournamentEmbed.js';
import { prisma } from '../../database/client.js';
import type { FluxerClient } from '../../fluxer/client.js';
import { sendTo } from '../channels.js';

/** Publica o anúncio do campeonato em #eventos (com ✅ para inscrição) e guarda a mensagem. */
export async function announceTournament(client: FluxerClient, tournamentId: number, intro?: string) {
  const t = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  const msg = await sendTo(client, 'events', {
    content: intro,
    embeds: [await tournamentEmbed(tournamentId)],
    allowed_mentions: { parse: ['everyone'] },
  });
  if (!msg) return null;
  await prisma.tournament.update({ where: { id: tournamentId }, data: { messageId: msg.id, channelId: msg.channel_id } });
  if (t.teamSize === 1) await client.rest.addReaction(msg.channel_id, msg.id, JOIN_EMOJI).catch(() => undefined);
  return msg;
}

/** Atualiza o anúncio original (lista de inscritos / chave). */
export async function refreshTournamentMessage(client: FluxerClient, tournamentId: number) {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!t?.messageId || !t.channelId) return;
  await client.rest
    .editMessage(t.channelId, t.messageId, { embeds: [await tournamentEmbed(tournamentId)], allowed_mentions: { parse: [] } })
    .catch(() => undefined);
}
