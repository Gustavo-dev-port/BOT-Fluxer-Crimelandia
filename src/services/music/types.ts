/** Tipos do módulo de música. */

export interface Track {
  title: string;
  /** Canal do YouTube ou artista. */
  artist: string;
  /** Duração em segundos (null = desconhecida / ao vivo). */
  durationSeconds: number | null;
  /** Página do vídeo no YouTube. Vazio enquanto o item veio do Spotify e ainda não foi buscado. */
  url: string;
  thumbnail: string | null;
  /** De onde o pedido veio. */
  source: 'youtube' | 'spotify' | 'search';
  /** Para itens do Spotify: o que buscar no YouTube quando chegar a vez. */
  query?: string;
  requestedById: string;
}

export type RepeatMode = 'off' | 'track' | 'queue';
