/**
 * Onboarding no banco: entrada de membros (idempotente), atividade, promoção e histórico.
 * Tudo é separado por comunidade (guildId).
 */
import { Prisma, type CommunityMember } from '../generated/prisma/client.js';
import { type Db, prisma } from '../database/client.js';
import { joinedCutoff, type PromotionRules } from './rules/onboarding.js';

export type AuditAction =
  | 'member_join'
  | 'member_rejoin'
  | 'role_assigned'
  | 'role_missing'
  | 'role_created'
  | 'welcome_sent'
  | 'welcome_failed'
  | 'member_promoted'
  | 'config_changed';

export interface AuditEntry {
  guildId: string;
  action: AuditAction;
  userId?: string | null;
  actorId?: string | null;
  roleId?: string | null;
  details?: Record<string, unknown>;
}

export function audit(entry: AuditEntry, db: Db = prisma) {
  return db.auditLog.create({
    data: {
      guildId: entry.guildId,
      action: entry.action,
      userId: entry.userId ?? null,
      actorId: entry.actorId ?? null,
      roleId: entry.roleId ?? null,
      details: entry.details ? JSON.stringify(entry.details) : null,
    },
  });
}

export function listAudit(guildId: string, take = 10) {
  return prisma.auditLog.findMany({ where: { guildId }, orderBy: { id: 'desc' }, take });
}

export type JoinKind = 'first' | 'rejoin' | 'duplicate';

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * Registra a entrada de um membro. O mesmo evento recebido duas vezes (mesmo joined_at)
 * é 'duplicate' e não faz nada; sair e voltar é 'rejoin' (recebe o cargo inicial de novo,
 * mas não as boas-vindas). As escritas são condicionais, então dois eventos simultâneos
 * nunca contam como duas entradas.
 */
export async function registerJoin(
  guildId: string,
  userId: string,
  username: string | null,
  joinedAt: Date | null,
): Promise<{ kind: JoinKind; member: CommunityMember }> {
  const where = { guildId_userId: { guildId, userId } };
  const existing = await prisma.communityMember.findUnique({ where });
  if (!existing) {
    try {
      const member = await prisma.communityMember.create({ data: { guildId, userId, username, joinedAt } });
      return { kind: 'first', member };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return { kind: 'duplicate', member: (await prisma.communityMember.findUnique({ where }))! };
    }
  }

  const same = existing.joinedAt && (!joinedAt || existing.joinedAt.getTime() === joinedAt.getTime());
  if (same) return { kind: 'duplicate', member: existing };

  const firstTime = !existing.welcomedAt && !existing.initialRoleAt;
  const { count } = await prisma.communityMember.updateMany({
    where: { id: existing.id, joinedAt: existing.joinedAt },
    // Quem saiu perdeu os cargos no Fluxer: a promoção precisa ser conquistada de novo (os pontos ficam).
    data: { joinedAt, username: username ?? existing.username, ...(firstTime ? {} : { promotedAt: null, promotionCheckedAt: null }) },
  });
  const member = (await prisma.communityMember.findUnique({ where }))!;
  if (count === 0) return { kind: 'duplicate', member };
  return { kind: firstTime ? 'first' : 'rejoin', member };
}

export function recordInitialRole(memberId: number, roleId: string, at = new Date()) {
  return prisma.communityMember.update({ where: { id: memberId }, data: { initialRoleId: roleId, initialRoleAt: at } });
}

/** Reserva o envio das boas-vindas: só a primeira chamada recebe true. */
export async function claimWelcome(memberId: number, at = new Date()): Promise<boolean> {
  const { count } = await prisma.communityMember.updateMany({ where: { id: memberId, welcomedAt: null }, data: { welcomedAt: at } });
  return count === 1;
}

export function setWelcomeMessageId(memberId: number, messageId: string) {
  return prisma.communityMember.update({ where: { id: memberId }, data: { welcomeMessageId: messageId } });
}

/** Soma pontos de atividade (cria o membro se ainda não existir). */
export async function addActivity(guildId: string, userId: string, points: number, username?: string) {
  if (points <= 0) return;
  await prisma.communityMember.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId, username: username ?? null, activityPoints: points },
    update: { activityPoints: { increment: points } },
  });
}

export function getCommunityMember(guildId: string, userId: string) {
  return prisma.communityMember.findUnique({ where: { guildId_userId: { guildId, userId } } });
}

/** Quanto tempo esperar para olhar de novo alguém que ainda não pôde ser promovido. */
export const PROMOTION_RECHECK_MS = 6 * 3_600_000;

/**
 * Candidatos à promoção: atividade suficiente, ainda não promovidos e (se o banco já
 * sabe a data de entrada) com os dias mínimos. A data e os cargos são confirmados no Fluxer.
 */
export function promotionCandidates(guildId: string, rules: PromotionRules, now = new Date(), take = 25) {
  return prisma.communityMember.findMany({
    where: {
      guildId,
      promotedAt: null,
      activityPoints: { gte: rules.minimumActivityPoints },
      OR: [{ joinedAt: null }, { joinedAt: { lte: joinedCutoff(rules.minimumDays, now) } }],
      AND: [{ OR: [{ promotionCheckedAt: null }, { promotionCheckedAt: { lt: new Date(now.getTime() - PROMOTION_RECHECK_MS) } }] }],
    },
    orderBy: { activityPoints: 'desc' },
    take,
  });
}

export function markPromotionChecked(memberId: number, joinedAt: Date | null, now = new Date()) {
  return prisma.communityMember.update({
    where: { id: memberId },
    data: { promotionCheckedAt: now, ...(joinedAt ? { joinedAt } : {}) },
  });
}

/** Marca a promoção; só a primeira chamada recebe true (evita promover duas vezes). */
export async function claimPromotion(memberId: number, now = new Date()): Promise<boolean> {
  const { count } = await prisma.communityMember.updateMany({ where: { id: memberId, promotedAt: null }, data: { promotedAt: now } });
  return count === 1;
}

/** Desfaz a marca quando o Fluxer recusou a troca de cargo (tenta de novo mais tarde). */
export function releasePromotion(memberId: number, now = new Date()) {
  return prisma.communityMember.update({ where: { id: memberId }, data: { promotedAt: null, promotionCheckedAt: now } });
}
