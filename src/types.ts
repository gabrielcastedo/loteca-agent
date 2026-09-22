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

/** Probabilidades implícitas de mercado para um jogo, já sem overround. */
export interface OddsJogo {
  // nomes dos times exatamente como vieram da odds API (podem diferir da Loteca)
  timeCasa: string;
  timeVisitante: string;
  comeceEm?: string; // kickoff ISO
  bookmaker: string;
  oddCasa: number;
  oddEmpate: number;
  oddVisitante: number;
}

/** Resultado do casamento entre um jogo da Loteca e suas odds de mercado. */
export interface JogoComOdds {
  jogo: LotecaJogo;
  odds: OddsJogo | null; // null = não foi possível casar com nenhuma fonte de odds
  matchConfidence: number; // 0 a 1 — quão confiável foi o casamento de nomes
}
