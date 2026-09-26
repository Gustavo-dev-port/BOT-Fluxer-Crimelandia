import { EmbedBuilder, type GuildMember, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Colors, discordTime } from '../bot/format.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { parseHexColor, SHOP_ITEMS, type ShopItem } from '../lib/shop.js';
import { UserError } from '../lib/types.js';
import { ensurePlayer } from '../services/players.js';
import { equipTitle, purchase, recentTransactions, refund } from '../services/shop.js';
import { type Command, refOf } from './types.js';

export const loja: Command = {
  data: new SlashCommandBuilder().setName('loja').setDescription('Itens que você pode comprar com FluxCoins'),
  async execute(interaction) {
    const player = await ensurePlayer(prisma, refOf(interaction.user));
    const lines = SHOP_ITEMS.map((i) => `🪙 **${i.price}** — ${i.name} · \`${i.id}\``);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.gold)
          .setTitle('🛒 Loja Fluxer')
          .setDescription(`${lines.join('\n')}\n\nCompre com **/comprar item:<id>**.`)
          .addFields({
            name: 'Como ganhar FluxCoins',
            value: `Vitória **+${config.coins.win}** · Participação **+${config.coins.participation}** · Campeão **+${config.coins.champion}** · Evento especial **+${config.coins.specialEvent}**`,
          })
          .setFooter({ text: `Seu saldo: ${player.coins} FluxCoins` }),
      ],
    });
  },
};

/** Aplica itens que dependem de cargos do Discord. */
async function applyDiscordItem(member: GuildMember, item: ShopItem, color: number | null): Promise<string> {
  if (item.kind === 'role') {
    const roleId = process.env[item.roleEnv];
    if (!roleId) throw new UserError('Este item ainda não foi configurado pelos admins.');
    await member.roles.add(roleId);
    return `Você recebeu o cargo <@&${roleId}>!`;
  }
  if (item.kind === 'color') {
    if (color === null) throw new UserError('Informe uma cor válida na opção `cor` (ex.: `#ff8800`).');
    const expiresAt = new Date(Date.now() + item.days * 86_400_000);
    const existing = await prisma.tempRole.findFirst({ where: { playerId: member.id, deleteRole: true } });
    const guild = member.guild;
    let role = existing ? await guild.roles.fetch(existing.roleId).catch(() => null) : null;
    if (role) {
      await role.setColor(color);
      await prisma.tempRole.update({ where: { id: existing!.id }, data: { expiresAt } });
    } else {
      const top = guild.members.me?.roles.highest.position ?? 1;
      role = await guild.roles.create({ name: `🎨 ${member.user.username}`, color, position: Math.max(1, top - 1), reason: 'Loja Fluxer' });
      if (existing) await prisma.tempRole.delete({ where: { id: existing.id } });
      await prisma.tempRole.create({ data: { playerId: member.id, roleId: role.id, deleteRole: true, expiresAt } });
    }
    await member.roles.add(role);
    return `Seu nickname ficou colorido até ${discordTime(expiresAt, 'f')}! 🎨`;
  }
  return '';
}

export const comprar: Command = {
  data: new SlashCommandBuilder()
    .setName('comprar')
    .setDescription('Compra um item da loja')
    .addStringOption((o) =>
      o
        .setName('item')
        .setDescription('Item')
        .setRequired(true)
        .addChoices(...SHOP_ITEMS.map((i) => ({ name: `${i.name} (${i.price})`, value: i.id }))),
    )
    .addStringOption((o) => o.setName('cor').setDescription('Cor em hexadecimal para o item de cor, ex.: #ff8800')),
  async execute(interaction) {
    const colorInput = interaction.options.getString('cor');
    const color = colorInput ? parseHexColor(colorInput) : null;
    const itemId = interaction.options.getString('item', true);
    if (itemId === 'cor-nick' && color === null) throw new UserError('Informe uma cor válida na opção `cor` (ex.: `#ff8800`).');

    await interaction.deferReply();
    const { item, balance } = await purchase(refOf(interaction.user), itemId);
    let message = '';
    if (item.kind === 'title') message = `Equipe com **/titulo equipar titulo:${item.title}**.`;
    if (item.kind === 'event_credit') message = 'Crie seu evento com **/campeonato criar**!';
    if (item.kind === 'role' || item.kind === 'color') {
      try {
        const member = await interaction.guild!.members.fetch(interaction.user.id);
        message = await applyDiscordItem(member, item, color);
      } catch (err) {
        await refund(interaction.user.id, item);
        if (err instanceof UserError) throw err;
        console.error('[loja] Falha ao aplicar item:', err);
        throw new UserError('Não consegui aplicar o item (o bot precisa da permissão Gerenciar Cargos). Suas FluxCoins foram devolvidas.');
      }
    }
    await interaction.editReply(`🛒 Você comprou **${item.name}**! ${message}\nSaldo: 🪙 **${balance}**`);
  },
};

export const titulo: Command = {
  data: new SlashCommandBuilder()
    .setName('titulo')
    .setDescription('Gerencia seu título exibido no perfil')
    .addSubcommand((s) =>
      s
        .setName('equipar')
        .setDescription('Equipa um título que você possui')
        .addStringOption((o) => o.setName('titulo').setDescription('Título').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName('remover').setDescription('Remove o título equipado'))
    .addSubcommand((s) => s.setName('listar').setDescription('Lista seus títulos')),
  async autocomplete(interaction) {
    const titles = await prisma.playerTitle.findMany({ where: { playerId: interaction.user.id } });
    await interaction.respond(titles.slice(0, 25).map((t) => ({ name: t.title, value: t.title })));
  },
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'equipar') {
      const title = interaction.options.getString('titulo', true);
      await equipTitle(interaction.user.id, title);
      await interaction.reply({ content: `🎖️ Título **${title}** equipado!`, flags: MessageFlags.Ephemeral });
    } else if (sub === 'remover') {
      await ensurePlayer(prisma, refOf(interaction.user));
      await equipTitle(interaction.user.id, null);
      await interaction.reply({ content: 'Título removido.', flags: MessageFlags.Ephemeral });
    } else {
      const titles = await prisma.playerTitle.findMany({ where: { playerId: interaction.user.id } });
      await interaction.reply({
        content: titles.length ? `Seus títulos: ${titles.map((t) => `**${t.title}**`).join(', ')}` : 'Você ainda não tem títulos. Veja a /loja!',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

export const saldo: Command = {
  data: new SlashCommandBuilder().setName('saldo').setDescription('Seu saldo e últimas movimentações de FluxCoins'),
  async execute(interaction) {
    const player = await ensurePlayer(prisma, refOf(interaction.user));
    const txs = await recentTransactions(player.id);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.gold)
          .setTitle(`🪙 ${player.coins} FluxCoins`)
          .setDescription(
            txs.length
              ? txs.map((t) => `${t.amount >= 0 ? '🟢' : '🔴'} **${t.amount >= 0 ? '+' : ''}${t.amount}** — ${t.reason} · ${discordTime(t.createdAt)}`).join('\n')
              : '_Sem movimentações ainda._',
          ),
      ],
    });
  },
};
