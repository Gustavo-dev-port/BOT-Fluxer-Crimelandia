import { prisma, transaction } from '../db.js';
import { findItem, type ShopItem } from '../lib/shop.js';
import { UserError } from '../lib/types.js';
import { spendCoins } from './economy.js';
import { ensurePlayer, type PlayerRef } from './players.js';

/**
 * Debita o item e registra o que for puramente de banco (títulos, créditos).
 * Itens que mexem em cargos do servidor são aplicados pela camada do bot,
 * que chama `refund` se algo der errado.
 */
export async function purchase(user: PlayerRef, itemId: string): Promise<{ item: ShopItem; balance: number }> {
  const item = findItem(itemId);
  if (!item) throw new UserError('Item não encontrado na loja.');
  return transaction(async (tx) => {
    await ensurePlayer(tx, user);
    if (item.kind === 'title') {
      const owned = await tx.playerTitle.findUnique({ where: { playerId_title: { playerId: user.id, title: item.title } } });
      if (owned) throw new UserError(`Você já tem o título **${item.title}**.`);
    }
    const balance = await spendCoins(tx, user.id, item.price, `Loja: ${item.name}`);
    if (item.kind === 'title') {
      await tx.playerTitle.create({ data: { playerId: user.id, title: item.title } });
    } else if (item.kind === 'event_credit') {
      await tx.player.update({ where: { id: user.id }, data: { eventCredits: { increment: 1 } } });
    }
    return { item, balance };
  });
}

export async function refund(playerId: string, item: ShopItem) {
  await prisma.player.update({ where: { id: playerId }, data: { coins: { increment: item.price } } });
  await prisma.transaction.create({ data: { playerId, amount: item.price, reason: `Estorno: ${item.name}` } });
}

export async function equipTitle(playerId: string, title: string | null) {
  if (title) {
    const owned = await prisma.playerTitle.findUnique({ where: { playerId_title: { playerId, title } } });
    if (!owned) throw new UserError(`Você não tem o título **${title}**.`);
  }
  await prisma.player.update({ where: { id: playerId }, data: { equippedTitle: title } });
}

/** Consome um crédito de evento personalizado, se houver. */
export async function consumeEventCredit(playerId: string): Promise<boolean> {
  const res = await prisma.player.updateMany({
    where: { id: playerId, eventCredits: { gt: 0 } },
    data: { eventCredits: { decrement: 1 } },
  });
  return res.count > 0;
}

export async function recentTransactions(playerId: string, take = 10) {
  return prisma.transaction.findMany({ where: { playerId }, orderBy: { createdAt: 'desc' }, take });
}
