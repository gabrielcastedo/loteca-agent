import type { PrioridadeUpgrade, Resultado } from "./analysis/otimizador.js";
import type { ResultadoMonteCarlo } from "./analysis/monteCarlo.js";
import type { ResultadoFechamento } from "./analysis/fechamento.js";
import type { JogoRelatorio } from "./report.js";

const LABEL_RESULTADO: Record<Resultado, string> = { casa: "1", empate: "X", visitante: "2" };
const LABEL_PRIORIDADE: Record<PrioridadeUpgrade, string> = {
  alta: "Prioridade Alta",
  media: "Prioridade Média",
  nenhuma: "Não vale upgrade",
};
const COR_PRIORIDADE: Record<PrioridadeUpgrade, string> = {
  alta: "#dc2626",
  media: "#d97706",
  nenhuma: "#6b6b76",
};

export function gerarRelatorioHtml(
  concursoNumero: number,
  relatorio: JogoRelatorio[],
  fechamento: ResultadoFechamento,
  fechamentoMonteCarlo: ResultadoMonteCarlo | null
): string {
  const geradoEm = new Date().toLocaleString("pt-BR");
  const semOdds = relatorio.filter((j) => !j.odds);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Loteca — Concurso ${concursoNumero}</title>
<style>
  :root {
    --bg: #f7f7fa;
    --card-bg: #ffffff;
    --text: #1a1a1f;
    --text-muted: #6b6b76;
    --border: #e3e3ea;
    --casa: #2563eb;
    --empate: #9ca3af;
    --visitante: #dc2626;
    --accent: #059669;
    --warn-bg: #fff7ed;
    --warn-border: #fdba74;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14141a;
      --card-bg: #1f1f27;
      --text: #f0f0f5;
      --text-muted: #a0a0ad;
      --border: #33333d;
      --warn-bg: #2a2117;
      --warn-border: #92400e;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 16px 64px;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
  }
  .container { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  .subtitulo { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 24px; }
  h2 { font-size: 1.15rem; margin: 32px 0 12px; }
  .jogo {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 12px;
  }
  .jogo-titulo {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 6px;
    font-weight: 600;
    margin-bottom: 10px;
  }
  .jogo-titulo-nome { flex: 1; min-width: 0; }
  .jogo-titulo-badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .seq { color: var(--text-muted); font-weight: 400; margin-right: 8px; }
  .badge {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--accent);
    color: white;
    white-space: nowrap;
  }
  .sem-odds { color: var(--text-muted); font-style: italic; }
  .barra {
    display: flex;
    height: 22px;
    border-radius: 6px;
    overflow: hidden;
    margin: 6px 0;
    font-size: 0.72rem;
    color: white;
    font-weight: 600;
  }
  .barra > div { display: flex; align-items: center; justify-content: center; white-space: nowrap; overflow: hidden; }
  .barra .casa { background: var(--casa); }
  .barra .empate { background: var(--empate); }
  .barra .visitante { background: var(--visitante); }
  .linha-label { font-size: 0.78rem; color: var(--text-muted); margin-top: 10px; }
  .desfalque {
    background: var(--warn-bg);
    border: 1px solid var(--warn-border);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 0.82rem;
    margin-top: 8px;
  }
  table { width: 100%; border-collapse: collapse; background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; margin-bottom: 8px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 0.88rem; }
  th { color: var(--text-muted); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; }
  tr:last-child td { border-bottom: none; }
  .resumo-cartao { color: var(--text-muted); font-size: 0.85rem; margin-top: 10px; margin-bottom: 24px; }
  .lista-sem-odds { font-size: 0.85rem; color: var(--text-muted); }
  .fechamento-tabela-wrap { overflow-x: auto; margin-bottom: 8px; }
  .fechamento-tabela { font-size: 0.78rem; white-space: nowrap; }
  .fechamento-tabela th, .fechamento-tabela td { padding: 6px 8px; }
  .cel-hedge { background: var(--warn-bg); color: var(--visitante); font-weight: 700; }
  .aviso-fechamento {
    background: var(--warn-bg);
    border: 1px solid var(--warn-border);
    border-radius: 8px;
    padding: 12px 14px;
    font-size: 0.85rem;
    margin: 12px 0 20px;
  }
  footer { margin-top: 40px; font-size: 0.75rem; color: var(--text-muted); }
</style>
</head>
<body>
<div class="container">
  <h1>Loteca — Concurso ${concursoNumero}</h1>
  <div class="subtitulo">Gerado em ${geradoEm}</div>

  <h2>Grade × Odds</h2>
  ${relatorio.map(renderJogo).join("\n")}

  ${renderFechamento(fechamento, fechamentoMonteCarlo)}

  ${semOdds.length > 0 ? renderSemOdds(semOdds) : ""}

  <footer>Gerado automaticamente pelo loteca-agent. Não é recomendação financeira — ver README para limitações de cada fase.</footer>
</div>
</body>
</html>`;
}

function renderJogo(j: JogoRelatorio): string {
  const titulo = `<span class="seq">${String(j.sequencial).padStart(2, "0")}.</span>${escapeHtml(j.equipeCasa)} × ${escapeHtml(j.equipeVisitante)}`;

  if (!j.odds || !j.probabilidadePura || !j.probabilidadeFinal || !j.popularidade || !j.melhorValor) {
    return `<div class="jogo">
      <div class="jogo-titulo"><span class="jogo-titulo-nome">${titulo}</span></div>
      <div class="sem-odds">Sem odds disponíveis — escolha manual.</div>
    </div>`;
  }

  const confAviso = j.matchConfidence < 1 ? `<span class="badge" style="background:#d97706">match incerto</span>` : "";
  const prioridadeBadge = j.prioridade
    ? `<span class="badge" style="background:${COR_PRIORIDADE[j.prioridade]}">${LABEL_PRIORIDADE[j.prioridade]}</span>`
    : "";

  const desfalquesHtml = j.desfalques
    ? `<div class="desfalque">
        <strong>${escapeHtml(j.equipeCasa)}:</strong> ${j.desfalques[0].impacto} — ${escapeHtml(j.desfalques[0].motivo)}<br>
        <strong>${escapeHtml(j.equipeVisitante)}:</strong> ${j.desfalques[1].impacto} — ${escapeHtml(j.desfalques[1].motivo)}
      </div>`
    : "";

  return `<div class="jogo">
    <div class="jogo-titulo">
      <span class="jogo-titulo-nome">${titulo}</span>
      <span class="jogo-titulo-badges">${confAviso}${prioridadeBadge}<span class="badge">melhor valor: ${LABEL_RESULTADO[j.melhorValor.resultado]} (${j.melhorValor.valor.toFixed(2)}x)</span></span>
    </div>

    <div class="linha-label">Odds (${escapeHtml(j.odds.bookmaker)}): 1=${j.odds.oddCasa.toFixed(2)} · X=${j.odds.oddEmpate.toFixed(2)} · 2=${j.odds.oddVisitante.toFixed(2)}</div>
    <div class="linha-label">${j.odds.porCasa?.length ? `Probabilidade implícita (média de ${j.odds.porCasa.length} casas — não é o de-vig direto da odd acima, ver README P2)` : "Probabilidade implícita"}</div>
    ${renderBarra(j.probabilidadePura)}

    ${
      j.desfalques
        ? `<div class="linha-label">Probabilidade ajustada (desfalques)</div>${renderBarra(j.probabilidadeFinal)}${desfalquesHtml}`
        : ""
    }

    <div class="linha-label">Popularidade estimada (heurística)</div>
    ${renderBarra(j.popularidade)}
  </div>`;
}

function renderBarra(p: { casa: number; empate: number; visitante: number }): string {
  const casa = Math.max(p.casa * 100, 0);
  const empate = Math.max(p.empate * 100, 0);
  const visitante = Math.max(p.visitante * 100, 0);
  return `<div class="barra">
    <div class="casa" style="width:${casa.toFixed(1)}%">${casa >= 12 ? `1 ${casa.toFixed(0)}%` : ""}</div>
    <div class="empate" style="width:${empate.toFixed(1)}%">${empate >= 12 ? `X ${empate.toFixed(0)}%` : ""}</div>
    <div class="visitante" style="width:${visitante.toFixed(1)}%">${visitante >= 12 ? `2 ${visitante.toFixed(0)}%` : ""}</div>
  </div>`;
}

function renderFechamento(fechamento: ResultadoFechamento, monteCarlo: ResultadoMonteCarlo | null): string {
  if (fechamento.bilhetes.length === 0) {
    return "";
  }

  const jogosOrdenados = fechamento.bilhetes[0].marcacoes;
  const cabecalho = jogosOrdenados.map((m) => `<th>J${String(m.sequencial).padStart(2, "0")}</th>`).join("");

  const linhas = fechamento.bilhetes
    .map((b) => {
      const celulas = b.marcacoes
        .map((m) => {
          const ehCobertura = b.jogosDeCoberturaSequenciais.includes(m.sequencial);
          const texto = m.marcacoes.map((r) => LABEL_RESULTADO[r]).join("/");
          return `<td class="${ehCobertura ? "cel-hedge" : ""}">${texto}</td>`;
        })
        .join("");
      return `<tr><td><strong>Bilhete ${b.numero}</strong></td>${celulas}</tr>`;
    })
    .join("\n");

  const monteCarloHtml = monteCarlo
    ? `<strong>${monteCarlo.pctTodosOsJogos.toFixed(1)}%</strong> de chance real de algum bilhete acertar todos os ${monteCarlo.totalJogosSimulados} jogos simulados, ` +
      `<strong>${monteCarlo.pctNoMaximoUmErro.toFixed(1)}%</strong> de algum bilhete errar no máximo 1` +
      (monteCarlo.totalJogosSimulados < 14 ? " (não reflete oficialmente 13/14, faltam jogos sem odds)." : ".")
    : "não foi possível simular.";

  return `<h2>Fechamento (cobertura de até 2 desvios simultâneos)</h2>
  <div class="aviso-fechamento">
    <strong>Isso não é 100% de garantia.</strong> Cada bilhete marca o favorito em todos os jogos, exceto 2
    "jogos de risco" (Prioridade Alta ou Média), que recebem duplo (favorito + segundo colocado) cada. Cada bilhete
    cobre um par diferente de jogos de risco — juntos, os bilhetes cobrem <em>até 2</em> desses jogos desviando do
    favorito ao mesmo tempo. NÃO cobre: 3 ou mais jogos de risco desviando juntos, o terceiro colocado em qualquer
    jogo, nem qualquer desvio nos jogos "secos" (fixos em todos os bilhetes). Se um jogo seco falhar,
    <strong>todos os bilhetes erram esse jogo ao mesmo tempo</strong>. A chance real, calculada por simulação: ${monteCarloHtml}
  </div>
  <div class="fechamento-tabela-wrap">
    <table class="fechamento-tabela">
      <thead><tr><th>Bilhete</th>${cabecalho}</tr></thead>
      <tbody>${linhas}</tbody>
    </table>
  </div>
  <div class="resumo-cartao">Total: ${fechamento.bilhetes.length} bilhetes (2 duplos cada) — custo R$${fechamento.custoTotalReais.toFixed(2)}.</div>`;
}

function renderSemOdds(semOdds: JogoRelatorio[]): string {
  const itens = semOdds
    .map((j) => `${String(j.sequencial).padStart(2, "0")}. ${escapeHtml(j.equipeCasa)} × ${escapeHtml(j.equipeVisitante)}`)
    .join(" · ");
  return `<h2>Fora do cartão sugerido (sem odds — escolha manual)</h2>
  <p class="lista-sem-odds">${itens}</p>`;
}

function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
