import { resultadoDoPlacar } from "./fixtures.js";
import type { ResultadoApurado } from "./fixtures.js";

/**
 * numerosmegasena.com.br publica os resultados de várias loterias da
 * Caixa, incluindo Loteca, numa página Next.js server-renderizada. Não é
 * uma API documentada — os dados vêm embutidos no HTML dentro do script
 * `__NEXT_DATA__` (payload de hidratação do Next.js), em
 * `props.pageProps.result.jogos`: um array com `jogo` (sequencial),
 * `time1`/`time2`, `gols1`/`gols2` e `resultado` (1/X/2) já calculado.
 *
 * Preferida como fonte principal de resultado apurado (ver
 * `scripts/conferir.ts`) em vez do endpoint `servicebus2` da Caixa
 * (`fetchResultadoApuradoCaixa` em `fixtures.ts`) porque os dados já vêm
 * prontos (sem precisar filtrar/derivar) e a resposta de "concurso ainda
 * não apurado" é um HTTP 404 comum, mais fácil de distinguir de um erro
 * real do que o HTTP 500 que o endpoint da Caixa devolveu ao testar com
 * um concurso futuro. `robots.txt` permite (`Allow: /`, só bloqueia
 * `/api/` e `/admin`).
 */
const NUMEROSMEGASENA_URL = "https://numerosmegasena.com.br/loteca/";

interface NumerosMegaSenaJogo {
  jogo: number;
  time1: string;
  time2: string;
  gols1: number | null;
  gols2: number | null;
  resultado: string;
}

interface NumerosMegaSenaNextData {
  props?: {
    pageProps?: {
      result?: {
        concurso?: string;
        jogos?: NumerosMegaSenaJogo[];
      };
    };
  };
}

export async function fetchResultadoApurado(numero: number): Promise<ResultadoApurado[]> {
  const url = `${NUMEROSMEGASENA_URL}${numero}/`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; loteca-agent/0.1; pessoal)" } });

  if (res.status === 404) {
    throw new Error(`Concurso ${numero} ainda não apurado (ou não existe) em numerosmegasena.com.br.`);
  }
  if (!res.ok) {
    throw new Error(`Falha ao buscar concurso ${numero} em numerosmegasena.com.br: HTTP ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  return parseNumerosMegaSenaHtml(html, numero);
}

/** Extraída do fetch pra ser testável com HTML sintético, sem rede (ver `oddsShow.ts`, mesmo padrão). */
export function parseNumerosMegaSenaHtml(html: string, numero: number): ResultadoApurado[] {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error(`numerosmegasena.com.br: não encontrei o bloco __NEXT_DATA__ na página do concurso ${numero} — a estrutura do site pode ter mudado.`);
  }

  const data = JSON.parse(match[1]) as NumerosMegaSenaNextData;
  const jogos = data.props?.pageProps?.result?.jogos;
  if (!jogos || jogos.length === 0) {
    throw new Error(`numerosmegasena.com.br: página do concurso ${numero} não trouxe "jogos" — a estrutura do site pode ter mudado.`);
  }

  const semPlacar = jogos.filter((j) => j.gols1 == null || j.gols2 == null);
  if (semPlacar.length > 0) {
    throw new Error(
      `Concurso ${numero} ainda não foi totalmente apurado em numerosmegasena.com.br — ${semPlacar.length} de ${jogos.length} jogo(s) sem placar.`
    );
  }

  return jogos.map((j) => ({
    sequencial: j.jogo,
    golsCasa: j.gols1!,
    golsVisitante: j.gols2!,
    resultado: resultadoDoPlacar(j.gols1!, j.gols2!),
  }));
}
