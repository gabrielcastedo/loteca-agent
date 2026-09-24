import type { Resultado } from "../analysis/otimizador.js";
import type { OddsPorCasa } from "../types.js";

/**
 * cheerio depende de `undici`, que exige Node 20+ (referencia o global
 * `File` no carregamento do módulo). Só usamos o parsing de HTML do
 * cheerio, não a parte de rede — então um polyfill do `File` (disponível
 * em `node:buffer` desde o Node 18.13) é suficiente pra rodar no Node 18
 * sem precisar trocar de versão. Import dinâmico pra garantir que o
 * polyfill roda antes do cheerio ser carregado.
 */
if (typeof (globalThis as Record<string, unknown>).File === "undefined") {
  const { File } = await import("node:buffer");
  (globalThis as Record<string, unknown>).File = File;
}
const { load } = await import("cheerio");

/**
 * odds.show (https://odds.show) tem um widget público feito especificamente
 * pra loterias/bolões brasileiros (Loteca, Timemania), que já casa os jogos
 * com os nomes oficiais da Caixa e mostra a melhor odd de cada mercado
 * (1/X/2) entre várias casas de apostas. Isso resolve o maior problema do
 * projeto até aqui: cobertura (times pequenos, eliminatórias) e matching de
 * nomes (o site já usa o nome oficial da Caixa).
 *
 * Não é uma API pública documentada — é HTML server-renderizado (Next.js) de
 * uma página pensada pra embutir via iframe. `robots.txt` permite crawling
 * (`Allow: /`), os dados já vêm prontos no HTML de uma requisição GET normal
 * (sem precisar executar JS/navegador), e o uso aqui é o mesmo do widget:
 * ler odds públicas de Loteca uma vez por execução. Ainda assim, como não é
 * um contrato de API formal, a estrutura pode mudar sem aviso — os seletores
 * abaixo evitam depender de classes CSS geradas (que mudam a cada build) e
 * se apoiam em `aria-label` e no texto "Oficial: ..." (mais estáveis).
 */
const ODDS_SHOW_URL = "https://odds.show/br/widget_lotteries/?lottery=loteca";

/** Melhor odd de um mercado (1, X ou 2) entre as casas listadas no widget. */
export interface OddShowMercado {
  odd: number;
  bookmaker: string;
}

/** Um jogo do widget, com o nome oficial (igual ao da Caixa) e a melhor odd por mercado. */
export interface OddsShowJogo {
  sequencial: number;
  equipeCasaOficial: string;
  equipeVisitanteOficial: string;
  mercados: Partial<Record<Resultado, OddShowMercado>>;
  /**
   * Odds completas (1/X/2) por casa individual — o widget também renderiza
   * uma tabela detalhada por casa (além do trio "destacado" acima), só que
   * com o formato de `aria-label` invertido ("Bet365, 1, odd 2.90" em vez de
   * "1, Bet365, odd 2.90"). Só entra aqui a casa que tiver os 3 mercados
   * completos — ver `probabilidadesImplicitasMedia` em `probability.ts`.
   */
  porCasa: OddsPorCasa[];
}

const MERCADO_POR_SIMBOLO: Record<string, Resultado> = { "1": "casa", X: "empate", "2": "visitante" };

export async function fetchOddsShowLoteca(): Promise<OddsShowJogo[]> {
  const res = await fetch(ODDS_SHOW_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; loteca-agent/0.1; pessoal)" },
  });

  if (!res.ok) {
    throw new Error(`Falha ao buscar odds.show: HTTP ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  return parseOddsShowHtml(html);
}

export function parseOddsShowHtml(html: string): OddsShowJogo[] {
  const $ = load(html);
  const jogos: OddsShowJogo[] = [];

  $("details").each((indice, elemento) => {
    const bloco = $(elemento);
    const texto = bloco.text();

    const oficialMatch = texto.match(/Oficial:\s*([^-]+?)\s*-\s*\d{2}\/\d{2}/);
    if (!oficialMatch) return; // não é um card de jogo (ou mudou de estrutura)

    const [equipeCasaOficial, equipeVisitanteOficial] = oficialMatch[1]
      .split(/\s+x\s+/i)
      .map((nome) => nome.trim());
    if (!equipeCasaOficial || !equipeVisitanteOficial) return;

    const mercados: Partial<Record<Resultado, OddShowMercado>> = {};
    const oddsPorBookmaker = new Map<string, Partial<Record<Resultado, number>>>();

    bloco.find("a[aria-label]").each((_, tile) => {
      const label = $(tile).attr("aria-label") ?? "";

      // Trio "destacado": "1, Bet365, odd 2.90" — a melhor odd de cada mercado
      // (pode vir de casas diferentes), usada só como referência de preço.
      const matchDestacado = label.match(/^(1|X|2),\s*([^,]+),\s*odd\s*([\d.]+)/i);
      if (matchDestacado) {
        const mercado = MERCADO_POR_SIMBOLO[matchDestacado[1]];
        const odd = Number(matchDestacado[3]);
        if (mercado && !Number.isNaN(odd)) {
          // Mantém a melhor (maior) odd caso o mesmo mercado apareça mais de uma vez.
          if (!mercados[mercado] || odd > mercados[mercado]!.odd) {
            mercados[mercado] = { odd, bookmaker: matchDestacado[2].trim() };
          }
        }
        return;
      }

      // Tabela detalhada por casa: "Bet365, 1, odd 2.90" (ordem invertida) —
      // essa é a fonte da probabilidade implícita (ver probability.ts).
      const matchPorCasa = label.match(/^([^,]+),\s*(1|X|2),\s*odd\s*([\d.]+)/i);
      if (matchPorCasa) {
        const mercado = MERCADO_POR_SIMBOLO[matchPorCasa[2]];
        const odd = Number(matchPorCasa[3]);
        if (!mercado || Number.isNaN(odd)) return;

        const bookmaker = matchPorCasa[1].trim();
        const odds = oddsPorBookmaker.get(bookmaker) ?? {};
        odds[mercado] = odd;
        oddsPorBookmaker.set(bookmaker, odds);
      }
    });

    const porCasa: OddsPorCasa[] = [...oddsPorBookmaker.entries()]
      .filter((entrada): entrada is [string, Required<Partial<Record<Resultado, number>>>] => {
        const [, odds] = entrada;
        return odds.casa !== undefined && odds.empate !== undefined && odds.visitante !== undefined;
      })
      .map(([bookmaker, odds]) => ({
        bookmaker,
        oddCasa: odds.casa,
        oddEmpate: odds.empate,
        oddVisitante: odds.visitante,
      }));

    jogos.push({
      sequencial: indice + 1,
      equipeCasaOficial,
      equipeVisitanteOficial,
      mercados,
      porCasa,
    });
  });

  return jogos;
}
