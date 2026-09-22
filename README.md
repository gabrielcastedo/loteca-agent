# Loteca Agent — Fase 1 + Fase 2

Coleta a grade de jogos do concurso aberto da Loteca, busca odds de mercado
para os jogos, casa as duas fontes e calcula a probabilidade implícita
(sem overround) de cada resultado (1 / X / 2). Opcionalmente, busca
notícias recentes de cada time, usa Claude pra classificar desfalques
relevantes (lesões, suspensões) e ajusta a probabilidade implícita com
base nisso. Salva tudo em SQLite local.

## Setup

```bash
npm install
cp .env.example .env
# edite .env com sua chave gratuita de https://the-odds-api.com
npm run dev
```

A Fase 2 (desfalques) é opcional: sem `NEWSAPI_KEY` e `ANTHROPIC_API_KEY`
configuradas no `.env`, o app funciona normalmente só com a Fase 1.

## O que este código faz (e o que não faz ainda)

Faz:

- Busca a grade de 14 jogos do concurso aberto direto da API que o site da
  Caixa usa (`src/data/fixtures.ts`) — detecta corretamente quando não há
  concurso aberto no momento (comum entre o fechamento de um concurso e a
  publicação do próximo)
- Busca odds h2h (1x2) de vários campeonatos via The Odds API
  (`src/data/odds.ts`)
- Casa os nomes de time entre as duas fontes (`src/data/matcher.ts`) —
  esta é a parte mais frágil, ver abaixo
- Calcula probabilidade implícita de mercado por jogo (`src/probability.ts`)
- **Fase 2 (opcional):** busca notícias recentes de cada time via
  NewsAPI.org (`src/data/news.ts`), usa Claude Haiku pra classificar o
  nível de impacto de desfalques (`src/analysis/desfalques.ts`) e ajusta a
  probabilidade implícita proporcionalmente (`src/analysis/ajuste.ts`)
- Persiste tudo em SQLite (`src/db/schema.ts`), incluindo as análises de
  desfalque na tabela `desfalques`

Não faz ainda (próximas fases, conforme conversamos):

- Não estima popularidade da aposta (quantas pessoas provavelmente vão
  marcar o mesmo resultado) — isso é a Fase 3
- Não decide onde alocar duplos/triplos — isso é a Fase 4 (otimizador)

## Pontos de atenção conhecidos

1. **Endpoint da Caixa não é documentado oficialmente**, mas o formato de
   resposta em `fixtures.ts` já foi validado ao vivo (2026-09-21). O
   endpoint sem número sempre devolve o último concurso **já apurado**, não
   o aberto pra apostas — `fetchConcursoAtual()` busca `numeroConcursoProximo`
   em seguida e lança erro claro se não houver concurso realmente aberto no
   momento (comum entre o fechamento de um concurso e a publicação do
   próximo). Se a Caixa mudar o formato de novo, o erro de parsing aparece
   rápido (a grade vem com menos de 14 jogos).

2. **Matching de nomes de time é o gargalo real do projeto.** A Caixa e a
   Odds API não usam a mesma convenção de nomes (ex: Caixa manda
   `"BRAGANTINO"` puro, Odds API usa `"Bragantino-SP"`; Caixa manda
   `"ATLETICO"` sem distinguir MG/PR/GO, só dá pra desambiguar usando a UF).
   O matcher faz normalização + match exato + overrides manuais (alguns
   fixos por UF) — espere popular `MANUAL_OVERRIDES`/`MANUAL_OVERRIDES_POR_UF`
   aos poucos, concurso a concurso. Use `npm run test-matcher <numero>` pra
   testar contra dados reais sem esperar um concurso estar aberto.

3. **Cobertura de campeonatos.** Times de Série B/C brasileira ou
   competições regionais podem não ter odds na Odds API (ou em qualquer
   provedor gratuito). Esses jogos ficam sem odds no relatório — não tem
   solução mágica além de aceitar a lacuna ou pagar por um provedor com
   cobertura maior.

4. **Rate limit do tier gratuito da Odds API** é ~500 requisições/mês.
   Como a Loteca é semanal e o código busca 1x por campeonato por execução,
   isso dá margem, mas evite rodar em loop de teste sem necessidade.

5. **Fase 2 ainda não foi validada ponta a ponta com chaves reais.** A
   lógica compila e os testes sintéticos do ajuste de probabilidade batem,
   mas a busca de notícias (NewsAPI) e a classificação (Claude) dependem de
   chaves que ainda não foram configuradas neste ambiente. O tier gratuito
   da NewsAPI é restrito a uso não-comercial/dev — releia os termos antes
   de rodar isso com frequência. Os fatores de ajuste em
   `src/analysis/ajuste.ts` (`FATOR_REDUCAO`) são um chute inicial, não uma
   calibração — ajuste conforme validar resultados reais.
