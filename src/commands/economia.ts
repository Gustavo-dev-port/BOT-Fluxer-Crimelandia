import { cmd, Colors, timeTag } from '../bot/format.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import type { FluxerClient } from '../fluxer/client.js';
import type { Snowflake } from '../fluxer/types.js';
import { findItem, parseHexColor, SHOP_ITEMS, type ShopItem } from '../lib/shop.js';
import { UserError } from '../lib/types.js';
import { ensurePlayer } from '../services/players.js';
import { equipTitle, purchase, recentTransactions, refund } from '../services/shop.js';
import { type Command, refOf } from './types.js';

export const loja: Command = {
  name: 'loja',
  aliases: ['shop'],
  category: 'Economia',
  usage: '',
  description: 'Itens que você pode comprar com FluxCoins',
  async execute(ctx) {
    const player = await ensurePlayer(prisma, refOf(ctx.author));
    const lines = SHOP_ITEMS.map((i) => `🪙 **${i.price}** — ${i.name} · \`${i.id}\``);
    await ctx.reply({
      embeds: [
        {
          color: Colors.gold,
          title: '🛒 Loja Fluxer',
          description: `${lines.join('\n')}\n\nCompre com ${cmd('comprar')} <id>. Para a cor: ${cmd('comprar')} cor-nick #ff8800`,
          fields: [
            {
              name: 'Como ganhar FluxCoins',
              value: `Vitória **+${config.coins.win}** · Participação **+${config.coins.participation}** · Campeão **+${config.coins.champion}** · Evento especial **+${config.coins.specialEvent}**`,
            },
          ],
          footer: { text: `Seu saldo: ${player.coins} FluxCoins` },
        },
      ],
    });
  },
};

/** Aplica itens que dependem de cargos no servidor. */
async function applyRoleItem(client: FluxerClient, userId: Snowflake, username: string, item: ShopItem, color: number | null): Promise<string> {
  const reason = 'Loja Fluxer';
  if (item.kind === 'role') {
    const roleId = process.env[item.roleEnv];
    if (!roleId) throw new UserError('Este item ainda não foi configurado pelos admins.');
    await client.rest.addMemberRole(client.guildId, userId, roleId, reason);
    return `Você recebeu o cargo <@&${roleId}>!`;
  }
  if (item.kind === 'color') {
    const expiresAt = new Date(Date.now() + item.days * 86_400_000);
    const existing = await prisma.tempRole.findFirst({ where: { playerId: userId, deleteRole: true } });
    let roleId: Snowflake | null = null;
    if (existing) {
      // Renova: troca a cor do cargo que o jogador já tem.
      const updated = await client.rest.modifyRole(client.guildId, existing.roleId, { color: color! }, reason).catch(() => null);
      if (updated) {
        roleId = updated.id;
        await prisma.tempRole.update({ where: { id: existing.id }, data: { expiresAt } });
      } else {
        await prisma.tempRole.delete({ where: { id: existing.id } });
      }
    }
    if (!roleId) {
      const role = await client.rest.createRole(client.guildId, { name: `🎨 ${username}`.slice(0, 100), color: color!, permissions: '0' }, reason);
      roleId = role.id;
      // Cargos novos nascem na posição 1; sobe para logo abaixo do cargo do bot para a cor aparecer.
      const top = await client.botTopRolePosition().catch(() => 0);
      if (top > 1) await client.rest.setRolePositions(client.guildId, [{ id: role.id, position: top - 1 }], reason).catch(() => undefined);
      await prisma.tempRole.create({ data: { playerId: userId, roleId, deleteRole: true, expiresAt } });
    }
    await client.rest.addMemberRole(client.guildId, userId, roleId, reason);
    return `Seu nickname ficou colorido até ${timeTag(expiresAt, 'f')}! 🎨`;
  }
  return '';
}

export const comprar: Command = {
  name: 'comprar',
  aliases: ['buy'],
  category: 'Economia',
  usage: '<item> [#cor]',
  description: 'Compra um item da loja',
  details: ['Ex.: `!comprar titulo-sniper` · `!comprar cor-nick #ff8800`', 'Veja os IDs dos itens em `!loja`.'],
  async execute(ctx) {
    const itemId = ctx.args[0]?.toLowerCase();
    const item = itemId ? findItem(itemId) : undefined;
    if (!item) throw new UserError(`Item não encontrado. Veja os itens com \`${config.prefix}loja\`.`);
    const color = ctx.args[1] ? parseHexColor(ctx.args[1]) : null;
    if (item.kind === 'color' && color === null) throw new UserError('Informe uma cor em hexadecimal, ex.: `!comprar cor-nick #ff8800`.');

    const ref = refOf(ctx.author);
    const { balance } = await purchase(ref, item.id);
    let message = '';
    if (item.kind === 'title') message = `Equipe com \`${config.prefix}titulo equipar ${item.title}\`.`;
    if (item.kind === 'event_credit') message = `Crie seu evento com \`${config.prefix}campeonato criar\`!`;
    if (item.kind === 'role' || item.kind === 'color') {
      try {
        message = await applyRoleItem(ctx.client, ctx.author.id, ref.username, item, color);
      } catch (err) {
        await refund(ctx.author.id, item);
        if (err instanceof UserError) throw err;
        console.error('[loja] Falha ao aplicar item:', err);
        throw new UserError('Não consegui aplicar o item (o bot precisa da permissão **Gerenciar Cargos**). Suas FluxCoins foram devolvidas.');
      }
    }
    await ctx.reply(`🛒 Você comprou **${item.name}**! ${message}\nSaldo: 🪙 **${balance}**`);
  },
};

export const titulo: Command = {
  name: 'titulo',
  aliases: ['título', 'titulos'],
  category: 'Economia',
  usage: '<equipar|remover|listar> [título]',
  description: 'Gerencia o título exibido no seu perfil',
  details: ['Ex.: `!titulo equipar Rei do Rush`'],
  async execute(ctx) {
    const sub = ctx.args[0]?.toLowerCase();
    if (sub === 'equipar') {
      const typed = ctx.args.slice(1).join(' ').trim().toLowerCase();
      const titles = await prisma.playerTitle.findMany({ where: { playerId: ctx.author.id } });
      const title = titles.find((t) => t.title.toLowerCase() === typed)?.title;
      if (!title) throw new UserError(`Você não tem esse título. Seus títulos: ${titles.map((t) => `**${t.title}**`).join(', ') || 'nenhum'}.`);
      await equipTitle(ctx.author.id, title);
      await ctx.reply(`🎖️ Título **${title}** equipado!`);
    } else if (sub === 'remover') {
      await ensurePlayer(prisma, refOf(ctx.author));
      await equipTitle(ctx.author.id, null);
      await ctx.reply('Título removido.');
    } else {
      const titles = await prisma.playerTitle.findMany({ where: { playerId: ctx.author.id } });
      await ctx.reply(
        titles.length ? `Seus títulos: ${titles.map((t) => `**${t.title}**`).join(', ')}` : `Você ainda não tem títulos. Veja a \`${config.prefix}loja\`!`,
      );
    }
  },
};

export const saldo: Command = {
  name: 'saldo',
  aliases: ['coins', 'carteira'],
  category: 'Economia',
  usage: '',
  description: 'Seu saldo e últimas movimentações de FluxCoins',
  async execute(ctx) {
    const player = await ensurePlayer(prisma, refOf(ctx.author));
    const txs = await recentTransactions(player.id);
    await ctx.reply({
      embeds: [
        {
          color: Colors.gold,
          title: `🪙 ${player.coins} FluxCoins`,
          description: txs.length
            ? txs.map((t) => `${t.amount >= 0 ? '🟢' : '🔴'} **${t.amount >= 0 ? '+' : ''}${t.amount}** — ${t.reason} · ${timeTag(t.createdAt)}`).join('\n')
            : '_Sem movimentações ainda._',
        },
      ],
    });
  },
};
