/** Embed de jogo grátis: imagem, nome, descrição, plataforma, prazo e link "Resgatar". */
import { clip, timeTag } from './format.js';
import type { Embed } from '../fluxer/types.js';
import type { FreeGameOffer } from '../services/freeGames/types.js';

export function freeGameEmbed(game: FreeGameOffer): Embed {
  const weekend = game.kind === 'free-weekend';
  const lines = [
    `**[${game.title}](${game.url})**`,
    game.description ? clip(game.description, 600) : null,
    '',
    `🏷️ ${game.platform}${weekend ? ' · **Free Weekend** (jogue grátis por tempo limitado)' : ' · **grátis para resgatar e manter**'}`,
    `⏰ Até: ${game.endsAt ? `${timeTag(game.endsAt, 'f')} (${timeTag(game.endsAt, 'R')})` : 'não informado'}`,
    '',
    // O Fluxer não tem botões; o link faz o papel do "Resgatar".
    `🎁 **[${weekend ? 'Jogar grátis' : 'Resgatar'}](${game.url})**`,
  ].filter((l): l is string => l !== null);
  return {
    color: 0xa855f7,
    title: weekend ? '🎮 FREE WEEKEND' : '🎁 JOGO GRÁTIS',
    url: game.url,
    description: lines.join('\n'),
    image: game.image ? { url: game.image } : undefined,
    footer: { text: game.platform },
  };
}
