# ⚔️ Fluxer BOT — Crimelândia

Bot para o [Fluxer](https://fluxer.app) que registra disputas entre amigos, cria temporadas, mantém rankings e organiza eventos de jogos automaticamente.

Feito direto sobre a API oficial do Fluxer ([docs.fluxer.app](https://docs.fluxer.app)): descoberta da instância, HTTP API e Gateway, sem SDKs de terceiros.

- **Rankings** — pontos por temporada e ELO (com ligas: Bronze III → Mestre)
- **Duelos 1v1** — desafio com aceite e resultado validado pelos dois lados
- **Times** — 2v2, 3v3 ou squads de até 10
- **Campeonatos** — chave simples (mata-mata) ou todos contra todos
- **Temporadas** — reset automático, cargo exclusivo do campeão e histórico arquivado
- **Eventos semanais** — toda sexta às 20h: _Night Fluxer_, inscrição reagindo com ✅
- **Promoções** — Steam, Epic, GOG, Humble, Nuuvem e Green Man Gaming a cada 30 min, sem repetir
- **Jogos grátis** — Epic, giveaways da Steam/GOG e free weekends a cada hora, com `!gratis`
- **FluxCoins** — moeda da comunidade, loja com títulos, cor de nick e eventos personalizados
- **Conquistas** — medalhas desbloqueadas automaticamente
- **Rivalidades** — `!rival` descobre quem vocês mais enfrentam, com histórico; `!rivalidades` mostra o Top 10 da comunidade
- **Hall do Reino** — campeão, MVP da semana, mais ativo, maior sequência, mais vitórias e mais FluxCoins, fixado em `#🏰┃hall-do-reino` e atualizado a cada 10 min
- **Missões diárias** — 3 missões novas à meia-noite (vencer partidas, tempo em voz, entrar em salas, mensagens, reações), com recompensa de 20 a 100 FluxCoins; `!missoes` e `!coletar`
- **Perfil medieval** — classe, liga com barra de progresso, avatar e títulos de honra (👑 ⚔️ 🧙 🐺 🔥)

> **Comandos de texto e reações.** O Fluxer não tem slash commands nem botões. Os comandos usam um prefixo (`!` por padrão) e as confirmações usam reações: ✅ aceita/confirma, ❌ recusa, ⚠️ contesta.

## Stack

| Tecnologia              | Uso                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Node.js 22 + TypeScript | Linguagem (usa o `WebSocket` e o `fetch` nativos)                                                                  |
| API do Fluxer           | HTTP API + Gateway, cliente próprio em `src/fluxer/`                                                               |
| SQLite / PostgreSQL     | SQLite no desenvolvimento, PostgreSQL em produção (Docker)                                                         |
| Prisma 6                | ORM e migrações                                                                                                    |
| node-cron               | Temporadas, expirações e evento semanal                                                                            |
| Vitest                  | Testes (incluindo um servidor Fluxer falso para testes ponta a ponta)                                              |
| Winston                 | Logs no console, em `logs/error.log` / `logs/combined.log` e por módulo (`missions.log`, `voice.log`, `night.log`) |
| ESLint + Prettier       | Qualidade e formatação do código                                                                                   |
| Docker                  | Hospedagem (bot + PostgreSQL)                                                                                      |

## Instalação

### 1. Criar o bot no Fluxer

1. No Fluxer, crie uma aplicação (Configurações → aplicações/desenvolvedor). A criação gera o **token do bot** no formato `<application_id>.<secret>` — ele só aparece uma vez (`FLUXER_TOKEN`).
2. Copie o ID do seu servidor (`FLUXER_GUILD_ID`).
3. Suba o bot uma vez (passo 2): ele imprime no log o **link de convite** (`/v1/oauth2/authorize?client_id=…&scope=bot&permissions=…`) já com as permissões necessárias:
   _Ver canais, Enviar mensagens, Inserir links, Adicionar reações, Ler histórico, Mencionar @everyone (evento semanal e cargo de promoções), Fixar mensagens (placar), Gerenciar cargos (loja e campeão), Gerenciar apelidos (apelido especial), Gerenciar canais (só para o `!setup`)_.
4. Para os cargos funcionarem, o cargo do bot precisa ficar **acima** dos cargos que ele entrega (hierarquia do Fluxer).

Se você usa uma instância própria do Fluxer, aponte `FLUXER_INSTANCE` para ela — o bot lê os endpoints de `/.well-known/fluxer`.

### 2. Rodar localmente

```bash
cp .env.example .env         # preencha FLUXER_TOKEN e FLUXER_GUILD_ID
npm install                  # também gera o Prisma Client
npm run dev                  # aplica as migrações (SQLite em prisma/fluxer.db) e sobe o bot
```

No Windows (PowerShell), troque `cp` por `Copy-Item .env.example .env`.

No servidor, rode **`!setup`** (admin): ele cria os canais `#comandos`, `#placar`, `#partidas`, `#eventos`, `#promocoes`, `#jogos-gratis` e `#hall-do-reino` e o cargo **🏆 Campeão do Reino**. Depois ajuste o que quiser com **`!config`** e veja todos os comandos com **`!ajuda`**.

> ⚠️ Valores reais (token, senhas) vão **só no `.env`**, que o git ignora. Nunca no `.env.example`.

### 3. Docker

```bash
cp .env.example .env   # preencha
docker compose up -d --build
```

O compose sobe dois serviços:

- **bot**: a imagem de produção, que usa **PostgreSQL** e aplica as migrações de `prisma/postgres/` ao iniciar.
- **postgres**: PostgreSQL 16, com os dados no volume `postgres-data`. Usuário, senha e banco vêm de `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` no `.env`.

Os logs ficam no volume `bot-logs` (`/app/logs`). Veja com `docker compose logs -f bot`.

O módulo de música com Lavalink ficou de fora: o Lavalink só funciona com a voz do Discord, e o Fluxer usa LiveKit.

### Banco de dados: SQLite e PostgreSQL

O Prisma fixa o tipo de banco dentro do schema, então há dois:

- `prisma/schema.prisma` — a **fonte da verdade** (SQLite, desenvolvimento).
- `prisma/postgres/schema.prisma` — **gerado** a partir do primeiro, só troca o provider (produção).

Ao mudar o banco:

```bash
npm run db:migrate -- --name minha_mudanca   # 1. migração SQLite
npm run db:postgres:sync                      # 2. regenera o schema do PostgreSQL
# 3. migração PostgreSQL (precisa de um PostgreSQL local vazio em DATABASE_URL):
npx prisma migrate dev --schema prisma/postgres/schema.prisma --name minha_mudanca --create-only
```

Um teste falha se os dois schemas ficarem diferentes.

## Promoções

A cada 30 minutos o bot busca promoções e publica as novas no canal de promoções (`!setup` cria o `#💸┃promocoes`, ou use `!config promo #canal`).

| Loja                      | Como                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Steam                     | API da loja (`featuredcategories`, ofertas em destaque, preços em R$)                                  |
| Epic Games                | GraphQL da loja (`searchStore` com `onSale`)                                                           |
| GOG                       | Catálogo público (`catalog.gog.com`, ordenado por desconto)                                            |
| Humble Bundle             | Busca da Humble Store (preços em US$)                                                                  |
| Nuuvem e Green Man Gaming | API oficial da [IsThereAnyDeal](https://docs.isthereanydeal.com) (precisa de `ITAD_API_KEY`, gratuita) |

Regras:

- Descontos abaixo de **40%** são ignorados (`PROMO_MIN_DISCOUNT`).
- A mesma promoção **não é repostada**: fica salva no banco (tabela `Promotion`).
- Se o **preço mudar**, o banco é atualizado e a mensagem original é editada ("🔄 PREÇO ATUALIZADO").
- Com desconto **≥ 80%**, o cargo definido em `!config promo-role @Caçadores de Promoção` é mencionado.
- No máximo 10 postagens por rodada (`PROMO_MAX_POSTS_PER_RUN`); o resto sai nas próximas.
- Uma loja fora do ar ou que mude o formato é registrada no log e as outras continuam.
- O Fluxer não tem botões: o "Ver oferta" é um link no próprio embed.

Comandos: `!promocoes` lista as melhores promoções ativas; `!promocoes atualizar` (admin) busca agora e mostra um resumo.

As lojas não têm contrato de API estável. Se uma delas começar a falhar, o log (`logs/combined.log`) mostra qual. Dá para desligá-la tirando o nome de `PROMO_SOURCES`, ou trocá-la pela IsThereAnyDeal (adicione o nome da loja em `ITAD_SHOPS`, ex.: `Steam`).

## Jogos grátis

A cada hora o bot procura jogos grátis e publica os novos no canal de jogos grátis (`!setup` cria o `#🎁┃jogos-gratis`, ou use `!config jogos-gratis #canal`).

| Fonte              | O que traz                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Epic Games         | Os jogos grátis da semana (endpoint público `freeGamesPromotions`), com descrição           |
| Steam e GOG        | Giveaways pela API oficial da IsThereAnyDeal (`/giveaways/v1`, usa a mesma `ITAD_API_KEY`)  |
| Steam Free Weekend | Giveaways da ITAD com "free weekend" no título ou na nota aparecem como **🎮 FREE WEEKEND** |

Cada postagem tem imagem, nome, descrição, plataforma, data limite e o link **Resgatar**. O mesmo jogo não é postado duas vezes. Jogos vencidos ou que ainda não começaram são ignorados, e os que passam do prazo saem da lista.

`!gratis` lista todos os jogos grátis ativos. `!gratis atualizar` (admin) busca na hora.

## Canais

| Canal               | Função                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| `#comandos`         | Todos os comandos do bot (restrinja com `RESTRICT_COMMANDS_CHANNEL=true`) |
| `#placar`           | Ranking atualizado automaticamente — o bot edita a mesma mensagem fixada  |
| `#partidas`         | Histórico das disputas confirmadas e das disputas contestadas             |
| `#eventos`          | Campeonatos, evento semanal e fim de temporada                            |
| `#💸┃promocoes`     | Promoções de jogos com 40%+ de desconto (a cada 30 min)                   |
| `#🏰┃hall-do-reino` | Hall do Reino — mensagem fixada, atualizada a cada 10 min (só leitura)    |

Os canais ficam salvos por servidor (tabela `GuildSettings`). Troque qualquer um com `!config`, ex.: `!config eventos #📜┃eventos`.

## Comandos

`[ ]` = opcional. Nomes com espaço (times, campeonatos) vão entre aspas: `"Os Brabos"`. `#partida` só é necessário se você tiver mais de uma partida aberta. `!ajuda <comando>` mostra detalhes e exemplos.

### Duelos

| Comando                                     | Função                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `!duelo @amigo <jogo>`                      | Cria um desafio — o bot adiciona ✅ e ❌ na mensagem                                       |
| `!aceitar [#partida]` ou reagir ✅          | Aceita o duelo                                                                             |
| `!recusar [#partida]` ou reagir ❌          | Recusa o duelo                                                                             |
| `!cancelar [#partida]`                      | Cancela um desafio que você criou                                                          |
| `!resultado @vencedor [duração] [#partida]` | Registra quem venceu (ex.: `!resultado @Lucas 25min`) — **o outro lado precisa confirmar** |
| `!confirmar [#partida]` ou reagir ✅        | Confirma o resultado informado pelo adversário                                             |
| `!contestar [#partida]` ou reagir ⚠️        | Contesta; a partida vai para um admin                                                      |
| `!partidas`                                 | Suas partidas em aberto                                                                    |

### Ranking e perfil

| Comando                           | Função                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!rank [temporada] [pontos\|elo]` | Ranking da temporada atual ou de uma anterior (`!rank 2`, `!rank elo`)                                                                                                        |
| `!top10`                          | Os 10 melhores jogadores                                                                                                                                                      |
| `!perfil [@jogador]`              | Perfil medieval: avatar, classe, liga com barra de progresso, colocação, vitórias (+ na semana), derrotas, win rate, sequência, títulos de honra, jogos favoritos, conquistas |
| `!rival [@jogador] [@outro]`      | Maior rivalidade ou confronto direto, com taxa de vitória e histórico dos últimos 5 duelos                                                                                    |
| `!rivalidades`                    | Top 10 rivalidades da comunidade (pares com 2+ duelos 1v1)                                                                                                                    |
| `!hall`                           | Hall do Reino                                                                                                                                                                 |

### Times e eventos

| Comando                                                    | Função                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `!time criar <nome> @membros…`                             | Cria um time (você é o capitão)                                                        |
| `!time desafiar "Meu Time" "Adversário" <jogo>`            | Desafio entre times do mesmo tamanho (capitão adversário reage ✅)                     |
| `!time info` · `listar` · `sair` · `desfazer`              | Gestão de times                                                                        |
| `!evento criar "Nome" <jogo> [mata-mata\|todos] [tamanho]` | Cria evento 1v1, 2v2… (admin, ou com crédito da loja). `!campeonato` é o mesmo comando |
| `!evento iniciar <id>`                                     | Fecha inscrições, define seeds pelo rating e gera a chave                              |
| `!evento chave <id>`                                       | Mostra chave / classificação                                                           |
| `!evento listar` · `sair <id>` · `cancelar <id>`           | Gestão de eventos                                                                      |
| `!inscrever <id> ["Time"]` ou reagir ✅ no anúncio         | Entra no evento                                                                        |

### Economia

| Comando                                           | Função                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `!loja`                                           | Itens disponíveis                                                                                                      |
| `!resgatar <item> [#cor \| apelido]`              | Resgata um item (`!resgatar cor-nick #ff8800`, `!resgatar apelido-especial Rei do Clutch`); `!comprar` também funciona |
| `!titulo equipar <título>` · `remover` · `listar` | Título exibido no perfil                                                                                               |
| `!saldo`                                          | Saldo e últimas movimentações                                                                                          |
| `!missoes`                                        | Suas 3 missões do dia, com barra de progresso                                                                          |
| `!coletar`                                        | Coleta as FluxCoins das missões concluídas                                                                             |

### Administração

Admin = quem tem **Gerenciar Servidor** (ou Administrador, ou é o dono).

| Comando                                                                                   | Função                                        |
| ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| `!setup`                                                                                  | Cria/configura os canais e o cargo de campeão |
| `!config`                                                                                 | Mostra a configuração do servidor             |
| `!config <promo\|jogos-gratis\|eventos\|musica\|placar\|partidas\|comandos\|hall> #canal` | Define um canal                               |
| `!config <promo-role\|campeao-role> @cargo`                                               | Define um cargo                               |
| `!config idioma pt-BR` · `!config <opção> limpar`                                         | Idioma / remove um valor                      |
| `!temporada [encerrar]`                                                                   | Informações / encerra a temporada agora       |
| `!jogo listar` · `adicionar <nome>` · `remover <nome>`                                    | Jogos disponíveis para disputas               |
| `!admin resultado #partida @vencedor`                                                     | Resolve disputas                              |
| `!admin cancelar #partida`                                                                | Cancela uma partida não confirmada            |
| `!admin moedas @jogador <quantidade> [motivo]`                                            | Ajusta FluxCoins                              |
| `!admin placar`                                                                           | Recria a mensagem do placar                   |
| `!admin evento-semanal`                                                                   | Abre o evento semanal agora                   |

## Como funciona um duelo

```
!duelo @Lucas Valorant ──► PENDENTE ──(Lucas reage ✅)──► ACEITO
                              │                              │
                        (❌ ou 24h)                (um lado: !resultado @vencedor)
                              ▼                              ▼
                     RECUSADO / EXPIRADO       AGUARDANDO CONFIRMAÇÃO
                                                 │                 │
                                     (outro lado reage ✅)  (reage ⚠️)
                                                 ▼                 ▼
                                            CONFIRMADO ◄──admin── EM DISPUTA
```

Isso evita que apenas uma pessoa registre vitória. Cada reação também tem um comando equivalente (`!aceitar`, `!confirmar`…). Se os dois lados usarem `!resultado` com o mesmo vencedor, a partida é confirmada; com vencedores diferentes, vai para disputa.

Na confirmação, o bot atualiza ELO/pontos, paga FluxCoins, verifica conquistas, avança a chave (se for de campeonato), posta em `#partidas` e edita o `#placar`.

## Regras

**Ranking** — `RANKING_MODE=pontos` (padrão: vitória +3, derrota +1) ou `elo`. O ELO é sempre calculado (K=32, início 1000) e define a liga:

| Liga            | Rating    |
| --------------- | --------- |
| Ferro           | < 1000    |
| Bronze III/II/I | 1000–1199 |
| Prata           | 1200–1399 |
| Ouro            | 1400–1599 |
| Platina         | 1600–1799 |
| Diamante        | 1800–1999 |
| Mestre          | 2000+     |

Em partidas de time, usa-se a média de rating de cada lado e todos recebem a mesma variação.

**Temporadas** — mensais: terminam à meia-noite do dia 1º do mês seguinte, no fuso `TIMEZONE` (com `SEASON_MODE=days`, duram `SEASON_DAYS`). No fim: 🥇 o campeão recebe o cargo **🏆 Campeão do Reino** (criado pelo `!setup`, ou o definido em `!config campeao-role`), que sai do campeão anterior, e +150 FluxCoins; 📊 as estatísticas ficam arquivadas (`!rank N`); 🔄 o ranking recomeça do zero, ou parcialmente com `SEASON_CARRY_OVER` (ex.: `0.5` mantém metade da distância até 1000).

**FluxCoins** — vitória +25 · participação +10 · campeão (torneio ou temporada) +150 · evento especial (Night Fluxer) +50 para cada participante.

**Loja** — títulos (Rei do Rush, Fantasma, Sniper, Senhor do Clutch, Tryhard), cor do nickname (7 dias), apelido especial ✨ (7 dias; o apelido anterior volta depois), cargo VIP temporário (7 dias, `SHOP_VIP_ROLE_ID`) e evento personalizado (permite criar um evento). Itens ficam em `src/services/rules/shop.ts`.

**Missões diárias** — à meia-noite (fuso `TIMEZONE`) o bot sorteia 3 missões de tipos diferentes e anuncia em `#comandos`. O sorteio usa a data como semente, então reiniciar o bot não troca as missões. Tipos: ⚔️ vencer partidas, 🎮 jogar partidas, 🎙️ minutos em voz, 🚪 entrar em salas de voz, 💬 mensagens, 👍 reações; recompensa de 20 a 100 FluxCoins. O progresso conta na hora e o bot avisa em `#comandos` quando alguém conclui. Contra spam: mensagens contam uma a cada 15 s, com 3+ caracteres e sem comandos; cada reação conta uma vez por mensagem por dia. As recompensas ficam guardadas até o `!coletar`.

**Hall do Reino** — 👑 campeão da última temporada encerrada (antes da primeira, o líder atual); ⭐ MVP da semana: mais vitórias nos últimos 7 dias; 🛡️ mais ativo: mais partidas nos últimos 30 dias; 🔥 maior sequência de vitórias em qualquer temporada; ⚔️ mais vitórias na carreira; 🪙 maior saldo de FluxCoins. Empates ficam com quem chegou primeiro.

**Perfil medieval** — a classe vem do estilo de jogo: 🪖 Recruta (menos de 5 partidas), 🧠 Estrategista (vence 60%+), 🪓 Berserker (30+ partidas e menos de 50% de vitórias), 🛡️ Cavaleiro (o resto). Títulos de honra, calculados na hora: 👑 Campeão do Reino (vença uma temporada), ⚔️ Gladiador (50 partidas), 🧙 Arquimago (1600 de rating), 🐺 Lobo Solitário (25 vitórias em duelos 1v1), 🔥 Imparável (10 vitórias seguidas). Os que faltam aparecem com 🔒 e uma barra de progresso.

**Partidas** — o banco registra vencedor, perdedor, jogo, duração e data. A duração vem do `!resultado` (ex.: `25min`, `1h20`) ou é medida do aceite até o resultado; o `!perfil` mostra a média.

**Evento semanal** — `WEEKLY_EVENT_CRON` (padrão `0 20 * * 5`, sexta 20h no fuso `TIMEZONE`). Quem reagir com ✅ entra na chave; após `WEEKLY_EVENT_REGISTRATION_MINUTES` (30) a chave é gerada automaticamente. Com menos de 2 inscritos, o evento é cancelado.

## Variáveis de ambiente

Todas estão comentadas no `.env.example`. As principais:

| Variável                                              | Padrão               | Para quê                                                                 |
| ----------------------------------------------------- | -------------------- | ------------------------------------------------------------------------ |
| `FLUXER_TOKEN`                                        | —                    | Token do bot (`<application_id>.<secret>`), **obrigatório**              |
| `FLUXER_GUILD_ID`                                     | —                    | ID do servidor, **obrigatório**                                          |
| `FLUXER_INSTANCE`                                     | `https://fluxer.app` | Instância do Fluxer (endpoints via `/.well-known/fluxer`)                |
| `COMMAND_PREFIX`                                      | `!`                  | Prefixo dos comandos                                                     |
| `DATABASE_URL`                                        | `file:./fluxer.db`   | SQLite no desenvolvimento; o compose monta a do PostgreSQL               |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `fluxer`             | PostgreSQL do `docker compose`                                           |
| `LOG_LEVEL`                                           | `info`               | Nível dos logs (`logs/combined.log`, `logs/error.log`)                   |
| `TIMEZONE`                                            | `America/Sao_Paulo`  | Fuso de temporadas e agendamentos                                        |
| `RANKING_MODE`                                        | `pontos`             | `pontos` ou `elo`                                                        |
| `SEASON_MODE` / `SEASON_DAYS` / `SEASON_CARRY_OVER`   | `monthly` / 30 / 0   | Temporadas                                                               |
| `CHAMPION_ROLE_ID`                                    | —                    | Alternativa ao `!config campeao-role`                                    |
| `ITAD_API_KEY`                                        | —                    | Chave gratuita da IsThereAnyDeal (Nuuvem, GMG, giveaways Steam/GOG)      |
| `PROMO_*`                                             | ver `.env.example`   | Promoções: fontes, desconto mínimo (40), menção (80), intervalo (30 min) |
| `FREE_GAMES_*`                                        | ver `.env.example`   | Jogos grátis: fontes, intervalo (1 h)                                    |
| `WEEKLY_EVENT_*`                                      | sexta 20h            | Evento semanal Night Fluxer                                              |
| `SHOP_VIP_ROLE_ID`                                    | —                    | Cargo entregue pelo item VIP da loja                                     |

## Deploy

1. Num servidor com Docker, clone o repositório e crie o `.env`: token, ID do servidor e uma senha forte em `POSTGRES_PASSWORD`.
2. `docker compose up -d --build`. O bot aplica as migrações do PostgreSQL sozinho.
3. Atualizar: `git pull && docker compose up -d --build`.
4. Logs: `docker compose logs -f bot` ou os arquivos no volume `bot-logs`.

## Música (Lavalink)

O módulo de música da especificação usa Lavalink, que só se conecta à voz do **Discord**. A voz do Fluxer usa **LiveKit** (docs.fluxer.app → Voice), então o Lavalink não funciona aqui. Por isso não há `/play` nem serviço `lavalink` no compose. O canal de música já pode ser configurado (`!config musica #canal`) para quando existir um player compatível com LiveKit (veja `docs/AUDITORIA.md`).

## Estrutura

```
src/
├── commands/     comandos de texto
├── events/       eventos do Gateway (mensagens e reações)
├── services/     regras de negócio (duelos, eventos, temporadas, promoções, jogos grátis, notificações)
├── database/     Prisma e repositórios
├── embeds/       montagem das mensagens
├── schedulers/   tarefas agendadas
├── utils/        logger, http, parsing, calendário
├── types/        tipos de domínio
└── fluxer/       cliente da API do Fluxer
```

Detalhes em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md). Situação do projeto em [`docs/AUDITORIA.md`](docs/AUDITORIA.md).

## Desenvolvimento

```bash
npm run dev            # bot com hot reload (aplica migrações antes)
npm test               # testes: lógica pura, serviços num SQLite de teste e o bot
                       # inteiro contra um servidor Fluxer falso (tests/mockFluxer.ts)
npm run test:postgres  # os mesmos testes num PostgreSQL (defina TEST_DATABASE_URL)
npm run typecheck
npm run lint           # ESLint (sem any, sem console fora dos scripts)
npm run format         # Prettier
npm run check          # typecheck + lint + formatação + testes
npm run build
npm run db:studio      # navegar no banco
```

Logs: `logs/combined.log` (tudo) e `logs/error.log` (só erros), em JSON. Ajuste o nível com `LOG_LEVEL`.

Veja [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) para a estrutura do código e como estender (novos jogos, itens, conquistas, comandos).
