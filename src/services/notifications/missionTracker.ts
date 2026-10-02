/**
 * Liga os eventos do servidor (mensagens, reações, partidas, voz) ao progresso
 * das missões diárias, e avisa em #comandos quando alguém conclui uma missão.
 */
import { config } from '../../config.js';
import { cmd, Colors, mention } from '../../embeds/format.js';
import type { FluxerClient } from '../../fluxer/client.js';
import type { MessageCreateEvent, ReactionEvent } from '../../fluxer/types.js';
import type { ConfirmedMatch } from '../matches.js';
import { type CompletedMission, ensureDailyMissions, missionLabel, recordProgress, todayKey } from '../missions.js';
import type { PlayerRef } from '../players.js';
import type { MissionKind } from '../rules/missions.js';
import { ACTIVITY_POINTS } from '../rules/onboarding.js';
import { addActivity } from '../onboarding.js';
import { voicePresence } from '../voicePresence.js';
import { sendTo } from '../channels.js';
import { errorMeta, scoped } from '../../utils/logger.js';
import { missionQueue } from '../../utils/queue.js';

const log = scoped('missões');
const voiceLog = scoped('voz');

/** Intervalo mínimo entre mensagens (e entre reações) que contam para as missões. */
export const MESSAGE_COOLDOWN_MS = 15_000;
export const REACTION_COOLDOWN_MS = 5_000;
/** Mensagens muito curtas ("k", "a") não contam. */
export const MIN_MESSAGE_LENGTH = 3;

const lastMessageAt = new Map<string, number>();
const lastReactionAt = new Map<string, number>();
/** Uma reação por mensagem por dia conta uma vez só (tirar e pôr de novo não soma). */
let reactedDay = '';
const reacted = new Set<string>();

async function announceCompleted(client: FluxerClient, completed: CompletedMission[]) {
  for (const { mission, playerId } of completed) {
    log.info(`missão concluída: ${missionLabel(mission)}`, { user: playerId, reward: mission.reward });
    await sendTo(client, 'commands', {
      content: `🎯 ${mention(playerId)} concluiu a missão **${missionLabel(mission)}**! Use ${cmd('coletar')} para receber 🪙 **${mission.reward}**.`,
      allowed_mentions: { users: [playerId] },
    });
  }
}

/** Pontos de atividade da progressão (Escudeiro → Mercenário). Erros ficam só no log. */
async function recordActivity(guildId: string, player: string | PlayerRef, kind: MissionKind, amount: number) {
  const id = typeof player === 'string' ? player : player.id;
  try {
    await addActivity(guildId, id, ACTIVITY_POINTS[kind] * amount, typeof player === 'string' ? undefined : player.username);
  } catch (err) {
    log.error(`falha ao somar atividade (${kind})`, { user: id, ...errorMeta(err) });
  }
}

/** Soma progresso (missões e atividade) e anuncia o que foi concluído. Erros ficam só no log. */
export async function trackMission(client: FluxerClient, player: string | PlayerRef, kind: MissionKind, amount = 1, now = new Date()) {
  try {
    const completed = await missionQueue(async () => {
      await recordActivity(client.guildId, player, kind, amount);
      return recordProgress(player, kind, amount, now);
    });
    await announceCompleted(client, completed);
  } catch (err) {
    log.error(`falha ao registrar progresso (${kind})`, { user: typeof player === 'string' ? player : player.id, ...errorMeta(err) });
  }
}

/** Mensagem comum (não comando) conta para "Envie N mensagens", com intervalo mínimo. */
export async function trackMessage(client: FluxerClient, message: MessageCreateEvent, now = Date.now()) {
  const text = message.content.trim();
  if (text.startsWith(config.prefix) || text.length < MIN_MESSAGE_LENGTH) return;
  const last = lastMessageAt.get(message.author.id) ?? 0;
  if (now - last < MESSAGE_COOLDOWN_MS) return;
  lastMessageAt.set(message.author.id, now);
  const ref = { id: message.author.id, username: message.author.global_name ?? message.author.username };
  await trackMission(client, ref, 'send_messages', 1, new Date(now));
}

/** Reação conta para "Reaja a N mensagens": uma vez por mensagem por dia, com intervalo mínimo. */
export async function trackReaction(client: FluxerClient, event: ReactionEvent, now = Date.now()) {
  const user = event.member?.user;
  if (user?.bot) return;
  const day = todayKey(new Date(now));
  if (day !== reactedDay) {
    reactedDay = day;
    reacted.clear();
  }
  const key = `${event.user_id}:${event.message_id}`;
  if (reacted.has(key)) return;
  const last = lastReactionAt.get(event.user_id) ?? 0;
  if (now - last < REACTION_COOLDOWN_MS) return;
  reacted.add(key);
  lastReactionAt.set(event.user_id, now);
  const ref = user ? { id: user.id, username: user.global_name ?? user.username } : event.user_id;
  await trackMission(client, ref, 'react_messages', 1, new Date(now));
}

/** Partida confirmada: todos jogaram; o lado vencedor venceu. */
export async function trackMatch(client: FluxerClient, result: ConfirmedMatch) {
  for (const p of result.match.participants) {
    await trackMission(client, p.playerId, 'play_matches');
    if (p.side === result.winnerSide) await trackMission(client, p.playerId, 'win_duels');
  }
}

/** Liga o rastreador de voz às missões (chamado uma vez na inicialização). */
export function trackVoice(client: FluxerClient) {
  voicePresence.listen({
    onJoin: (user, channelId) => {
      voiceLog.info('entrou na sala', { user: user.id, channel: channelId });
      void trackMission(client, user, 'join_voice');
    },
    onLeave: (user, channelId) => voiceLog.info('saiu da sala', { user: user.id, channel: channelId }),
    onMinutes: (user, minutes) => void trackMission(client, user, 'voice_minutes', minutes),
  });
}

/** Gera as missões do dia (se preciso) e as anuncia em #comandos. */
export async function announceDailyMissions(client: FluxerClient, now = new Date()) {
  const missions = await ensureDailyMissions(now);
  log.info(`missões do dia ${todayKey(now)}: ${missions.map((m) => m.kind).join(', ')}`);
  await sendTo(client, 'commands', {
    embeds: [
      {
        color: Colors.forest,
        title: '📜 Missões do dia',
        description:
          missions.map((m) => `${missionLabel(m)} — 🪙 **${m.reward}**`).join('\n') +
          `\n\nAcompanhe com ${cmd('missoes')} e colete com ${cmd('coletar')}.`,
      },
    ],
  });
}
