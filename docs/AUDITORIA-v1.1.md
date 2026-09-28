# Auditoria — Fluxer BOT v1.1

Relatório da atualização v1.1 ("FLUXER APP v1.1 — Atualização Oficial"). A auditoria da v1.0 continua em [`AUDITORIA.md`](AUDITORIA.md).

## Decisão de escopo

A especificação da v1.1 descrevia o **aplicativo** Fluxer, feito em React/Next.js com Tailwind e LiveKit: telas, player fixo, rotas REST. Este repositório é o **bot** que roda dentro do Fluxer. O código do app (fluxer.app) é de outra equipe e não temos acesso a ele. Por decisão do dono do projeto, a v1.1 foi feita **inteira dentro do bot**:

| Na especificação                            | No bot                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Telas (Hall, Missões, Rivalidades, Perfil…) | Comandos com embeds (`!hall`, `!missoes`, `!rivalidades`, `!perfil`…) e mensagens fixadas             |
| Endpoints REST (`GET /hall-of-fame`, …)     | Comandos equivalentes (tabela abaixo)                                                                 |
| Realtime / WebSocket                        | Gateway do Fluxer: mensagens, reações e voz em tempo real                                             |
| Salas LiveKit                               | Canais de voz do Fluxer, que por baixo são salas LiveKit, criados e apagados pela API                 |
| Estética medieval (paleta, cards)           | Embeds com a paleta (ouro `#D4AF37`, vinho `#8B1E3F`, verde `#2E8B57`, grafite `#0E1116`) e barras ▰▱ |

| Endpoint da especificação                                  | Comando                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `GET /hall-of-fame`                                        | `!hall` (e a mensagem fixada em `#🏰┃hall-do-reino`)      |
| `GET /missions`                                            | `!missoes`                                                |
| `POST /missions/claim`                                     | `!coletar`                                                |
| `GET /rivalries`                                           | `!rival`, `!rivalidades`                                  |
| `POST /voice-room/create`                                  | `!grupo`                                                  |
| `PATCH /voice-room/settings`                               | `!grupo nome/limite/privado/publico/senha/expulsar/lider` |
| `GET /night/status`                                        | `!night`                                                  |
| `GET /music/queue`, `POST /music/play`, `POST /music/skip` | não implementados (veja LiveKit)                          |

## Compatibilidade

- **Nada foi removido.** Todos os comandos, tabelas e mensagens da v1.0 continuam iguais. `!perfil` e `!rival` ganharam informação e não perderam nenhuma.
- **Banco:** 3 migrações novas, só **aditivas** (tabelas novas e uma coluna que aceita vazio), para SQLite e PostgreSQL. Testei a atualização aplicando as migrações novas num banco com dados da v1.0: os dados continuaram lá.
- **Night Fluxer:** o comando `!admin evento-semanal` e as variáveis `WEEKLY_EVENT_*` funcionam como antes. Um evento semanal aberto antes da atualização termina do jeito antigo, sem votação nem equipes.
- **Permissões:** o link de convite agora pede também **Conectar**, **Mover membros** e **Gerenciar mensagens**, usadas pelas salas temporárias. Sem elas, só o `!grupo expulsar` e a limpeza de mensagens com senha deixam de funcionar.

## Arquivos criados

| Arquivo                                        | O que faz                                                |
| ---------------------------------------------- | -------------------------------------------------------- |
| `src/commands/hall.ts`                         | `!hall`                                                  |
| `src/commands/missoes.ts`                      | `!missoes`, `!coletar`                                   |
| `src/commands/night.ts`                        | `!night`                                                 |
| `src/commands/grupo.ts`                        | `!grupo` e subcomandos                                   |
| `src/embeds/hallEmbed.ts`                      | Cards do Hall do Reino                                   |
| `src/events/voiceState.ts`                     | Eventos de voz do Gateway → presença em voz              |
| `src/services/hallOfFame.ts`                   | Cálculo das honrarias                                    |
| `src/services/missions.ts`                     | Missões: geração, progresso e coleta                     |
| `src/services/night.ts`                        | Night Fluxer: votação, sorteio de equipes e encerramento |
| `src/services/voicePresence.ts`                | Quem está em qual sala de voz; minutos e entradas        |
| `src/services/notifications/pinnedMessage.ts`  | Mensagem fixada sempre atualizada (placar e Hall)        |
| `src/services/notifications/hallAnnouncer.ts`  | Atualiza o `#hall-do-reino`                              |
| `src/services/notifications/missionTracker.ts` | Eventos → progresso de missões; aviso de conclusão       |
| `src/services/notifications/voiceRooms.ts`     | Salas temporárias: API do Fluxer e limpeza               |
| `src/services/rules/honors.ts`                 | Títulos de honra e classe (lógica pura)                  |
| `src/services/rules/missions.ts`               | Catálogo e sorteio das missões (lógica pura)             |
| `src/services/rules/night.ts`                  | Votação e sorteio de equipes (lógica pura)               |
| `src/services/rules/voiceRooms.ts`             | Nome, senha e prazo das salas (lógica pura)              |
| `src/utils/queue.ts`                           | Filas de escrita (reações, missões, salas)               |
| `tests/v11.test.ts`                            | Testes da v1.1                                           |
| `docs/AUDITORIA-v1.1.md`                       | Este relatório                                           |
| 6 arquivos de migração                         | Veja **Migrations**                                      |

## Arquivos modificados

- **Comandos:** `commands/admin.ts` (`!setup` cria o `#🏰┃hall-do-reino`), `config.ts` (`!config hall`), `index.ts` (registro), `ranking.ts` (perfil medieval, rival com histórico, `!rivalidades`).
- **Cliente Fluxer:** `fluxer/client.ts` (URL do avatar), `rest.ts` (editar e apagar canal, permissões por membro, apagar mensagem, desconectar da voz), `permissions.ts` (CONNECT, MOVE_MEMBERS, MANAGE_MESSAGES), `types.ts` (estado de voz).
- **Eventos:** `events/messageCreate.ts` e `reactions.ts` alimentam as missões; `reactions.ts` também recebe os votos e passou a tratar uma reação por vez.
- **Serviços:** `services/profile.ts` (contexto dos títulos, rivalidades da comunidade), `rules/rivalry.ts` (histórico, Top 10), `rules/tiers.ts` (progresso de liga), `notifications/announcer.ts` (placar via `pinnedMessage`, missões ao confirmar partida).
- **Agendadores:** `schedulers/maintenanceScheduler.ts` (voz e salas a cada minuto, Hall a cada 10 min, missões às 00:00, limpeza do Night Fluxer) e `weeklyEvent.ts` (Night Fluxer completo).
- **Apoio:** `embeds/format.ts` (paleta e barra de progresso), `embeds/tournamentEmbed.ts` (votação e equipes), `utils/calendar.ts` (dia no fuso), `utils/logger.ts` (logs por módulo), `config.ts`, `database/guildSettingsRepository.ts`, `index.ts`.
- **Banco e documentação:** `prisma/schema.prisma` e `prisma/postgres/schema.prisma`, `.env.example`, `README.md`, `docs/ARQUITETURA.md`.
- **Testes:** `tests/fluxer.e2e.test.ts`, `helpers.ts`, `mockFluxer.ts`.

## Migrations

| Migração                           | Conteúdo                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| `20260928000000_hall_channel`      | `GuildSettings.hallChannelId` (coluna que aceita vazio)       |
| `20260928010000_daily_missions`    | Tabelas `DailyMission` e `PlayerMission`                      |
| `20260928020000_night_voice_rooms` | Tabelas `WeeklyEvent`, `EventVote`, `EventTeam` e `VoiceRoom` |

As três existem para SQLite (`prisma/migrations`) e PostgreSQL (`prisma/postgres/migrations`). `prisma migrate diff` confirmou que migrações e schema batem nos dois bancos.

Models pedidos × entregues:

| Pedido                                                      | Entregue                                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DailyMission`, `PlayerMission`, `VoiceRoom`, `WeeklyEvent` | ✅ com esses nomes                                                                                       |
| `WeeklyVote` / `EventVote`                                  | ✅ `EventVote` (a especificação usa os dois nomes)                                                       |
| `EventTeam`                                                 | ✅                                                                                                       |
| `Rivalry`                                                   | ⚙️ Calculada na hora a partir das partidas. Uma tabela só duplicaria dados e poderia ficar desatualizada |
| `MusicQueue`, `MusicHistory`                                | ❌ Dependem do módulo de música                                                                          |

## Funcionalidades concluídas

### Módulo 2 — Hall do Reino ✅

- Honrarias:
  - 👑 Campeão da Temporada: o da última temporada encerrada; antes da primeira, o líder atual.
  - ⭐ MVP da Semana: mais vitórias em 7 dias.
  - 🛡️ Mais Ativo: mais partidas em 30 dias.
  - 🔥 Maior Sequência.
  - ⚔️ Mais Vitórias na carreira.
  - 🪙 Mais FluxCoins.
- Mensagem fixada em `#🏰┃hall-do-reino`, só leitura e atualizada **a cada 10 minutos**, mais o comando `!hall`.

### Módulo 3 — Missões diárias ✅

- **3 missões por dia às 00:00** (fuso `TIMEZONE`), anunciadas em `#comandos`. O sorteio usa a data como semente, então reiniciar o bot não troca as missões.
- Tipos:
  - ⚔️ vencer partidas
  - 🎮 jogar partidas
  - 🎙️ minutos em voz
  - 🚪 entrar em salas de voz
  - 💬 mensagens
  - 👍 reações
  - 🤝 receber amigos no seu grupo
- Recompensas de **20 a 100 FluxCoins**.
- **Progresso em tempo real:** partidas no momento da confirmação, voz pelos eventos do Gateway (minutos contados a cada minuto), mensagens e reações na hora. Quem conclui recebe um aviso em `#comandos`.
- `!missoes` mostra as barras de progresso e `!coletar` paga cada missão uma vez só.
- Proteção contra spam: mensagem conta uma a cada 15 s, com 3+ caracteres e sem comandos; cada reação conta uma vez por mensagem por dia; cada amigo no grupo conta uma vez por dia.

### Módulo 4 — Rivalidades ✅

- `!rival` mostra: adversário mais enfrentado, taxa de vitória dos dois lados, **histórico dos últimos 5 duelos**, último confronto e total de partidas.
- `!rivalidades` mostra o **Top 10 da comunidade**.

### Módulo 5 — Night Fluxer ✅

Toda sexta às 20h:

1. Abre a votação entre os jogos mais jogados (1️⃣–4️⃣).
2. Os votos são contados; empate fica com o primeiro da lista.
3. A inscrição é pelo ✅.
4. As equipes são sorteadas (Lobos, Dragões, Corvos…).
5. O bot cria **uma sala de voz por equipe**.
6. Os resultados vão com `!resultado`.
7. O **ranking** é atualizado.

As salas são apagadas no fim do evento. `!night` mostra a fase, os votos, os inscritos, as equipes, as salas e a chave. Com poucos inscritos, o evento roda em 1v1 com uma "Arena".

### Módulo 6 — Salas temporárias ✅

- `!grupo` cria o "**Grupo do <nome>**".
- Ajustes: nome, limite de participantes, privado ou público, senha opcional (guardada só como hash; a mensagem com a senha é apagada), convite, **expulsar** (tira da voz e bloqueia a volta) e **transferir liderança**.
- A sala é **apagada quando fica vazia**: 1 minuto depois do último sair, ou 5 minutos se ninguém chegou a entrar.

### Módulo 7 — Perfil medieval ✅

- Avatar, pelo Media Proxy do Fluxer.
- Nome, título equipado e **classe**: Recruta, Estrategista, Berserker ou Cavaleiro.
- **Liga com barra de progresso**, vitórias, derrotas, win rate com barra, FluxCoins e conquistas.
- Os 5 **títulos** (👑 ⚔️ 🧙 🐺 🔥): os conquistados aparecem destacados, os que faltam com 🔒 e barra de progresso.

### Logs ✅

- Além de `combined.log` e `error.log`, há arquivos por módulo:
  - `missions.log`: missões geradas e concluídas.
  - `voice.log`: entradas e saídas, salas criadas, expulsões, trocas de líder e salas apagadas.
  - `night.log`: abertura, votação, salas criadas, cancelamento e encerramento.
- `music.log` não existe porque não há módulo de música.

## Checklist completo

| Item                                                                                              | Situação                                                   |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Música: player, fila, play, pause, skip, shuffle, repeat, volume, progresso                       | ❌ Veja LiveKit                                            |
| Música: pesquisa, YouTube e Spotify por metadados                                                 | ❌ Veja LiveKit                                            |
| Player fixo na parte de baixo                                                                     | ⚙️ Não existe em bot (é interface do app)                  |
| Parar a música após 5 min com a sala vazia                                                        | ❌ Depende do player                                       |
| Hall do Reino, atualizado a cada 10 min, 6 honrarias                                              | ✅                                                         |
| Cards com visual medieval                                                                         | ✅ Embeds com a paleta pedida                              |
| `GET /hall-of-fame`                                                                               | ✅ `!hall`                                                 |
| `DailyMission` / `PlayerMission`                                                                  | ✅                                                         |
| 3 missões por dia às 00:00                                                                        | ✅                                                         |
| Recompensas de 20 a 100                                                                           | ✅                                                         |
| Telas de Missões, Progresso e Coletar                                                             | ✅ `!missoes` e `!coletar`                                 |
| Progresso em tempo real                                                                           | ✅                                                         |
| Missão "Escute 30 minutos de música"                                                              | ❌ Depende do módulo de música                             |
| Rivalidades: mais enfrentado, win rate, histórico, último confronto, total                        | ✅                                                         |
| Top 10 rivalidades                                                                                | ✅                                                         |
| Night Fluxer: enquete, votação, inscrição, sorteio, salas, resultados, ranking                    | ✅                                                         |
| `WeeklyEvent` / `EventTeam` / `EventVote`                                                         | ✅                                                         |
| Salas temporárias: criar, nome, limite, privado, senha, expulsar, liderança, apagar vazia         | ✅                                                         |
| `VoiceRoom`                                                                                       | ✅                                                         |
| Perfil: banner, avatar, nome, título, classe, liga, V/D, win rate, FluxCoins, conquistas, títulos | ✅ O "banner" é o cabeçalho decorado do embed              |
| Animações discretas                                                                               | ⚙️ Embeds não têm animação; ficaram as barras de progresso |
| Logs por módulo                                                                                   | ✅ (menos `music.log`)                                     |
| Nada removido; migrações compatíveis                                                              | ✅                                                         |

## Testes executados

- `npm run check`: typecheck, ESLint e Prettier limpos; **122 testes** passando no SQLite (eram 89 na v1.0). A suíte completa rodou 5 vezes seguidas sem falha.
- `npm run test:postgres`: os mesmos **122 testes** passando num **PostgreSQL 16** real.
- **Lógica pura:**
  - barra de progresso e progresso de liga;
  - títulos e classes;
  - histórico e Top 10 de rivalidades;
  - sorteio das missões (determinístico, 3 tipos distintos, recompensas de 20 a 100);
  - dia no fuso;
  - presença em voz (entradas, trocas de sala, minutos com sobra, bots ignorados, estado inicial);
  - votação (emojis com e sem U+FE0F, apuração, empate);
  - sorteio de equipes (todos uma vez, tamanhos equilibrados);
  - nome, senha e prazo das salas.
- **Banco:**
  - cada honraria do Hall, antes e depois de encerrar a temporada;
  - missões: geração única, limite no alvo, conclusão única, coleta única, eventos simultâneos, jogador desconhecido;
  - Night Fluxer: votos, troca de voto, sorteio de 5 jogadores em 2 equipes, chave em times, 1v1 com arena, cancelamento com salas.
- **Ponta a ponta** contra o servidor Fluxer falso:
  - `!setup` cria o `#🏰┃hall-do-reino` só leitura; o Hall é fixado e depois editado;
  - `!hall`, perfil com avatar, `!rival` e `!rivalidades`;
  - missões por mensagem, por entrada em voz (`VOICE_STATE_UPDATE`) e por vitória, com aviso, `!missoes` e `!coletar`;
  - Night Fluxer completo: anúncio com reações, 4 inscrições e 3 votos por reação, jogo vencedor, 2 salas de voz criadas, `!night`, salas apagadas no fim;
  - `!grupo`: criar, limite, privado com senha (mensagem apagada), senha errada e certa, expulsar (desconecta e bloqueia), transferir liderança, sala apagada depois de vazia.
- **Atualização de banco:** as 3 migrações novas aplicadas sobre um banco da v1.0 com dados, sem perda.
- **Bot compilado** (`npm run build` + `node dist/index.js`) contra o servidor Fluxer falso: conectou, gerou as missões do dia, ligou os agendadores, respondeu a `!ajuda`, `!hall`, `!missoes`, `!night`, `!grupo`, `!grupo info`, `!rivalidades` e `!perfil`, e criou `missions.log`, `voice.log` e `night.log`. Nenhum erro no log.

### Problemas encontrados e corrigidos durante os testes

- **Muitas reações ao mesmo tempo perdiam inscrições.** Com todos reagindo ao anúncio do Night Fluxer de uma vez, o SQLite estourava o tempo de espera e algumas inscrições sumiam. Agora reações, progresso de missões e entradas/saídas de sala passam por filas (uma tarefa por vez), separadas para uma não esperar a outra.
- **Erro solto na fila de missões:** uma falha virava "promise rejeitada sem tratamento". Corrigido.
- **Jogador conhecido só pelo ID** (reação sem dados do membro) causava erro de chave estrangeira. Agora é ignorado.
- **Sala temporária** usada entre duas varreduras parecia "nunca usada" e demorava mais para sumir. A ocupação agora vem direto dos eventos de voz.
- **Teste instável (já existia desde a v1.0):** os testes de ponta a ponta reagiam a um prompt de partida antes de o bot terminar de registrá-lo. Agora esperam o registro, como uma pessoa esperaria os botões ✅/❌ aparecerem. Depois disso, a suíte rodou 4 vezes seguidas em cada banco (SQLite e PostgreSQL) sem falha.

## Build

`npm run build` (TypeScript estrito) compila sem erros e `node dist/index.js` sobe normalmente. O Dockerfile não mudou; o ambiente de desenvolvimento continua sem acesso ao repositório de pacotes do Debian, então `docker compose build` não foi executado.

## Prisma

- Schema SQLite e o schema PostgreSQL gerado (`npm run db:postgres:sync`) estão sincronizados.
- As 3 migrações novas foram geradas com `prisma migrate diff` a partir do histórico, nos dois bancos, e conferidas sem divergência.
- `npm run dev` aplica as migrações sozinho (`predev`). Em produção, rode `prisma migrate deploy` (ou `npm run db:postgres:deploy`).

## LiveKit

> **Atualização:** a música foi implementada depois desta auditoria. O bot entra na sala pelo op 4, recebe a credencial LiveKit (`VOICE_SERVER_UPDATE`) e publica o áudio do YouTube via `yt-dlp` + `ffmpeg`; o Spotify entra como busca no YouTube. Foi testada num servidor LiveKit real. Detalhes no README (seção Música). O texto abaixo descreve a situação no fechamento da v1.1.

- **Salas:** no Fluxer, cada canal de voz é uma sala LiveKit. O bot cria, configura e apaga esses canais pela API documentada:
  - `POST /guilds/{id}/channels` com tipo 2 e `user_limit`;
  - `PATCH` e `DELETE /channels/{id}`;
  - `PUT /channels/{id}/permissions/{id}`;
  - desconexão com `PATCH` no membro e `channel_id: null`.
- **Eventos de participante:** entrou/saiu vêm de `VOICE_STATE_UPDATE` e o estado inicial de `GUILD_CREATE.voice_states` (e `PASSIVE_UPDATES` em servidores grandes).
  - Sala criada e sala encerrada ficam em `voice.log` e `night.log`.
- **Música:** ❌ não implementada. Um player exige que o bot **entre na sala LiveKit e publique uma faixa de áudio**. O bloqueio é a origem do áudio:
  - a especificação pede "sem baixar conteúdo, só metadados", mas metadados não trazem áudio;
  - o Spotify não libera áudio para terceiros;
  - tocar o YouTube exige extrair e retransmitir o áudio, o que esbarra nos termos de uso.
- **DataPackets:** seriam o jeito de sincronizar a fila e o progresso entre os players. Sem player, não se aplicam.

## Realtime

- Tudo que a v1.1 pede "em tempo real" chega pelo **Gateway do Fluxer**, sem polling: mensagens, reações (votos, inscrições, confirmações) e voz (entradas, saídas, minutos).
- As tarefas periódicas são poucas: minutos em voz e salas vazias a cada minuto, e o Hall a cada 10 minutos, como pedido.

## Pendências para a V1.2

1. **Música via LiveKit.** Um cliente de voz (ex.: `@livekit/rtc-node`) que entre na sala e publique áudio, com fila compartilhada, play/pause/skip, repeat, volume por usuário e progresso sincronizado por DataPackets. Depende de:
   - a API do Fluxer liberar a entrada de bots nas salas de voz (token LiveKit para bot);
   - uma **fonte de áudio com licença**: arquivos enviados pela comunidade, rádios ou músicas livres.

   Com isso vêm `MusicQueue`, `MusicHistory`, `music.log` e a missão "Escute 30 minutos de música".

2. **Painel web** (Next.js + Tailwind, paleta medieval) lendo o mesmo banco, com as telas e rotas REST da especificação (`/hall-of-fame`, `/missions`, `/rivalries`, `/night/status`…). Já estava no roadmap da v1.0.
3. **Mover o jogador para a sala** ao criar um grupo ou quando a equipe é sorteada: a API permite, com Mover membros, mas só para quem já está em outra sala de voz.
4. **Categoria própria** para os grupos e o Night Fluxer (`!config grupos #categoria`).
5. **Equipes do Night Fluxer equilibradas por rating** em vez de sorteio puro, como opção.
6. **Vários servidores e internacionalização**, que continuam do roadmap da v1.0.
