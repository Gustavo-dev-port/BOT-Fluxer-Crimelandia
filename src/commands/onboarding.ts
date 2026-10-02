/**
 * Administração do onboarding pelo chat do Fluxer:
 * !boasvindas (mensagem, canal, DM, cargo inicial, preview), !progressao e !auditoria.
 */
import { config } from '../config.js';
import { Colors, mention, timeTag } from '../embeds/format.js';
import { guildSettings, type GuildSettingsPatch } from '../database/guildSettingsRepository.js';
import { ChannelType, type Role } from '../fluxer/types.js';
import { parseChannelMention, parseRoleMention } from '../utils/args.js';
import { UserError } from '../types/domain.js';
import { audit, getCommunityMember, listAudit } from '../services/onboarding.js';
import { buildWelcome, resolveAutomaticRole, runPromotions } from '../services/notifications/onboarding.js';
import {
  joinedCutoff,
  PLACEHOLDERS,
  roleProblem,
  ROLE_PROBLEM_TEXT,
  SYSTEM_DEFAULT_ROLE_NAME,
  SYSTEM_PROMOTION_ROLE_NAME,
  unknownPlaceholders,
  WELCOME_MESSAGE_MAX,
} from '../services/rules/onboarding.js';
import { getChannelId } from '../services/channels.js';
import type { Command, CommandContext } from './types.js';

const ON = new Set(['ativar', 'ligar', 'on', 'sim']);
const OFF = new Set(['desativar', 'desligar', 'off', 'nao', 'não']);
const DEFAULT_WORDS = new Set(['padrao', 'padrão', 'limpar', 'remover', 'nenhum']);

const yesNo = (v: boolean) => (v ? '✅ ativado' : '⛔ desativado');

function toggle(word: string | undefined, usage: string): boolean {
  const w = word?.toLowerCase();
  if (w && ON.has(w)) return true;
  if (w && OFF.has(w)) return false;
  throw new UserError(`Use \`${usage} ativar\` ou \`${usage} desativar\`.`);
}

/** Salva e registra no histórico quem mudou o quê. */
async function change(ctx: CommandContext, patch: GuildSettingsPatch) {
  await guildSettings.update(ctx.client.guildId, patch);
  await audit({ guildId: ctx.client.guildId, action: 'config_changed', actorId: ctx.author.id, details: patch });
}

/** Valida um cargo para uso automático; recusa @everyone, administrativos e cargos acima do bot. */
async function requireSafeRole(ctx: CommandContext, token: string | undefined, usage: string): Promise<Role> {
  const roleId = token ? parseRoleMention(token) : null;
  if (!roleId) throw new UserError(`Mencione o cargo: \`${usage} @cargo\``);
  const roles = await ctx.client.getRoles();
  const role = roles.find((r) => r.id === roleId);
  const problem = roleProblem(role, ctx.client.guildId, await ctx.client.botTopRolePosition());
  if (problem) throw new UserError(`Não posso usar esse cargo: ${ROLE_PROBLEM_TEXT[problem]}.`);
  return role!;
}

async function roleLine(ctx: CommandContext, kind: 'start' | 'promotion') {
  const s = await guildSettings.get(ctx.client.guildId);
  const resolved = await resolveAutomaticRole(ctx.client, kind, s, false).catch(() => null);
  const configured = kind === 'start' ? s.defaultMemberRoleId : s.promotionRoleId;
  const system = kind === 'start' ? SYSTEM_DEFAULT_ROLE_NAME : SYSTEM_PROMOTION_ROLE_NAME;
  if (resolved) return `<@&${resolved.role.id}>${resolved.source === 'system' ? ' _(do sistema)_' : ''}`;
  return configured ? `⚠️ <@&${configured}> não pode ser usado; será criado **${system}**` : `será criado **${system}** no primeiro uso`;
}

async function showWelcome(ctx: CommandContext) {
  const s = await guildSettings.get(ctx.client.guildId);
  const channelId = s.welcomeChannelId ?? (await getChannelId(ctx.client, 'welcome'));
  await ctx.reply({
    allowed_mentions: { parse: [] },
    embeds: [
      {
        color: Colors.primary,
        title: '🏰 Boas-vindas e cargo inicial',
        fields: [
          { name: 'Boas-vindas', value: yesNo(s.welcomeEnabled), inline: true },
          { name: 'DM', value: yesNo(s.welcomeDMEnabled), inline: true },
          { name: 'Canal', value: channelId ? `<#${channelId}>` : '_não configurado_', inline: true },
          { name: 'Cargo inicial', value: await roleLine(ctx, 'start') },
          { name: 'Mensagem', value: s.welcomeMessage ? 'personalizada' : 'padrão' },
          { name: 'Placeholders', value: PLACEHOLDERS.map((p) => `\`{${p}}\``).join(' ') },
        ],
        footer: { text: `${config.prefix}boasvindas preview mostra como fica` },
      },
    ],
  });
}

export const boasvindas: Command = {
  name: 'boasvindas',
  aliases: ['bemvindo', 'onboarding'],
  category: 'Administração',
  usage: '[ativar|desativar|canal|mensagem|dm|cargo|preview]',
  description: 'Boas-vindas automáticas e cargo inicial dos novos membros (admin)',
  adminOnly: true,
  details: [
    '`!boasvindas` — mostra a configuração',
    '`!boasvindas ativar` / `desativar` — liga ou desliga a mensagem',
    '`!boasvindas canal #canal` — onde a mensagem é publicada',
    '`!boasvindas mensagem <texto>` — texto próprio (`padrao` volta ao original)',
    `Placeholders: ${PLACEHOLDERS.map((p) => `\`{${p}}\``).join(' ')}`,
    '`!boasvindas dm ativar|desativar` — também manda por mensagem direta',
    '`!boasvindas cargo @cargo` — cargo inicial (`padrao` = 🌱 Escudeiro); cargos administrativos são recusados',
    '`!boasvindas preview` — mostra a mensagem como se você tivesse acabado de entrar',
  ],
  async execute(ctx) {
    const sub = ctx.args[0]?.toLowerCase();
    const guildId = ctx.client.guildId;
    if (!sub || sub === 'ver' || sub === 'status') return showWelcome(ctx);

    if (ON.has(sub) || OFF.has(sub)) {
      const enabled = ON.has(sub);
      await change(ctx, { welcomeEnabled: enabled });
      await ctx.reply(`Boas-vindas ${yesNo(enabled)}.`);
      return;
    }
    if (sub === 'canal') {
      const value = ctx.args[1];
      if (value && DEFAULT_WORDS.has(value.toLowerCase())) {
        await change(ctx, { welcomeChannelId: null });
        await ctx.reply('🧹 Canal de boas-vindas removido (usa #boas-vindas se existir).');
        return;
      }
      const channelId = value ? parseChannelMention(value) : null;
      if (!channelId) throw new UserError(`Mencione o canal: \`${config.prefix}boasvindas canal #canal\``);
      const channel = (await ctx.client.rest.getGuildChannels(guildId)).find((c) => c.id === channelId);
      if (!channel || channel.type !== ChannelType.GUILD_TEXT) throw new UserError('Esse canal de texto não existe nesta comunidade.');
      await change(ctx, { welcomeChannelId: channelId });
      await ctx.reply(`✅ Boas-vindas em <#${channelId}>.`);
      return;
    }
    if (sub === 'mensagem' || sub === 'texto') {
      const text = ctx.rest.replace(/^\S+\s*/, '').trim();
      if (!text) throw new UserError(`Escreva o texto: \`${config.prefix}boasvindas mensagem Bem-vindo, {mention}!\``);
      if (DEFAULT_WORDS.has(text.toLowerCase())) {
        await change(ctx, { welcomeMessage: null });
        await ctx.reply('✅ Mensagem padrão restaurada.');
        return;
      }
      if (text.length > WELCOME_MESSAGE_MAX) throw new UserError(`A mensagem pode ter até ${WELCOME_MESSAGE_MAX} caracteres.`);
      await change(ctx, { welcomeMessage: text });
      const unknown = unknownPlaceholders(text);
      await ctx.reply(
        `✅ Mensagem salva. Veja com \`${config.prefix}boasvindas preview\`.` +
          (unknown.length ? `\n⚠️ Placeholders desconhecidos (ficam como estão): ${unknown.map((u) => `\`{${u}}\``).join(' ')}` : ''),
      );
      return;
    }
    if (sub === 'dm') {
      const enabled = toggle(ctx.args[1], `${config.prefix}boasvindas dm`);
      await change(ctx, { welcomeDMEnabled: enabled });
      await ctx.reply(`DM de boas-vindas ${yesNo(enabled)}.`);
      return;
    }
    if (sub === 'cargo') {
      const value = ctx.args[1];
      if (value && DEFAULT_WORDS.has(value.toLowerCase())) {
        await change(ctx, { defaultMemberRoleId: null });
        await ctx.reply(`✅ Cargo inicial: **${SYSTEM_DEFAULT_ROLE_NAME}** do sistema.`);
        return;
      }
      const role = await requireSafeRole(ctx, value, `${config.prefix}boasvindas cargo`);
      await change(ctx, { defaultMemberRoleId: role.id });
      await ctx.reply({ content: `✅ Novos membros recebem <@&${role.id}>.`, allowed_mentions: { parse: [] } });
      return;
    }
    if (sub === 'preview' || sub === 'previa' || sub === 'prévia' || sub === 'testar') {
      const s = await guildSettings.get(guildId);
      const role = await resolveAutomaticRole(ctx.client, 'start', s, false).catch(() => null);
      const payload = await buildWelcome(
        ctx.client,
        s,
        ctx.author,
        ctx.message.member?.nick ?? null,
        role?.role.name ?? SYSTEM_DEFAULT_ROLE_NAME,
      );
      await ctx.reply({
        content: `👀 **Preview** (${s.welcomeEnabled ? 'ativada' : 'desativada'}):\n\n${payload.content}`,
        allowed_mentions: { parse: [] },
      });
      return;
    }
    throw new UserError(`Opção desconhecida. Veja \`${config.prefix}ajuda boasvindas\`.`);
  },
};

const DAY = 86_400_000;

export const progressao: Command = {
  name: 'progressao',
  aliases: ['progressão', 'jornada'],
  category: 'Ranking',
  usage: '[ativar|desativar|dias|atividade|cargo|verificar]',
  description: 'Sua jornada de Escudeiro a Mercenário; admins configuram a promoção automática',
  details: [
    '`!progressao` — regras e o seu progresso',
    'Admin: `!progressao ativar|desativar` · `!progressao dias 7` · `!progressao atividade 50`',
    'Admin: `!progressao cargo @cargo` (`padrao` = 🍺 Mercenário) · `!progressao verificar` (roda agora)',
    'Pontos: 1 por mensagem (com intervalo), reação, entrada em voz e minuto em voz; 5 por partida; 2 por convite do !grupo',
  ],
  async execute(ctx) {
    const sub = ctx.args[0]?.toLowerCase();
    const guildId = ctx.client.guildId;
    if (sub) await ctx.requireAdmin();

    if (!sub) {
      const s = await guildSettings.get(guildId);
      const me = await getCommunityMember(guildId, ctx.author.id);
      const joined = ctx.message.member?.joined_at ? new Date(ctx.message.member.joined_at) : me?.joinedAt;
      const days = joined ? Math.floor((Date.now() - joined.getTime()) / DAY) : null;
      const points = me?.activityPoints ?? 0;
      const status = me?.promotedAt
        ? `🍺 Promovido ${timeTag(me.promotedAt)}`
        : `📅 ${days ?? '?'} / ${s.minimumDays} dias · ⚡ ${points} / ${s.minimumActivityPoints} pontos` +
          (joined && joined <= joinedCutoff(s.minimumDays) && points >= s.minimumActivityPoints ? ' · ✅ pronto para a promoção' : '');
      await ctx.reply({
        allowed_mentions: { parse: [] },
        embeds: [
          {
            color: Colors.primary,
            title: '⚔️ Jornada: Escudeiro → Mercenário',
            description:
              `Promoção automática: ${yesNo(s.automaticPromotionEnabled)}\n` +
              `Requisitos: **${s.minimumDays} dias** na comunidade e **${s.minimumActivityPoints} pontos** de atividade.\n\n` +
              `${mention(ctx.author.id)}: ${status}`,
            fields: [
              { name: 'Cargo inicial', value: await roleLine(ctx, 'start'), inline: true },
              { name: 'Promoção', value: await roleLine(ctx, 'promotion'), inline: true },
            ],
          },
        ],
      });
      return;
    }

    if (ON.has(sub) || OFF.has(sub)) {
      const enabled = ON.has(sub);
      if (enabled) {
        // Garante os dois cargos (cria os do sistema, sem permissões, se faltarem).
        const s = await guildSettings.get(guildId);
        await resolveAutomaticRole(ctx.client, 'start', s, true);
        await resolveAutomaticRole(ctx.client, 'promotion', s, true);
      }
      await change(ctx, { automaticPromotionEnabled: enabled });
      await ctx.reply(`Promoção automática ${yesNo(enabled)}.`);
      return;
    }
    if (sub === 'dias' || sub === 'atividade' || sub === 'pontos') {
      const n = Number(ctx.args[1]);
      const max = sub === 'dias' ? 365 : 100_000;
      if (!Number.isInteger(n) || n < 0 || n > max) throw new UserError(`Informe um número inteiro de 0 a ${max}.`);
      const patch = sub === 'dias' ? { minimumDays: n } : { minimumActivityPoints: n };
      await change(ctx, patch);
      await ctx.reply(sub === 'dias' ? `✅ Mínimo de **${n} dias** na comunidade.` : `✅ Mínimo de **${n} pontos** de atividade.`);
      return;
    }
    if (sub === 'cargo') {
      const value = ctx.args[1];
      if (value && DEFAULT_WORDS.has(value.toLowerCase())) {
        await change(ctx, { promotionRoleId: null });
        await ctx.reply(`✅ Cargo da promoção: **${SYSTEM_PROMOTION_ROLE_NAME}** do sistema.`);
        return;
      }
      const role = await requireSafeRole(ctx, value, `${config.prefix}progressao cargo`);
      await change(ctx, { promotionRoleId: role.id });
      await ctx.reply({ content: `✅ A promoção dá <@&${role.id}>.`, allowed_mentions: { parse: [] } });
      return;
    }
    if (sub === 'verificar' || sub === 'rodar') {
      const run = await runPromotions(ctx.client);
      if (run.skipped === 'disabled') throw new UserError(`A promoção automática está desativada (\`${config.prefix}progressao ativar\`).`);
      if (run.skipped) throw new UserError('Cargo inicial ou de promoção não encontrado. Veja `!progressao`.');
      await ctx.reply({
        content: run.promoted.length ? `⚔️ Promovidos agora: ${run.promoted.map(mention).join(', ')}` : 'Ninguém novo para promover agora.',
        allowed_mentions: { parse: [] },
      });
      return;
    }
    throw new UserError(`Opção desconhecida. Veja \`${config.prefix}ajuda progressao\`.`);
  },
};

const ACTION_LABEL: Record<string, string> = {
  member_join: '👋 entrou',
  member_rejoin: '🔁 voltou',
  role_assigned: '🌱 cargo inicial',
  role_missing: '⚠️ sem cargo inicial',
  role_created: '✨ cargo criado',
  welcome_sent: '🏰 boas-vindas',
  welcome_failed: '⚠️ boas-vindas não enviadas',
  member_promoted: '⚔️ promovido',
  config_changed: '⚙️ configuração',
};

export const auditoria: Command = {
  name: 'auditoria',
  aliases: ['historico-bot', 'audit'],
  category: 'Administração',
  usage: '[quantidade]',
  description: 'Histórico das ações automáticas do bot (cargos, boas-vindas, promoções, configurações) (admin)',
  adminOnly: true,
  async execute(ctx) {
    const n = Math.min(20, Math.max(1, Number(ctx.args[0]) || 10));
    const entries = await listAudit(ctx.client.guildId, n);
    if (!entries.length) {
      await ctx.reply('Nenhum registro ainda.');
      return;
    }
    const lines = entries.map((e) => {
      const who = e.userId ? ` ${mention(e.userId)}` : '';
      const role = e.roleId ? ` <@&${e.roleId}>` : '';
      const by = e.actorId ? ` · por ${mention(e.actorId)}` : '';
      return `${timeTag(e.createdAt)} ${ACTION_LABEL[e.action] ?? e.action}${who}${role}${by}`;
    });
    await ctx.reply({
      allowed_mentions: { parse: [] },
      embeds: [{ color: Colors.info, title: '📜 Auditoria do bot', description: lines.join('\n') }],
    });
  },
};
