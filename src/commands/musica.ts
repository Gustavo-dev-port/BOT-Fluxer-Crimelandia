import { cmd, Colors, mention } from '../embeds/format.js';
import { nowPlayingEmbed, queueEmbed, REPEAT_LABEL, trackLine } from '../embeds/musicEmbed.js';
import { musicService } from '../services/music/musicService.js';
import { MAX_VOLUME } from '../services/music/player.js';
import type { RepeatMode } from '../services/music/types.js';
import { UserError } from '../types/domain.js';
import type { Command, CommandContext } from './types.js';

const quiet = { allowed_mentions: { parse: [] as never[] } };
const music = (ctx: CommandContext) => musicService(ctx.client);

/** Controles exigem estar na mesma sala do bot (admins podem de qualquer lugar). */
async function requireListener(ctx: CommandContext) {
  const m = music(ctx);
  if (await ctx.isAdmin()) {
    if (!m.voice.channelId) throw new UserError('Não estou tocando nada agora.');
    return m;
  }
  m.requireSameChannel(ctx.author.id);
  return m;
}

export const tocar: Command = {
  name: 'tocar',
  aliases: ['play', 'toca'],
  category: 'Música',
  usage: '<música, link do YouTube ou do Spotify>',
  description: 'Toca uma música (ou playlist) na sua sala de voz; se já estiver tocando, entra na fila',
  details: [
    'Aceita: nome da música (busca no YouTube), link de vídeo ou playlist do YouTube, link de faixa, álbum ou playlist do Spotify.',
    '`!tocar proxima <música>` põe a música logo depois da atual.',
    'Entre numa sala de voz antes: o bot toca onde você estiver.',
  ],
  async execute(ctx) {
    let query = ctx.rest;
    let playNext = false;
    const first = ctx.args[0]?.toLowerCase();
    if (first === 'proxima' || first === 'próxima' || first === 'next') {
      playNext = true;
      query = ctx.rest.replace(/^\S+\s*/, '');
    }
    const r = await music(ctx).play(ctx.author.id, query, ctx.channelId, playNext);
    const extra = r.dropped ? `\n⚠️ ${r.dropped} música(s) ficaram de fora (limite da fila).` : '';
    const where = r.startedNow ? `Tocando em <#${r.channelId}>` : playNext ? 'Toca a seguir' : 'Adicionada à fila';
    await ctx.reply({
      ...quiet,
      embeds: [
        {
          color: Colors.royalGold,
          title: r.collection ? `📜 ${r.collection}` : `🎵 ${r.added[0].title}`,
          description:
            (r.collection ? `**${r.added.length}** músicas adicionadas.` : trackLine(r.added[0])) +
            `\n${where} · pedida por ${mention(ctx.author.id)}${extra}`,
          ...(r.added[0].thumbnail && !r.collection ? { thumbnail: { url: r.added[0].thumbnail } } : {}),
        },
      ],
    });
  },
};

export const pausar: Command = {
  name: 'pausar',
  aliases: ['pause'],
  category: 'Música',
  usage: '',
  description: 'Pausa a música',
  async execute(ctx) {
    const m = await requireListener(ctx);
    if (!m.player.pause()) throw new UserError('Não há música tocando para pausar.');
    await ctx.reply('⏸️ Pausado. Use `!continuar` para voltar.');
  },
};

export const continuar: Command = {
  name: 'continuar',
  aliases: ['resume', 'despausar'],
  category: 'Música',
  usage: '',
  description: 'Continua a música pausada (ou volta a tocar a fila salva)',
  async execute(ctx) {
    const m = music(ctx);
    if (m.player.state === 'paused') {
      await requireListener(ctx);
      m.player.resume();
      await ctx.reply('▶️ Continuando.');
      return;
    }
    if (await m.resumeQueue(ctx.author.id, ctx.channelId)) {
      await ctx.reply(`▶️ Voltando a tocar a fila em <#${m.voice.channelId}>.`);
      return;
    }
    throw new UserError(`Nada pausado. Peça uma música com ${cmd('tocar')}.`);
  },
};

export const pular: Command = {
  name: 'pular',
  aliases: ['skip', 'proxima'],
  category: 'Música',
  usage: '',
  description: 'Pula para a próxima música',
  async execute(ctx) {
    const m = await requireListener(ctx);
    const current = m.player.queue.current;
    if (!current || !m.player.skip()) throw new UserError('Não há música tocando.');
    await ctx.reply({ ...quiet, content: `⏭️ Pulada: **${current.title}**` });
  },
};

export const voltar: Command = {
  name: 'voltar',
  aliases: ['previous', 'anterior'],
  category: 'Música',
  usage: '',
  description: 'Volta para a música anterior',
  async execute(ctx) {
    const m = await requireListener(ctx);
    const prev = m.player.previous();
    if (!prev) throw new UserError('Não há música anterior.');
    await ctx.reply({ ...quiet, content: `⏮️ Voltando: **${prev.title}**` });
  },
};

export const parar: Command = {
  name: 'parar',
  aliases: ['stop'],
  category: 'Música',
  usage: '',
  description: 'Para a música, limpa a fila e sai da sala',
  async execute(ctx) {
    const m = await requireListener(ctx);
    await m.stop(`!parar de ${ctx.author.id}`);
    await ctx.reply('⏹️ Música parada e fila limpa.');
  },
};

export const sair: Command = {
  name: 'sair',
  aliases: ['leave', 'desconectar'],
  category: 'Música',
  usage: '',
  description: 'Tira o bot da sala de voz (a fila fica guardada para o !continuar)',
  async execute(ctx) {
    const m = await requireListener(ctx);
    const saved = m.player.queue.snapshot();
    await m.stop(`!sair de ${ctx.author.id}`);
    // Guarda o que faltava tocar para um !continuar depois.
    m.player.queue.add(saved);
    await m.saveQueue();
    await ctx.reply(`👋 Saí da sala.${saved.length ? ` ${saved.length} música(s) guardadas: use ${cmd('continuar')} para voltar.` : ''}`);
  },
};

export const fila: Command = {
  name: 'fila',
  aliases: ['queue', 'q'],
  category: 'Música',
  usage: '[página]',
  description: 'Mostra a fila de músicas',
  async execute(ctx) {
    const page = Number(ctx.args[0] ?? 1);
    await ctx.reply({ ...quiet, embeds: [queueEmbed(music(ctx).player, Number.isFinite(page) ? page : 1)] });
  },
};

export const tocando: Command = {
  name: 'tocando',
  aliases: ['np', 'nowplaying', 'agora'],
  category: 'Música',
  usage: '',
  description: 'Música atual, com progresso',
  async execute(ctx) {
    const m = music(ctx);
    await ctx.reply({ ...quiet, embeds: [nowPlayingEmbed(m.player, m.voice.channelId)] });
  },
};

export const embaralhar: Command = {
  name: 'embaralhar',
  aliases: ['shuffle', 'misturar'],
  category: 'Música',
  usage: '',
  description: 'Embaralha a fila',
  async execute(ctx) {
    const m = await requireListener(ctx);
    if (m.player.queue.size < 2) throw new UserError('Precisa de pelo menos 2 músicas na fila.');
    m.player.shuffle();
    await ctx.reply(`🔀 Fila embaralhada (${m.player.queue.size} músicas).`);
  },
};

const REPEAT_WORDS: Record<string, RepeatMode> = {
  musica: 'track',
  música: 'track',
  track: 'track',
  fila: 'queue',
  queue: 'queue',
  off: 'off',
  desligar: 'off',
  nao: 'off',
  não: 'off',
};

export const repetir: Command = {
  name: 'repetir',
  aliases: ['repeat', 'loop'],
  category: 'Música',
  usage: '[musica|fila|off]',
  description: 'Repetir a música atual, a fila inteira, ou desligar',
  details: ['Sem opção, alterna: desligado → música → fila → desligado.'],
  async execute(ctx) {
    const m = await requireListener(ctx);
    const word = ctx.args[0]?.toLowerCase();
    const order: RepeatMode[] = ['off', 'track', 'queue'];
    const mode = word ? REPEAT_WORDS[word] : order[(order.indexOf(m.player.queue.repeat) + 1) % order.length];
    if (!mode) throw new UserError('Use `!repetir musica`, `!repetir fila` ou `!repetir off`.');
    m.player.setRepeat(mode);
    await ctx.reply(`Repetir: **${REPEAT_LABEL[mode]}**`);
  },
};

export const volume: Command = {
  name: 'volume',
  aliases: ['vol'],
  category: 'Música',
  usage: `<0-${MAX_VOLUME}>`,
  description: 'Volume do bot para todos na sala (cada pessoa ainda pode ajustar o próprio no Fluxer)',
  async execute(ctx) {
    const m = music(ctx);
    if (!ctx.args[0]) {
      await ctx.reply(`🔊 Volume: **${m.player.volume}%**`);
      return;
    }
    await requireListener(ctx);
    const v = Number(ctx.args[0].replace('%', ''));
    if (!Number.isFinite(v) || v < 0 || v > MAX_VOLUME) throw new UserError(`O volume vai de 0 a ${MAX_VOLUME}.`);
    m.player.setVolume(v);
    await ctx.reply(`🔊 Volume: **${m.player.volume}%**`);
  },
};

export const remover: Command = {
  name: 'remover',
  aliases: ['remove', 'tirar'],
  category: 'Música',
  usage: '<posição na fila>',
  description: 'Tira uma música da fila (veja a posição em !fila)',
  async execute(ctx) {
    const m = await requireListener(ctx);
    const removed = m.player.queue.remove(Number(ctx.args[0]));
    if (!removed) throw new UserError('Posição inválida. Veja as posições com `!fila`.');
    m.refreshPlayer();
    await ctx.reply({ ...quiet, content: `🗑️ Removida: **${removed.title}**` });
  },
};

export const MUSIC_COMMANDS = [tocar, pausar, continuar, pular, voltar, parar, sair, fila, tocando, embaralhar, repetir, volume, remover];
