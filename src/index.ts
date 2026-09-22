import "dotenv/config";
import { fetchConcursoAtual } from "./data/fixtures.js";
import { fetchOddsTodosCampeonatos } from "./data/odds.js";
import { matchJogosComOdds } from "./data/matcher.js";
import { openDb, salvarConcursoComOdds } from "./db/schema.js";
import type { JogoComOdds } from "./types.js";

async function main() {
  const apiKey = process.env.ODDS_API_KEY;
  const region = process.env.ODDS_API_REGION ?? "eu";
  const dbPath = process.env.DB_PATH ?? "./data/loteca.db";

  if (!apiKey || apiKey === "coloque_sua_chave_aqui") {
    console.error(
      "ODDS_API_KEY não configurada. Copie .env.example para .env e preencha sua chave " +
        "(gratuita em https://the-odds-api.com)."
    );
    process.exit(1);
  }

  console.log("1/4 — Buscando grade do concurso atual da Loteca...");
  const concurso = await fetchConcursoAtual();
  console.log(`     Concurso ${concurso.numero}: ${concurso.jogos.length} jogos encontrados.`);

  console.log("2/4 — Buscando odds dos campeonatos relevantes...");
  const odds = await fetchOddsTodosCampeonatos(apiKey, region);
  console.log(`     ${odds.length} linhas de odds coletadas (jogo x bookmaker).`);

  console.log("3/4 — Casando jogos da Loteca com odds de mercado...");
  const jogosComOdds = matchJogosComOdds(concurso.jogos, odds);
  const semMatch = jogosComOdds.filter((j) => !j.odds).length;
  if (semMatch > 0) {
    console.warn(
      `     Aviso: ${semMatch} de ${jogosComOdds.length} jogos ficaram sem odds correspondentes. ` +
        `Provavelmente são times de divisões que a Odds API não cobre, ou nome não bate — ` +
        `veja src/data/matcher.ts (MANUAL_OVERRIDES).`
    );
  }

  console.log("4/4 — Salvando no banco local...");
  const db = openDb(dbPath);
  salvarConcursoComOdds(db, concurso, jogosComOdds);
  db.close();

  imprimirRelatorio(concurso.numero, jogosComOdds);
}

function imprimirRelatorio(concursoNumero: number, jogos: JogoComOdds[]): void {
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

    console.log(
      `${label}${confAviso}\n` +
        `    odds  (${odds.bookmaker}): 1=${odds.oddCasa.toFixed(2)}  X=${odds.oddEmpate.toFixed(2)}  2=${odds.oddVisitante.toFixed(2)}\n` +
        `    prob. implícita:         1=${(probs.casa * 100).toFixed(1)}%  X=${(probs.empate * 100).toFixed(1)}%  2=${(probs.visitante * 100).toFixed(1)}%\n`
    );
  }
}

/** Remove o overround (margem da casa) das odds decimais, retornando probabilidades que somam 100%. */
function probabilidadesImplicitas(oddCasa: number, oddEmpate: number, oddVisitante: number) {
  const bruta = { casa: 1 / oddCasa, empate: 1 / oddEmpate, visitante: 1 / oddVisitante };
  const soma = bruta.casa + bruta.empate + bruta.visitante;
  return {
    casa: bruta.casa / soma,
    empate: bruta.empate / soma,
    visitante: bruta.visitante / soma,
  };
}

main().catch((err) => {
  console.error("Erro na execução:", err);
  process.exit(1);
});
