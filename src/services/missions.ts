/**
 * Missões diárias: geração, progresso e coleta de recompensas.
 */
import type { DailyMission, PlayerMission } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { type Db, prisma, transaction } from '../database/client.js';
import { dateKeyIn } from '../utils/calendar.js';
import { addCoins } from './economy.js';
import { ensurePlayer, type PlayerRef } from './players.js';
import { generateDailyMissions, type MissionKind, missionType } from './rules/missions.js';

export const todayKey = (now = new Date()) => dateKeyIn(now, config.timezone);

/** Rótulo com emoji, ex.: "⚔️ Vença 2 partidas". */
export function missionLabel(m: Pick<DailyMission, 'kind' | 'target'>): string {
  const type = missionType(m.kind);
  return type ? `${type.emoji} ${type.label(m.target)}` : m.kind;
}

/** As missões do dia, criando as 3 do sorteio se ainda não existirem. */
export async function ensureDailyMissions(now = new Date(), db: Db = prisma): Promise<DailyMission[]> {
  const date = todayKey(now);
  const existing = await db.dailyMission.findMany({ where: { date }, orderBy: { id: 'asc' } });
  if (existing.length) return existing;
  for (const m of generateDailyMissions(date)) {
    // Dois processos gerando ao mesmo tempo: a chave única (date, kind) evita duplicar.
    await db.dailyMission.upsert({ where: { date_kind: { date, kind: m.kind } }, create: { date, ...m }, update: {} });
  }
  return db.dailyMission.findMany({ where: { date }, orderBy: { id: 'asc' } });
}

export interface CompletedMission {
  mission: DailyMission;
  playerId: string;
}

// Eventos do mesmo jogador (várias mensagens seguidas) são tratados um de cada vez
// para não disputarem a mesma linha de PlayerMission.
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  queues.set(key, next);
  const cleanup = () => {
    if (queues.get(key) === next) queues.delete(key);
  };
  // O erro continua chegando a quem chamou; aqui só se limpa a fila.
  next.then(cleanup, cleanup);
  return next;
}

/**
 * Soma progresso nas missões de hoje do tipo informado.
 * `player` pode ser só o ID (jogador já existe) ou { id, username } (cria se preciso).
 * Devolve as missões que acabaram de ser concluídas.
 */
export function recordProgress(player: string | PlayerRef, kind: MissionKind, amount = 1, now = new Date()): Promise<CompletedMission[]> {
  const playerId = typeof player === 'string' ? player : player.id;
  return serialized(playerId, async () => {
    if (amount <= 0) return [];
    const missions = (await ensureDailyMissions(now)).filter((m) => m.kind === kind);
    if (!missions.length) return [];
    if (typeof player !== 'string') await ensurePlayer(prisma, player);
    // Só o ID de alguém que nunca usou o bot: não há jogador para associar.
    else if (!(await prisma.player.findUnique({ where: { id: playerId } }))) return [];

    const completed: CompletedMission[] = [];
    for (const mission of missions) {
      const current = await prisma.playerMission.findUnique({ where: { missionId_playerId: { missionId: mission.id, playerId } } });
      if (current?.completedAt) continue;
      const progress = Math.min(mission.target, (current?.progress ?? 0) + amount);
      const completedAt = progress >= mission.target ? now : null;
      await prisma.playerMission.upsert({
        where: { missionId_playerId: { missionId: mission.id, playerId } },
        create: { missionId: mission.id, playerId, progress, completedAt },
        update: { progress, completedAt },
      });
      if (completedAt) completed.push({ mission, playerId });
    }
    return completed;
  });
}

export interface MissionView {
  mission: DailyMission;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

/** Missões de hoje com o progresso do jogador. */
export async function getPlayerMissions(playerId: string, now = new Date()): Promise<MissionView[]> {
  const missions = await ensureDailyMissions(now);
  const rows = await prisma.playerMission.findMany({ where: { playerId, missionId: { in: missions.map((m) => m.id) } } });
  const byMission = new Map<number, PlayerMission>(rows.map((r) => [r.missionId, r]));
  return missions.map((mission) => {
    const row = byMission.get(mission.id);
    return { mission, progress: row?.progress ?? 0, completed: Boolean(row?.completedAt), claimed: Boolean(row?.claimedAt) };
  });
}

export interface ClaimResult {
  claimed: DailyMission[];
  total: number;
  balance: number;
}

/** Coleta todas as recompensas de missões concluídas e ainda não coletadas (de qualquer dia). */
export async function claimRewards(playerId: string, now = new Date()): Promise<ClaimResult> {
  return transaction(async (tx) => {
    const pending = await tx.playerMission.findMany({
      where: { playerId, completedAt: { not: null }, claimedAt: null },
      include: { mission: true },
      orderBy: { id: 'asc' },
    });
    const claimed: DailyMission[] = [];
    let total = 0;
    for (const row of pending) {
      // updateMany com claimedAt: null garante que a mesma missão não é paga duas vezes.
      const { count } = await tx.playerMission.updateMany({ where: { id: row.id, claimedAt: null }, data: { claimedAt: now } });
      if (!count) continue;
      await addCoins(tx, playerId, row.mission.reward, `Missão diária: ${missionLabel(row.mission)}`);
      claimed.push(row.mission);
      total += row.mission.reward;
    }
    const player = await tx.player.findUnique({ where: { id: playerId } });
    return { claimed, total, balance: player?.coins ?? 0 };
  });
}
