# Auditoria — Fluxer BOT

> Esta é a auditoria da v1.0. A da atualização v1.1 (Hall do Reino, missões diárias, rivalidades, Night Fluxer, salas temporárias e perfil medieval) está em [`AUDITORIA-v1.1.md`](AUDITORIA-v1.1.md).

Estado do projeto em relação à especificação "FLUXER BOT — Bot Oficial da Comunidade Fluxer".

**Decisão de plataforma:** a especificação pedia Discord.js e slash commands, mas o bot roda no **Fluxer**, por decisão do dono do projeto. As adaptações que isso exige estão marcadas com ⚙️.

## Funcionalidades prontas

### Módulo 1 — Promoções ✅

- Adaptadores independentes, todos devolvendo `{ id, title, platform, image, oldPrice, currentPrice, discount, expiresAt, url }`:
  - **Steam** — `featuredcategories`
  - **Epic Games** — GraphQL `searchStore`
  - **GOG** — `catalog.gog.com`
  - **Humble Bundle** — busca da loja
  - **Nuuvem e Green Man Gaming** — API oficial da IsThereAnyDeal; essas lojas não têm API pública
- Agendador a cada 30 minutos.
- Não repete promoção: tabela `Promotion`.
- Quando o preço muda, atualiza o banco e edita a mensagem original.
- Ignora descontos abaixo de 40%.
- Canal padrão `#💸┃promocoes`.
- Embed "🟢 NOVA PROMOÇÃO" com título, plataforma, De, Por, Desconto e Expira.
- ⚙️ O botão "Ver oferta" virou link, porque o Fluxer não tem botões.
- Menciona o cargo **Caçadores de Promoção** com desconto ≥ 80%.
- Extras:
  - `!promocoes` e `!promocoes atualizar`
  - limite de postagens por rodada
  - encerramento de promoções vencidas

### Módulo 2 — Jogos grátis ✅

- Fontes:
  - jogos grátis da Epic
  - giveaways da Steam e da GOG, pela IsThereAnyDeal
  - Steam Free Weekend, identificado nos giveaways da ITAD
- Agendador a cada 1 hora.
- Não repete jogo (tabela `FreeGame`).
- Canal `#🎁┃jogos-gratis`.
- Postagem com imagem, nome, descrição, plataforma e data limite. ⚙️ O "Resgatar" é um link.
- `!gratis` lista os jogos grátis ativos.

### Módulo 4 — Disputas ✅

- ⚙️ Comandos como texto com prefixo:
  - `!duelo @jogador jogo`
  - `!aceitar` e `!recusar`, também pelas reações ✅/❌
  - `!resultado @vencedor`
  - `!rank`, `!perfil`, `!rival`
- Resultado confirmado pelos dois lados: quem reporta e quem confirma (✅) ou contesta (⚠️). Divergência vai para um admin.
- Banco registra vencedor, perdedor, jogo, **duração** e data.
- Estatísticas: vitórias, derrotas, win rate, sequência, rivalidade, partidas totais e duração média.
- **Temporadas mensais**: viram no dia 1º, no fuso configurado.
  - Ranking arquivado.
  - Pontos resetados (total ou parcial).
  - Histórico mantido.
- Cargo automático **🏆 Campeão do Reino**, criado pelo `!setup`, que sai do campeão anterior.
- Extras:
  - ELO com ligas
  - partidas 2v2/3v3 entre times
  - conquistas
  - `#placar` atualizado sozinho

### Módulo 5 — Eventos ✅

- `!evento criar`, `!evento iniciar`, `!evento cancelar`, `!inscrever` (também reagindo ✅ no anúncio).
- Suporta 1v1, 2v2 e squads, em **mata-mata** (com seeds e byes) ou **todos contra todos**.
- Chave gerada automaticamente e atualizada a cada resultado.
- Canal `#📜┃eventos`.
- Extra: evento semanal automático _Night Fluxer_.

### Módulo 6 — Economia ✅

- FluxCoin: vitória +25, participação +10, campeão +150, evento +50.
- `!saldo`, `!loja`, `!resgatar`.
- Itens:
  - títulos
  - cor do nick (7 dias)
  - cargo VIP temporário (7 dias)
  - apelido especial ✨ (7 dias, devolvendo o apelido original)
  - crédito para criar evento
- Extrato na tabela `Transaction`.

### Módulo 7 — Configuração ✅

- Tabela `GuildSettings`. Campos:
  - canais: `promoChannelId`, `freeGamesChannelId`, `musicChannelId`, `eventChannelId`
  - cargos: `promoRoleId`, `championRoleId`
  - `language`
  - mais os canais de comandos, placar e partidas
- `!config` (só admin), com as opções:
  - canais: `promo`, `jogos-gratis`, `eventos`, `musica`, `placar`, `partidas`, `comandos`
  - cargos: `promo-role`, `campeao-role`
  - `idioma`
  - `limpar`, para remover um valor

### Infraestrutura ✅

- **Banco:** SQLite no desenvolvimento e PostgreSQL em produção, com migrações completas para os dois.
- **Logs:** Winston em `logs/error.log` e `logs/combined.log`. Registram comandos, erros, agendadores e Gateway.
- **Docker:** `Dockerfile` e `docker-compose.yml` com bot + postgres.
- **Código:** TypeScript estrito, sem `any` (garantido pelo ESLint), Prettier, tratamento global de erros.
- **Arquitetura:** pastas `commands/ events/ services/ database/ embeds/ schedulers/ utils/ types/`. Repositórios nos módulos novos. Serviços desacoplados por interfaces (fontes, repositório, publicador, logger).
- **Documentação:** README com instalação, variáveis, criação do bot, permissões, deploy, Docker, Lavalink, estrutura e todos os comandos. Mais `docs/ARQUITETURA.md`.

## Pendências

| Item                                   | Situação                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Módulo 3 — Música**                  | ❌ Não implementado. O Lavalink só fala com a voz do Discord; o Fluxer usa **LiveKit**. Um player exigiria outra base (um cliente de voz LiveKit que toque áudio), fora do escopo desta versão. `musicChannelId` e `!config musica` já existem. |
| Tabela `MusicHistory`                  | ❌ Depende do módulo de música.                                                                                                                                                                                                                 |
| Slash commands e botões                | ⚙️ Não existem no Fluxer. Substituídos por comandos com prefixo e reações.                                                                                                                                                                      |
| Nomes `Economy` e `Event`              | ⚙️ Equivalem a `Player.coins` + `Transaction` e a `Tournament`. Não renomeei para não migrar dados.                                                                                                                                             |
| Repository Pattern nos módulos antigos | ⚠️ Os módulos novos (config, promoções, jogos grátis) usam repositórios. Os serviços de disputas, eventos e economia ainda acessam o Prisma direto, porque dependem de transações entre várias tabelas.                                         |
| Idioma                                 | ⚠️ O campo `language` existe, mas só há textos em pt-BR.                                                                                                                                                                                        |

## Testes realizados

- **89 testes automatizados** (`npm test`), todos passando. Os mesmos 89 passam num **PostgreSQL 16 real** (`npm run test:postgres`), com o banco criado pelas migrações de produção. Cobertura:
  - **Lógica pura:** ELO, ligas, geração de chaves (seeds, byes, todos contra todos), rivalidades, conquistas, duração, apelidos, virada do mês em fusos com e sem horário de verão.
  - **Serviços no banco:** duelo completo, disputas, 2v2, mata-mata até o campeão, todos contra todos, fim de temporada, perfil, rival, loja, duração.
  - **Promoções e jogos grátis:** cada adaptador via HTTP contra uma loja falsa com respostas de exemplo (as da IsThereAnyDeal vêm da especificação OpenAPI oficial). Também as regras: desconto mínimo, duplicatas, mudança de preço, limite por rodada, loja com erro, falta de canal, vencimento.
  - **Ponta a ponta** contra um **servidor Fluxer falso** que segue docs.fluxer.app (descoberta, HTTP e Gateway):
    - Identify sem intents, Resume após queda, retry em 429
    - comandos e reações
    - permissões de admin
    - `!config`, `!setup`, promoções, jogos grátis, `!resgatar`, `!evento`
- **Execução real do bot compilado** contra o servidor falso, em SQLite e em PostgreSQL: conecta, liga os agendadores, responde a comandos e grava logs. Com as lojas bloqueadas, cada falha foi registrada e o bot seguiu funcionando.
- **Migrações:** `prisma migrate diff` confirmou que as migrações e o schema não divergem, nos dois bancos.
- **Não testado:**
  - Numa instância real do Fluxer. O dono do projeto já rodou as primeiras versões com sucesso.
  - Contra as lojas reais: a rede do ambiente de desenvolvimento bloqueia esses sites.
  - `docker compose build`: o ambiente bloqueia o repositório de pacotes do Debian. Os passos do Dockerfile foram reproduzidos à mão.

## Riscos técnicos

1. **APIs de lojas sem contrato.** Steam, Epic, GOG e Humble podem mudar o formato ou bloquear robôs (a Epic é a mais propensa). A leitura é defensiva e as falhas vão para o log, mas uma loja pode parar de trazer ofertas em silêncio. A alternativa é passar a loja para a IsThereAnyDeal, que tem API oficial.
2. **Adaptadores validados só com respostas de exemplo.** A primeira execução real é o teste de verdade. Confira `logs/combined.log` ("steam: N ofertas").
3. **API do Fluxer em evolução.** O cliente segue a documentação atual. Mudanças no Gateway ou em rotas exigem ajustes em `src/fluxer/`.
4. **Permissões e hierarquia de cargos.** Cor do nick, VIP, apelido especial e cargo de campeão exigem que o cargo do bot fique acima dos cargos e membros envolvidos. Em caso de falha as moedas são devolvidas, mas o item não é aplicado.
5. **Um servidor por instância.** O bot atende o servidor de `FLUXER_GUILD_ID`. Várias comunidades pedem várias instâncias ou uma refatoração.
6. **Rate limits.** Promoções e jogos grátis limitam as postagens por rodada, e o cliente respeita `retry_after`. Rodadas muito frequentes (`PROMO_CRON`) podem esbarrar nos limites das lojas.
7. **Segredos.** O token e a chave da ITAD ficam só no `.env`. Os logs escondem credenciais em URLs. Um token já foi publicado por engano: a recomendação de gerar um novo continua valendo.

## Roadmap da versão 2.0

1. **Música no Fluxer:** player baseado em LiveKit (cliente de voz que publica áudio). Com ele: `play`, `pause`, `skip`, `queue`, `loop`, `volume`, `nowplaying`, `MusicHistory`, autoplay e desconexão após 5 minutos.
2. **Repository Pattern completo:** mover disputas, eventos e economia para repositórios, com uma unidade de trabalho para as transações.
3. **Vários servidores** numa mesma instância: `GuildSettings` já é por servidor; falta separar temporadas, ranking e economia por `guildId`.
4. **Internacionalização:** textos em arquivos de idioma, usando o campo `language`.
5. **Painel web** para ranking, histórico de temporadas e configuração.
6. **Alertas de desejos:** cada jogador segue jogos e recebe DM quando entram em promoção (a IsThereAnyDeal tem Waitlist).
7. **CI** no GitHub Actions rodando `npm run check` e `npm run test:postgres` a cada PR.
8. **Métricas e saúde:** endpoint de healthcheck e contadores de ofertas por loja, para detectar quando uma loja para de responder.
