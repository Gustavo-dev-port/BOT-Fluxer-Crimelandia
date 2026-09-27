import type { Embed } from '../fluxer/types.js';
import type { HallEntry, HallOfFame } from '../services/hallOfFame.js';
import { ACTIVE_WINDOW_DAYS, MVP_WINDOW_DAYS } from '../services/hallOfFame.js';
import { Colors, mention } from './format.js';

const pad = (n: number) => String(n).padStart(2, '0');
const EMPTY = '_O trono aguarda um desafiante._';

function card(entry: HallEntry | null, detail: (e: HallEntry) => string): string {
  return entry ? `${mention(entry.playerId)}\n${detail(entry)}` : EMPTY;
}

/** Hall do Reino: um "card" (campo) por honraria, na paleta medieval. */
export function hallEmbed(hall: HallOfFame): Embed {
  const champion = hall.champion;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return {
    color: Colors.royalGold,
    title: '🏰 Hall do Reino',
    description: '━━━━━━━━ ⚜️ ━━━━━━━━\nOs nomes que ecoam pelos salões de Crimelândia.',
    fields: [
      {
        name: champion?.current ? `👑 Líder da Temporada ${pad(champion.seasonNumber)}` : '👑 Campeão da Temporada',
        value: champion
          ? `${mention(champion.playerId)}\n${champion.current ? `${champion.value} pts até agora` : `Temporada ${pad(champion.seasonNumber)} · ${champion.value} pts`}`
          : EMPTY,
        inline: true,
      },
      {
        name: '⭐ MVP da Semana',
        value: card(hall.mvpWeek, (e) => `${plural(e.value, 'vitória')} em ${MVP_WINDOW_DAYS} dias`),
        inline: true,
      },
      {
        name: '🛡️ Mais Ativo',
        value: card(hall.mostActive, (e) => `${plural(e.value, 'partida')} em ${ACTIVE_WINDOW_DAYS} dias`),
        inline: true,
      },
      {
        name: '🔥 Maior Sequência',
        value: card(hall.bestStreak, (e) => (e.value === 1 ? '1 vitória' : `${e.value} vitórias seguidas`)),
        inline: true,
      },
      { name: '⚔️ Mais Vitórias', value: card(hall.mostWins, (e) => `${plural(e.value, 'vitória')} na carreira`), inline: true },
      { name: '🪙 Mais FluxCoins', value: card(hall.richest, (e) => `${e.value} FluxCoins`), inline: true },
    ],
    footer: { text: 'Atualizado a cada 10 minutos' },
    timestamp: hall.updatedAt.toISOString(),
  };
}
