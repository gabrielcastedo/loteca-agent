import type { OddsJogo } from "../types.js";

/**
 * The Odds API (https://the-odds-api.com) — tier gratuito cobre ~500
 * requisições/mês, o que é suficiente pra 1 chamada semanal por
 * campeonato relevante.
 *
 * Cada "sport key" cobre um campeonato. A Loteca mistura jogos de vários
 * campeonatos brasileiros e às vezes internacionais na mesma cartela, então
 * a Fase 1 busca odds de uma lista de campeonatos e depois casa (matching)
 * com os jogos da grade — ver src/data/matcher.ts.
 */
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

// Sport keys relevantes pra grade da Loteca. Ajuste conforme os campeonatos
// que aparecerem nos concursos reais — a lista completa está em
// GET /v4/sports?apiKey=... (endpoint gratuito, não consome cota de odds).
export const CAMPEONATOS_RELEVANTES = [
  "soccer_brazil_campeonato", // Brasileirão Série A
  "soccer_brazil_serie_b", // Brasileirão Série B
  "soccer_conmebol_copa_libertadores",
  "soccer_conmebol_copa_sudamericana",
  "soccer_spain_la_liga",
  "soccer_epl",
  "soccer_uefa_champs_league",
  // Eliminatórias de Copa do Mundo: existem como sport key mas aparecem como
  // "active: false" em GET /v4/sports (só via ?all=true) — testado ao vivo
  // em 2026-09-21 e retornou 0 eventos pro concurso 1272 (nenhum bookmaker
  // tinha posto linha ainda pra jogos como Gibraltar x Andorra). Gratuito,
  // sem custo extra — deixe aqui pra pegar caso populem mais perto do jogo.
  "soccer_fifa_world_cup_qualifiers_europe",
  "soccer_fifa_world_cup_qualifiers_south_america",
] as const;

interface OddsApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: Array<{
      key: string; // "h2h" = moneyline / vitória-empate-derrota
      outcomes: Array<{ name: string; price: number }>;
    }>;
  }>;
}

/**
 * Busca odds h2h (1x2) de um campeonato específico.
 * Retorna uma lista "achatada" — uma linha por (jogo, casa de apostas).
 * A escolha de qual bookmaker usar (ou fazer a média) fica pro matcher/modelo.
 */
export async function fetchOddsCampeonato(
  sportKey: string,
  apiKey: string,
  region: string = "eu"
): Promise<OddsJogo[]> {
  const url =
    `${ODDS_API_BASE}/sports/${sportKey}/odds/` +
    `?apiKey=${apiKey}&regions=${region}&markets=h2h&oddsFormat=decimal`;

  const res = await fetch(url);

  if (!res.ok) {
    // A Odds API retorna 401/422 com corpo explicando o erro — vale logar.
    const body = await res.text().catch(() => "");
    throw new Error(
      `Falha ao buscar odds de ${sportKey}: HTTP ${res.status}. ${body}`
    );
  }

  const events = (await res.json()) as OddsApiEvent[];
  return events.flatMap(eventToOddsJogos);
}

/**
 * Busca odds de todos os campeonatos em CAMPEONATOS_RELEVANTES.
 * Roda em série (não paralelo) para não estourar rate limit do tier gratuito.
 */
export async function fetchOddsTodosCampeonatos(
  apiKey: string,
  region: string = "eu"
): Promise<OddsJogo[]> {
  const resultado: OddsJogo[] = [];

  for (const sportKey of CAMPEONATOS_RELEVANTES) {
    try {
      const odds = await fetchOddsCampeonato(sportKey, apiKey, region);
      resultado.push(...odds);
    } catch (err) {
      // Um campeonato sem jogos na semana retorna lista vazia, não erro —
      // erro aqui geralmente é sport_key inválido ou cota estourada.
      console.warn(`Aviso: não foi possível buscar odds de ${sportKey}:`, err);
    }
  }

  return resultado;
}

function eventToOddsJogos(event: OddsApiEvent): OddsJogo[] {
  const linhas: OddsJogo[] = [];

  for (const bk of event.bookmakers) {
    const h2h = bk.markets.find((m) => m.key === "h2h");
    if (!h2h) continue;

    const casa = h2h.outcomes.find((o) => o.name === event.home_team);
    const fora = h2h.outcomes.find((o) => o.name === event.away_team);
    const empate = h2h.outcomes.find(
      (o) => o.name !== event.home_team && o.name !== event.away_team
    );

    // Sem os três resultados não dá pra calcular probabilidade do 1x2 completo.
    if (!casa || !fora || !empate) continue;

    linhas.push({
      timeCasa: event.home_team,
      timeVisitante: event.away_team,
      comeceEm: event.commence_time,
      bookmaker: bk.title,
      oddCasa: casa.price,
      oddEmpate: empate.price,
      oddVisitante: fora.price,
    });
  }

  return linhas;
}
