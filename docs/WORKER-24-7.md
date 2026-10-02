# Onboarding automático e worker 24/7

Implementação incremental sobre o bot existente. Tudo fala com o Fluxer pela API oficial: Gateway (`GUILD_MEMBER_ADD`) e HTTP API (cargos, mensagens, DM). Nada de Discord.

## Como funciona

### Entrada de membros

1. O Fluxer envia `GUILD_MEMBER_ADD` com o membro completo e o `guild_id`.
2. O bot ignora:
   - eventos de outra comunidade (só vale `FLUXER_GUILD_ID`);
   - bots.
3. Ele cria a associação `CommunityMember`, que é única por comunidade + usuário.
4. Um evento repetido (mesmo `joined_at`) não faz nada. Mesmo dois eventos simultâneos geram uma associação, uma atribuição de cargo e uma mensagem só:
   - os eventos passam por uma fila serial;
   - as escritas no banco são condicionais.
5. **Cargo inicial**, nesta ordem:
   1. o configurado (`defaultMemberRoleId`);
   2. o cargo do sistema `🌱 Escudeiro` (o de menor posição, se houver mais de um);
   3. se nenhum dos dois existir, o bot cria `🌱 Escudeiro` **sem nenhuma permissão**.

   Um cargo nunca é usado se:
   - for o @everyone;
   - tiver permissão administrativa ou de moderação: Administrador, Gerenciar Servidor/Cargos/Canais/Mensagens/Apelidos/Webhooks/Expressões, Expulsar, Banir, Silenciar, Ensurdecer, Mover, Moderar, Mencionar @everyone, Fixar ou Ver registro de auditoria;
   - estiver acima do cargo do bot.

   Se o cargo configurado foi excluído ou virou administrativo, o bot usa o do sistema.

6. **Boas-vindas** só na primeira entrada (quem sai e volta recebe o cargo de novo, mas não outra mensagem):
   - vão para o canal configurado e, se ativado, também por DM;
   - só o novo membro é mencionado: um `@everyone` no texto ou no nome não notifica ninguém.
7. Tudo vai para o histórico (`AuditLog`, visível com `!auditoria`). O Fluxer também recebe o motivo no cabeçalho `X-Audit-Log-Reason`.

Ações registradas no histórico:

- `member_join` / `member_rejoin`
- `role_assigned` / `role_missing` / `role_created`
- `welcome_sent` / `welcome_failed`
- `member_promoted`
- `config_changed` (com quem mudou)

### Mensagem de boas-vindas

Padrão:

```
🏰 Um novo aventureiro chegou ao Reino!

Seja bem-vindo, @usuário!
Você inicia sua jornada como 🌱 Escudeiro.
…
Que comece sua jornada por Crimelândia.
```

Placeholders:

| Placeholder       | O que vira                                   |
| ----------------- | -------------------------------------------- |
| `{username}`      | nome de usuário                              |
| `{displayName}`   | apelido, nome de exibição ou nome de usuário |
| `{mention}`       | menção ao membro                             |
| `{communityName}` | nome da comunidade                           |
| `{memberCount}`   | total de membros                             |
| `{role}`          | nome do cargo inicial                        |

Cuidados com o texto:

- A troca é feita numa passada só: um nome como `{role}` não é expandido de novo.
- Nada do texto é executado.
- Placeholders desconhecidos ficam como estão, e o `!boasvindas mensagem` avisa quando há algum.

### Progressão Escudeiro → Mercenário

- Fica **desativada por padrão**. Ative com `!progressao ativar`, que garante os cargos `🌱 Escudeiro` e `🍺 Mercenário` (criados sem permissões).
- Requisitos configuráveis: `minimumDays` (padrão 7) e `minimumActivityPoints` (padrão 50).
- Pontos de atividade (mesmos eventos das missões, com o mesmo intervalo mínimo contra spam):

  | Atividade                        | Pontos       |
  | -------------------------------- | ------------ |
  | Mensagem, reação, entrada em voz | 1            |
  | Minuto em voz                    | 1 por minuto |
  | Partida confirmada               | 5            |
  | Convite do `!grupo`              | 2            |

- A cada 15 minutos o worker faz a promoção:
  - antes de promover, confere no Fluxer a data de entrada e se o membro ainda tem o cargo inicial;
  - troca Escudeiro por Mercenário e anuncia: "⚔️ Uma nova jornada começa! @usuário deixou de ser 🌱 Escudeiro e agora faz parte dos 🍺 Mercenários do Reino.";
  - registra `member_promoted`.
- Uma promoção nunca acontece duas vezes. Se o Fluxer recusar a troca de cargo, o bot tenta de novo mais tarde.

### Administração (no chat do Fluxer)

| Comando                                                                         | Função                                                                |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `!boasvindas`                                                                   | Configuração atual                                                    |
| `!boasvindas ativar` · `desativar`                                              | Liga/desliga as boas-vindas (o cargo inicial continua)                |
| `!boasvindas canal #canal`                                                      | Chat das boas-vindas                                                  |
| `!boasvindas mensagem <texto>` · `mensagem padrao`                              | Edita / restaura a mensagem                                           |
| `!boasvindas preview`                                                           | Mostra a mensagem como se você tivesse acabado de entrar              |
| `!boasvindas dm ativar\|desativar`                                              | Também por mensagem direta                                            |
| `!boasvindas cargo @cargo` · `cargo padrao`                                     | Cargo inicial (recusa cargos administrativos)                         |
| `!progressao`                                                                   | Requisitos e o seu progresso (qualquer membro)                        |
| `!progressao ativar\|desativar` · `dias <n>` · `atividade <n>` · `cargo @cargo` | Promoção automática                                                   |
| `!progressao verificar`                                                         | Roda a promoção agora                                                 |
| `!auditoria [n]`                                                                | Últimas ações registradas                                             |
| `!setup`                                                                        | Agora também cria `#👋┃boas-vindas`, `🌱 Escudeiro` e `🍺 Mercenário` |

Só admins (**Gerenciar Servidor**) mudam a configuração. A interface administrativa é o próprio chat, seguindo a decisão da v1.1 de manter tudo dentro do bot. Não existe painel web.

## Worker

O processo do bot (`node dist/index.js`, ou o serviço `bot` do compose) **é** o worker. Ele não depende de nenhuma página aberta e cuida de:

- boas-vindas e cargo inicial;
- progressão de cargos;
- promoções de jogos e jogos grátis;
- missões diárias;
- Night Fluxer e eventos;
- manutenção (desafios expirados, itens temporários, temporadas);
- salas temporárias;
- Hall do Reino;
- música.

### Robustez

| Recurso                            | O que faz                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reconexão automática               | O Gateway faz Resume (ou novo Identify) com espera exponencial até 30 s.                                                                                                     |
| Retry com backoff na inicialização | Banco e descoberta do Fluxer: 8 tentativas, de 1 s até 30 s.                                                                                                                 |
| Retry com backoff na API           | Falhas de rede, 502 e 504 são repetidas com espera crescente; 429 e 503 respeitam o `retry_after`.                                                                           |
| Watchdog                           | Gateway ou banco fora por mais de `WORKER_WATCHDOG_MINUTES` (10): o processo sai com código 1 e o Docker o reinicia do zero.                                                 |
| Erro fatal                         | Token inválido, ou falha ao iniciar os módulos: sai com código 1 para reiniciar.                                                                                             |
| Tratamento global de erros         | `unhandledRejection` vai para o log; `uncaughtException` vai para o log e o processo reinicia limpo.                                                                         |
| Desligamento gracioso              | No `SIGTERM`/`SIGINT`, nesta ordem: para de aceitar eventos, para os agendadores, espera as filas (até 10 s), sai da voz, fecha o Gateway e o `/health`, desconecta o banco. |
| Logs estruturados                  | JSON em `logs/*.log` (`onboarding.log` e `worker.log` são novos); `LOG_FORMAT=json` deixa o console em JSON também.                                                          |

### Health check

`GET /health` (porta `HEALTH_PORT`, padrão 3000):

```json
{ "status": "healthy", "database": "connected", "worker": "running", "gateway": "connected", "uptimeSeconds": 3600, "reconnects": 0 }
```

- Responde **200** só com o banco respondendo, o worker rodando e o Gateway conectado. Uma reconexão de até `HEALTH_GATEWAY_GRACE_SECONDS` (120 s) não conta.
- Fora isso responde **503** com `"status": "unhealthy"`.
- Não expõe tokens nem dados de membros.

## Docker 24/7

- **`Dockerfile`:**
  - `HEALTHCHECK` chamando o `/health`;
  - `EXPOSE 3000`;
  - o `CMD` usa `exec node`, então o Node recebe o `SIGTERM` do `docker stop`. Antes, o `sh` recebia o sinal e o desligamento não era gracioso.
- **`docker-compose.yml`:**
  - `restart: unless-stopped` nos dois serviços;
  - healthcheck no PostgreSQL;
  - `/health` publicado só em `127.0.0.1`;
  - `stop_grace_period: 30s`;
  - rotação dos logs do Docker (10 MB × 5);
  - segredos só no `.env`.
- **O que ficou de fora do compose, de propósito:**
  - **fluxer-app:** o aplicativo Fluxer é a própria plataforma (fluxer.app ou a sua instância em `FLUXER_INSTANCE`); o bot só se conecta a ela.
  - **livekit:** a voz usa o LiveKit do próprio Fluxer, que entrega endereço e token em cada `VOICE_SERVER_UPDATE`. Um LiveKit no compose não seria usado.
  - **Nome do serviço:** continua `bot` (é o worker). Renomear para `fluxer-worker` deixaria o container antigo rodando junto em quem já usa o compose, e o bot responderia em dobro.

### Subir 24/7 numa VPS

```bash
# 1. Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh

# 2. Código e configuração
git clone https://github.com/Gustavo-dev-port/BOT-Fluxer-Crimelandia.git
cd BOT-Fluxer-Crimelandia
cp .env.example .env
nano .env        # FLUXER_TOKEN, FLUXER_GUILD_ID e uma senha forte em POSTGRES_PASSWORD

# 3. Subir (aplica as migrações do PostgreSQL sozinho)
docker compose up -d --build

# 4. Conferir
docker compose ps                       # bot "healthy", postgres "healthy"
curl http://127.0.0.1:3000/health
```

Depois rode `!setup` no Fluxer e ajuste com `!boasvindas` e `!progressao`. Com `restart: unless-stopped`, os containers voltam sozinhos depois de uma falha ou de um reboot da VPS. O serviço do Docker já inicia no boot.

### Atualizar sem perder dados

Os dados ficam no volume `postgres-data`. `git pull` e `--build` não mexem nele, e as migrações só **adicionam** (as desta versão criam colunas e tabelas novas).

```bash
cd BOT-Fluxer-Crimelandia
# backup antes (recomendado)
docker compose exec -T postgres pg_dump -U fluxer fluxer > backup-$(date +%F).sql
git pull
docker compose up -d --build     # recria só o que mudou e roda "prisma migrate deploy"
docker compose ps
```

Restaurar um backup, se precisar:

```bash
docker compose exec -T postgres psql -U fluxer fluxer < backup-AAAA-MM-DD.sql
```

**Nunca** use `docker compose down -v`: o `-v` apaga os volumes, ou seja, o banco.

### Ver os logs

```bash
docker compose logs -f bot              # ao vivo
docker compose logs --since 1h bot      # última hora
docker compose exec bot ls /app/logs    # arquivos: combined, error, onboarding, worker, missions, voice, night, music
docker compose exec bot tail -f /app/logs/onboarding.log
```

### Reiniciar só o worker

```bash
docker compose restart bot      # o PostgreSQL continua rodando
docker compose stop bot         # parar (desligamento gracioso, até 30 s)
docker compose start bot
```

### Sem Docker

```bash
npm ci && npm run build
npm run db:postgres:generate && npm run db:postgres:deploy   # com DATABASE_URL do PostgreSQL
pm2 start dist/index.js --name fluxer-worker
pm2 save && pm2 startup
```

O PM2 reinicia o worker quando ele sai (watchdog, erro fatal) e no boot.

## Arquivos

### Criados

| Arquivo                                                        | Conteúdo                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/services/rules/onboarding.ts`                             | Regras puras: mensagem padrão, placeholders, cargos proibidos, escolha do cargo, pontos e elegibilidade |
| `src/services/onboarding.ts`                                   | Banco: entrada idempotente, boas-vindas/promoção "reservadas", atividade, auditoria                     |
| `src/services/notifications/onboarding.ts`                     | Fluxer: `onMemberAdd`, cargo automático seguro, boas-vindas (canal/DM), `runPromotions`                 |
| `src/commands/onboarding.ts`                                   | `!boasvindas`, `!progressao`, `!auditoria`                                                              |
| `src/worker/worker.ts`                                         | `startWorker()`                                                                                         |
| `src/worker/health.ts`                                         | `GET /health`                                                                                           |
| `src/worker/status.ts`                                         | Estado do worker                                                                                        |
| `src/utils/retry.ts`                                           | Retry com espera exponencial                                                                            |
| `src/schedulers/types.ts`                                      | `Stoppable` (tarefas paradas no desligamento)                                                           |
| `prisma/migrations/20261001000000_onboarding_worker/`          | Migração do SQLite                                                                                      |
| `prisma/postgres/migrations/20261001000000_onboarding_worker/` | Migração do PostgreSQL                                                                                  |
| `tests/onboarding.test.ts`                                     | 21 testes do onboarding                                                                                 |
| `tests/worker.test.ts`                                         | 10 testes do worker                                                                                     |
| `docs/WORKER-24-7.md`                                          | Este documento                                                                                          |

### Modificados

| Arquivo                                                                                      | Mudança                                                             |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/index.ts`                                                                               | Só sobe o worker e cuida de sinais e erros globais                  |
| `src/fluxer/client.ts`                                                                       | Nome da comunidade, total de membros, `invalidateRoles()`           |
| `src/fluxer/rest.ts`                                                                         | `createDM`, retry com backoff em falha de rede, 502 e 504           |
| `src/fluxer/types.ts`                                                                        | `GuildMemberAddEvent`, `member_count`                               |
| `src/config.ts`                                                                              | Bloco `worker` e canal `boas-vindas`                                |
| `src/schedulers/*`                                                                           | Devolvem as tarefas para o desligamento; job da progressão (15 min) |
| `src/services/notifications/missionTracker.ts`                                               | Soma os pontos de atividade                                         |
| `src/utils/queue.ts`                                                                         | `memberQueue` e `drainQueues()`                                     |
| `src/utils/logger.ts`                                                                        | `onboarding.log`, `worker.log`, `LOG_FORMAT=json`                   |
| `src/commands/admin.ts`                                                                      | `!setup` cria `#👋┃boas-vindas`, Escudeiro e Mercenário             |
| `src/commands/config.ts`, `src/commands/index.ts`, `src/database/guildSettingsRepository.ts` | Canal `boas-vindas` e registro dos comandos                         |
| `prisma/schema.prisma`, `prisma/postgres/schema.prisma`                                      | Models (abaixo)                                                     |
| `Dockerfile`, `docker-compose.yml`, `.env.example`                                           | Docker 24/7 e variáveis novas                                       |
| `tests/mockFluxer.ts`, `tests/helpers.ts`                                                    | Fluxer falso com DM, cargos por membro, `member_count`              |
| `README.md`, `docs/ARQUITETURA.md`                                                           | Documentação                                                        |

## Models e migrations

Migração `20261001000000_onboarding_worker` (SQLite e PostgreSQL). Ela só adiciona: todas as colunas novas têm valor padrão, então nenhum dado existente muda.

**`GuildSettings`** ganhou:

| Campo                       | Padrão          |
| --------------------------- | --------------- |
| `welcomeEnabled`            | `true`          |
| `welcomeChannelId`          | —               |
| `welcomeMessage`            | `null` = padrão |
| `welcomeDMEnabled`          | `false`         |
| `defaultMemberRoleId`       | —               |
| `automaticPromotionEnabled` | `false`         |
| `minimumDays`               | 7               |
| `minimumActivityPoints`     | 50              |
| `promotionRoleId`           | —               |

**`CommunityMember`** (novo):

- `@@unique([guildId, userId])`;
- `joinedAt`, `welcomedAt`, `welcomeMessageId`;
- `initialRoleId`, `initialRoleAt`;
- `activityPoints`, `promotedAt`, `promotionCheckedAt`.

**`AuditLog`** (novo): `guildId`, `action`, `userId`, `actorId`, `roleId`, `details` (JSON), `createdAt`.

## Variáveis de ambiente novas

| Variável                       | Padrão    | Para quê                                                       |
| ------------------------------ | --------- | -------------------------------------------------------------- |
| `HEALTH_PORT`                  | 3000      | Porta do `/health` (0 = desligado)                             |
| `HEALTH_HOST`                  | `0.0.0.0` | Endereço do `/health`                                          |
| `HEALTH_HOST_PORT`             | 3000      | Porta da VPS onde o compose publica o `/health` (só 127.0.0.1) |
| `HEALTH_GATEWAY_GRACE_SECONDS` | 120       | Tolerância sem Gateway antes de "unhealthy"                    |
| `WORKER_WATCHDOG_MINUTES`      | 10        | Sem Gateway/banco por mais que isso: reinicia (0 = nunca)      |
| `LOG_FORMAT`                   | `text`    | `json` para o console em JSON                                  |

As configurações de boas-vindas e progressão ficam no banco, por comunidade, e são alteradas pelos comandos. Não usam variáveis de ambiente.

## Testes

- `tests/onboarding.test.ts`:
  - entrada de membro e atribuição do Escudeiro;
  - mensagem de boas-vindas, placeholders, preview e DM;
  - cargo padrão inexistente;
  - cargo administrativo configurado ou recusado no comando;
  - evento duplicado (inclusive simultâneo) e saída/volta;
  - falha ao dar o cargo e canal ausente;
  - outra comunidade e bots;
  - isolamento entre comunidades;
  - pontos de atividade;
  - promoção para Mercenário (e não promover duas vezes).
- `tests/worker.test.ts`:
  - retry e backoff;
  - `/health` (healthy, tolerância, banco fora);
  - novo membro pelo Gateway;
  - queda e reconexão com Resume;
  - desligamento gracioso;
  - token recusado (onFatal);
  - porta do `/health` ocupada;
  - inicialização que desiste.
