import { admin, jogo, setup, temporada } from './admin.js';
import { campeonato, inscrever } from './campeonato.js';
import { aceitar, cancelar, confirmar, contestar, duelo, partidas, recusar, resultado } from './duelo.js';
import { comprar, loja, saldo, titulo } from './economia.js';
import { perfil, rank, rival, top10 } from './ranking.js';
import { time } from './time.js';
import type { Command } from './types.js';

export const commands: Command[] = [
  // Duelos
  duelo,
  aceitar,
  recusar,
  cancelar,
  resultado,
  confirmar,
  contestar,
  partidas,
  // Ranking
  rank,
  top10,
  perfil,
  rival,
  // Times e campeonatos
  time,
  campeonato,
  inscrever,
  // Economia
  loja,
  comprar,
  titulo,
  saldo,
  // Administração
  temporada,
  jogo,
  setup,
  admin,
];

export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
