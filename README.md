# Loteca Agent — Fase 1

Coleta a grade de jogos do concurso atual da Loteca, busca odds de mercado
para os jogos, casa as duas fontes e calcula a probabilidade implícita
(sem overround) de cada resultado (1 / X / 2). Salva tudo em SQLite local.

## Setup

```bash
npm install
cp .env.example .env
# edite .env com sua chave gratuita de https://the-odds-api.com
npm run dev
```

## O que este código faz (e o que não faz ainda)

Faz:
- Busca a grade de 14 jogos do concurso atual direto da API que o site da
  Caixa usa (`src/data/fixtures.ts`)
- Busca odds h2h (1x2) de vários campeonatos via The Odds API
  (`src/data/odds.ts`)
- Casa os nomes de time entre as duas fontes (`src/data/matcher.ts`) —
  esta é a parte mais frágil, ver abaixo
- Calcula probabilidade implícita de mercado por jogo
- Persiste tudo em SQLite (`src/db/schema.ts`)

Não faz ainda (próximas fases, conforme conversamos):
- Não estima popularidade da aposta (quantas pessoas provavelmente vão
  marcar o mesmo resultado) — isso é a Fase 3
- Não decide onde alocar duplos/triplos — isso é a Fase 4 (otimizador)
- Não cruza com notícias/desfalques/calendário de outras competições —
  isso entra na Fase 2, como camada adicional de ajuste sobre a
  probabilidade implícita pura

## Pontos de atenção conhecidos (validar ao rodar de verdade)

1. **Endpoint da Caixa não é documentado oficialmente.** O formato de
   resposta em `fixtures.ts` foi inferido a partir do template Angular da
   página pública da Loteca, não testado ao vivo neste ambiente. Rode
   localmente, descomente o `console.log(raw)` em `fetchConcursoAtual` e
   confira os nomes de campo antes de confiar no parsing.

2. **Matching de nomes de time é o gargalo real do projeto.** A Caixa e a
   Odds API não usam a mesma convenção de nomes (`"RB BRAGANTINO"` vs
   `"Red Bull Bragantino"`, sufixos de UF tipo `"/PE"`, etc). O matcher
   atual faz normalização + match exato + uma lista manual de overrides —
   espere popular essa lista aos poucos, concurso a concurso.

3. **Cobertura de campeonatos.** Times de Série B/C brasileira ou
   competições regionais podem não ter odds na Odds API (ou em qualquer
   provedor gratuito). Esses jogos ficam sem odds no relatório — não tem
   solução mágica além de aceitar a lacuna ou pagar por um provedor com
   cobertura maior.

4. **Rate limit do tier gratuito da Odds API** é ~500 requisições/mês.
   Como a Loteca é semanal e o código busca 1x por campeonato por execução,
   isso dá margem, mas evite rodar em loop de teste sem necessidade.
