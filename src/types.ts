/**
 * Um jogo dentro da grade de 14 jogos de um concurso da Loteca.
 */
export interface LotecaJogo {
  concursoNumero: number;
  sequencial: number; // posição do jogo na cartela (1 a 14)
  equipeCasa: string;
  equipeVisitante: string;
  ufCasa?: string;
  ufVisitante?: string;
  dataHora?: string; // ISO, quando disponível
  campeonato?: string; // nem sempre vem na API — pode precisar inferir
}

/**
 * Metadados do concurso (janela de apostas, prêmio estimado etc).
 */
export interface LotecaConcurso {
  numero: number;
  dataApuracao?: string;
  dataProximoConcurso?: string;
  valorEstimadoProximoConcurso?: number;
  jogos: LotecaJogo[];
}

/** Odds completas (1/X/2) de uma única casa de apostas pra um jogo. */
export interface OddsPorCasa {
  bookmaker: string;
  oddCasa: number;
  oddEmpate: number;
  oddVisitante: number;
}

/** Probabilidades implícitas de mercado para um jogo, já sem overround. */
export interface OddsJogo {
  // nomes dos times exatamente como vieram da odds API (podem diferir da Loteca)
  timeCasa: string;
  timeVisitante: string;
  comeceEm?: string; // kickoff ISO
  bookmaker: string; // legenda de qual casa deu a "melhor odd" de cada mercado (ver oddCasa/oddEmpate/oddVisitante) — só referência de preço
  oddCasa: number;
  oddEmpate: number;
  oddVisitante: number;
  /**
   * Odds individuais por casa, quando a fonte expõe isso (hoje só o
   * odds.show — ver `src/data/oddsShow.ts`). Quando presente, a
   * probabilidade implícita (`src/probability.ts`) usa a média entre casas
   * em vez de misturar a melhor odd de cada mercado (que pode vir de casas
   * diferentes e "some" o viés/overround de cada uma) — ver P2 em
   * `docs/plano-melhorias.md`.
   */
  porCasa?: OddsPorCasa[];
}

/** Resultado do casamento entre um jogo da Loteca e suas odds de mercado. */
export interface JogoComOdds {
  jogo: LotecaJogo;
  odds: OddsJogo | null; // null = não foi possível casar com nenhuma fonte de odds
  matchConfidence: number; // 0 a 1 — quão confiável foi o casamento de nomes
}

/**
 * Fase 2: nível de impacto de desfalques (lesões, suspensões etc.) que um
 * time pode ter no próximo jogo, conforme avaliado a partir de notícias
 * recentes.
 */
export type NivelImpacto = "nenhum" | "baixo" | "medio" | "alto";

/** Análise de desfalque de um time específico pra um jogo específico. */
export interface DesfalqueAnalise {
  time: string;
  impacto: NivelImpacto;
  motivo: string;
}

/** Probabilidade implícita de mercado, sem overround (soma = 1). */
export interface ProbabilidadePura {
  casa: number;
  empate: number;
  visitante: number;
}

/**
 * Fase 3: estimativa heurística de quanto cada resultado (1/X/2) tende a
 * ser marcado por apostadores casuais (soma = 1). Não é uma medição real —
 * não existe dado público de popularidade por jogo na Loteca. Ver
 * `src/analysis/popularidade.ts`.
 */
export type PopularidadeEstimada = ProbabilidadePura;
