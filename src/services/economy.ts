import type { Db } from '../database/client.js';
import { UserError } from '../types/domain.js';

export async function addCoins(db: Db, playerId: string, amount: number, reason: string): Promise<number> {
  const player = await db.player.update({ where: { id: playerId }, data: { coins: { increment: amount } } });
  await db.transaction.create({ data: { playerId, amount, reason } });
  return player.coins;
}

/** Debita moedas, falhando se o saldo for insuficiente. */
export async function spendCoins(db: Db, playerId: string, amount: number, reason: string): Promise<number> {
  const player = await db.player.findUnique({ where: { id: playerId } });
  if (!player || player.coins < amount) {
    throw new UserError(`Saldo insuficiente: você tem **${player?.coins ?? 0}** FluxCoins e precisa de **${amount}**.`);
  }
  return addCoins(db, playerId, -amount, reason);
}
