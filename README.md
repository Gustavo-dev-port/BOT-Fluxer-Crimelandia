# ⚔️ Fluxer BOT — Crimelândia

Bot para o [Fluxer](https://fluxer.app) que registra disputas entre amigos, cria temporadas, mantém rankings e organiza eventos de jogos automaticamente.

Feito direto sobre a API oficial do Fluxer ([docs.fluxer.app](https://docs.fluxer.app)): descoberta da instância, HTTP API e Gateway, sem SDKs de terceiros.

- **Rankings** — pontos por temporada e ELO (com ligas: Bronze III → Mestre)
- **Duelos 1v1** — desafio com aceite e resultado validado pelos dois lados
- **Times** — 2v2, 3v3 ou squads de até 10
- **Campeonatos** — chave simples (mata-mata) ou todos contra todos
- **Temporadas** — reset automático, cargo exclusivo do campeão e histórico arquivado
- **Night Fluxer** — toda sexta às 20h: votação do jogo (1️⃣–4️⃣), inscrição com ✅, sorteio automático de equipes, uma sala de voz por equipe e chave; `!night` mostra o status
- **Salas temporárias** — `!grupo` cria a sala de voz "Grupo do <nome>": nome, limite, privado/público, senha, convite, expulsão e troca de líder; some sozinha quando fica vazia
- **Música** — `!tocar` toca YouTube (e links do Spotify via YouTube) na sua sala de voz, pelo LiveKit do Fluxer: fila, pausar, pular, voltar, repetir, embaralhar, volume e player fixado em `#🎵┃musica`
- **Promoções** — Steam, Epic, GOG, Humble, Nuuvem e Green Man Gaming a cada 30 min, sem repetir
- **Jogos grátis** — Epic, giveaways da Steam/GOG e free weekends a cada hora, com `!gratis`
- **FluxCoins** — moeda da comunidade, loja com títulos, cor de nick e eventos personalizados
- **Conquistas** — medalhas desbloqueadas automaticamente
- **Rivalidades** — `!rival` descobre quem vocês mais enfrentam, com histórico; `!rivalidades` mostra o Top 10 da comunidade
- **Hall do Reino** — campeão, MVP da semana, mais ativo, maior sequência, mais vitórias e mais FluxCoins, fixado em `#🏰┃hall-do-reino` e atualizado a cada 10 min
- **Missões diárias** — 3 missões novas à meia-noite (vencer partidas, tempo em voz, entrar em salas, mensagens, reações), com recompensa de 20 a 100 FluxCoins; `!missoes` e `!coletar`
- **Perfil medieval** — classe, liga com barra de progresso, avatar e títulos de honra (👑 ⚔️ 🧙 🐺 🔥)
- **Onboarding** — quem entra recebe o cargo 🌱 Escudeiro e uma mensagem de boas-vindas (canal e, se quiser, DM), configuráveis com `!boasvindas`; nunca um cargo administrativo
- **Jornada Escudeiro → Mercenário** — promoção automática opcional por dias na comunidade + pontos de atividade (`!progressao`), com anúncio e histórico (`!auditoria`)
- **Worker 24/7** — processo independente com reconexão automática, health check (`GET /health`), watchdog e desligamento gracioso

> **Comandos de texto e reações.** O Fluxer não tem slash commands nem botões. Os comandos usam um prefixo (`!` por padrão) e as confirmações usam reações: ✅ aceita/confirma, ❌ recusa, ⚠️ contesta.

## Stack

| Tecnologia              | Uso                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Node.js 22 + TypeScript | Linguagem (usa o `WebSocket` e o `fetch` nativos)                                                                  |
| API do Fluxer           | HTTP API + Gateway, cliente próprio em `src/fluxer/`                                                               |
| SQLite / PostgreSQL     | SQLite no desenvolvimento, PostgreSQL em produção (Docker)                                                         |
| Prisma 7                | ORM e migrações                                                                                                    |
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
   _Ver canais, Enviar mensagens, Inserir links, Adicionar reações, Ler histórico, Mencionar @everyone (evento semanal e cargo de promoções), Fixar mensagens (placar), Gerenciar cargos (loja e campeão), Gerenciar apelidos (apelido especial), Gerenciar canais (`!setup`, salas do Night Fluxer e do `!grupo`), Conectar e Falar (música), Mover membros (expulsar de um `!grupo`), Gerenciar mensagens (apagar mensagens com senha de grupo)_.
4. Para os cargos funcionarem, o cargo do bot precisa ficar **acima** dos cargos que ele entrega (hierarquia do Fluxer).

Se você usa uma instância própria do Fluxer, aponte `FLUXER_INSTANCE` para ela — o bot lê os endpoints de `/.well-known/fluxer`.

### 2. Rodar localmente

```bash
cp .env.example .env         # preencha FLUXER_TOKEN e FLUXER_GUILD_ID
npm install                  # também gera o Prisma Client (em src/generated/prisma)
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

O projeto usa o **Prisma 7**:

- A conexão vem de `prisma.config.ts` (SQLite) e `prisma.postgres.config.ts` (PostgreSQL), não mais do schema. Os comandos do PostgreSQL usam `--config prisma.postgres.config.ts`.
- O Prisma Client é gerado em `src/generated/prisma` (ignorado pelo git). Se aparecer erro de import nessa pasta, rode `npx prisma generate`.
- O bot fala com o banco por adaptadores: `@prisma/adapter-libsql` (SQLite) e `@prisma/adapter-pg` (PostgreSQL), escolhidos pela `DATABASE_URL`.
- No SQLite, um caminho relativo (`file:./fluxer.db`) continua sendo relativo à pasta `prisma/`, para o bot e o CLI. Pastas com espaço ou acento no caminho funcionam.

Ao mudar o banco:

```bash
npm run db:migrate -- --name minha_mudanca   # 1. migração SQLite
npm run db:postgres:sync                      # 2. regenera o schema do PostgreSQL
# 3. migração PostgreSQL (precisa de um PostgreSQL local vazio em DATABASE_URL):
npx prisma migrate dev --config prisma.postgres.config.ts --name minha_mudanca --create-only
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

| Canal               | Função                                                                     |
| ------------------- | -------------------------------------------------------------------------- |
| `#comandos`         | Todos os comandos do bot (restrinja com `RESTRICT_COMMANDS_CHANNEL=true`)  |
| `#placar`           | Ranking atualizado automaticamente — o bot edita a mesma mensagem fixada   |
| `#partidas`         | Histórico das disputas confirmadas e das disputas contestadas              |
| `#eventos`          | Campeonatos, evento semanal e fim de temporada                             |
| `#💸┃promocoes`     | Promoções de jogos com 40%+ de desconto (a cada 30 min)                    |
| `#🏰┃hall-do-reino` | Hall do Reino — mensagem fixada, atualizada a cada 10 min (só leitura)     |
| `#🎵┃musica`        | Player de música fixado: o que está tocando, progresso e fila (só leitura) |
| `#👋┃boas-vindas`   | Boas-vindas dos novos membros e anúncios de promoção (só leitura)          |

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
| `!progressao`                     | Sua jornada Escudeiro → Mercenário: dias, pontos de atividade e requisitos                                                                                                    |

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
| `!night`                                                   | Status do Night Fluxer: fase, votação, inscritos, equipes, salas de voz e chave        |
| `!grupo [criar] [nome]`                                    | Cria sua sala de voz temporária ("Grupo do <nome>")                                    |
| `!grupo nome <nome>` · `limite <0-99>`                     | Renomeia / limita a sala (0 = sem limite)                                              |
| `!grupo privado [senha]` · `publico` · `senha <s\|limpar>` | Privacidade e senha (a mensagem com a senha é apagada)                                 |
| `!grupo convidar @amigo` · `entrar @líder <senha>`         | Libera um amigo / entra num grupo privado com senha                                    |
| `!grupo expulsar @membro` · `lider @membro`                | Expulsa (tira da voz e bloqueia) / transfere a liderança                               |
| `!grupo info` · `fechar`                                   | Detalhes / apaga a sala                                                                |

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

| Comando                                                                                                | Função                                      |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `!setup`                                                                                               | Cria/configura canais e cargos              |
| `!config`                                                                                              | Mostra a configuração do servidor           |
| `!config <promo\|jogos-gratis\|eventos\|musica\|placar\|partidas\|comandos\|hall\|boas-vindas> #canal` | Define um canal                             |
| `!config <promo-role\|campeao-role> @cargo`                                                            | Define um cargo                             |
| `!config idioma pt-BR` · `!config <opção> limpar`                                                      | Idioma / remove um valor                    |
| `!temporada [encerrar]`                                                                                | Informações / encerra a temporada agora     |
| `!jogo listar` · `adicionar <nome>` · `remover <nome>`                                                 | Jogos disponíveis para disputas             |
| `!admin resultado #partida @vencedor`                                                                  | Resolve disputas                            |
| `!admin cancelar #partida`                                                                             | Cancela uma partida não confirmada          |
| `!admin moedas @jogador <quantidade> [motivo]`                                                         | Ajusta FluxCoins                            |
| `!admin placar`                                                                                        | Recria a mensagem do placar                 |
| `!admin evento-semanal`                                                                                | Abre o evento semanal agora                 |
| `!boasvindas` · `ativar` · `desativar` · `canal #canal` · `dm ativar\|desativar`                       | Boas-vindas dos novos membros               |
| `!boasvindas mensagem <texto>` · `mensagem padrao` · `preview`                                         | Edita / restaura / mostra a mensagem        |
| `!boasvindas cargo @cargo` · `cargo padrao`                                                            | Cargo inicial (cargos administrativos: não) |
| `!progressao ativar\|desativar` · `dias <n>` · `atividade <n>` · `cargo @cargo`                        | Promoção automática Escudeiro → Mercenário  |
| `!progressao verificar`                                                                                | Roda a promoção agora                       |
| `!auditoria [n]`                                                                                       | Histórico das ações automáticas do bot      |

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

**Night Fluxer** — `WEEKLY_EVENT_CRON` (padrão `0 20 * * 5`, sexta 20h no fuso `TIMEZONE`):

1. 🗳️ O anúncio em `#eventos` traz a votação entre os `NIGHT_POLL_OPTIONS` (4) jogos mais jogados nos últimos 30 dias (reaja com 1️⃣–4️⃣; tirar a reação desfaz o voto) e a inscrição (✅).
2. ⏱️ Após `WEEKLY_EVENT_REGISTRATION_MINUTES` (30), vence o jogo mais votado (empate: o primeiro da lista).
3. 🎲 As equipes de `NIGHT_TEAM_SIZE` (2) são sorteadas (Lobos, Dragões, Corvos…; quem sobra entra nas primeiras). Com menos de 2 equipes possíveis, o evento roda em 1v1.
4. 🔊 O bot cria uma sala de voz por equipe (ou uma "Arena" no 1v1), na categoria do `#eventos`.
5. ⚔️ A chave começa; os resultados vão com `!resultado` e atualizam o ranking como qualquer partida.
6. 🧹 Quando o evento termina (ou é cancelado), as salas de voz são apagadas. Com menos de 2 inscritos, o evento é cancelado.

**Salas temporárias** — `!grupo` cria a sala na categoria do `#comandos`. Sala nova sem ninguém some em 5 minutos; depois de usada, some 1 minuto após o último sair. Privado nega **Conectar** para @everyone e libera o líder, quem já está na sala e os convidados; a senha fica guardada só como hash. A missão "Receba N amigos no seu grupo" conta cada amigo uma vez por dia.

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
| `LOG_FORMAT`                                          | `text`               | Console em texto ou `json` (logs estruturados)                           |
| `HEALTH_PORT` / `HEALTH_HOST_PORT`                    | 3000 / 3000          | Porta do `GET /health` (0 = desligado) / porta publicada na VPS          |
| `HEALTH_GATEWAY_GRACE_SECONDS`                        | 120                  | Tolerância sem Gateway antes do `/health` ficar "unhealthy"              |
| `WORKER_WATCHDOG_MINUTES`                             | 10                   | Sem Gateway/banco por mais que isso: o worker reinicia (0 = nunca)       |
| `TIMEZONE`                                            | `America/Sao_Paulo`  | Fuso de temporadas e agendamentos                                        |
| `RANKING_MODE`                                        | `pontos`             | `pontos` ou `elo`                                                        |
| `SEASON_MODE` / `SEASON_DAYS` / `SEASON_CARRY_OVER`   | `monthly` / 30 / 0   | Temporadas                                                               |
| `CHAMPION_ROLE_ID`                                    | —                    | Alternativa ao `!config campeao-role`                                    |
| `ITAD_API_KEY`                                        | —                    | Chave gratuita da IsThereAnyDeal (Nuuvem, GMG, giveaways Steam/GOG)      |
| `PROMO_*`                                             | ver `.env.example`   | Promoções: fontes, desconto mínimo (40), menção (80), intervalo (30 min) |
| `FREE_GAMES_*`                                        | ver `.env.example`   | Jogos grátis: fontes, intervalo (1 h)                                    |
| `WEEKLY_EVENT_*`                                      | sexta 20h            | Evento semanal Night Fluxer                                              |
| `NIGHT_TEAM_SIZE` / `NIGHT_POLL_OPTIONS`              | 2 / 4                | Tamanho das equipes sorteadas / jogos na votação                         |
| `MUSIC_ENABLED` / `YTDLP_PATH` / `FFMPEG_PATH`        | true / `yt-dlp` / —  | Música; caminhos do yt-dlp e do ffmpeg (vazio = o do pacote npm)         |
| `MUSIC_DEFAULT_VOLUME` / `MUSIC_IDLE_MINUTES`         | 80 / 5               | Volume inicial / minutos com a sala vazia até o bot sair                 |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`         | —                    | Opcional: álbuns e playlists do Spotify                                  |
| `SHOP_VIP_ROLE_ID`                                    | —                    | Cargo entregue pelo item VIP da loja                                     |

## Deploy

1. Num servidor com Docker, clone o repositório e crie o `.env`: token, ID do servidor e uma senha forte em `POSTGRES_PASSWORD`.
2. `docker compose up -d --build`. O bot aplica as migrações do PostgreSQL sozinho.
3. Atualizar: `git pull && docker compose up -d --build`.
4. Logs: `docker compose logs -f bot` ou os arquivos no volume `bot-logs`.
5. Saúde: `curl http://127.0.0.1:3000/health` (e `docker compose ps` mostra `healthy`).

O serviço `bot` é o **worker**: fica ligado 24/7 sozinho, sem depender de página aberta. O passo a passo completo (VPS, atualização sem perder dados, logs, reiniciar só o worker) está em [docs/WORKER-24-7.md](docs/WORKER-24-7.md).

## Música (LiveKit)

O bot toca música nas salas de voz do Fluxer. A voz do Fluxer é **LiveKit** (o Lavalink, feito para o Discord, não serve aqui).

**Como funciona:**

1. Você entra numa sala de voz e usa `!tocar <música ou link>`.
2. O bot pede a entrada no canal pelo Gateway (op 4) e recebe do Fluxer a credencial LiveKit (`VOICE_SERVER_UPDATE`).
3. Ele entra na sala e publica uma faixa de áudio.
4. O áudio sai do **YouTube** pelo `yt-dlp` e é decodificado pelo `ffmpeg`, tudo por pipe, sem salvar arquivos.
5. Links do **Spotify** (faixa, álbum, playlist) viram buscas "artista - música" no YouTube, feitas quando chega a vez de cada uma.

**Instalação:**

- **yt-dlp:** precisa estar instalado.
  - Windows: `winget install yt-dlp`
  - Linux/macOS: `pip install -U yt-dlp`
  - Se não estiver no PATH, aponte `YTDLP_PATH` para ele.
  - Atualize com frequência (`yt-dlp -U`): o YouTube muda e versões velhas param de funcionar.
- **ffmpeg:** vem sozinho com o `npm install` (pacote `@ffmpeg-installer/ffmpeg`).
- **Docker:** a imagem já baixa o yt-dlp.
- **Spotify (opcional):** para álbuns e playlists, crie um app em developer.spotify.com e preencha `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET`. Sem isso, só links de faixa funcionam.
- **Permissões do bot na sala:** Ver canal, **Conectar** e **Falar**.

**Comandos:**

| Comando                                        | Função                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `!tocar <busca ou link>`                       | Toca (ou põe na fila) uma música, playlist do YouTube, ou faixa/álbum/playlist do Spotify |
| `!tocar proxima <busca ou link>`               | Põe logo depois da música atual                                                           |
| `!pausar` · `!continuar`                       | Pausa / continua (`!continuar` também volta a tocar a fila salva depois de `!sair`)       |
| `!pular` · `!voltar`                           | Próxima / anterior                                                                        |
| `!fila [página]` · `!tocando`                  | Fila / música atual com barra de progresso                                                |
| `!embaralhar` · `!repetir [musica\|fila\|off]` | Embaralha a fila / repete a música ou a fila                                              |
| `!volume <0-150>`                              | Volume do bot para todos (cada pessoa ainda ajusta o próprio no Fluxer)                   |
| `!remover <posição>`                           | Tira uma música da fila                                                                   |
| `!parar` · `!sair`                             | Para e limpa a fila / sai da sala guardando a fila                                        |

**Regras:**

- Só quem está na mesma sala que o bot controla a música; admins controlam de qualquer lugar.
- O **player fica fixado em `#🎵┃musica`** (criado pelo `!setup`) com capa, título, artista, duração, barra de progresso e quem pediu, atualizado sozinho.
- A cada 5 s, e a cada mudança, o estado vai para a sala como **DataPacket** LiveKit (tópico `fluxer.music`), para players sincronizados.
- Com a sala vazia (ou a fila terminada) por `MUSIC_IDLE_MINUTES` (5), o bot sai.
- A fila fica salva no banco (`MusicQueue`) e sobrevive a reinícios; o que tocou fica em `MusicHistory`.
- Log próprio em `logs/music.log`.
- Missão diária nova: 🎵 "Escute N minutos de música com o bot".

> ⚠️ **Termos do YouTube:** tocar áudio do YouTube por um bot contraria os termos de uso do YouTube. É o que a maioria dos bots de música faz, mas o YouTube pode limitar ou bloquear o acesso (erros como "Sign in to confirm you're not a bot"). A responsabilidade pelo uso é do dono do servidor.

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

Detalhes em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md). Situação do projeto em [`docs/AUDITORIA.md`](docs/AUDITORIA.md) (v1.0) e [`docs/AUDITORIA-v1.1.md`](docs/AUDITORIA-v1.1.md) (v1.1).

## Desenvolvimento

```bash
npm run dev            # bot com hot reload (aplica migrações antes)
npm test               # testes: lógica pura, serviços num SQLite de teste e o bot
                       # inteiro contra um servidor Fluxer falso (tests/mockFluxer.ts)
npm run test:postgres  # os mesmos testes num PostgreSQL (defina TEST_DATABASE_URL)
npm run test:livekit   # música num LiveKit real (defina LIVEKIT_TEST_URL; veja tests/music.livekit.test.ts)
npm run typecheck
npm run lint           # ESLint (sem any, sem console fora dos scripts)
npm run format         # Prettier
npm run check          # typecheck + lint + formatação + testes
npm run build
npm run db:studio      # navegar no banco
```

Logs: `logs/combined.log` (tudo) e `logs/error.log` (só erros), em JSON. Ajuste o nível com `LOG_LEVEL`.

Veja [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) para a estrutura do código e como estender (novos jogos, itens, conquistas, comandos).
