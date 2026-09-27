import { Colors } from '../embeds/format.js';
import { config as appConfig } from '../config.js';
import { CHANNEL_FIELDS, type ChannelKey, guildSettings, ROLE_FIELDS, type RoleKey } from '../database/guildSettingsRepository.js';
import { ChannelType } from '../fluxer/types.js';
import { parseChannelMention, parseRoleMention } from '../utils/args.js';
import { UserError } from '../types/domain.js';
import type { Command, CommandContext } from './types.js';

/** Nome usado no comando → canal em GuildSettings. */
const CHANNEL_OPTIONS: Record<string, { key: ChannelKey; label: string }> = {
  promo: { key: 'promo', label: 'Promoções' },
  'jogos-gratis': { key: 'freeGames', label: 'Jogos grátis' },
  gratis: { key: 'freeGames', label: 'Jogos grátis' },
  musica: { key: 'music', label: 'Música' },
  eventos: { key: 'events', label: 'Eventos' },
  placar: { key: 'scoreboard', label: 'Placar' },
  partidas: { key: 'matches', label: 'Partidas' },
  comandos: { key: 'commands', label: 'Comandos' },
  hall: { key: 'hall', label: 'Hall do Reino' },
};

const ROLE_OPTIONS: Record<string, { key: RoleKey; label: string }> = {
  'promo-role': { key: 'promo', label: 'Caçadores de Promoção (menção em promoções ≥ 80%)' },
  'campeao-role': { key: 'champion', label: 'Campeão da temporada' },
};

const LANGUAGES = ['pt-BR'];
const CLEAR_WORDS = new Set(['limpar', 'remover', 'nenhum']);

async function showSettings(ctx: CommandContext) {
  const s = await guildSettings.get(ctx.client.guildId);
  const ch = (id: string | null) => (id ? `<#${id}>` : '_não configurado_');
  const role = (id: string | null) => (id ? `<@&${id}>` : '_não configurado_');
  // Um canal pode ter mais de um nome no comando (ex.: gratis / jogos-gratis); mostra só o primeiro.
  const seen = new Set<ChannelKey>();
  const channelLines = Object.entries(CHANNEL_OPTIONS)
    .filter(([, o]) => !seen.has(o.key) && Boolean(seen.add(o.key)))
    .map(([name, o]) => `**${o.label}** (\`${name}\`): ${ch(s[CHANNEL_FIELDS[o.key]])}`);
  await ctx.reply({
    allowed_mentions: { parse: [] },
    embeds: [
      {
        color: Colors.primary,
        title: '⚙️ Configuração do servidor',
        fields: [
          { name: 'Canais', value: channelLines.join('\n') },
          {
            name: 'Cargos',
            value: Object.entries(ROLE_OPTIONS)
              .map(([name, o]) => `**${o.label}** (\`${name}\`): ${role(s[ROLE_FIELDS[o.key]])}`)
              .join('\n'),
          },
          { name: 'Idioma', value: s.language },
        ],
        footer: {
          text: `Ex.: ${appConfig.prefix}config promo #promocoes · ${appConfig.prefix}config promo-role @Caçadores · ${appConfig.prefix}config promo limpar`,
        },
      },
    ],
  });
}

export const configCommand: Command = {
  name: 'config',
  aliases: ['configurar'],
  category: 'Administração',
  usage: '[opção] [#canal | @cargo | limpar]',
  description: 'Configura canais e cargos do bot (admin)',
  adminOnly: true,
  details: [
    '`!config` — mostra a configuração atual',
    `Canais: ${Object.keys(CHANNEL_OPTIONS)
      .map((n) => `\`${n}\``)
      .join(', ')} — ex.: \`!config promo #promocoes\``,
    `Cargos: ${Object.keys(ROLE_OPTIONS)
      .map((n) => `\`${n}\``)
      .join(', ')} — ex.: \`!config promo-role @Caçadores de Promoção\``,
    '`!config idioma pt-BR` · qualquer opção + `limpar` remove o valor',
  ],
  async execute(ctx) {
    const option = ctx.args[0]?.toLowerCase();
    const value = ctx.args[1];
    if (!option || option === 'ver') return showSettings(ctx);

    const guildId = ctx.client.guildId;
    const clear = value !== undefined && CLEAR_WORDS.has(value.toLowerCase());

    const channelOpt = CHANNEL_OPTIONS[option];
    if (channelOpt) {
      if (clear) {
        await guildSettings.setChannel(guildId, channelOpt.key, null);
        await ctx.reply(`🧹 Canal de **${channelOpt.label}** removido.`);
        return;
      }
      const channelId = value ? parseChannelMention(value) : null;
      if (!channelId) throw new UserError(`Mencione o canal: \`${appConfig.prefix}config ${option} #canal\``);
      const channels = await ctx.client.rest.getGuildChannels(guildId);
      const channel = channels.find((c) => c.id === channelId);
      if (!channel || (channel.type !== ChannelType.GUILD_TEXT && channel.type !== ChannelType.GUILD_VOICE)) {
        throw new UserError('Esse canal não existe neste servidor ou não aceita mensagens.');
      }
      await guildSettings.setChannel(guildId, channelOpt.key, channelId);
      await ctx.reply(`✅ **${channelOpt.label}** agora é <#${channelId}>.`);
      return;
    }

    const roleOpt = ROLE_OPTIONS[option];
    if (roleOpt) {
      if (clear) {
        await guildSettings.setRole(guildId, roleOpt.key, null);
        await ctx.reply(`🧹 Cargo de **${roleOpt.label}** removido.`);
        return;
      }
      const roleId = value ? parseRoleMention(value) : null;
      if (!roleId) throw new UserError(`Mencione o cargo: \`${appConfig.prefix}config ${option} @cargo\``);
      const roles = await ctx.client.getRoles();
      if (!roles.some((r) => r.id === roleId)) throw new UserError('Esse cargo não existe neste servidor.');
      await guildSettings.setRole(guildId, roleOpt.key, roleId);
      await ctx.reply({ content: `✅ **${roleOpt.label}** agora é <@&${roleId}>.`, allowed_mentions: { parse: [] } });
      return;
    }

    if (option === 'idioma') {
      if (!value || !LANGUAGES.includes(value)) throw new UserError(`Idiomas disponíveis: ${LANGUAGES.join(', ')}.`);
      await guildSettings.update(guildId, { language: value });
      await ctx.reply(`✅ Idioma: **${value}**.`);
      return;
    }

    throw new UserError(`Opção desconhecida. Veja \`${appConfig.prefix}ajuda config\`.`);
  },
};
