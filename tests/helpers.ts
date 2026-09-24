import type { JogoParaOtimizar } from "../src/analysis/otimizador.js";

/**
 * Gera N jogos sintéticos com "ganho marginal" (probabilidade do 2º
 * colocado) estritamente decrescente por sequencial — sequencial 1 tem o
 * maior ganho marginal, sequencial N o menor, sem empates entre jogos.
 *
 * `casa` fica fixo como sempre o favorito absoluto (maior dos 3), `empate`
 * varia dentro de uma faixa controlada pelo chamador (sempre menor que
 * `casa` e maior que `visitante`, que absorve o resto) — assim o 2º
 * colocado do ranking é sempre o empate, na ordem esperada, e dá pra testar
 * cenários com escalas bem diferentes (rodada "equilibrada" vs. "cheia de
 * favoritos óbvios") só variando `casa`/`empateTopo`/`empateBase`.
 */
export function jogosComPrioridadePrevisivel(
  n: number,
  casa: number,
  empateTopo: number,
  empateBase: number
): JogoParaOtimizar[] {
  if (empateTopo <= empateBase) throw new Error("empateTopo deve ser > empateBase");
  if (casa <= empateTopo) throw new Error("casa deve ser o maior valor (favorito)");

  const passo = n > 1 ? (empateTopo - empateBase) / (n - 1) : 0;

  return Array.from({ length: n }, (_, i) => {
    const empate = empateTopo - i * passo;
    const visitante = 1 - casa - empate;

    if (!(casa > empate && empate > visitante && visitante > 0)) {
      throw new Error(
        `Construção inválida no jogo ${i + 1}: casa=${casa} empate=${empate} visitante=${visitante} ` +
          `— precisa casa > empate > visitante > 0 pra ordem ficar previsível.`
      );
    }

    return {
      sequencial: i + 1,
      equipeCasa: `CASA${i + 1}`,
      equipeVisitante: `VISITANTE${i + 1}`,
      probabilidade: { casa, empate, visitante },
    };
  });
}
