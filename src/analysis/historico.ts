import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ProbabilidadePura } from "../types.js";

interface HistoricoLoteca {
  modalidade: string;
  atualizadoEm: string;
  ultimoConcurso: number;
  totalConcursos: number;
  concursos: [numero: number, data: string, resultado: string][];
}

const CAMINHO_HISTORICO = fileURLToPath(new URL("../data/historico-loteca.json", import.meta.url));

/**
 * Taxa histórica real de vitória do mandante/empate/visitante em todos os
 * jogos de todos os concursos da Loteca desde 2002 (dado público, arquivo
 * `src/data/historico-loteca.json`, calculado a partir de 1.261 concursos /
 * 17.654 jogos até 2026-09-21 — outra IA, a partir da mesma fonte de dados,
 * chegou aos mesmos números, o que confirma a aritmética mas não é uma
 * segunda fonte independente).
 *
 * Isso é a frequência REAL de resultados (não popularidade de aposta —
 * aquilo continua sem dado público, ver aviso em `popularidade.ts`). Serve
 * de âncora fraca pra "conhecimento popular" tipo "mandante costuma ganhar"
 * — o mesmo tipo de intuição genérica (não calibrada por jogo) que um
 * apostador casual carrega mesmo sem saber o número exato.
 */
export function carregarTaxaHistorica(): ProbabilidadePura {
  const raw = readFileSync(CAMINHO_HISTORICO, "utf-8");
  const historico: HistoricoLoteca = JSON.parse(raw);

  let casa = 0;
  let empate = 0;
  let visitante = 0;

  for (const [, , resultado] of historico.concursos) {
    for (const c of resultado) {
      if (c === "1") casa++;
      else if (c === "X") empate++;
      else if (c === "2") visitante++;
    }
  }

  const total = casa + empate + visitante;
  return { casa: casa / total, empate: empate / total, visitante: visitante / total };
}

/** Calculado uma vez no import — o arquivo histórico não muda durante a execução. */
export const TAXA_HISTORICA: ProbabilidadePura = carregarTaxaHistorica();
