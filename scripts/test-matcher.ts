import "dotenv/config";
import { fetchConcursoPorNumero } from "../src/data/fixtures.js";
import { fetchOddsTodosCampeonatos } from "../src/data/odds.js";
import { matchJogosComOdds } from "../src/data/matcher.js";

/**
 * Ferramenta de apoio pra validar o matcher contra dados reais sem esperar
 * um concurso estar aberto pra apostas. Aceita um número de concurso (pode
 * já estar encerrado — serve só pra conferir os nomes, não as odds em si).
 *
 * Uso: npx ts-node --esm scripts/test-matcher.ts [numeroDoConcurso]
 */
async function main() {
  const apiKey = process.env.ODDS_API_KEY!;
  const numero = Number(process.argv[2] ?? 1271);

  const concurso = await fetchConcursoPorNumero(numero);
  const odds = await fetchOddsTodosCampeonatos(apiKey, process.env.ODDS_API_REGION ?? "eu");
  const resultado = matchJogosComOdds(concurso.jogos, odds);

  const oddsTeamNames = [...new Set(odds.flatMap((o) => [o.timeCasa, o.timeVisitante]))];
  const semMatch = resultado.filter((r) => !r.odds).length;

  console.log(`Concurso ${numero}: ${resultado.length} jogos, ${semMatch} sem match.\n`);

  for (const item of resultado) {
    const { jogo, odds: o, matchConfidence } = item;
    const status = o ? `MATCH (conf ${matchConfidence})` : "SEM MATCH";
    console.log(`${status} — ${jogo.equipeCasa} (${jogo.ufCasa ?? "?"}) x ${jogo.equipeVisitante} (${jogo.ufVisitante ?? "?"})`);

    if (!o) {
      const candidatosCasa = oddsTeamNames.filter((n) => soundsSimilar(n, jogo.equipeCasa));
      const candidatosVisitante = oddsTeamNames.filter((n) => soundsSimilar(n, jogo.equipeVisitante));
      if (candidatosCasa.length) console.log(`    possível match p/ casa: ${candidatosCasa.join(" | ")}`);
      if (candidatosVisitante.length) console.log(`    possível match p/ visitante: ${candidatosVisitante.join(" | ")}`);
    }
  }
}

function soundsSimilar(a: string, b: string): boolean {
  const na = a.toUpperCase();
  const nb = b.toUpperCase();
  return na.includes(nb.split(" ")[0]) || nb.includes(na.split(" ")[0]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
