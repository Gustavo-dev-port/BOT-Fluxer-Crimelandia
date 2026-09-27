export type ShopItem =
  | { id: string; name: string; price: number; kind: 'title'; title: string }
  | { id: string; name: string; price: number; kind: 'color'; days: number }
  | { id: string; name: string; price: number; kind: 'event_credit' }
  | { id: string; name: string; price: number; kind: 'role'; roleEnv: string; days: number }
  | { id: string; name: string; price: number; kind: 'nickname'; days: number };

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'titulo-rei-do-rush', name: 'Título: Rei do Rush', price: 200, kind: 'title', title: 'Rei do Rush' },
  { id: 'titulo-fantasma', name: 'Título: Fantasma', price: 200, kind: 'title', title: 'Fantasma' },
  { id: 'titulo-sniper', name: 'Título: Sniper', price: 200, kind: 'title', title: 'Sniper' },
  { id: 'titulo-clutch', name: 'Título: Senhor do Clutch', price: 300, kind: 'title', title: 'Senhor do Clutch' },
  { id: 'titulo-tryhard', name: 'Título: Tryhard', price: 150, kind: 'title', title: 'Tryhard' },
  { id: 'cor-nick', name: 'Cor do nickname (7 dias)', price: 250, kind: 'color', days: 7 },
  { id: 'evento-personalizado', name: 'Criar um evento personalizado', price: 400, kind: 'event_credit' },
  { id: 'cargo-vip', name: 'Cargo cosmético VIP (7 dias)', price: 500, kind: 'role', roleEnv: 'SHOP_VIP_ROLE_ID', days: 7 },
  { id: 'apelido-especial', name: 'Apelido especial ✨ (7 dias)', price: 300, kind: 'nickname', days: 7 },
];

export function findItem(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((i) => i.id === id);
}

/** Aceita "#ff8800", "ff8800" ou "#f80". */
export function parseHexColor(input: string): number | null {
  let hex = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex))
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return parseInt(hex, 16);
}

/** Máximo de caracteres de um apelido no Fluxer (docs: guild member update, nick 1–32). */
export const MAX_NICK_LENGTH = 32;
export const SPECIAL_NICK_PREFIX = '✨ ';

/**
 * Apelido especial: tira menções e caracteres de controle, junta espaços e põe
 * o prefixo ✨. Retorna null se não sobrar nada.
 */
export function specialNickname(input: string): string | null {
  const clean = input
    .replace(/[\p{Cc}<>@#`]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  return (SPECIAL_NICK_PREFIX + clean).slice(0, MAX_NICK_LENGTH).trim();
}
