import type { ResultadoOtimizacao, Resultado } from "./analysis/otimizador.js";
import type { JogoRelatorio } from "./report.js";

const LABEL_RESULTADO: Record<Resultado, string> = { casa: "1", empate: "X", visitante: "2" };

export function gerarRelatorioHtml(
  concursoNumero: number,
  relatorio: JogoRelatorio[],
  cartao: ResultadoOtimizacao | null,
  orcamentoReais: number
): string {
  const geradoEm = new Date().toLocaleString("pt-BR");
  const semOdds = relatorio.filter((j) => !j.odds);
  const cartaoPorSequencial = new Map(cartao?.alocacoes.map((a) => [a.sequencial, a]) ?? []);

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
    justify-content: space-between;
    align-items: baseline;
    font-weight: 600;
    margin-bottom: 10px;
  }
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
  table { width: 100%; border-collapse: collapse; background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 0.88rem; }
  th { color: var(--text-muted); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; }
  tr:last-child td { border-bottom: none; }
  .tipo-triplo { color: var(--visitante); font-weight: 600; }
  .tipo-duplo { color: var(--casa); font-weight: 600; }
  .tipo-simples { color: var(--text-muted); }
  .resumo-cartao { color: var(--text-muted); font-size: 0.85rem; margin-top: 10px; }
  .lista-sem-odds { font-size: 0.85rem; color: var(--text-muted); }
  footer { margin-top: 40px; font-size: 0.75rem; color: var(--text-muted); }
</style>
</head>
<body>
<div class="container">
  <h1>Loteca — Concurso ${concursoNumero}</h1>
  <div class="subtitulo">Gerado em ${geradoEm}</div>

  <h2>Grade × Odds</h2>
  ${relatorio.map(renderJogo).join("\n")}

  <h2>Cartão sugerido (orçamento R$${orcamentoReais.toFixed(2)})</h2>
  ${cartao ? renderCartao(cartao, relatorio) : `<p class="sem-odds">Nenhum cartão sugerido (sem jogos com odds).</p>`}

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
      <div class="jogo-titulo">${titulo}</div>
      <div class="sem-odds">Sem odds disponíveis — escolha manual.</div>
    </div>`;
  }

  const confAviso = j.matchConfidence < 1 ? `<span class="badge" style="background:#d97706">match incerto</span>` : "";

  const desfalquesHtml = j.desfalques
    ? `<div class="desfalque">
        <strong>${escapeHtml(j.equipeCasa)}:</strong> ${j.desfalques[0].impacto} — ${escapeHtml(j.desfalques[0].motivo)}<br>
        <strong>${escapeHtml(j.equipeVisitante)}:</strong> ${j.desfalques[1].impacto} — ${escapeHtml(j.desfalques[1].motivo)}
      </div>`
    : "";

  return `<div class="jogo">
    <div class="jogo-titulo">${titulo} ${confAviso}<span class="badge">melhor valor: ${LABEL_RESULTADO[j.melhorValor.resultado]} (${j.melhorValor.valor.toFixed(2)}x)</span></div>

    <div class="linha-label">Odds (${escapeHtml(j.odds.bookmaker)}): 1=${j.odds.oddCasa.toFixed(2)} · X=${j.odds.oddEmpate.toFixed(2)} · 2=${j.odds.oddVisitante.toFixed(2)}</div>
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

function renderCartao(cartao: ResultadoOtimizacao, relatorio: JogoRelatorio[]): string {
  const porSequencial = new Map(relatorio.map((j) => [j.sequencial, j]));

  const linhas = cartao.alocacoes
    .map((a) => {
      const jogo = porSequencial.get(a.sequencial);
      const tipoClasse = `tipo-${a.tipo}`;
      const marcacoes = a.marcacoes.map((r) => LABEL_RESULTADO[r]).join(", ");
      return `<tr>
        <td>${String(a.sequencial).padStart(2, "0")}</td>
        <td>${escapeHtml(jogo?.equipeCasa ?? a.equipeCasa)} × ${escapeHtml(jogo?.equipeVisitante ?? a.equipeVisitante)}</td>
        <td class="${tipoClasse}">${a.tipo}</td>
        <td>${marcacoes}</td>
      </tr>`;
    })
    .join("\n");

  return `<table>
    <thead><tr><th>Jogo</th><th>Confronto</th><th>Tipo</th><th>Marcações</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table>
  <div class="resumo-cartao">Total: ${cartao.totalCombinacoes} combinações — custo estimado R$${cartao.custoReais.toFixed(2)}.
  Fórmula 2<sup>duplos</sup> × 3<sup>triplos</sup> × R$2,00 — confira o teto de duplos/triplos e o preço atual no site/app da Caixa antes de apostar de verdade.</div>`;
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
