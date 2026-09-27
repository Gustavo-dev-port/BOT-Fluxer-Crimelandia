import { config } from '../config.js';
import { prisma } from '../db.js';
import type { FluxerClient } from '../fluxer/client.js';
import { FluxerApiError } from '../fluxer/rest.js';
import type { Embed, Message, Snowflake } from '../fluxer/types.js';
import { tierFor } from '../lib/tiers.js';
import { getMatch, type ConfirmedMatch, type MatchWithParticipants } from '../services/matches.js';
import { getRanking, rankingValue } from '../services/ranking.js';
import { getActiveSeason, type SeasonEndResult } from '../services/seasons.js';
import { getSetting, setSetting } from '../services/settings.js';
import { entryLabel, getTournament, type TournamentProgress } from '../services/tournaments.js';
import { guildSettings } from '../database/guildSettingsRepository.js';
import { getChannelId, sendTo } from './channels.js';
import { clip, cmd, Colors, formatDuration, medal, mention, sideLabel, signed, timeTag, versus } from './format.js';
import { refreshTournamentMessage } from './tournamentView.js';
import { errorMeta, scoped } from '../utils/logger.js';

const log = scoped('anúncios');

// ─── Reações no lugar de botões ─────────────────────────────────────────────

export const Emoji = {
  YES: '✅',
  NO: '❌',
  DISPUTE: '⚠️',
} as const;

export type PromptKind = 'challenge' | 'confirm';

const PROMPT_EMOJIS: Record<PromptKind, string[]> = {
  challenge: [Emoji.YES, Emoji.NO],
  confirm: [Emoji.YES, Emoji.DISPUTE],
};

/**
 * Registra a mensagem como "prompt" da partida e adiciona as reações que
 * funcionam como botões.
 */
export async function attachPrompt(client: FluxerClient, message: Message, kind: PromptKind, matchId: number) {
  await prisma.reactionPrompt.create({ data: { messageId: message.id, channelId: message.channel_id, kind, matchId } });
  for (const emoji of PROMPT_EMOJIS[kind]) {
    await client.rest
      .addReaction(message.channel_id, message.id, emoji)
      .catch((err: unknown) => log.warn('falha ao adicionar reação', errorMeta(err)));
  }
}

/** Aposenta os prompts da partida (a ação já foi feita por comando ou reação). */
export async function retirePrompts(client: FluxerClient, matchId: number, except?: Snowflake) {
  const prompts = await prisma.reactionPrompt.findMany({ where: { matchId } });
  for (const p of prompts) {
    if (p.messageId === except) continue;
    // Tirar as reações exige Gerenciar Mensagens; sem isso, apenas deixamos de ouvir.
    await client.rest.removeAllReactions(p.channelId, p.messageId).catch(() => undefined);
  }
  await prisma.reactionPrompt.deleteMany({ where: { matchId } });
}

// ─── Mensagens de partida ───────────────────────────────────────────────────

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

/** Tudo que acontece depois de uma partida confirmada. */
export async function afterMatchConfirmed(client: FluxerClient, result: ConfirmedMatch) {
  await retirePrompts(client, result.match.id);
  await sendTo(client, 'matches', { embeds: [await resultEmbed(result)], allowed_mentions: { parse: [] } });
  if (result.tournament) {
    await announceTournamentProgress(client, result.tournament);
    await refreshTournamentMessage(client, result.tournament.tournamentId);
  }
  await updateScoreboard(client);
}

export async function announceDisputed(client: FluxerClient, match: MatchWithParticipants) {
  await retirePrompts(client, match.id);
  await sendTo(client, 'matches', { embeds: [await disputedEmbed(match)] });
}

// ─── Campeonatos ────────────────────────────────────────────────────────────

export async function announceTournamentProgress(client: FluxerClient, progress: TournamentProgress) {
  const t = await getTournament(prisma, progress.tournamentId);
  if (progress.readyMatchIds.length) {
    const matches = await Promise.all(progress.readyMatchIds.map((id) => getMatch(prisma, id)));
    const lines: string[] = [];
    for (const m of matches) lines.push(`\`#${m.id}\` Rodada ${m.round} — ${await versus(m)}`);
    const pings = [...new Set(matches.flatMap((m) => m.participants.map((p) => mention(p.playerId))))];
    await sendTo(client, 'events', {
      content: clip(pings.join(' '), 1900),
      embeds: [
        {
          color: Colors.info,
          title: `🎮 ${t.name} — partidas liberadas`,
          description: clip(`${lines.join('\n')}\n\nJoguem e registrem com ${cmd('resultado')} @vencedor #partida.`, 4000),
        },
      ],
    });
  }
  if (progress.finished) {
    const winner = t.entries.find((e) => e.id === progress.finished!.winnerEntryId)!;
    await sendTo(client, 'events', {
      embeds: [
        {
          color: Colors.gold,
          title: `🏆 ${t.name} terminou!`,
          description:
            `Campeão: ${entryLabel(winner)}\n🪙 +${config.coins.champion} FluxCoins para ${progress.finished.championIds.map(mention).join(', ')}` +
            (t.isWeekly ? `\n🎉 Todos os participantes ganharam +${config.coins.specialEvent} FluxCoins pelo evento especial.` : ''),
        },
      ],
    });
  }
}

// ─── Placar ─────────────────────────────────────────────────────────────────

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

/** Edita a mensagem fixa do #placar (ou cria, se não existir). */
export async function updateScoreboard(client: FluxerClient) {
  const channelId = await getChannelId(client, 'scoreboard');
  if (!channelId) return;
  const payload = { embeds: [await scoreboardEmbed()], allowed_mentions: { parse: [] } };
  const savedChannel = await getSetting('scoreboard:channelId');
  const messageId = await getSetting('scoreboard:messageId');
  if (messageId && savedChannel === channelId) {
    try {
      await client.rest.editMessage(channelId, messageId, payload);
      return;
    } catch (err) {
      // Mensagem apagada: cria outra abaixo.
      if (!(err instanceof FluxerApiError && err.status === 404)) {
        log.error('falha ao editar o placar', errorMeta(err));
        return;
      }
    }
  }
  const sent = await client.send(channelId, payload).catch((err) => {
    log.error('falha ao enviar o placar', errorMeta(err));
    return null;
  });
  if (sent) {
    await setSetting('scoreboard:messageId', sent.id);
    await setSetting('scoreboard:channelId', channelId);
    await client.rest.pinMessage(channelId, sent.id).catch(() => undefined);
  }
}

// ─── Temporadas ─────────────────────────────────────────────────────────────

export async function announceSeasonEnd(client: FluxerClient, result: SeasonEndResult) {
  const roleId = (await guildSettings.getRole(client.guildId, 'champion')) ?? config.season.championRoleId;
  if (roleId && result.championId) {
    // Cargo exclusivo: sai do campeão anterior e vai para o novo.
    const reason = `Campeao da Temporada ${result.endedNumber}`;
    if (result.previousChampionId && result.previousChampionId !== result.championId) {
      await client.rest.removeMemberRole(client.guildId, result.previousChampionId, roleId, reason).catch(() => undefined);
    }
    await client.rest
      .addMemberRole(client.guildId, result.championId, roleId, reason)
      .catch((err: unknown) => log.error('falha ao dar o cargo de campeão', errorMeta(err)));
  }

  const podium = result.finalTop
    .slice(0, 3)
    .map((r) => `${medal(r.position)} ${mention(r.playerId)} — ${rankingValue(r)} (${r.wins}V/${r.losses}D)`)
    .join('\n');

  await sendTo(client, 'events', {
    content: result.championId ? mention(result.championId) : undefined,
    embeds: [
      {
        color: Colors.gold,
        title: `🏁 Fim da Temporada ${String(result.endedNumber).padStart(2, '0')}`,
        description:
          (result.championId
            ? `👑 Campeão: ${mention(result.championId)} (+${config.coins.champion} FluxCoins)\n\n${podium}`
            : '_Nenhuma partida foi jogada nesta temporada._') +
          `\n\n📊 Estatísticas arquivadas — veja com ${cmd('rank')} ${result.endedNumber}.` +
          `\n🔄 A **Temporada ${String(result.newSeasonNumber).padStart(2, '0')}** começou! Termina ${timeTag(result.newSeasonEndsAt, 'D')}.`,
      },
    ],
  });
  await updateScoreboard(client);
}
