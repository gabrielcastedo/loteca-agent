import type { CenarioCartao, Resultado, ResultadoOtimizacao } from "./otimizador.js";
import type { BilheteFechamento } from "./fechamento.js";
import type { ProbabilidadePura } from "../types.js";

export interface ResultadoMonteCarlo {
  numSimulacoes: number;
  /** Pode ser < 14 se algum jogo do cartão ficou sem odds (fora da simulação). */
  totalJogosSimulados: number;
  /** % de simulações em que o cartão acertou todos os jogos simulados. */
  pctTodosOsJogos: number;
  /** % de simulações em que o cartão errou no máximo 1 jogo. */
  pctNoMaximoUmErro: number;
  /** Nº de acertos -> quantidade de simulações com esse total. */
  distribuicaoAcertos: Record<number, number>;
}

export interface CenarioComSimulacao extends CenarioCartao {
  monteCarlo: ResultadoMonteCarlo | null;
}

const NUM_SIMULACOES_PADRAO = 20000;

/**
 * Simula N rodadas aleatórias (sorteando cada jogo pela probabilidade
 * final que o próprio modelo calculou) e mede quantos acertos o cartão
 * sugerido teria em cada uma.
 *
 * IMPORTANTE: isso NÃO é uma validação externa do modelo — é uma leitura
 * estatística do que o modelo já acha. Se a probabilidade estimada
 * estiver errada, a simulação herda o mesmo erro (garbage in, garbage
 * out). Responde "dado o que o modelo calculou, qual a chance desse
 * cartão específico bater 13/14?", não "o modelo está certo?" — isso é o
 * P0 do plano de melhorias (`docs/plano-melhorias.md`): comparar contra
 * resultado real depois da apuração.
 *
 * Só simula os jogos que entraram no cartão (com odds); jogos sem odds
 * ficam de fora e `totalJogosSimulados` reflete isso — os percentuais só
 * correspondem aos acertos oficiais de 13/14 quando os 14 jogos tiverem
 * odds.
 */
export function simularCartao(
  cartao: ResultadoOtimizacao,
  probabilidadesPorSequencial: Map<number, ProbabilidadePura>,
  numSimulacoes: number = NUM_SIMULACOES_PADRAO
): ResultadoMonteCarlo | null {
  const jogos = cartao.alocacoes
    .map((a) => {
      const prob = probabilidadesPorSequencial.get(a.sequencial);
      return prob ? { marcacoes: new Set(a.marcacoes), prob } : null;
    })
    .filter((j): j is { marcacoes: Set<Resultado>; prob: ProbabilidadePura } => j !== null);

  if (jogos.length === 0) return null;

  const distribuicaoAcertos: Record<number, number> = {};

  for (let s = 0; s < numSimulacoes; s++) {
    let acertos = 0;
    for (const jogo of jogos) {
      if (jogo.marcacoes.has(sortearResultado(jogo.prob))) acertos++;
    }
    distribuicaoAcertos[acertos] = (distribuicaoAcertos[acertos] ?? 0) + 1;
  }

  const total = jogos.length;
  const contarComAcertosMinimo = (minimo: number) =>
    Object.entries(distribuicaoAcertos).reduce(
      (soma, [acertos, qtd]) => (Number(acertos) >= minimo ? soma + qtd : soma),
      0
    );

  return {
    numSimulacoes,
    totalJogosSimulados: total,
    pctTodosOsJogos: ((distribuicaoAcertos[total] ?? 0) / numSimulacoes) * 100,
    pctNoMaximoUmErro: (contarComAcertosMinimo(total - 1) / numSimulacoes) * 100,
    distribuicaoAcertos,
  };
}

function sortearResultado(p: ProbabilidadePura): Resultado {
  const r = Math.random();
  if (r < p.casa) return "casa";
  if (r < p.casa + p.empate) return "empate";
  return "visitante";
}

/**
 * Simula N rodadas e mede, em cada uma, o MELHOR resultado entre todos os
 * bilhetes do fechamento (o de mais acertos) — é assim que um fechamento
 * de verdade funciona: você ganha pelo bilhete que mais acertou, não por
 * todos juntos.
 *
 * Essa é a chance REAL do fechamento, em contraste com uma "garantia" de
 * cobertura combinatória (que só vale se os jogos fixos/"secos" também
 * acertarem — ver aviso em `gerarFechamento`). Sorteia a rodada UMA vez
 * por simulação e testa todos os bilhetes contra o MESMO sorteio, porque
 * é assim que funciona na vida real (um concurso só, vários bilhetes).
 */
export function simularFechamento(
  bilhetes: BilheteFechamento[],
  probabilidadesPorSequencial: Map<number, ProbabilidadePura>,
  numSimulacoes: number = NUM_SIMULACOES_PADRAO
): ResultadoMonteCarlo | null {
  if (bilhetes.length === 0) return null;

  const bilhetesProcessados = bilhetes.map((b) =>
    b.marcacoes
      .map((m) => {
        const prob = probabilidadesPorSequencial.get(m.sequencial);
        return prob ? { marcacoes: new Set(m.marcacoes), prob } : null;
      })
      .filter((x): x is { marcacoes: Set<Resultado>; prob: ProbabilidadePura } => x !== null)
  );

  const total = bilhetesProcessados[0]?.length ?? 0;
  if (total === 0) return null;

  const distribuicaoAcertos: Record<number, number> = {};

  for (let s = 0; s < numSimulacoes; s++) {
    const sorteio = bilhetesProcessados[0].map((item) => sortearResultado(item.prob));

    let melhorBilhete = 0;
    for (const bilhete of bilhetesProcessados) {
      let acertos = 0;
      for (let i = 0; i < bilhete.length; i++) {
        if (bilhete[i].marcacoes.has(sorteio[i])) acertos++;
      }
      if (acertos > melhorBilhete) melhorBilhete = acertos;
    }

    distribuicaoAcertos[melhorBilhete] = (distribuicaoAcertos[melhorBilhete] ?? 0) + 1;
  }

  const contarComAcertosMinimo = (minimo: number) =>
    Object.entries(distribuicaoAcertos).reduce(
      (soma, [acertos, qtd]) => (Number(acertos) >= minimo ? soma + qtd : soma),
      0
    );

  return {
    numSimulacoes,
    totalJogosSimulados: total,
    pctTodosOsJogos: ((distribuicaoAcertos[total] ?? 0) / numSimulacoes) * 100,
    pctNoMaximoUmErro: (contarComAcertosMinimo(total - 1) / numSimulacoes) * 100,
    distribuicaoAcertos,
  };
}
