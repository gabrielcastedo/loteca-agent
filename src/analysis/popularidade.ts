import type { LotecaJogo, PopularidadeEstimada, ProbabilidadePura } from "../types.js";
import { TAXA_HISTORICA } from "./historico.js";

/**
 * IMPORTANTE: não existe dado público sobre quantos apostadores marcam
 * cada resultado por jogo na Loteca (pesquisado — só existe número de
 * acertadores por faixa no cartão inteiro, não por jogo). Isso é uma
 * HEURÍSTICA baseada em três padrões conhecidos de comportamento de
 * apostador casual em bolões esportivos, não uma estimativa calibrada com
 * dados reais:
 *
 * 1. Empate é sistematicamente sub-apostado — apostador casual evita
 *    marcar X mesmo quando é estatisticamente a aposta mais segura.
 * 2. Times de torcida grande recebem popularidade desproporcional à
 *    probabilidade real de vitória, por conta do tamanho da torcida.
 * 3. Apostador casual carrega uma intuição genérica tipo "mandante costuma
 *    ganhar" mesmo sem saber a odd daquele jogo específico — a marcação
 *    dele é parcialmente ancorada na taxa histórica real de 1/X/2 de todos
 *    os concursos (`TAXA_HISTORICA`, `src/analysis/historico.ts`), não só
 *    na probabilidade do jogo em questão.
 *
 * Os fatores abaixo são um chute inicial — não há como calibrar isso sem
 * dado de popularidade real (que não existe publicamente). Ajuste-os se
 * tiver uma fonte melhor (ex: pesquisa de torcida atualizada).
 */
const FATOR_SUBAPOSTA_EMPATE = 0.6;
const BONUS_TORCIDA_GRANDE = 1.25;

/**
 * Força da âncora histórica (0 = ignora completamente, 1 = pondera pela
 * razão histórica cheia). 0.5 é um meio-termo deliberado: a probabilidade
 * real do jogo específico continua sendo o sinal dominante, a taxa
 * histórica só empurra um pouco na direção do "senso comum" de bolão.
 */
const INFLUENCIA_HISTORICO = 0.5;
const NEUTRO = 1 / 3;

/** Quanto a taxa histórica daquele resultado desvia do neutro (1/3), moderado por `INFLUENCIA_HISTORICO`. */
function fatorHistorico(resultado: keyof ProbabilidadePura): number {
  return Math.pow(TAXA_HISTORICA[resultado] / NEUTRO, INFLUENCIA_HISTORICO);
}

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
  const pesoCasa =
    probabilidade.casa * (temTorcidaGrande(jogo.equipeCasa) ? BONUS_TORCIDA_GRANDE : 1) * fatorHistorico("casa");
  const pesoVisitante =
    probabilidade.visitante *
    (temTorcidaGrande(jogo.equipeVisitante) ? BONUS_TORCIDA_GRANDE : 1) *
    fatorHistorico("visitante");
  const pesoEmpate = probabilidade.empate * FATOR_SUBAPOSTA_EMPATE * fatorHistorico("empate");

  const soma = pesoCasa + pesoEmpate + pesoVisitante;

  return {
    casa: pesoCasa / soma,
    empate: pesoEmpate / soma,
    visitante: pesoVisitante / soma,
  };
}
