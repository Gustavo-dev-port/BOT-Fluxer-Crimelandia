/**
 * Parsing de comandos de texto (o Fluxer não tem slash commands).
 * Exemplo: `!time desafiar "Os Brabos" "Time B" CS2`
 */

/** Divide em palavras, respeitando "aspas" (retas ou curvas). */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|“([^”]*)”|(\S+)/g;
  for (const m of input.matchAll(re)) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

export interface ParsedCommand {
  name: string;
  args: string[];
  /** Texto cru depois do nome do comando. */
  rest: string;
}

/** Retorna null se a mensagem não começa com o prefixo. */
export function parseCommand(content: string, prefix: string): ParsedCommand | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith(prefix)) return null;
  const body = trimmed.slice(prefix.length).trimStart();
  const match = /^(\S+)\s*([\s\S]*)$/.exec(body);
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: tokenize(match[2]), rest: match[2].trim() };
}

/** `<@123>` → "123". O Fluxer usa `<@id>` para menções de usuário. */
export function parseUserMention(token: string): string | null {
  const m = /^<@!?(\d+)>$/.exec(token);
  return m ? m[1] : null;
}

/** `#12` ou `12` → 12 (IDs de partida/campeonato são pequenos; snowflakes são ignorados). */
export function parseSmallId(token: string | undefined): number | null {
  if (!token) return null;
  const m = /^#?(\d{1,9})$/.exec(token);
  return m ? Number(m[1]) : null;
}

/** Remove menções e IDs `#n` e junta o resto (ex.: nome de jogo com espaços). */
export function freeText(tokens: string[]): string {
  return tokens
    .filter((t) => !parseUserMention(t) && !/^#\d{1,9}$/.test(t))
    .join(' ')
    .trim();
}

/** `<#123>` → "123" (menção de canal). */
export function parseChannelMention(token: string): string | null {
  const m = /^<#(\d+)>$/.exec(token);
  return m ? m[1] : null;
}

/** `<@&123>` → "123" (menção de cargo). */
export function parseRoleMention(token: string): string | null {
  const m = /^<@&(\d+)>$/.exec(token);
  return m ? m[1] : null;
}

/**
 * Duração da partida: "25min", "25m", "1h", "1h20", "1h20m" → segundos.
 * Retorna null se o texto não for uma duração.
 */
export function parseDuration(token: string): number | null {
  const t = token.toLowerCase();
  let m = /^(\d{1,3})\s*(?:m|min|mins|minutos?)$/.exec(t);
  if (m) return Number(m[1]) * 60;
  m = /^(\d{1,2})h(?:(\d{1,2})(?:m|min)?)?$/.exec(t);
  if (m) return Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60;
  return null;
}
