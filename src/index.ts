import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { exec } from "node:child_process";
import { Anthropic } from "@anthropic-ai/sdk";
import { fetchConcursoAtual, fetchConcursoDeArquivo } from "./data/fixtures.js";
import { fetchOddsTodosCampeonatos } from "./data/odds.js";
import { fetchOddsShowLoteca } from "./data/oddsShow.js";
import type { OddsShowJogo } from "./data/oddsShow.js";
import { fetchNoticiasTime } from "./data/news.js";
import { matchJogosComOdds } from "./data/matcher.js";
import { analisarDesfalques } from "./analysis/desfalques.js";
import { otimizarCartao } from "./analysis/otimizador.js";
import type { JogoParaOtimizar, Resultado, ResultadoOtimizacao } from "./analysis/otimizador.js";
import { construirRelatorio } from "./report.js";
import type { JogoRelatorio } from "./report.js";
import { gerarRelatorioHtml } from "./reportHtml.js";
import { openDb, salvarConcursoComOdds, salvarDesfalques } from "./db/schema.js";
import type { DesfalqueAnalise, JogoComOdds, OddsJogo } from "./types.js";

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

  const gradeManualPath = process.env.CONCURSO_MANUAL_PATH;
  console.log(
    gradeManualPath
      ? `1/6 — Lendo grade manual de "${gradeManualPath}"...`
      : "1/6 — Buscando grade do concurso atual da Loteca..."
  );
  const concurso = gradeManualPath
    ? await fetchConcursoDeArquivo(gradeManualPath)
    : await fetchConcursoAtual();
  console.log(`     Concurso ${concurso.numero}: ${concurso.jogos.length} jogos encontrados.`);

  console.log("2/6 — Buscando odds no odds.show (widget de Loteca)...");
  let oddsShowPorSequencial = new Map<number, OddsShowJogo>();
  try {
    const oddsShowJogos = await fetchOddsShowLoteca();
    oddsShowPorSequencial = new Map(oddsShowJogos.map((j) => [j.sequencial, j]));
    console.log(`     ${oddsShowJogos.length} jogos encontrados no odds.show.`);
  } catch (err) {
    console.warn(
      `     Aviso: falha ao buscar odds.show (${err instanceof Error ? err.message : err}). ` +
        `Seguindo só com The Odds API.`
    );
  }

  console.log("3/6 — Buscando odds dos campeonatos relevantes (The Odds API, fallback)...");
  const odds = await fetchOddsTodosCampeonatos(apiKey, region);
  console.log(`     ${odds.length} linhas de odds coletadas (jogo x bookmaker).`);

  console.log("4/6 — Casando jogos da Loteca com odds de mercado...");
  const jogosComOddsApi = matchJogosComOdds(concurso.jogos, odds);
  const jogosComOdds = jogosComOddsApi.map((item) =>
    preferirOddsShow(item, oddsShowPorSequencial.get(item.jogo.sequencial))
  );
  const semMatch = jogosComOdds.filter((j) => !j.odds).length;
  if (semMatch > 0) {
    console.warn(
      `     Aviso: ${semMatch} de ${jogosComOdds.length} jogos ficaram sem odds correspondentes ` +
        `(nem odds.show, nem The Odds API). Veja src/data/matcher.ts (MANUAL_OVERRIDES) pro caso da Odds API.`
    );
  }

  let desfalquesPorSequencial = new Map<number, DesfalqueAnalise[]>();
  if (fase2Ativa) {
    console.log("5/6 — Buscando notícias e analisando desfalques (Fase 2)...");
    desfalquesPorSequencial = await analisarDesfalquesDoConcurso(jogosComOdds, newsApiKey!, anthropicApiKey!);
  } else {
    console.log(
      "5/6 — Pulando análise de desfalques: configure NEWSAPI_KEY e ANTHROPIC_API_KEY no .env pra ativar a Fase 2."
    );
  }

  console.log("6/6 — Salvando no banco local...");
  const db = openDb(dbPath);
  const idsPorSequencial = salvarConcursoComOdds(db, concurso, jogosComOdds);
  for (const [sequencial, analises] of desfalquesPorSequencial) {
    const jogoId = idsPorSequencial.get(sequencial);
    if (jogoId && analises.length > 0) {
      salvarDesfalques(db, jogoId, analises);
    }
  }
  db.close();

  const relatorio = construirRelatorio(jogosComOdds, desfalquesPorSequencial);
  const cartao = montarCartaoSugerido(relatorio, orcamentoReais);

  imprimirRelatorioConsole(concurso.numero, relatorio);
  imprimirCartaoSugeridoConsole(relatorio, cartao, orcamentoReais);

  const caminhoHtml = salvarRelatorioHtml(concurso.numero, relatorio, cartao, orcamentoReais);
  console.log(`\nRelatório visual salvo em: ${caminhoHtml}`);
  abrirNoNavegador(caminhoHtml);
}

/**
 * Prioriza a odd do odds.show sobre a do The Odds API pra um jogo,
 * já que o odds.show casa por número de jogo (não por nome) e cobre times
 * pequenos/eliminatórias que a Odds API não tem — ver src/data/oddsShow.ts.
 * Só usa o odds.show se os 3 mercados (1/X/2) estiverem presentes; senão
 * mantém o resultado da Odds API (que pode ser um match ou `null`).
 */
function preferirOddsShow(itemOddsApi: JogoComOdds, oddsShowJogo: OddsShowJogo | undefined): JogoComOdds {
  if (!oddsShowJogo) return itemOddsApi;

  const { casa, empate, visitante } = oddsShowJogo.mercados;
  if (!casa || !empate || !visitante) return itemOddsApi;

  const odds: OddsJogo = {
    timeCasa: itemOddsApi.jogo.equipeCasa,
    timeVisitante: itemOddsApi.jogo.equipeVisitante,
    bookmaker: `odds.show (melhor odd: ${casa.bookmaker}/${empate.bookmaker}/${visitante.bookmaker})`,
    oddCasa: casa.odd,
    oddEmpate: empate.odd,
    oddVisitante: visitante.odd,
  };

  return { jogo: itemOddsApi.jogo, odds, matchConfidence: 1 };
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
 * Fase 4: monta o cartão sugerido (simples/duplo/triplo por jogo) dentro
 * do orçamento configurado em ORCAMENTO_REAIS, usando a probabilidade
 * final (ajustada pela Fase 2 quando disponível) de cada jogo com odds.
 * Retorna null se não houver jogos com odds ou o orçamento for insuficiente.
 */
function montarCartaoSugerido(relatorio: JogoRelatorio[], orcamentoReais: number): ResultadoOtimizacao | null {
  const jogosParaOtimizar: JogoParaOtimizar[] = relatorio
    .filter((j): j is JogoRelatorio & { probabilidadeFinal: NonNullable<JogoRelatorio["probabilidadeFinal"]> } =>
      Boolean(j.probabilidadeFinal)
    )
    .map((j) => ({
      sequencial: j.sequencial,
      equipeCasa: j.equipeCasa,
      equipeVisitante: j.equipeVisitante,
      probabilidade: j.probabilidadeFinal,
    }));

  if (jogosParaOtimizar.length === 0) return null;

  try {
    return otimizarCartao(jogosParaOtimizar, orcamentoReais);
  } catch (err) {
    console.error(`Não foi possível montar o cartão: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

function imprimirRelatorioConsole(concursoNumero: number, relatorio: JogoRelatorio[]): void {
  console.log(`\n=== Concurso ${concursoNumero} — Grade x Odds ===\n`);

  for (const j of relatorio) {
    const label = `${String(j.sequencial).padStart(2, "0")}. ${j.equipeCasa} x ${j.equipeVisitante}`;

    if (!j.odds || !j.probabilidadePura || !j.probabilidadeFinal || !j.popularidade || !j.melhorValor) {
      console.log(`${label}\n    (sem odds)\n`);
      continue;
    }

    const confAviso = j.matchConfidence < 1 ? "  [match incerto]" : "";

    let linhaAjuste = "";
    if (j.desfalques) {
      const [casaAn, visitanteAn] = j.desfalques;
      linhaAjuste =
        `    desfalques: ${j.equipeCasa}=${casaAn.impacto} (${casaAn.motivo})\n` +
        `                ${j.equipeVisitante}=${visitanteAn.impacto} (${visitanteAn.motivo})\n` +
        `    prob. ajustada:           1=${(j.probabilidadeFinal.casa * 100).toFixed(1)}%  X=${(j.probabilidadeFinal.empate * 100).toFixed(1)}%  2=${(j.probabilidadeFinal.visitante * 100).toFixed(1)}%\n`;
    }

    const linhaPopularidade =
      `    popularidade estimada:   1=${(j.popularidade.casa * 100).toFixed(1)}%  X=${(j.popularidade.empate * 100).toFixed(1)}%  2=${(j.popularidade.visitante * 100).toFixed(1)}%\n` +
      `    melhor valor: ${LABEL_RESULTADO[j.melhorValor.resultado]} (${j.melhorValor.valor.toFixed(2)}x mais provável do que popular)\n`;

    console.log(
      `${label}${confAviso}\n` +
        `    odds  (${j.odds.bookmaker}): 1=${j.odds.oddCasa.toFixed(2)}  X=${j.odds.oddEmpate.toFixed(2)}  2=${j.odds.oddVisitante.toFixed(2)}\n` +
        `    prob. implícita:         1=${(j.probabilidadePura.casa * 100).toFixed(1)}%  X=${(j.probabilidadePura.empate * 100).toFixed(1)}%  2=${(j.probabilidadePura.visitante * 100).toFixed(1)}%\n` +
        linhaAjuste +
        linhaPopularidade
    );
  }
}

function imprimirCartaoSugeridoConsole(
  relatorio: JogoRelatorio[],
  cartao: ResultadoOtimizacao | null,
  orcamentoReais: number
): void {
  console.log(`\n=== Cartão sugerido (orçamento R$${orcamentoReais.toFixed(2)}) ===\n`);

  if (!cartao) {
    console.log("Nenhum jogo com odds disponível — não há como sugerir um cartão.\n");
    return;
  }

  for (const alocacao of cartao.alocacoes) {
    const label = `${String(alocacao.sequencial).padStart(2, "0")}. ${alocacao.equipeCasa} x ${alocacao.equipeVisitante}`;
    const marcacoes = alocacao.marcacoes.map((r) => LABEL_RESULTADO[r]).join(", ");
    console.log(`${label}\n    ${alocacao.tipo.padEnd(7)} → ${marcacoes}\n`);
  }

  console.log(
    `Total: ${cartao.totalCombinacoes} combinações, custo estimado R$${cartao.custoReais.toFixed(2)}.\n` +
      `(fórmula 2^duplos × 3^triplos × R$2,00 — confira o teto de duplos/triplos e o preço atual no site/app da Caixa antes de apostar de verdade)`
  );

  const semOdds = relatorio.filter((j) => !j.odds);
  if (semOdds.length > 0) {
    console.log(
      `\nAviso: ${semOdds.length} jogo(s) sem odds ficaram de fora do cartão sugerido — escolha manual: ` +
        semOdds.map((j) => `${j.sequencial}. ${j.equipeCasa} x ${j.equipeVisitante}`).join("; ")
    );
  }
}

/** Gera o relatório visual (HTML) e salva em relatorios/concurso-<numero>.html. */
function salvarRelatorioHtml(
  concursoNumero: number,
  relatorio: JogoRelatorio[],
  cartao: ResultadoOtimizacao | null,
  orcamentoReais: number
): string {
  const html = gerarRelatorioHtml(concursoNumero, relatorio, cartao, orcamentoReais);
  const pasta = "./relatorios";
  const caminho = `${pasta}/concurso-${concursoNumero}.html`;

  mkdirSync(pasta, { recursive: true });
  writeFileSync(caminho, html, "utf-8");

  return caminho;
}

/** Abre o relatório no navegador padrão. Falha silenciosamente se não for possível (ex: ambiente sem GUI). */
function abrirNoNavegador(caminho: string): void {
  const comando =
    process.platform === "win32"
      ? `start "" "${caminho}"`
      : process.platform === "darwin"
        ? `open "${caminho}"`
        : `xdg-open "${caminho}"`;

  exec(comando, (err) => {
    if (err) {
      console.warn(`     Aviso: não consegui abrir o navegador automaticamente. Abra o arquivo manualmente.`);
    }
  });
}

main().catch((err) => {
  console.error("Erro na execução:", err);
  process.exit(1);
});
