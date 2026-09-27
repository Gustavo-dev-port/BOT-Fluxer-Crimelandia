/** Datas de calendário num fuso horário, sem bibliotecas externas. */

/** Diferença (ms) entre o horário local do fuso e o UTC, no instante dado. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Meia-noite do dia 1º do mês seguinte, no fuso informado. */
export function startOfNextMonth(now: Date, timeZone: string): Date {
  const local = new Date(now.getTime() + tzOffsetMs(now, timeZone));
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1);
  // Converte a meia-noite "local" para UTC (duas passadas cobrem mudanças de horário de verão).
  let utc = guess - tzOffsetMs(new Date(guess), timeZone);
  utc = guess - tzOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

/** Dia no fuso informado, no formato "AAAA-MM-DD" (ex.: missões diárias). */
export function dateKeyIn(now: Date, timeZone: string): string {
  // en-CA formata como 2026-09-28.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
