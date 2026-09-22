import type { ProbabilidadePura } from "../types.js";

export type TipoAposta = "simples" | "duplo" | "triplo";
export type Resultado = "casa" | "empate" | "visitante";

export interface JogoParaOtimizar {
  sequencial: number;
  equipeCasa: string;
  equipeVisitante: string;
  probabilidade: ProbabilidadePura;
}

export interface AlocacaoJogo {
  sequencial: number;
  equipeCasa: string;
  equipeVisitante: string;
  tipo: TipoAposta;
  marcacoes: Resultado[]; // ordenadas da maior pra menor probabilidade
}

export interface ResultadoOtimizacao {
  alocacoes: AlocacaoJogo[];
  totalCombinacoes: number;
  custoReais: number;
}

/**
 * R$2,00 por combinação, confirmado em múltiplas fontes ao pesquisar (ver
 * README). O teto de duplos/triplos por cartão NÃO está confirmado (fontes
 * divergem) — este otimizador só respeita o orçamento em reais, não impõe
 * limite de quantidade. Confira o limite atual no site/app da Caixa antes
 * de finalizar uma aposta real.
 */
const PRECO_POR_COMBINACAO = 2;
const APOSTA_MINIMA_REAIS = 4;

const QTD_MARCACOES: Record<TipoAposta, number> = { simples: 1, duplo: 2, triplo: 3 };

interface RankingJogo {
  jogo: JogoParaOtimizar;
  ordenado: Array<{ resultado: Resultado; prob: number }>;
}

interface CandidatoUpgrade {
  para: TipoAposta;
  ganho: number; // probabilidade adicional capturada ao aplicar o upgrade
  fatorIncremento: number; // quanto o total de combinações multiplica (2 ou 1.5)
}

/**
 * Aloca duplos/triplos entre os jogos disponíveis (com probabilidade já
 * calculada) pra maximizar a cobertura de probabilidade dentro de um
 * orçamento em reais.
 *
 * Algoritmo guloso: a cada passo, escolhe o upgrade (simples→duplo ou
 * duplo→triplo, em qualquer jogo) com maior "ganho de probabilidade por
 * unidade de orçamento combinatório gasto" (log2 do fator de multiplicação),
 * entre os que ainda cabem no orçamento, e aplica. Repete até não caber
 * mais nenhum upgrade.
 *
 * Isso NÃO é uma otimização exata — o custo é multiplicativo (2^duplos ×
 * 3^triplos), então o problema é uma mochila não-linear sem solução
 * gulosa provadamente ótima. É uma heurística simples e auditável,
 * suficiente pro objetivo do projeto (ver `simples`-first: a escolha
 * principal de cada jogo é sempre o resultado de maior probabilidade real,
 * não o de melhor "valor" da Fase 3 — misturar os dois objetivos exigiria
 * dado de popularidade real que não temos, ver `popularidade.ts`).
 *
 * Jogos sem probabilidade calculada (sem odds) devem ser filtrados pelo
 * chamador antes de passar pra esta função — ficam de fora do cartão
 * otimizado e precisam de escolha manual.
 */
export function otimizarCartao(jogos: JogoParaOtimizar[], orcamentoReais: number): ResultadoOtimizacao {
  if (orcamentoReais < APOSTA_MINIMA_REAIS) {
    throw new Error(
      `Orçamento de R$${orcamentoReais.toFixed(2)} é menor que a aposta mínima da Loteca (R$${APOSTA_MINIMA_REAIS.toFixed(2)}).`
    );
  }

  const maxCombinacoes = Math.floor(orcamentoReais / PRECO_POR_COMBINACAO);

  const rankings: RankingJogo[] = jogos.map((jogo) => ({
    jogo,
    ordenado: (["casa", "empate", "visitante"] as Resultado[])
      .map((resultado) => ({ resultado, prob: jogo.probabilidade[resultado] }))
      .sort((a, b) => b.prob - a.prob),
  }));

  const tipos: TipoAposta[] = rankings.map(() => "simples");
  let duplos = 0;
  let triplos = 0;

  const combinacoes = (d: number, t: number) => 2 ** d * 3 ** t;

  function proximoCandidato(indice: number): CandidatoUpgrade | null {
    const tipo = tipos[indice];
    const ranking = rankings[indice].ordenado;
    if (tipo === "simples") {
      return { para: "duplo", ganho: ranking[1].prob, fatorIncremento: 2 };
    }
    if (tipo === "duplo") {
      return { para: "triplo", ganho: ranking[2].prob, fatorIncremento: 1.5 };
    }
    return null;
  }

  while (true) {
    let melhorIndice = -1;
    let melhorScore = -Infinity;
    let melhorDuplos = duplos;
    let melhorTriplos = triplos;
    let melhorPara: TipoAposta = "simples";

    for (let i = 0; i < tipos.length; i++) {
      const candidato = proximoCandidato(i);
      if (!candidato) continue;

      const novoDuplos = candidato.para === "duplo" ? duplos + 1 : duplos - 1;
      const novoTriplos = candidato.para === "triplo" ? triplos + 1 : triplos;
      if (combinacoes(novoDuplos, novoTriplos) > maxCombinacoes) continue;

      const score = candidato.ganho / Math.log2(candidato.fatorIncremento);
      if (score > melhorScore) {
        melhorScore = score;
        melhorIndice = i;
        melhorDuplos = novoDuplos;
        melhorTriplos = novoTriplos;
        melhorPara = candidato.para;
      }
    }

    if (melhorIndice === -1) break;

    tipos[melhorIndice] = melhorPara;
    duplos = melhorDuplos;
    triplos = melhorTriplos;
  }

  const alocacoes: AlocacaoJogo[] = rankings.map((r, i) => ({
    sequencial: r.jogo.sequencial,
    equipeCasa: r.jogo.equipeCasa,
    equipeVisitante: r.jogo.equipeVisitante,
    tipo: tipos[i],
    marcacoes: r.ordenado.slice(0, QTD_MARCACOES[tipos[i]]).map((o) => o.resultado),
  }));

  const totalCombinacoes = combinacoes(duplos, triplos);

  return {
    alocacoes,
    totalCombinacoes,
    custoReais: totalCombinacoes * PRECO_POR_COMBINACAO,
  };
}
