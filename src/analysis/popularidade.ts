import type { LotecaJogo, PopularidadeEstimada, ProbabilidadePura } from "../types.js";

/**
 * IMPORTANTE: não existe dado público sobre quantos apostadores marcam
 * cada resultado por jogo na Loteca (pesquisado — só existe número de
 * acertadores por faixa no cartão inteiro, não por jogo). Isso é uma
 * HEURÍSTICA baseada em dois padrões conhecidos de comportamento de
 * apostador casual em bolões esportivos, não uma estimativa calibrada com
 * dados reais:
 *
 * 1. Empate é sistematicamente sub-apostado — apostador casual evita
 *    marcar X mesmo quando é estatisticamente a aposta mais segura.
 * 2. Times de torcida grande recebem popularidade desproporcional à
 *    probabilidade real de vitória, por conta do tamanho da torcida.
 *
 * Os fatores abaixo são um chute inicial — não há como calibrar isso sem
 * dado de popularidade real (que não existe publicamente). Ajuste-os se
 * tiver uma fonte melhor (ex: pesquisa de torcida atualizada).
 */
const FATOR_SUBAPOSTA_EMPATE = 0.6;
const BONUS_TORCIDA_GRANDE = 1.25;

/**
 * Lista não-exaustiva dos times com maior torcida no Brasil, conforme
 * pesquisas de torcida (ex: Datafolha/Pluri, ordem aproximada, nomes
 * normalizados como no matcher). Time fora da lista não recebe bônus —
 * não significa que não tenha torcida grande, só que não foi incluído.
 */
const TORCIDAS_GRANDES = new Set([
  "FLAMENGO",
  "CORINTHIANS",
  "SAO PAULO",
  "PALMEIRAS",
  "VASCO DA GAMA",
  "CRUZEIRO",
  "GREMIO",
  "INTERNACIONAL",
  "ATLETICO", // cobre Atlético-MG/PR/GO sem distinguir — ok pro propósito de popularidade
  "SANTOS",
  "BAHIA",
  "BOTAFOGO",
]);

function normalizarNomeTime(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

function temTorcidaGrande(nomeTime: string): boolean {
  return TORCIDAS_GRANDES.has(normalizarNomeTime(nomeTime));
}

/**
 * Estima a popularidade de cada resultado (1/X/2) entre apostadores
 * casuais, a partir da probabilidade real (pura ou já ajustada pela Fase
 * 2). Isso é uma heurística, não uma medição — ver aviso acima.
 */
export function estimarPopularidade(
  probabilidade: ProbabilidadePura,
  jogo: Pick<LotecaJogo, "equipeCasa" | "equipeVisitante">
): PopularidadeEstimada {
  const pesoCasa = probabilidade.casa * (temTorcidaGrande(jogo.equipeCasa) ? BONUS_TORCIDA_GRANDE : 1);
  const pesoVisitante =
    probabilidade.visitante * (temTorcidaGrande(jogo.equipeVisitante) ? BONUS_TORCIDA_GRANDE : 1);
  const pesoEmpate = probabilidade.empate * FATOR_SUBAPOSTA_EMPATE;

  const soma = pesoCasa + pesoEmpate + pesoVisitante;

  return {
    casa: pesoCasa / soma,
    empate: pesoEmpate / soma,
    visitante: pesoVisitante / soma,
  };
}
