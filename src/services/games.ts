import { config } from '../config.js';
import { prisma } from '../db.js';
import { UserError } from '../lib/types.js';

export async function seedDefaultGames() {
  for (const name of config.defaultGames) {
    await prisma.game.upsert({ where: { name }, create: { name }, update: {} });
  }
}

export async function listGames(includeInactive = false) {
  return prisma.game.findMany({ where: includeInactive ? undefined : { active: true }, orderBy: { name: 'asc' } });
}

export async function addGame(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 50) throw new UserError('Nome de jogo inválido.');
  return prisma.game.upsert({ where: { name: trimmed }, create: { name: trimmed }, update: { active: true } });
}

export async function removeGame(name: string) {
  const game = await prisma.game.findUnique({ where: { name } });
  if (!game) throw new UserError(`Jogo **${name}** não encontrado.`);
  return prisma.game.update({ where: { id: game.id }, data: { active: false } });
}

/** Normaliza o jogo digitado para o nome cadastrado (sem diferenciar maiúsculas). */
export async function resolveGame(input: string): Promise<string> {
  const games = await listGames();
  const match = games.find((g) => g.name.toLowerCase() === input.trim().toLowerCase());
  if (!match) {
    throw new UserError(`Jogo **${input}** não cadastrado. Jogos disponíveis: ${games.map((g) => g.name).join(', ')}.`);
  }
  return match.name;
}
