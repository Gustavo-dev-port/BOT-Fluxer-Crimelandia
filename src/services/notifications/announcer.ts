import { disputedEmbed, Emoji, resultEmbed, scoreboardEmbed } from '../../embeds/matchEmbeds.js';
import { config } from '../../config.js';
import { prisma } from '../../database/client.js';
import type { FluxerClient } from '../../fluxer/client.js';
import { FluxerApiError } from '../../fluxer/rest.js';
import type { Message, Snowflake } from '../../fluxer/types.js';
import { getMatch, type ConfirmedMatch, type MatchWithParticipants } from '../matches.js';
import { rankingValue } from '../ranking.js';
import { type SeasonEndResult } from '../seasons.js';
import { getSetting, setSetting } from '../settings.js';
import { entryLabel, getTournament, type TournamentProgress } from '../tournaments.js';
import { guildSettings } from '../../database/guildSettingsRepository.js';
import { getChannelId, sendTo } from '../channels.js';
import { clip, cmd, Colors, medal, mention, timeTag, versus } from '../../embeds/format.js';
import { refreshTournamentMessage } from './tournamentAnnouncer.js';
import { errorMeta, scoped } from '../../utils/logger.js';

const log = scoped('anúncios');

// ─── Reações no lugar de botões ─────────────────────────────────────────────

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
