import { prisma } from '../db.js';
import type { FluxerClient } from '../fluxer/client.js';
import type { Embed } from '../fluxer/types.js';
import { roundCount } from '../lib/bracket.js';
import { TournamentFormat, TournamentStatus } from '../lib/types.js';
import { entryLabel, getTournament, roundRobinTable, tournamentMatches } from '../services/tournaments.js';
import { sendTo } from './channels.js';
import { clip, cmd, Colors, medal, STATUS_LABEL, timeTag } from './format.js';

export const JOIN_EMOJI = '✅';

export const FORMAT_LABEL: Record<string, string> = {
  SINGLE_ELIM: 'Chave simples (mata-mata)',
  ROUND_ROBIN: 'Todos contra todos',
};

function roundName(round: number, total: number): string {
  const fromEnd = total - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinal';
  if (fromEnd === 2) return 'Quartas de final';
  if (fromEnd === 3) return 'Oitavas de final';
  return `Rodada ${round}`;
}

export async function tournamentEmbed(tournamentId: number): Promise<Embed> {
  const t = await getTournament(prisma, tournamentId);
  const label = new Map(t.entries.map((e) => [e.id, entryLabel(e)]));
  const statusText = { REGISTRATION: 'Inscrições abertas', RUNNING: 'Em andamento', FINISHED: 'Finalizado', CANCELLED: 'Cancelado' }[t.status];
  const fields: NonNullable<Embed['fields']> = [];
  const embed: Embed = {
    color: t.status === TournamentStatus.FINISHED ? Colors.gold : Colors.info,
    title: `🏆 ${t.name} (#${t.id})`,
    description: [
      `🎮 **${t.game}** · ${FORMAT_LABEL[t.format]} · ${t.teamSize === 1 ? 'Individual' : `Times de ${t.teamSize}`}`,
      `Status: **${statusText}**`,
      t.closesAt && t.status === TournamentStatus.REGISTRATION ? `Inscrições fecham ${timeTag(t.closesAt)}` : null,
      t.status === TournamentStatus.REGISTRATION
        ? t.teamSize === 1
          ? `Reaja com ${JOIN_EMOJI} ou use ${cmd('inscrever')} ${t.id} para participar.`
          : `Capitães: ${cmd('inscrever')} ${t.id} "Nome do Time"`
        : null,
      t.winnerEntryId ? `👑 Campeão: ${label.get(t.winnerEntryId)}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    fields,
  };

  if (t.status === TournamentStatus.REGISTRATION) {
    fields.push({
      name: `Inscritos (${t.entries.length})`,
      value: t.entries.length ? clip(t.entries.map(entryLabel).join(', '), 1024) : '_Ninguém ainda_',
    });
    return embed;
  }

  const matches = await tournamentMatches(t.id);
  if (t.format === TournamentFormat.ROUND_ROBIN) {
    const table = await roundRobinTable(prisma, t.id, t.entries.map((e) => e.id));
    fields.push({
      name: 'Classificação',
      value: clip(table.map((s, i) => `${medal(i + 1)} ${label.get(s.entry)} — ${s.wins}V/${s.losses}D`).join('\n'), 1024),
    });
    const pending = matches.filter((m) => m.status !== 'CONFIRMED' && m.status !== 'CANCELLED');
    if (pending.length) {
      fields.push({
        name: 'Partidas restantes',
        value: clip(pending.map((m) => `\`#${m.id}\` ${label.get(m.entry1Id!)} vs ${label.get(m.entry2Id!)}`).join('\n'), 1024),
      });
    }
    return embed;
  }

  const total = roundCount(t.entries.length);
  for (let round = 1; round <= total; round++) {
    const lines = matches
      .filter((m) => m.round === round)
      .map((m) => {
        const a = m.entry1Id ? label.get(m.entry1Id) : '_a definir_';
        const b = m.entry2Id ? label.get(m.entry2Id) : m.round === 1 ? '_bye_' : '_a definir_';
        const win = m.status === 'CONFIRMED' ? (m.winnerSide === 1 ? ` → ${a}` : ` → ${b}`) : '';
        const status = m.status === 'CONFIRMED' ? '✅' : (STATUS_LABEL[m.status]?.split(' ')[0] ?? '');
        return `${status} \`#${m.id}\` ${a} vs ${b}${win}`;
      });
    fields.push({ name: roundName(round, total), value: clip(lines.join('\n'), 1024) || '—' });
  }
  return embed;
}

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
