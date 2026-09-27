import { describe, expect, it } from 'vitest';
import { computeGuildPermissions, has, highestRolePosition, Permission } from '../src/fluxer/permissions.js';
import { freeText, parseCommand, parseSmallId, parseUserMention, tokenize } from '../src/lib/args.js';

describe('parsing de comandos', () => {
  it('separa nome e argumentos respeitando aspas', () => {
    expect(parseCommand('!time desafiar "Os Brabos" “Time B” CS2', '!')).toEqual({
      name: 'time',
      args: ['desafiar', 'Os Brabos', 'Time B', 'CS2'],
      rest: 'desafiar "Os Brabos" “Time B” CS2',
    });
    expect(parseCommand('  !DUELO   <@2>  League of Legends ', '!')?.name).toBe('duelo');
    expect(parseCommand('oi', '!')).toBeNull();
    expect(parseCommand('!', '!')).toBeNull();
  });
  it('menções, IDs pequenos e texto livre', () => {
    expect(parseUserMention('<@123>')).toBe('123');
    expect(parseUserMention('<@&123>')).toBeNull(); // cargo
    expect(parseSmallId('#12')).toBe(12);
    expect(parseSmallId('12')).toBe(12);
    expect(parseSmallId('1189375284394692608')).toBeNull(); // snowflake
    expect(freeText(tokenize('<@1> League of Legends #3'))).toBe('League of Legends');
  });
});

describe('permissões (docs: Permission computation)', () => {
  const guild = '10';
  const roles = [
    {
      id: guild,
      name: '@everyone',
      color: 0,
      position: 0,
      permissions: String(Permission.SEND_MESSAGES),
      hoist: false,
      mentionable: false,
    },
    { id: 'mod', name: 'Mod', color: 0, position: 2, permissions: String(Permission.MANAGE_GUILD), hoist: false, mentionable: false },
    { id: 'adm', name: 'Adm', color: 0, position: 3, permissions: String(Permission.ADMINISTRATOR), hoist: false, mentionable: false },
  ];
  it('@everyone (id = servidor) vale para todos', () => {
    const p = computeGuildPermissions(guild, 'owner', 'u', [], roles);
    expect(has(p, Permission.SEND_MESSAGES)).toBe(true);
    expect(has(p, Permission.MANAGE_GUILD)).toBe(false);
  });
  it('cargos somam; ADMINISTRATOR e dono têm tudo', () => {
    expect(has(computeGuildPermissions(guild, 'owner', 'u', ['mod'], roles), Permission.MANAGE_GUILD)).toBe(true);
    expect(has(computeGuildPermissions(guild, 'owner', 'u', ['adm'], roles), Permission.MANAGE_ROLES)).toBe(true);
    expect(has(computeGuildPermissions(guild, 'owner', 'owner', [], roles), Permission.PIN_MESSAGES)).toBe(true);
  });
  it('bits acima de 32 funcionam (PIN_MESSAGES = 1 << 51)', () => {
    const r = [{ ...roles[0], permissions: String(Permission.PIN_MESSAGES) }];
    expect(has(computeGuildPermissions(guild, 'o', 'u', [], r), Permission.PIN_MESSAGES)).toBe(true);
  });
  it('posição do cargo mais alto', () => {
    expect(highestRolePosition(['mod', 'adm'], roles)).toBe(3);
    expect(highestRolePosition([], roles)).toBe(0);
  });
});

describe('nomes de canal', () => {
  it('ignora emojis, separadores e acentos', async () => {
    const { normalizeChannelName } = await import('../src/bot/channels.js');
    expect(normalizeChannelName('📜┃eventos')).toBe('eventos');
    expect(normalizeChannelName('🎁┃jogos-gratis')).toBe(normalizeChannelName('jogos-grátis'));
    expect(normalizeChannelName('💸┃promocoes')).toBe('promocoes');
  });
});

describe('schema do PostgreSQL', () => {
  it('está sincronizado com prisma/schema.prisma (rode npm run db:postgres:sync)', async () => {
    const { readFileSync } = await import('node:fs');
    // @ts-expect-error script .mjs sem tipos
    const { toPostgres } = (await import('../scripts/sync-postgres-schema.mjs')) as { toPostgres: (s: string) => string };
    expect(readFileSync('prisma/postgres/schema.prisma', 'utf8')).toBe(toPostgres(readFileSync('prisma/schema.prisma', 'utf8')));
  });
});

describe('logs sem credenciais', () => {
  it('HttpError esconde chaves na URL', async () => {
    const { HttpError, redactUrl } = await import('../src/utils/http.js');
    expect(redactUrl('https://api/x?limit=5&key=SEGREDO&b=1')).toBe('https://api/x?limit=5&key=***&b=1');
    expect(new HttpError(403, 'https://api/x?token=abc').message).not.toContain('abc');
  });
});
