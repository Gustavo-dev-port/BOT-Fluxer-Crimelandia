/** Embeds do player de música: "tocando agora" (player fixo) e a fila. */
import type { Embed } from '../fluxer/types.js';
import type { MusicPlayer } from '../services/music/player.js';
import type { RepeatMode, Track } from '../services/music/types.js';
import { clip, Colors, mention, progressBar } from './format.js';

/** 245 → "4:05"; 3725 → "1:02:05". */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const REPEAT_LABEL: Record<RepeatMode, string> = { off: 'desligado', track: '🔂 música', queue: '🔁 fila' };

const STATE_LABEL = { playing: '▶️ Tocando', paused: '⏸️ Pausado', idle: '⏹️ Parado' } as const;

export function trackLine(t: Track): string {
  const name = t.url ? `[${clip(t.title, 80)}](${t.url})` : clip(t.title, 80);
  return `${name} — ${clip(t.artist, 40)}${t.durationSeconds ? ` \`${clock(t.durationSeconds)}\`` : ''}`;
}

export function nowPlayingEmbed(player: MusicPlayer, channelId: string | null): Embed {
  const t = player.queue.current;
  if (!t || player.state === 'idle') {
    return {
      color: Colors.graphite,
      title: '🎵 Player do Reino',
      description: `Nada tocando agora.\nEntre numa sala de voz e use \`!tocar <música ou link>\`.`,
    };
  }
  const position = player.positionMs / 1000;
  const progress = t.durationSeconds
    ? `${progressBar(position, t.durationSeconds, 16)} \`${clock(position)} / ${clock(t.durationSeconds)}\``
    : `🔴 ao vivo · \`${clock(position)}\``;
  const next = player.queue.next.slice(0, 3);
  const embed: Embed = {
    color: Colors.royalGold,
    title: `${STATE_LABEL[player.state]}: ${clip(t.title, 200)}`,
    ...(t.url ? { url: t.url } : {}),
    description: [
      `🎤 **${clip(t.artist, 100)}**`,
      progress,
      `Pedida por ${mention(t.requestedById)}${channelId ? ` · 🔊 <#${channelId}>` : ''}`,
    ].join('\n'),
    fields: [
      { name: 'Volume', value: `${player.volume}%`, inline: true },
      { name: 'Repetir', value: REPEAT_LABEL[player.queue.repeat], inline: true },
      { name: 'Na fila', value: String(player.queue.size), inline: true },
    ],
    footer: { text: '!pausar · !continuar · !pular · !voltar · !fila · !parar' },
  };
  if (t.thumbnail) embed.thumbnail = { url: t.thumbnail };
  if (next.length) embed.fields!.push({ name: 'A seguir', value: next.map((n, i) => `${i + 1}. ${trackLine(n)}`).join('\n') });
  return embed;
}

export function queueEmbed(player: MusicPlayer, page = 1): Embed {
  const perPage = 10;
  const items = player.queue.next;
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const p = Math.min(Math.max(1, page), pages);
  const slice = items.slice((p - 1) * perPage, p * perPage);
  const total = items.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
  const current = player.queue.current;
  return {
    color: Colors.royalGold,
    title: '📜 Fila de músicas',
    description: [
      current ? `**Agora:** ${trackLine(current)}` : '_Nada tocando._',
      '',
      slice.length
        ? slice.map((t, i) => `\`${(p - 1) * perPage + i + 1}.\` ${trackLine(t)} · ${mention(t.requestedById)}`).join('\n')
        : '_Fila vazia._',
    ].join('\n'),
    footer: { text: `Página ${p}/${pages} · ${items.length} música(s) · ${clock(total)} · repetir: ${REPEAT_LABEL[player.queue.repeat]}` },
  };
}
