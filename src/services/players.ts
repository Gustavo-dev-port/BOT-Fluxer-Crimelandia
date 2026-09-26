import { config } from '../config.js';
import type { Db } from '../db.js';

export interface PlayerRef {
  id: string;
  username: string;
}

/** Cria o jogador se não existir e mantém o nome atualizado. */
export async function ensurePlayer(db: Db, ref: PlayerRef) {
  return db.player.upsert({
    where: { id: ref.id },
    create: { id: ref.id, username: ref.username },
    update: { username: ref.username },
  });
}

/** Estatísticas do jogador na temporada, criando com o rating inicial se necessário. */
export async function ensureStats(db: Db, playerId: string, seasonId: number) {
  return db.playerSeasonStats.upsert({
    where: { playerId_seasonId: { playerId, seasonId } },
    create: { playerId, seasonId, rating: config.elo.initial },
    update: {},
  });
}
