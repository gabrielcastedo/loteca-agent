# Plano de melhorias — qualidade das sugestões

Escrito em 2026-09-22, depois da primeira execução ponta a ponta bem-sucedida
(concurso 1272, 14/14 jogos com odds via odds.show). O pipeline funciona;
esse documento é sobre deixar as *sugestões* melhores, não sobre destravar
dados que faltavam.

## O problema de fundo

Todos os pesos e fatores do projeto hoje são chutes com bom senso, não
calibração:

- `FATOR_SUBAPOSTA_EMPATE` e `BONUS_TORCIDA_GRANDE` (Fase 3, popularidade)
- `FATOR_REDUCAO` do ajuste de desfalque (Fase 2)
- A regra do otimizador de sempre escolher a maior probabilidade pura como
  pick principal, ignorando o "melhor valor" da Fase 3 (Fase 4)

Sem comparar sugestão vs. resultado real, toda melhoria nesses fatores é
só outro chute — por isso o item P0 abaixo vem antes de tudo.

## P0 — Fechar o loop de validação (base pra tudo mais)

**O quê:** depois que um concurso é apurado (a própria API `servicebus2`
já tem isso, com os placares em `nuGolEquipeUm`/`nuGolEquipeDois`), buscar
o resultado real de cada jogo e comparar contra o que o app sugeriu:
- O pick principal (maior probabilidade) acertou?
- O "melhor valor" (Fase 3) teria sido uma escolha melhor?
- O cartão sugerido (Fase 4) teria acertado quantos jogos?

**Por quê primeiro:** sem isso, qualquer ajuste nos fatores das Fases 2-4
é só um segundo chute em cima do primeiro. Com histórico acumulado
(mesmo que poucos concursos no início), dá pra saber se `FATOR_SUBAPOSTA_EMPATE
= 0.6` está muito forte/fraco, se o otimizador está priorizando os jogos
certos pra duplo/triplo, etc.

**Como:** uma tabela nova (`resultados`) + um comando separado
(`npm run conferir <numero>`) que busca o concurso já apurado, compara com
o que foi salvo no banco na época, e imprime/persiste as métricas de acerto.

## P1 — Usar o "melhor valor" de verdade na escolha do pick

**O quê:** hoje `otimizador.ts` sempre marca o resultado de maior
probabilidade pura pra cada jogo simples, e o "melhor valor" da Fase 3 fica
só como informação no relatório — não influencia a escolha. Isso é
proposital (documentado em `otimizador.ts`), mas vale revisitar agora que
a cobertura de odds está completa.

**Por quê:** é a estratégia clássica de bolão — quando dois resultados têm
probabilidade parecida, mas um é bem menos popular, vale trocar pra ele
(mais gente errando o mesmo jogo que você aumenta seu valor relativo caso
acerte).

**Cuidado:** não é "sempre escolher o de melhor valor" — isso pioraria a
taxa de acerto. Precisa de uma regra explícita e documentada, tipo "só troca
o pick se a perda de probabilidade for menor que X pontos percentuais E o
ganho de valor for maior que Y". Os valores de X/Y são outro chute inicial
— por isso esse item deveria vir depois que P0 já tiver alguns concursos de
histórico pra calibrar com dado real, não only vibes.

## P2 — Odds por casa de apostas, não só "melhor de cada mercado"

**O quê:** hoje pegamos a melhor odd de 1, a melhor de X e a melhor de 2 do
odds.show — possivelmente de três casas diferentes. Ótimo pra saber o
melhor preço, mas estatisticamente menos limpo que pegar as três odds de
uma mesma casa (o "viés" de cada casa de apostas se mistura).

**O quê fazer:** se o odds.show expuser odds por casa individualmente (não
só a melhor), calcular probabilidade implícita a partir de uma média
ponderada entre casas, ou pelo menos guardar os dados brutos por casa pra
permitir isso depois.

## P3 — Mais sinais na Fase 2 (além de desfalque por notícia)

**O quê:** hoje só olhamos manchetes recentes via NewsAPI pra desfalques.
Sinais adicionais checáveis e que a arquitetura já suporta encadear (mesmo
padrão de `ajustarProbabilidade`):
- Forma recente (sequência de resultados) de cada time
- Histórico de confrontos diretos
- Fator casa mais robusto que só a odd do mercado

## P4 — Calibrar os chutes da Fase 3 com qualquer dado real disponível

Mesmo sem dado de popularidade real por jogo (não existe publicamente, já
confirmado), dá pra aproximar melhor:
- Trocar a lista fixa `TORCIDAS_GRANDES` por uma pesquisa de torcida real
  (Datafolha/Pluri) em vez de uma lista chutada por mim.
- Usar `listaRateioPremio` (número de acertadores por faixa, que a própria
  API da Caixa já devolve) como sinal agregado indireto — não dá pra saber
  por jogo, mas dá pra inferir se um concurso inteiro foi "fácil" (favoritos
  óbvios) e ajustar a confiança geral da heurística naquela semana.

## P5 — Teto real de duplos/triplos no otimizador

Ainda pendente (documentado no README). Se em algum momento você confirmar
o limite real olhando o app/site da Caixa na hora de apostar, dá pra travar
isso no otimizador em vez de deixar sem limite.

## P6 — Testes automatizados

Ainda não existem. Prioridade: os módulos de cálculo puro e determinístico
(`ajuste.ts`, `popularidade.ts`, `otimizador.ts`, `probability.ts`) —
são os que vão ser mexidos ao calibrar fatores (P0/P4), e testes evitam
regressão silenciosa nessa calibração.

## Por onde eu começaria

**P0 primeiro, sem dúvida.** Todo o resto (P1, P4) depende de ter dado real
pra calibrar em vez de mais um chute. P2 e P3 são incrementais e podem vir
em paralelo, sem depender de P0. P5 depende só de você confirmar um número
num app. P6 vale ir fazendo conforme mexer em cada módulo, não como um
projeto à parte.
