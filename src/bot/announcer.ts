import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { tierFor } from '../lib/tiers.js';
import { getMatch, type ConfirmedMatch, type MatchWithParticipants } from '../services/matches.js';
import { getRanking, rankingValue } from '../services/ranking.js';
import { getActiveSeason, type SeasonEndResult } from '../services/seasons.js';
import { getSetting, setSetting } from '../services/settings.js';
import { entryLabel, getTournament, type TournamentProgress } from '../services/tournaments.js';
import { getChannel, getGuild, sendTo } from './channels.js';
import { refreshTournamentMessage } from './tournamentView.js';
import { Colors, discordTime, medal, mention, sideLabel, signed, versus } from './format.js';

// ─── Botões ─────────────────────────────────────────────────────────────────

export function challengeButtons(matchId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`duel:accept:${matchId}`).setLabel('Aceitar').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`duel:decline:${matchId}`).setLabel('Recusar').setStyle(ButtonStyle.Danger).setEmoji('✖️'),
  );
}

export function confirmButtons(matchId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`duel:confirm:${matchId}`).setLabel('Confirmar').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`duel:dispute:${matchId}`).setLabel('Contestar').setStyle(ButtonStyle.Secondary).setEmoji('⚠️'),
  );
}

// ─── Mensagens de partida ───────────────────────────────────────────────────

export async function challengeEmbed(match: MatchWithParticipants) {
  return new EmbedBuilder()
    .setColor(Colors.primary)
    .setTitle(`⚔️ Desafio #${match.id} — ${match.game}`)
    .setDescription(
      `${await versus(match)}\n\n` +
        `${await sideLabel(match, 2)}, aceite com **/aceitar** ou pelo botão abaixo.\n` +
        `O desafio expira em ${config.duel.pendingExpiryHours}h.`,
    );
}

export async function awaitingEmbed(match: MatchWithParticipants) {
  const winner = await sideLabel(match, match.winnerSide as 1 | 2);
  const confirmer = await sideLabel(match, match.reportedSide === 1 ? 2 : 1);
  return new EmbedBuilder()
    .setColor(Colors.warning)
    .setTitle(`📝 Resultado informado — partida #${match.id}`)
    .setDescription(
      `${mention(match.reportedById!)} informou que ${winner} venceu.\n\n` +
        `${confirmer}, confirme com **/confirmar** ou conteste com **/contestar**.\n` +
        `_O resultado só vale depois da confirmação do outro lado._`,
    );
}

export async function resultEmbed(result: ConfirmedMatch) {
  const { match, winnerSide, delta } = result;
  const loserSide = winnerSide === 1 ? 2 : 1;
  const lines = [
    `🏆 ${await sideLabel(match, winnerSide)} venceu ${await sideLabel(match, loserSide)}`,
    '',
    `📈 ELO: **${signed(delta)}** / **${signed(-delta)}**`,
    `🪙 FluxCoins: vencedor **+${config.coins.win}**, participação **+${config.coins.participation}**`,
  ];
  for (const u of result.unlocked) {
    lines.push(`🏅 ${mention(u.playerId)} desbloqueou: ${u.achievements.map((a) => `${a.emoji} **${a.name}**`).join(', ')}`);
  }
  return new EmbedBuilder()
    .setColor(Colors.success)
    .setTitle(`✅ Partida #${match.id} — ${match.game}`)
    .setDescription(lines.join('\n'))
    .setTimestamp(match.confirmedAt ?? new Date());
}

/** Tudo que acontece depois de uma partida confirmada. */
export async function afterMatchConfirmed(client: Client, result: ConfirmedMatch) {
  await sendTo(client, 'matches', { embeds: [await resultEmbed(result)] });
  if (result.tournament) {
    await announceTournamentProgress(client, result.tournament);
    await refreshTournamentMessage(client, result.tournament.tournamentId);
  }
  await updateScoreboard(client);
}

export async function announceDisputed(client: Client, match: MatchWithParticipants) {
  await sendTo(client, 'matches', {
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.danger)
        .setTitle(`⚠️ Partida #${match.id} em disputa`)
        .setDescription(`${await versus(match)}\n\nOs jogadores discordam do resultado. Um admin deve resolver com **/admin resultado**.`),
    ],
  });
}

// ─── Campeonatos ────────────────────────────────────────────────────────────

export async function announceTournamentProgress(client: Client, progress: TournamentProgress) {
  const t = await getTournament(prisma, progress.tournamentId);
  if (progress.readyMatchIds.length) {
    const lines: string[] = [];
    for (const id of progress.readyMatchIds) {
      const m = await getMatch(prisma, id);
      lines.push(`\`#${m.id}\` Rodada ${m.round} — ${await versus(m)}`);
    }
    const pings = [...new Set((await Promise.all(progress.readyMatchIds.map((id) => getMatch(prisma, id)))).flatMap((m) => m.participants.map((p) => mention(p.playerId))))];
    await sendTo(client, 'events', {
      content: pings.join(' ').slice(0, 1900),
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.info)
          .setTitle(`🎮 ${t.name} — partidas liberadas`)
          .setDescription(`${lines.join('\n')}\n\nJoguem e registrem com **/resultado**.`.slice(0, 4000)),
      ],
    });
  }
  if (progress.finished) {
    const winner = t.entries.find((e) => e.id === progress.finished!.winnerEntryId)!;
    await sendTo(client, 'events', {
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.gold)
          .setTitle(`🏆 ${t.name} terminou!`)
          .setDescription(
            `Campeão: ${entryLabel(winner)}\n🪙 +${config.coins.champion} FluxCoins para ${progress.finished.championIds.map(mention).join(', ')}` +
              (t.isWeekly ? `\n🎉 Todos os participantes ganharam +${config.coins.specialEvent} FluxCoins pelo evento especial.` : ''),
          ),
      ],
    });
  }
}

// ─── Placar ─────────────────────────────────────────────────────────────────

export async function scoreboardEmbed(limit = 15) {
  const season = await getActiveSeason();
  const ranking = await getRanking(prisma, season.id, { limit });
  const lines = ranking.map((r) => {
    const tier = tierFor(r.rating);
    const fire = r.streak >= 3 ? ` 🔥${r.streak}` : '';
    return `${medal(r.position)} ${mention(r.playerId)} — **${rankingValue(r)}** · ${tier.emoji} ${tier.label} · ${r.wins}V/${r.losses}D${fire}`;
  });
  return new EmbedBuilder()
    .setColor(Colors.gold)
    .setTitle(`🏆 Temporada ${String(season.number).padStart(2, '0')}`)
    .setDescription(lines.length ? lines.join('\n') : '_Nenhuma partida registrada ainda. Use **/duelo** para começar!_')
    .setFooter({ text: `Termina` })
    .setTimestamp(season.endsAt);
}

/** Edita a mensagem fixa do #placar (ou cria, se não existir). */
export async function updateScoreboard(client: Client) {
  const channel = await getChannel(client, 'scoreboard');
  if (!channel) return;
  const embed = await scoreboardEmbed();
  const messageId = await getSetting('scoreboard:messageId');
  if (messageId) {
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (message) {
      await message.edit({ embeds: [embed] }).catch((err) => console.error('[placar] Falha ao editar:', err));
      return;
    }
  }
  const sent = await channel.send({ embeds: [embed] }).catch(() => null);
  if (sent) {
    await setSetting('scoreboard:messageId', sent.id);
    await sent.pin().catch(() => undefined);
  }
}

// ─── Temporadas ─────────────────────────────────────────────────────────────

export async function announceSeasonEnd(client: Client, result: SeasonEndResult) {
  const roleId = config.season.championRoleId;
  if (roleId && result.championId) {
    try {
      const guild = await getGuild(client);
      const role = await guild.roles.fetch(roleId);
      if (role) {
        // Cargo exclusivo: sai do campeão anterior e vai para o novo.
        if (result.previousChampionId && result.previousChampionId !== result.championId) {
          const previous = await guild.members.fetch(result.previousChampionId).catch(() => null);
          await previous?.roles.remove(role).catch(() => undefined);
        }
        const champ = await guild.members.fetch(result.championId).catch(() => null);
        await champ?.roles.add(role).catch((err) => console.error('[temporada] Falha ao dar cargo:', err));
      }
    } catch (err) {
      console.error('[temporada] Erro ao atualizar cargo de campeão:', err);
    }
  }

  const podium = result.finalTop
    .slice(0, 3)
    .map((r) => `${medal(r.position)} ${mention(r.playerId)} — ${rankingValue(r)} (${r.wins}V/${r.losses}D)`)
    .join('\n');

  await sendTo(client, 'events', {
    content: result.championId ? mention(result.championId) : undefined,
    embeds: [
      new EmbedBuilder()
        .setColor(Colors.gold)
        .setTitle(`🏁 Fim da Temporada ${String(result.endedNumber).padStart(2, '0')}`)
        .setDescription(
          (result.championId
            ? `👑 Campeão: ${mention(result.championId)} (+${config.coins.champion} FluxCoins)\n\n${podium}`
            : '_Nenhuma partida foi jogada nesta temporada._') +
            `\n\n📊 Estatísticas arquivadas — veja com **/rank temporada:${result.endedNumber}**.` +
            `\n🔄 A **Temporada ${String(result.newSeasonNumber).padStart(2, '0')}** começou! Termina ${discordTime(result.newSeasonEndsAt, 'D')}.`,
        ),
    ],
  });
  await updateScoreboard(client);
}
