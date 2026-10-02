/**
 * Onboarding no Fluxer: novo membro → cargo inicial (Escudeiro) → boas-vindas no canal
 * (e na DM, se ativado). Também a promoção automática Escudeiro → Mercenário.
 * Regras de segurança:
 * - só eventos da comunidade configurada (FLUXER_GUILD_ID); bots são ignorados;
 * - cargos automáticos nunca podem ter permissão de administração/moderação (rules/onboarding.ts);
 * - evento repetido não dá cargo nem boas-vindas de novo (services/onboarding.ts).
 */
import { mention } from '../../embeds/format.js';
import { guildSettings } from '../../database/guildSettingsRepository.js';
import type { GuildSettings } from '../../generated/prisma/client.js';
import type { FluxerClient } from '../../fluxer/client.js';
import { FluxerApiError } from '../../fluxer/rest.js';
import type { GuildMemberAddEvent, MessagePayload, Role, User } from '../../fluxer/types.js';
import {
  DEFAULT_WELCOME_MESSAGE,
  isPromotionEligible,
  pickAutomaticRole,
  PROMOTION_MESSAGE,
  renderTemplate,
  ROLE_PROBLEM_TEXT,
  SYSTEM_DEFAULT_ROLE_NAME,
  SYSTEM_PROMOTION_ROLE_NAME,
  type TemplateValues,
} from '../rules/onboarding.js';
import {
  audit,
  claimPromotion,
  claimWelcome,
  markPromotionChecked,
  promotionCandidates,
  recordInitialRole,
  registerJoin,
  releasePromotion,
  setWelcomeMessageId,
  type JoinKind,
} from '../onboarding.js';
import { getChannelId } from '../channels.js';
import { errorMeta, scoped } from '../../utils/logger.js';
import { memberQueue } from '../../utils/queue.js';

const log = scoped('onboarding');

const ROLE_COLORS = { start: 0x84cc16, promotion: 0xd97706 };

export type OnboardingResult =
  { status: 'ignored'; reason: 'other_guild' | 'bot' | 'no_user' } | { status: JoinKind; roleId: string | null; welcomed: boolean };

export interface ResolvedRole {
  role: Role;
  source: 'configured' | 'system' | 'created';
}

/**
 * Cargo automático (inicial ou de promoção): o configurado, se existir e for seguro; senão o
 * do sistema (🌱 Escudeiro / 🍺 Mercenário). Com `create`, cria o do sistema sem nenhuma
 * permissão quando não existe. Nunca devolve um cargo administrativo.
 */
export async function resolveAutomaticRole(
  client: FluxerClient,
  kind: 'start' | 'promotion',
  settings: GuildSettings,
  create: boolean,
): Promise<ResolvedRole | null> {
  const configuredId = kind === 'start' ? settings.defaultMemberRoleId : settings.promotionRoleId;
  const systemName = kind === 'start' ? SYSTEM_DEFAULT_ROLE_NAME : SYSTEM_PROMOTION_ROLE_NAME;
  const roles = await client.getRoles();
  const botTop = await client.botTopRolePosition();
  const picked = pickAutomaticRole(roles, client.guildId, botTop, configuredId, systemName);
  if (picked.role) return { role: picked.role, source: picked.source };

  if (picked.configuredProblem) {
    log.warn(`cargo configurado (${kind}) ignorado: ${ROLE_PROBLEM_TEXT[picked.configuredProblem]}`, { role: configuredId });
  }
  if (!create) return null;
  const role = await client.rest.createRole(
    client.guildId,
    { name: systemName, color: ROLE_COLORS[kind], permissions: '0' },
    'Cargo automatico do sistema (onboarding)',
  );
  client.invalidateRoles();
  await audit({ guildId: client.guildId, action: 'role_created', roleId: role.id, details: { name: systemName, kind } });
  log.info(`cargo do sistema criado: ${systemName}`, { role: role.id });
  return { role, source: 'created' };
}

/** Valores dos placeholders da mensagem de boas-vindas. */
export async function welcomeValues(client: FluxerClient, user: User, nick: string | null, roleName: string): Promise<TemplateValues> {
  return {
    username: user.username,
    displayName: nick ?? user.global_name ?? user.username,
    mention: mention(user.id),
    communityName: await client.getGuildName().catch(() => 'o Reino'),
    memberCount: client.memberCount !== null ? String(client.memberCount) : '?',
    role: roleName,
  };
}

/** Mensagem de boas-vindas pronta para enviar (também usada no preview do !boasvindas). */
export async function buildWelcome(
  client: FluxerClient,
  settings: GuildSettings,
  user: User,
  nick: string | null,
  roleName: string,
): Promise<MessagePayload> {
  const content = renderTemplate(settings.welcomeMessage ?? DEFAULT_WELCOME_MESSAGE, await welcomeValues(client, user, nick, roleName));
  // Só o novo membro pode ser mencionado: um @everyone no texto (ou no nome) não notifica ninguém.
  return { content, allowed_mentions: { users: [user.id] } };
}

async function sendWelcome(client: FluxerClient, settings: GuildSettings, memberId: number, event: GuildMemberAddEvent, roleName: string) {
  const user = event.user!;
  const payload = await buildWelcome(client, settings, user, event.nick, roleName);
  const channelId = settings.welcomeChannelId ?? (await getChannelId(client, 'welcome'));
  let messageId: string | null = null;
  if (channelId) {
    const message = await client.send(channelId, payload).catch((err: unknown) => {
      log.error('falha ao enviar as boas-vindas', { user: user.id, channel: channelId, ...errorMeta(err) });
      return null;
    });
    if (message) {
      messageId = message.id;
      await setWelcomeMessageId(memberId, message.id);
    }
  } else {
    log.warn('canal de boas-vindas não configurado; use !boasvindas canal #canal');
  }
  let dm = false;
  if (settings.welcomeDMEnabled) {
    dm = await client.rest
      .createDM(user.id)
      .then((ch) => client.send(ch.id, { content: payload.content, allowed_mentions: { parse: [] } }))
      .then(() => true)
      .catch((err: unknown) => {
        // DM fechada ou bloqueada não é erro do bot.
        log.info('DM de boas-vindas não entregue', { user: user.id, ...errorMeta(err) });
        return false;
      });
  }
  const delivered = messageId !== null || dm;
  await audit({
    guildId: client.guildId,
    action: delivered ? 'welcome_sent' : 'welcome_failed',
    userId: user.id,
    details: { channelId, messageId, dm, ...(delivered ? {} : { reason: channelId ? 'send_failed' : 'no_channel' }) },
  });
}

/** GUILD_MEMBER_ADD: cargo inicial + boas-vindas, uma vez por membro. */
export function onMemberAdd(client: FluxerClient, event: GuildMemberAddEvent): Promise<OnboardingResult> {
  if (event.guild_id !== client.guildId) return Promise.resolve({ status: 'ignored', reason: 'other_guild' });
  const user = event.user;
  if (!user) return Promise.resolve({ status: 'ignored', reason: 'no_user' });
  if (user.bot) return Promise.resolve({ status: 'ignored', reason: 'bot' });
  return memberQueue(() => onboard(client, event, user));
}

async function onboard(client: FluxerClient, event: GuildMemberAddEvent, user: User): Promise<OnboardingResult> {
  const guildId = client.guildId;
  const joined = event.joined_at ? new Date(event.joined_at) : null;
  const joinedAt = joined && !Number.isNaN(joined.getTime()) ? joined : null;
  const { kind, member } = await registerJoin(guildId, user.id, user.username, joinedAt);
  if (kind === 'duplicate') {
    log.info('entrada repetida ignorada', { user: user.id });
    return { status: 'duplicate', roleId: member.initialRoleId, welcomed: false };
  }
  log.info(kind === 'first' ? 'novo membro' : 'membro voltou', { user: user.id, username: user.username });
  await audit({ guildId, action: kind === 'first' ? 'member_join' : 'member_rejoin', userId: user.id, details: { joinedAt } });

  const settings = await guildSettings.get(guildId);
  let roleId: string | null = null;
  let roleName = SYSTEM_DEFAULT_ROLE_NAME;
  try {
    const resolved = await resolveAutomaticRole(client, 'start', settings, true);
    if (resolved) {
      roleName = resolved.role.name;
      if (!event.roles.includes(resolved.role.id)) {
        await client.rest.addMemberRole(guildId, user.id, resolved.role.id, 'Cargo inicial automatico (onboarding)');
      }
      roleId = resolved.role.id;
      await recordInitialRole(member.id, roleId);
      await audit({
        guildId,
        action: 'role_assigned',
        userId: user.id,
        roleId,
        details: { source: resolved.source, rejoin: kind === 'rejoin' },
      });
      log.info(`cargo inicial: ${resolved.role.name}`, { user: user.id, role: roleId, source: resolved.source });
    }
  } catch (err) {
    log.error('falha ao dar o cargo inicial', { user: user.id, ...errorMeta(err) });
    await audit({ guildId, action: 'role_missing', userId: user.id, details: { error: err instanceof Error ? err.message : String(err) } });
  }

  let welcomed = false;
  if (kind === 'first' && settings.welcomeEnabled && (await claimWelcome(member.id))) {
    await sendWelcome(client, settings, member.id, event, roleName);
    welcomed = true;
  }
  return { status: kind, roleId, welcomed };
}

// ─── Promoção Escudeiro → Mercenário ─────────────────────────────────────────

export interface PromotionRun {
  promoted: string[];
  skipped?: 'disabled' | 'no_start_role' | 'no_promotion_role';
}

async function announcePromotion(client: FluxerClient, settings: GuildSettings, userId: string, from: Role, to: Role) {
  const channelId = settings.welcomeChannelId ?? (await getChannelId(client, 'welcome')) ?? (await getChannelId(client, 'commands'));
  if (!channelId) return;
  const content = renderTemplate(PROMOTION_MESSAGE, { mention: mention(userId), fromRole: from.name, role: to.name });
  await client.send(channelId, { content, allowed_mentions: { users: [userId] } }).catch((err: unknown) => {
    log.error('falha ao anunciar promoção', { user: userId, ...errorMeta(err) });
  });
}

/**
 * Promove quem cumpriu os dias e a atividade mínimos e ainda tem o cargo inicial.
 * A data de entrada e os cargos são conferidos no Fluxer antes de promover.
 */
export async function runPromotions(client: FluxerClient, now = new Date()): Promise<PromotionRun> {
  const guildId = client.guildId;
  const settings = await guildSettings.get(guildId);
  if (!settings.automaticPromotionEnabled) return { promoted: [], skipped: 'disabled' };
  const start = await resolveAutomaticRole(client, 'start', settings, false);
  if (!start) {
    log.warn('promoção automática: cargo inicial não encontrado');
    return { promoted: [], skipped: 'no_start_role' };
  }
  const target = await resolveAutomaticRole(client, 'promotion', settings, false);
  if (!target) {
    log.warn('promoção automática: cargo de promoção não encontrado; use !progressao cargo @cargo');
    return { promoted: [], skipped: 'no_promotion_role' };
  }
  const rules = { minimumDays: settings.minimumDays, minimumActivityPoints: settings.minimumActivityPoints };
  const promoted: string[] = [];

  for (const candidate of await promotionCandidates(guildId, rules, now)) {
    const member = await client.rest.getMember(guildId, candidate.userId).catch((err: unknown) => {
      if (!(err instanceof FluxerApiError && err.status === 404))
        log.warn('falha ao buscar membro', { user: candidate.userId, ...errorMeta(err) });
      return null;
    });
    if (!member) {
      await markPromotionChecked(candidate.id, null, now);
      continue;
    }
    const joinedAt = new Date(member.joined_at);
    if (member.roles.includes(target.role.id)) {
      // Já é Mercenário (promovido à mão): só registra.
      await claimPromotion(candidate.id, now);
      continue;
    }
    if (!member.roles.includes(start.role.id) || !isPromotionEligible(joinedAt, candidate.activityPoints, rules, now)) {
      await markPromotionChecked(candidate.id, joinedAt, now);
      continue;
    }
    if (!(await claimPromotion(candidate.id, now))) continue;
    try {
      const reason = 'Promocao automatica (progressao)';
      await client.rest.addMemberRole(guildId, candidate.userId, target.role.id, reason);
      await client.rest.removeMemberRole(guildId, candidate.userId, start.role.id, reason);
    } catch (err) {
      log.error('falha ao promover', { user: candidate.userId, ...errorMeta(err) });
      await releasePromotion(candidate.id, now);
      continue;
    }
    promoted.push(candidate.userId);
    await audit({
      guildId,
      action: 'member_promoted',
      userId: candidate.userId,
      roleId: target.role.id,
      details: { from: start.role.id, points: candidate.activityPoints, joinedAt },
    });
    log.info(`promovido a ${target.role.name}`, { user: candidate.userId, points: candidate.activityPoints });
    await announcePromotion(client, settings, candidate.userId, start.role, target.role);
  }
  return { promoted };
}
