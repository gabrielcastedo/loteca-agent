import { classificarPrioridade } from "./otimizador.js";
import type { JogoParaOtimizar, Resultado } from "./otimizador.js";

export interface MarcacaoBilhete {
  sequencial: number;
  equipeCasa: string;
  equipeVisitante: string;
  marcacoes: Resultado[]; // 1 valor (fixo/"seco") ou 2 valores (duplo de cobertura neste bilhete)
}

export interface BilheteFechamento {
  numero: number;
  /** Quais jogos receberam duplo de cobertura neste bilhete (1 ou 2, conforme o nível de cobertura). */
  jogosDeCoberturaSequenciais: number[];
  marcacoes: MarcacaoBilhete[]; // as marcações completas (todos os jogos)
}

export interface ResultadoFechamento {
  bilhetes: BilheteFechamento[];
  custoTotalReais: number;
  jogosDeRiscoSequenciais: number[];
}

const PRECO_POR_COMBINACAO_REAIS = 2;

/**
 * Gera um "fechamento" de cobertura: em vez de 1 cartão com vários
 * duplos/triplos (produto cartesiano — Fase 4), monta N bilhetes
 * separados, cada um com o palpite favorito em todos os jogos EXCETO até
 * 2 "jogos de risco" (Prioridade Alta ou Média — ver `classificarPrioridade`),
 * que recebem duplo cobrindo favorito + segundo colocado. Um bilhete pra
 * cada PAR possível de jogos de risco.
 *
 * Cobre exatamente: "o resultado real bate com o favorito em todos os
 * jogos, ou desvia (pro segundo colocado) em até 2 dos jogos de risco
 * simultaneamente". NÃO cobre: 3+ jogos de risco desviando ao mesmo
 * tempo, o terceiro colocado em qualquer jogo, ou QUALQUER desvio nos
 * jogos que não são de risco (esses ficam fixos/"secos" em todos os
 * bilhetes — se um deles falhar, todos os bilhetes erram junto).
 *
 * Isso é uma garantia COMBINATÓRIA condicional, não uma probabilidade —
 * ver `simularFechamento` em `monteCarlo.ts` pra saber a chance real
 * estimada de isso realmente acontecer.
 */
export function gerarFechamento(jogos: JogoParaOtimizar[]): ResultadoFechamento {
  const prioridades = classificarPrioridade(jogos);
  const jogosDeRisco = jogos.filter((j) => {
    const p = prioridades.get(j.sequencial);
    return p === "alta" || p === "media";
  });

  if (jogosDeRisco.length < 2) {
    return { bilhetes: [], custoTotalReais: 0, jogosDeRiscoSequenciais: jogosDeRisco.map((j) => j.sequencial) };
  }

  const rankingPorSequencial = new Map(
    jogos.map((j) => [
      j.sequencial,
      (["casa", "empate", "visitante"] as Resultado[])
        .map((r) => ({ resultado: r, prob: j.probabilidade[r] }))
        .sort((a, b) => b.prob - a.prob),
    ])
  );

  const pares: Array<[JogoParaOtimizar, JogoParaOtimizar]> = [];
  for (let i = 0; i < jogosDeRisco.length; i++) {
    for (let j = i + 1; j < jogosDeRisco.length; j++) {
      pares.push([jogosDeRisco[i], jogosDeRisco[j]]);
    }
  }

  const bilhetes: BilheteFechamento[] = pares.map(([jogoA, jogoB], indice) => {
    const jogosDeCobertura = new Set([jogoA.sequencial, jogoB.sequencial]);

    const marcacoes: MarcacaoBilhete[] = jogos.map((j) => {
      const ranking = rankingPorSequencial.get(j.sequencial)!;
      const ehJogoDeCobertura = jogosDeCobertura.has(j.sequencial);
      return {
        sequencial: j.sequencial,
        equipeCasa: j.equipeCasa,
        equipeVisitante: j.equipeVisitante,
        marcacoes: ehJogoDeCobertura ? [ranking[0].resultado, ranking[1].resultado] : [ranking[0].resultado],
      };
    });

    return {
      numero: indice + 1,
      jogosDeCoberturaSequenciais: [jogoA.sequencial, jogoB.sequencial],
      marcacoes,
    };
  });

  // Cada bilhete tem 2 duplos = 2^2 = 4 combinações.
  const custoPorBilhete = 4 * PRECO_POR_COMBINACAO_REAIS;

  return {
    bilhetes,
    custoTotalReais: bilhetes.length * custoPorBilhete,
    jogosDeRiscoSequenciais: jogosDeRisco.map((j) => j.sequencial),
  };
}
