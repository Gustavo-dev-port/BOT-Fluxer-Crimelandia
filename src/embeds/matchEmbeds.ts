/** Embeds de duelos, resultados e placar. */
import { config } from '../config.js';
import { prisma } from '../database/client.js';
import type { Embed } from '../fluxer/types.js';
import type { ConfirmedMatch, MatchWithParticipants } from '../services/matches.js';
import { getRanking, rankingValue } from '../services/ranking.js';
import { tierFor } from '../services/rules/tiers.js';
import { getActiveSeason } from '../services/seasons.js';
import { cmd, Colors, formatDuration, medal, mention, sideLabel, signed, timeTag, versus } from './format.js';

/** Reações usadas no lugar de botões (o Fluxer não tem botões). */
export const Emoji = {
  YES: '✅',
  NO: '❌',
  DISPUTE: '⚠️',
} as const;

export async function challengeEmbed(match: MatchWithParticipants): Promise<Embed> {
  return {
    color: Colors.primary,
    title: `⚔️ Desafio #${match.id} — ${match.game}`,
    description:
      `${await versus(match)}\n\n` +
      `${await sideLabel(match, 2)}, reaja com ${Emoji.YES} para aceitar ou ${Emoji.NO} para recusar ` +
      `(ou use ${cmd('aceitar')} / ${cmd('recusar')}).\n` +
      `O desafio expira em ${config.duel.pendingExpiryHours}h.`,
  };
}

export async function acceptedEmbed(match: MatchWithParticipants): Promise<Embed> {
  return {
    color: Colors.info,
    title: `🎮 Partida #${match.id} aceita — ${match.game}`,
    description: `${await versus(match)}\n\nBom jogo! Ao terminar, qualquer um registra com ${cmd('resultado')} @vencedor.`,
  };
}

export async function awaitingEmbed(match: MatchWithParticipants): Promise<Embed> {
  const winner = await sideLabel(match, match.winnerSide as 1 | 2);
  const confirmer = await sideLabel(match, match.reportedSide === 1 ? 2 : 1);
  return {
    color: Colors.warning,
    title: `📝 Resultado informado — partida #${match.id}`,
    description:
      `${mention(match.reportedById!)} informou que ${winner} venceu.\n\n` +
      `${confirmer}, reaja com ${Emoji.YES} para confirmar ou ${Emoji.DISPUTE} para contestar ` +
      `(ou use ${cmd('confirmar')} / ${cmd('contestar')}).\n` +
      `_O resultado só vale depois da confirmação do outro lado._`,
  };
}

export async function resultEmbed(result: ConfirmedMatch): Promise<Embed> {
  const { match, winnerSide, delta } = result;
  const loserSide = winnerSide === 1 ? 2 : 1;
  const lines = [
    `🏆 ${await sideLabel(match, winnerSide)} venceu ${await sideLabel(match, loserSide)}`,
    '',
    `📈 ELO: **${signed(delta)}** / **${signed(-delta)}**`,
    ...(match.durationSeconds ? [`⏱️ Duração: **${formatDuration(match.durationSeconds)}**`] : []),
    `🪙 FluxCoins: vencedor **+${config.coins.win}**, participação **+${config.coins.participation}**`,
  ];
  for (const u of result.unlocked) {
    lines.push(`🏅 ${mention(u.playerId)} desbloqueou: ${u.achievements.map((a) => `${a.emoji} **${a.name}**`).join(', ')}`);
  }
  return {
    color: Colors.success,
    title: `✅ Partida #${match.id} — ${match.game}`,
    description: lines.join('\n'),
    timestamp: (match.confirmedAt ?? new Date()).toISOString(),
  };
}

export async function disputedEmbed(match: MatchWithParticipants): Promise<Embed> {
  return {
    color: Colors.danger,
    title: `⚠️ Partida #${match.id} em disputa`,
    description: `${await versus(match)}\n\nOs jogadores discordam do resultado. Um admin deve resolver com ${cmd('admin')} resultado #${match.id} @vencedor.`,
  };
}

export async function scoreboardEmbed(limit = 15): Promise<Embed> {
  const season = await getActiveSeason();
  const ranking = await getRanking(prisma, season.id, { limit });
  const lines = ranking.map((r) => {
    const tier = tierFor(r.rating);
    const fire = r.streak >= 3 ? ` 🔥${r.streak}` : '';
    return `${medal(r.position)} ${mention(r.playerId)} — **${rankingValue(r)}** · ${tier.emoji} ${tier.label} · ${r.wins}V/${r.losses}D${fire}`;
  });
  return {
    color: Colors.gold,
    title: `🏆 Temporada ${String(season.number).padStart(2, '0')}`,
    description:
      (lines.length ? lines.join('\n') : `_Nenhuma partida registrada ainda. Use ${cmd('duelo')} para começar!_`) +
      `\n\nTermina ${timeTag(season.endsAt)}`,
  };
}
