import "dotenv/config";
import { Anthropic } from "@anthropic-ai/sdk";
import { fetchConcursoAtual } from "./data/fixtures.js";
import { fetchOddsTodosCampeonatos } from "./data/odds.js";
import { fetchNoticiasTime } from "./data/news.js";
import { matchJogosComOdds } from "./data/matcher.js";
import { analisarDesfalques } from "./analysis/desfalques.js";
import { ajustarProbabilidade } from "./analysis/ajuste.js";
import { estimarPopularidade } from "./analysis/popularidade.js";
import { otimizarCartao } from "./analysis/otimizador.js";
import type { JogoParaOtimizar, Resultado } from "./analysis/otimizador.js";
import { probabilidadesImplicitas } from "./probability.js";
import { openDb, salvarConcursoComOdds, salvarDesfalques } from "./db/schema.js";
import type { DesfalqueAnalise, JogoComOdds, ProbabilidadePura } from "./types.js";

const LABEL_RESULTADO: Record<Resultado, string> = { casa: "1", empate: "X", visitante: "2" };

async function main() {
  const apiKey = process.env.ODDS_API_KEY;
  const region = process.env.ODDS_API_REGION ?? "eu";
  const dbPath = process.env.DB_PATH ?? "./data/loteca.db";
  const newsApiKey = configurado(process.env.NEWSAPI_KEY);
  const anthropicApiKey = configurado(process.env.ANTHROPIC_API_KEY);
  const fase2Ativa = Boolean(newsApiKey && anthropicApiKey);
  const orcamentoReais = Number(process.env.ORCAMENTO_REAIS ?? "20");

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
  imprimirCartaoSugerido(jogosComOdds, desfalquesPorSequencial, orcamentoReais);
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

/**
 * Calcula a probabilidade implícita pura e, se houver análise de
 * desfalques relevante pro jogo, a probabilidade ajustada (Fase 2). Se não
 * houver ajuste, `probabilidadeFinal` é igual a `probs`.
 */
function calcularProbabilidades(
  item: JogoComOdds,
  desfalquesPorSequencial: Map<number, DesfalqueAnalise[]>
): { probs: ProbabilidadePura; probabilidadeFinal: ProbabilidadePura; analises: [DesfalqueAnalise, DesfalqueAnalise] | null } {
  const odds = item.odds!;
  const probs = probabilidadesImplicitas(odds.oddCasa, odds.oddEmpate, odds.oddVisitante);

  const analises = desfalquesPorSequencial.get(item.jogo.sequencial);
  if (analises && analises.length === 2 && (analises[0].impacto !== "nenhum" || analises[1].impacto !== "nenhum")) {
    const probabilidadeFinal = ajustarProbabilidade(probs, analises[0].impacto, analises[1].impacto);
    return { probs, probabilidadeFinal, analises: [analises[0], analises[1]] };
  }

  return { probs, probabilidadeFinal: probs, analises: null };
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

    const { probs, probabilidadeFinal, analises } = calcularProbabilidades(item, desfalquesPorSequencial);
    const confAviso = matchConfidence < 1 ? "  [match incerto]" : "";

    let linhaAjuste = "";
    if (analises) {
      const [casaAn, visitanteAn] = analises;
      linhaAjuste =
        `    desfalques: ${jogo.equipeCasa}=${casaAn.impacto} (${casaAn.motivo})\n` +
        `                ${jogo.equipeVisitante}=${visitanteAn.impacto} (${visitanteAn.motivo})\n` +
        `    prob. ajustada:           1=${(probabilidadeFinal.casa * 100).toFixed(1)}%  X=${(probabilidadeFinal.empate * 100).toFixed(1)}%  2=${(probabilidadeFinal.visitante * 100).toFixed(1)}%\n`;
    }

    const popularidade = estimarPopularidade(probabilidadeFinal, jogo);
    const linhaPopularidade =
      `    popularidade estimada:   1=${(popularidade.casa * 100).toFixed(1)}%  X=${(popularidade.empate * 100).toFixed(1)}%  2=${(popularidade.visitante * 100).toFixed(1)}%\n` +
      `    ${melhorValor(probabilidadeFinal, popularidade)}\n`;

    console.log(
      `${label}${confAviso}\n` +
        `    odds  (${odds.bookmaker}): 1=${odds.oddCasa.toFixed(2)}  X=${odds.oddEmpate.toFixed(2)}  2=${odds.oddVisitante.toFixed(2)}\n` +
        `    prob. implícita:         1=${(probs.casa * 100).toFixed(1)}%  X=${(probs.empate * 100).toFixed(1)}%  2=${(probs.visitante * 100).toFixed(1)}%\n` +
        linhaAjuste +
        linhaPopularidade
    );
  }
}

/**
 * Fase 3: identifica qual resultado tem o maior "valor relativo"
 * (probabilidade real dividida pela popularidade estimada) — ou seja,
 * onde a chance real de acertar é maior do que a fração de apostadores
 * que provavelmente vai marcar esse resultado. É só um sinal informativo
 * por jogo — a escolha principal de cada jogo no cartão sugerido (Fase 4)
 * usa sempre a maior probabilidade real, não este sinal (ver otimizador.ts).
 */
function melhorValor(probabilidade: ProbabilidadePura, popularidade: ProbabilidadePura): string {
  const opcoes: Array<{ label: string; valor: number }> = [
    { label: "1", valor: probabilidade.casa / popularidade.casa },
    { label: "X", valor: probabilidade.empate / popularidade.empate },
    { label: "2", valor: probabilidade.visitante / popularidade.visitante },
  ];

  const melhor = opcoes.reduce((a, b) => (b.valor > a.valor ? b : a));

  return `melhor valor: ${melhor.label} (${melhor.valor.toFixed(2)}x mais provável do que popular)`;
}

/**
 * Fase 4: monta o cartão sugerido (simples/duplo/triplo por jogo) dentro
 * do orçamento configurado em ORCAMENTO_REAIS, usando a probabilidade
 * final (ajustada pela Fase 2 quando disponível) de cada jogo com odds.
 */
function imprimirCartaoSugerido(
  jogosComOdds: JogoComOdds[],
  desfalquesPorSequencial: Map<number, DesfalqueAnalise[]>,
  orcamentoReais: number
): void {
  const jogosParaOtimizar: JogoParaOtimizar[] = jogosComOdds
    .filter((item) => item.odds)
    .map((item) => {
      const { probabilidadeFinal } = calcularProbabilidades(item, desfalquesPorSequencial);
      return {
        sequencial: item.jogo.sequencial,
        equipeCasa: item.jogo.equipeCasa,
        equipeVisitante: item.jogo.equipeVisitante,
        probabilidade: probabilidadeFinal,
      };
    });

  const semOdds = jogosComOdds.filter((item) => !item.odds);

  console.log(`\n=== Cartão sugerido (orçamento R$${orcamentoReais.toFixed(2)}) ===\n`);

  if (jogosParaOtimizar.length === 0) {
    console.log("Nenhum jogo com odds disponível — não há como sugerir um cartão.\n");
    return;
  }

  let resultado;
  try {
    resultado = otimizarCartao(jogosParaOtimizar, orcamentoReais);
  } catch (err) {
    console.error(`Não foi possível montar o cartão: ${err instanceof Error ? err.message : err}\n`);
    return;
  }

  for (const alocacao of resultado.alocacoes) {
    const label = `${String(alocacao.sequencial).padStart(2, "0")}. ${alocacao.equipeCasa} x ${alocacao.equipeVisitante}`;
    const marcacoes = alocacao.marcacoes.map((r) => LABEL_RESULTADO[r]).join(", ");
    console.log(`${label}\n    ${alocacao.tipo.padEnd(7)} → ${marcacoes}\n`);
  }

  console.log(
    `Total: ${resultado.totalCombinacoes} combinações, custo estimado R$${resultado.custoReais.toFixed(2)}.\n` +
      `(fórmula 2^duplos × 3^triplos × R$2,00 — confira o teto de duplos/triplos e o preço atual no site/app da Caixa antes de apostar de verdade)`
  );

  if (semOdds.length > 0) {
    console.log(
      `\nAviso: ${semOdds.length} jogo(s) sem odds ficaram de fora do cartão sugerido — escolha manual: ` +
        semOdds.map((i) => `${i.jogo.sequencial}. ${i.jogo.equipeCasa} x ${i.jogo.equipeVisitante}`).join("; ")
    );
  }
}

main().catch((err) => {
  console.error("Erro na execução:", err);
  process.exit(1);
});
