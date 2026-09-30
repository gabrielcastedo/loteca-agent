import { readFileSync } from "node:fs";
import { probabilidadesImplicitas } from "../src/probability.js";
import { estimarPopularidade } from "../src/analysis/popularidade.js";
import { calcularMelhorValor } from "../src/report.js";
import type { Resultado } from "../src/analysis/otimizador.js";
import type { ProbabilidadePura } from "../src/types.js";

/**
 * Laboratório de estratégias de fechamento (backteste): em vez de perguntar
 * "qual é o melhor palpite?", testa DIFERENTES formas de montar bilhetes de
 * cobertura contra concursos reais já decididos, medindo custo e acerto do
 * melhor bilhete de cada estratégia.
 *
 * Fonte de dados: `backtest/concursos-2026-sem-selecao.json` — concursos
 * reais (sem jogo de seleção, ver README) com odds históricas reais
 * (football-data.co.uk) e resultado real (Caixa). Gerar esse dataset é um
 * processo separado (não incluído aqui) — ver docs/plano-melhorias.md.
 *
 * Uso: npm run backtest
 */

interface JogoDataset {
  sequencial: number;
  equipeCasa: string;
  equipeVisitante: string;
  oddCasa: number;
  oddEmpate: number;
  oddVisitante: number;
  resultadoReal: Resultado;
}

interface JogoPreparado {
  sequencial: number;
  ranking: Resultado[]; // ordenado por probabilidade decrescente
  resultadoReal: Resultado;
  scores: { ganhoMarginal: number; entropia: number; diferencaP1P2: number; valor: number };
}

interface Bilhete {
  marcacoes: Map<number, Resultado[]>; // sequencial -> resultados marcados
}

const PRECO_COMBINACAO = 2;
const N_PROTEGIDOS_PADRAO = 8; // mesmo tamanho do pool "alta+media" da produção (ver otimizador.ts)

function rankear(p: ProbabilidadePura): Resultado[] {
  return (["casa", "empate", "visitante"] as Resultado[]).sort((a, b) => p[b] - p[a]);
}

/** Probabilidade do 2º colocado — mesmo critério que `classificarPrioridade` usa em produção. */
function ganhoMarginal(p: ProbabilidadePura): number {
  return rankear(p)
    .map((r) => p[r])
    .sort((a, b) => b - a)[1];
}

/** Entropia de Shannon — quanto mais "espalhada" a distribuição, maior. Critério alternativo (P3/backtest). */
function entropia(p: ProbabilidadePura): number {
  return -[p.casa, p.empate, p.visitante].reduce((soma, x) => soma + (x > 0 ? x * Math.log2(x) : 0), 0);
}

/** Diferença entre 1º e 2º colocado — quanto MENOR, mais "pescoço a pescoço" o jogo. */
function diferencaP1P2(p: ProbabilidadePura): number {
  const [r0, r1] = rankear(p);
  return -(p[r0] - p[r1]); // negativo: menor diferença = maior prioridade
}

function prepararJogos(jogos: JogoDataset[]): JogoPreparado[] {
  return jogos.map((j) => {
    const prob = probabilidadesImplicitas(j.oddCasa, j.oddEmpate, j.oddVisitante);
    const popularidade = estimarPopularidade(prob, { equipeCasa: j.equipeCasa, equipeVisitante: j.equipeVisitante });
    const melhorValor = calcularMelhorValor(prob, popularidade);
    return {
      sequencial: j.sequencial,
      ranking: rankear(prob),
      resultadoReal: j.resultadoReal,
      scores: {
        ganhoMarginal: ganhoMarginal(prob),
        entropia: entropia(prob),
        diferencaP1P2: diferencaP1P2(prob),
        valor: melhorValor.valor,
      },
    };
  });
}

function melhorBilhete(bilhetes: Bilhete[], jogos: JogoPreparado[]): number {
  let melhor = 0;
  for (const b of bilhetes) {
    let acertos = 0;
    for (const j of jogos) {
      const marcado = b.marcacoes.get(j.sequencial);
      if (marcado && marcado.includes(j.resultadoReal)) acertos++;
    }
    if (acertos > melhor) melhor = acertos;
  }
  return melhor;
}

/** Estratégia A: 1 bilhete, favorito puro em todos os jogos, sem duplo. */
function estrategiaA(jogos: JogoPreparado[]) {
  const marcacoes = new Map(jogos.map((j) => [j.sequencial, [j.ranking[0]]]));
  const bilhetes: Bilhete[] = [{ marcacoes }];
  return { bilhetes, custo: 4 }; // aposta mínima oficial (R$4) — aqui medimos cobertura pura, sem duplo
}

/** Cobertura em pares (2 duplos/bilhete) entre os N jogos de maior score — mesma mecânica de `fechamento.ts`. */
function estrategiaPares(jogos: JogoPreparado[], scoreFn: (j: JogoPreparado) => number, n: number = N_PROTEGIDOS_PADRAO) {
  const protegidos = [...jogos].sort((a, b) => scoreFn(b) - scoreFn(a)).slice(0, Math.min(n, jogos.length));
  const bilhetes: Bilhete[] = [];
  for (let i = 0; i < protegidos.length; i++) {
    for (let k = i + 1; k < protegidos.length; k++) {
      const cobertura = new Set([protegidos[i].sequencial, protegidos[k].sequencial]);
      const marcacoes = new Map(
        jogos.map((j) => [j.sequencial, cobertura.has(j.sequencial) ? [j.ranking[0], j.ranking[1]] : [j.ranking[0]]])
      );
      bilhetes.push({ marcacoes });
    }
  }
  const custoPorBilhete = 4 * PRECO_COMBINACAO; // 2 duplos = 2^2 = 4 combinações
  return { bilhetes, custo: bilhetes.length * custoPorBilhete };
}

/** 1 duplo por bilhete, 1 bilhete por jogo protegido — cobertura de desvio único, mais barata que pares. */
function estrategiaSingle(jogos: JogoPreparado[], scoreFn: (j: JogoPreparado) => number, n: number = N_PROTEGIDOS_PADRAO) {
  const protegidos = [...jogos].sort((a, b) => scoreFn(b) - scoreFn(a)).slice(0, Math.min(n, jogos.length));
  const bilhetes: Bilhete[] = protegidos.map((alvo) => {
    const marcacoes = new Map(
      jogos.map((j) => [j.sequencial, j.sequencial === alvo.sequencial ? [j.ranking[0], j.ranking[1]] : [j.ranking[0]]])
    );
    return { marcacoes };
  });
  const custoPorBilhete = 2 * PRECO_COMBINACAO; // 1 duplo = 2^1 = 2 combinações
  return { bilhetes, custo: bilhetes.length * custoPorBilhete };
}

const ESTRATEGIAS: Record<string, (jogos: JogoPreparado[]) => { bilhetes: Bilhete[]; custo: number }> = {
  "A. Todos os favoritos": estrategiaA,
  "B. Fechamento atual (pares por ganho marginal)": (j) => estrategiaPares(j, (x) => x.scores.ganhoMarginal),
  "C. Duplo único nos maiores 2os colocados": (j) => estrategiaSingle(j, (x) => x.scores.ganhoMarginal),
  "D. Pares por entropia": (j) => estrategiaPares(j, (x) => x.scores.entropia),
  "E. Pares por diferença P1-P2": (j) => estrategiaPares(j, (x) => x.scores.diferencaP1P2),
  "F. Pares por valor heurístico": (j) => estrategiaPares(j, (x) => x.scores.valor),
};

interface Acumulador {
  totalHits: number;
  totalJogos: number;
  totalCusto: number;
  concursos12mais: number;
  concursos13mais: number;
}

function novoAcumulador(): Acumulador {
  return { totalHits: 0, totalJogos: 0, totalCusto: 0, concursos12mais: 0, concursos13mais: 0 };
}

function registrar(acc: Acumulador, hits: number, totalJogos: number, custo: number): void {
  acc.totalHits += hits;
  acc.totalJogos += totalJogos;
  acc.totalCusto += custo;
  if (hits >= 12) acc.concursos12mais++;
  if (hits >= 13) acc.concursos13mais++;
}

function main(): void {
  const dataset = JSON.parse(readFileSync("./backtest/concursos-2026-sem-selecao.json", "utf-8")) as {
    concursos: Array<{ numero: number; jogos: JogoDataset[] }>;
  };
  const nConcursos = dataset.concursos.length;

  console.log(`=== Laboratório de estratégias (${nConcursos} concursos, sem seleção) ===\n`);
  console.log("| Estratégia | Custo total | Custo médio/concurso | Melhor bilhete: acerto médio | Concursos com ≥12 | Concursos com ≥13 |");
  console.log("|---|---|---|---|---|---|");

  const resultadosPorEstrategia = new Map<string, Acumulador>();
  for (const nome of Object.keys(ESTRATEGIAS)) resultadosPorEstrategia.set(nome, novoAcumulador());

  for (const concurso of dataset.concursos) {
    const jogos = prepararJogos(concurso.jogos);
    for (const [nome, fn] of Object.entries(ESTRATEGIAS)) {
      const { bilhetes, custo } = fn(jogos);
      registrar(resultadosPorEstrategia.get(nome)!, melhorBilhete(bilhetes, jogos), jogos.length, custo);
    }
  }

  for (const [nome, acc] of resultadosPorEstrategia) {
    const custoMedio = acc.totalCusto / nConcursos;
    const acertoMedio = (acc.totalHits / acc.totalJogos) * 100;
    console.log(
      `| ${nome} | R$${acc.totalCusto.toFixed(2)} | R$${custoMedio.toFixed(2)} | ${acertoMedio.toFixed(1)}% | ${acc.concursos12mais}/${nConcursos} | ${acc.concursos13mais}/${nConcursos} |`
    );
  }

  // --- Sweep de orçamento: quanto cobrir (N jogos protegidos, cobertura em pares) muda o resultado? ---
  console.log(`\n=== E se a gente gastar mais? (N = quantos jogos entram na cobertura pareada) ===\n`);
  console.log("| N protegidos | Custo médio/concurso | Ganho marginal: acerto médio | Valor heurístico: acerto médio |");
  console.log("|---|---|---|---|");

  for (const n of [4, 6, 8, 10, 12, 14]) {
    const accGanho = novoAcumulador();
    const accValor = novoAcumulador();

    for (const concurso of dataset.concursos) {
      const jogos = prepararJogos(concurso.jogos);
      const resGanho = estrategiaPares(jogos, (x) => x.scores.ganhoMarginal, n);
      const resValor = estrategiaPares(jogos, (x) => x.scores.valor, n);
      registrar(accGanho, melhorBilhete(resGanho.bilhetes, jogos), jogos.length, resGanho.custo);
      registrar(accValor, melhorBilhete(resValor.bilhetes, jogos), jogos.length, resValor.custo);
    }

    const fmt = (acc: Acumulador) =>
      `${((acc.totalHits / acc.totalJogos) * 100).toFixed(1)}% (≥12: ${acc.concursos12mais}, ≥13: ${acc.concursos13mais})`;

    console.log(`| ${n} | R$${(accGanho.totalCusto / nConcursos).toFixed(2)} | ${fmt(accGanho)} | ${fmt(accValor)} |`);
  }
}

main();
