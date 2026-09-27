/** Embed de campeonato/evento: inscritos, chave ou classificação. */
import { prisma } from '../database/client.js';
import type { Embed } from '../fluxer/types.js';
import { roundCount } from '../services/rules/bracket.js';
import { entryLabel, getTournament, roundRobinTable, tournamentMatches } from '../services/tournaments.js';
import { TournamentFormat, TournamentStatus } from '../types/domain.js';
import { clip, cmd, Colors, medal, mention, STATUS_LABEL, timeTag } from './format.js';
import { NightStatus, nightByTournament, optionsOf } from '../services/night.js';
import { tally, VOTE_EMOJIS } from '../services/rules/night.js';

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
  const statusText = { REGISTRATION: 'Inscrições abertas', RUNNING: 'Em andamento', FINISHED: 'Finalizado', CANCELLED: 'Cancelado' }[
    t.status
  ];
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

  // Night Fluxer: votação do jogo e equipes sorteadas com as salas de voz.
  const night = t.isWeekly ? await nightByTournament(t.id) : null;
  if (night) {
    embed.title = `🌙 ${t.name} (#${t.id})`;
    embed.color = Colors.wine;
    const options = optionsOf(night);
    if (night.status === NightStatus.VOTING && options.length) {
      const counts = tally(
        options.length,
        night.votes.map((v) => v.option),
      );
      fields.push({
        name: '🗳️ Votação do jogo',
        value:
          options.map((g, i) => `${VOTE_EMOJIS[i]} ${g} — **${counts[i]}** ${counts[i] === 1 ? 'voto' : 'votos'}`).join('\n') +
          '\n_Reaja com o número do jogo para votar._',
      });
    }
    if (night.teams.length) {
      const lines = [];
      for (const team of night.teams) {
        const entry = t.entries.find((e) => e.teamId !== null && e.teamId === team.teamId);
        const members = entry?.team ? entry.team.members.map((m) => mention(m.playerId)).join(', ') : '';
        lines.push(`**${team.name}**${members ? ` — ${members}` : ''}${team.voiceChannelId ? ` · 🔊 <#${team.voiceChannelId}>` : ''}`);
      }
      fields.push({ name: '🛡️ Equipes e salas', value: clip(lines.join('\n'), 1024) });
    }
  }

  if (t.status === TournamentStatus.REGISTRATION) {
    fields.push({
      name: `Inscritos (${t.entries.length})`,
      value: t.entries.length ? clip(t.entries.map(entryLabel).join(', '), 1024) : '_Ninguém ainda_',
    });
    return embed;
  }

  const matches = await tournamentMatches(t.id);
  if (t.format === TournamentFormat.ROUND_ROBIN) {
    const table = await roundRobinTable(
      prisma,
      t.id,
      t.entries.map((e) => e.id),
    );
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
