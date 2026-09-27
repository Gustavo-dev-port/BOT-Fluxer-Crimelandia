/** Eventos de voz do Gateway → rastreador de presença em voz (missões e salas temporárias). */
import type { FluxerClient } from '../fluxer/client.js';
import type { GuildReady, PassiveUpdates, VoiceState } from '../fluxer/types.js';
import { voicePresence } from '../services/voicePresence.js';

/** Encaminha GUILD_CREATE, VOICE_STATE_UPDATE e PASSIVE_UPDATES do servidor configurado. */
export function onVoiceEvent(client: FluxerClient, event: string, data: unknown) {
  if (event === 'GUILD_CREATE') {
    const guild = data as GuildReady;
    if (guild.id === client.guildId && guild.voice_states) voicePresence.reset(guild.voice_states);
  } else if (event === 'VOICE_STATE_UPDATE') {
    const state = data as VoiceState;
    if (state.guild_id === client.guildId) voicePresence.update(state);
  } else if (event === 'PASSIVE_UPDATES') {
    const passive = data as PassiveUpdates;
    if (passive.guild_id === client.guildId) for (const s of passive.voice_states ?? []) voicePresence.update(s);
  }
}
