import "dotenv/config";
import { Anthropic } from "@anthropic-ai/sdk";
import { fetchConcursoAtual } from "./data/fixtures.js";
import { fetchOddsTodosCampeonatos } from "./data/odds.js";
import { fetchNoticiasTime } from "./data/news.js";
import { matchJogosComOdds } from "./data/matcher.js";
import { analisarDesfalques } from "./analysis/desfalques.js";
import { ajustarProbabilidade } from "./analysis/ajuste.js";
import { probabilidadesImplicitas } from "./probability.js";
import { openDb, salvarConcursoComOdds, salvarDesfalques } from "./db/schema.js";
import type { DesfalqueAnalise, JogoComOdds } from "./types.js";

async function main() {
  const apiKey = process.env.ODDS_API_KEY;
  const region = process.env.ODDS_API_REGION ?? "eu";
  const dbPath = process.env.DB_PATH ?? "./data/loteca.db";
  const newsApiKey = configurado(process.env.NEWSAPI_KEY);
  const anthropicApiKey = configurado(process.env.ANTHROPIC_API_KEY);
  const fase2Ativa = Boolean(newsApiKey && anthropicApiKey);

  if (!apiKey || apiKey === "coloque_sua_chave_aqui") {
    console.error(
      "ODDS_API_KEY não configurada. Copie .env.example para .env e preencha sua chave " +
        "(gratuita em https://the-odds-api.com)."
    );
    process.exit(1);
  }

  console.log("1/5 — Buscando grade do concurso atual da Loteca...");
  const concurso = await fetchConcursoAtual();
  console.log(`     Concurso ${concurso.numero}: ${concurso.jogos.length} jogos encontrados.`);

  console.log("2/5 — Buscando odds dos campeonatos relevantes...");
  const odds = await fetchOddsTodosCampeonatos(apiKey, region);
  console.log(`     ${odds.length} linhas de odds coletadas (jogo x bookmaker).`);

  console.log("3/5 — Casando jogos da Loteca com odds de mercado...");
  const jogosComOdds = matchJogosComOdds(concurso.jogos, odds);
  const semMatch = jogosComOdds.filter((j) => !j.odds).length;
  if (semMatch > 0) {
    console.warn(
      `     Aviso: ${semMatch} de ${jogosComOdds.length} jogos ficaram sem odds correspondentes. ` +
        `Provavelmente são times de divisões que a Odds API não cobre, ou nome não bate — ` +
        `veja src/data/matcher.ts (MANUAL_OVERRIDES).`
    );
  }

  let desfalquesPorSequencial = new Map<number, DesfalqueAnalise[]>();
  if (fase2Ativa) {
    console.log("4/5 — Buscando notícias e analisando desfalques (Fase 2)...");
    desfalquesPorSequencial = await analisarDesfalquesDoConcurso(jogosComOdds, newsApiKey!, anthropicApiKey!);
  } else {
    console.log(
      "4/5 — Pulando análise de desfalques: configure NEWSAPI_KEY e ANTHROPIC_API_KEY no .env pra ativar a Fase 2."
    );
  }

  console.log("5/5 — Salvando no banco local...");
  const db = openDb(dbPath);
  const idsPorSequencial = salvarConcursoComOdds(db, concurso, jogosComOdds);
  for (const [sequencial, analises] of desfalquesPorSequencial) {
    const jogoId = idsPorSequencial.get(sequencial);
    if (jogoId && analises.length > 0) {
      salvarDesfalques(db, jogoId, analises);
    }
  }
  db.close();

  imprimirRelatorio(concurso.numero, jogosComOdds, desfalquesPorSequencial);
}

/** Trata placeholders do .env.example como "não configurado". */
function configurado(valor: string | undefined): string | undefined {
  if (!valor || valor.startsWith("coloque_sua_chave")) return undefined;
  return valor;
}

/**
 * Busca notícias e classifica desfalques pra cada time envolvido em jogos
 * com odds (sem odds não há o que ajustar). Times repetidos são analisados
 * uma única vez por execução.
 */
async function analisarDesfalquesDoConcurso(
  jogosComOdds: JogoComOdds[],
  newsApiKey: string,
  anthropicApiKey: string
): Promise<Map<number, DesfalqueAnalise[]>> {
  const client = new Anthropic({ apiKey: anthropicApiKey });
  const cachePorTime = new Map<string, DesfalqueAnalise>();
  const resultado = new Map<number, DesfalqueAnalise[]>();

  for (const item of jogosComOdds) {
    if (!item.odds) continue;

    const analisesDoJogo: DesfalqueAnalise[] = [];
    for (const time of [item.jogo.equipeCasa, item.jogo.equipeVisitante]) {
      let analise = cachePorTime.get(time);
      if (!analise) {
        try {
          const noticias = await fetchNoticiasTime(time, newsApiKey);
          analise = await analisarDesfalques(time, noticias, client);
        } catch (err) {
          console.warn(`     Aviso: falha ao analisar desfalques de "${time}":`, err);
          analise = { time, impacto: "nenhum", motivo: "Falha na análise; assumindo sem impacto." };
        }
        cachePorTime.set(time, analise);
      }
      analisesDoJogo.push(analise);
    }

    resultado.set(item.jogo.sequencial, analisesDoJogo);
  }

  return resultado;
}

function imprimirRelatorio(
  concursoNumero: number,
  jogos: JogoComOdds[],
  desfalquesPorSequencial: Map<number, DesfalqueAnalise[]>
): void {
  console.log(`\n=== Concurso ${concursoNumero} — Grade x Odds ===\n`);

  for (const item of jogos) {
    const { jogo, odds, matchConfidence } = item;
    const label = `${String(jogo.sequencial).padStart(2, "0")}. ${jogo.equipeCasa} x ${jogo.equipeVisitante}`;

    if (!odds) {
      console.log(`${label}\n    (sem odds)\n`);
      continue;
    }

    const probs = probabilidadesImplicitas(odds.oddCasa, odds.oddEmpate, odds.oddVisitante);
    const confAviso = matchConfidence < 1 ? "  [match incerto]" : "";

    let linhaAjuste = "";
    const analises = desfalquesPorSequencial.get(jogo.sequencial);
    if (analises && analises.length === 2) {
      const [casaAn, visitanteAn] = analises;
      if (casaAn.impacto !== "nenhum" || visitanteAn.impacto !== "nenhum") {
        const ajustada = ajustarProbabilidade(probs, casaAn.impacto, visitanteAn.impacto);
        linhaAjuste =
          `    desfalques: ${jogo.equipeCasa}=${casaAn.impacto} (${casaAn.motivo})\n` +
          `                ${jogo.equipeVisitante}=${visitanteAn.impacto} (${visitanteAn.motivo})\n` +
          `    prob. ajustada:           1=${(ajustada.casa * 100).toFixed(1)}%  X=${(ajustada.empate * 100).toFixed(1)}%  2=${(ajustada.visitante * 100).toFixed(1)}%\n`;
      }
    }

    console.log(
      `${label}${confAviso}\n` +
        `    odds  (${odds.bookmaker}): 1=${odds.oddCasa.toFixed(2)}  X=${odds.oddEmpate.toFixed(2)}  2=${odds.oddVisitante.toFixed(2)}\n` +
        `    prob. implícita:         1=${(probs.casa * 100).toFixed(1)}%  X=${(probs.empate * 100).toFixed(1)}%  2=${(probs.visitante * 100).toFixed(1)}%\n` +
        linhaAjuste
    );
  }
}

main().catch((err) => {
  console.error("Erro na execução:", err);
  process.exit(1);
});
