import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client, EmbedBuilder } from 'discord.js';
import { prisma } from '../db.js';
import { TournamentFormat, TournamentStatus } from '../lib/types.js';
import { entryLabel, getTournament, roundRobinTable, tournamentMatches } from '../services/tournaments.js';
import { roundCount } from '../lib/bracket.js';
import { sendTo } from './channels.js';
import { Colors, discordTime, medal, STATUS_LABEL } from './format.js';

export const FORMAT_LABEL: Record<string, string> = {
  SINGLE_ELIM: 'Chave simples (mata-mata)',
  ROUND_ROBIN: 'Todos contra todos',
};

export function joinButton(tournamentId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`tour:join:${tournamentId}`).setLabel('Inscrever-se').setStyle(ButtonStyle.Primary).setEmoji('📝'),
  );
}

function roundName(round: number, total: number): string {
  const fromEnd = total - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinal';
  if (fromEnd === 2) return 'Quartas de final';
  if (fromEnd === 3) return 'Oitavas de final';
  return `Rodada ${round}`;
}

export async function tournamentEmbed(tournamentId: number) {
  const t = await getTournament(prisma, tournamentId);
  const label = new Map(t.entries.map((e) => [e.id, entryLabel(e)]));
  const embed = new EmbedBuilder()
    .setColor(t.status === TournamentStatus.FINISHED ? Colors.gold : Colors.info)
    .setTitle(`🏆 ${t.name} (#${t.id})`)
    .setDescription(
      [
        `🎮 **${t.game}** · ${FORMAT_LABEL[t.format]} · ${t.teamSize === 1 ? 'Individual' : `Times de ${t.teamSize}`}`,
        `Status: **${{ REGISTRATION: 'Inscrições abertas', RUNNING: 'Em andamento', FINISHED: 'Finalizado', CANCELLED: 'Cancelado' }[t.status]}**`,
        t.closesAt && t.status === TournamentStatus.REGISTRATION ? `Inscrições fecham ${discordTime(t.closesAt)}` : null,
        t.winnerEntryId ? `👑 Campeão: ${label.get(t.winnerEntryId)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );

  if (t.status === TournamentStatus.REGISTRATION) {
    embed.addFields({
      name: `Inscritos (${t.entries.length})`,
      value: t.entries.length ? t.entries.map(entryLabel).join(', ').slice(0, 1024) : '_Ninguém ainda — use /inscrever_',
    });
    return embed;
  }

  const matches = await tournamentMatches(t.id);
  if (t.format === TournamentFormat.ROUND_ROBIN) {
    const table = await roundRobinTable(prisma, t.id, t.entries.map((e) => e.id));
    embed.addFields({
      name: 'Classificação',
      value: table.map((s, i) => `${medal(i + 1)} ${label.get(s.entry)} — ${s.wins}V/${s.losses}D`).join('\n').slice(0, 1024),
    });
    const pending = matches.filter((m) => m.status !== 'CONFIRMED' && m.status !== 'CANCELLED');
    if (pending.length) {
      embed.addFields({
        name: 'Partidas restantes',
        value: pending.map((m) => `\`#${m.id}\` ${label.get(m.entry1Id!)} vs ${label.get(m.entry2Id!)}`).join('\n').slice(0, 1024),
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
        const status = m.status === 'CONFIRMED' ? '✅' : STATUS_LABEL[m.status]?.split(' ')[0] ?? '';
        return `${status} \`#${m.id}\` ${a} vs ${b}${win}`;
      });
    embed.addFields({ name: roundName(round, total), value: lines.join('\n').slice(0, 1024) || '—' });
  }
  return embed;
}

/** Publica o anúncio do campeonato em #eventos e guarda a mensagem. */
export async function announceTournament(client: Client, tournamentId: number, intro?: string) {
  const msg = await sendTo(client, 'events', {
    content: intro,
    embeds: [await tournamentEmbed(tournamentId)],
    components: [joinButton(tournamentId)],
  });
  if (msg) await prisma.tournament.update({ where: { id: tournamentId }, data: { messageId: msg.id, channelId: msg.channelId } });
  return msg;
}

/** Atualiza o anúncio original (lista de inscritos / chave). */
export async function refreshTournamentMessage(client: Client, tournamentId: number) {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!t?.messageId || !t.channelId) return;
  const channel = await client.channels.fetch(t.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const msg = await channel.messages.fetch(t.messageId).catch(() => null);
  await msg
    ?.edit({
      embeds: [await tournamentEmbed(tournamentId)],
      components: t.status === TournamentStatus.REGISTRATION ? [joinButton(tournamentId)] : [],
    })
    .catch(() => undefined);
}
