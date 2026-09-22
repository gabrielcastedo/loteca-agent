import type { JogoComOdds, LotecaJogo, OddsJogo } from "../types.js";

/**
 * A Caixa e a Odds API não usam os mesmos nomes de time. Validado ao vivo
 * em 2026-09-21 (concurso 1271) contra times reais coletados da Odds API:
 * - A Caixa manda "BRAGANTINO" puro; a Odds API usa "Bragantino-SP".
 * - A Caixa manda "ATLETICO" puro pra Atlético-MG, Atlético-PR e
 *   Atlético-GO — só dá pra diferenciar usando o campo `ufCasa`/
 *   `ufVisitante` que a própria Caixa fornece. Por isso overrides
 *   ambíguos usam a chave composta "NOME|UF" (ver `resolverNome`).
 *
 * Isso é o maior ponto de atrito prático do projeto — continue validando
 * concurso a concurso e alimentando os mapas abaixo conforme encontrar
 * divergências (o script `src/scratch-test-matcher.ts` ajuda nisso).
 */
const MANUAL_OVERRIDES: Record<string, string> = {
  // "nome normalizado na Loteca": "nome normalizado na Odds API"
  "BRAGANTINO": "BRAGANTINO SP",
  "GREMIO": "GREMIO FOOTBALL PORTO ALEGRENSE",
  // adicione conforme for validando concursos reais
};

/** Overrides que só se aplicam quando combinados com a UF do time (nomes ambíguos). */
const MANUAL_OVERRIDES_POR_UF: Record<string, string> = {
  // "NOME|UF na Loteca": "nome normalizado na Odds API"
  "ATLETICO|MG": "ATLETICO MINEIRO",
  "ATLETICO|PR": "ATLETICO PARANAENSE",
  "ATLETICO|GO": "ATLETICO GOIANIENSE",
};

/**
 * Casa cada jogo da Loteca com sua linha de odds correspondente.
 * Estratégia da Fase 1: normalização + exact match + overrides manuais.
 * Isso é propositalmente simples — fuzzy matching (ex: Levenshtein) só
 * compensa depois que os overrides manuais mostrarem os padrões reais de
 * divergência de nomes.
 */
export function matchJogosComOdds(
  jogos: LotecaJogo[],
  odds: OddsJogo[]
): JogoComOdds[] {
  return jogos.map((jogo) => {
    const candidato = encontrarOdds(jogo, odds);
    return {
      jogo,
      odds: candidato?.odds ?? null,
      matchConfidence: candidato?.confidence ?? 0,
    };
  });
}

function encontrarOdds(
  jogo: LotecaJogo,
  odds: OddsJogo[]
): { odds: OddsJogo; confidence: number } | null {
  const casaAlvo = resolverNome(jogo.equipeCasa, jogo.ufCasa);
  const visitanteAlvo = resolverNome(jogo.equipeVisitante, jogo.ufVisitante);

  for (const linha of odds) {
    const casaOdds = normalizar(linha.timeCasa);
    const visitanteOdds = normalizar(linha.timeVisitante);

    if (casaOdds === casaAlvo && visitanteOdds === visitanteAlvo) {
      return { odds: linha, confidence: 1 };
    }
  }

  // Segunda tentativa: mando de campo invertido entre as fontes (acontece
  // em jogos internacionais listados de forma diferente por cada provedor).
  for (const linha of odds) {
    const casaOdds = normalizar(linha.timeCasa);
    const visitanteOdds = normalizar(linha.timeVisitante);

    if (casaOdds === visitanteAlvo && visitanteOdds === casaAlvo) {
      return { odds: linha, confidence: 0.6 };
    }
  }

  return null;
}

function resolverNome(nomeLoteca: string, uf?: string): string {
  const normalizado = normalizar(nomeLoteca);

  if (uf) {
    const overridePorUf = MANUAL_OVERRIDES_POR_UF[`${normalizado}|${uf.toUpperCase()}`];
    if (overridePorUf) return normalizar(overridePorUf);
  }

  const override = MANUAL_OVERRIDES[normalizado];
  return override ? normalizar(override) : normalizado;
}

function normalizar(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-zA-Z0-9 ]/g, " ") // troca pontuação por espaço (ex: "Bragantino-SP" -> "Bragantino SP")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}
