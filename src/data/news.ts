/**
 * Busca de notícias via NewsAPI.org (https://newsapi.org) — tier gratuito
 * cobre 100 requisições/dia, mas é restrito a uso não-comercial/dev. Cada
 * time consome 1 requisição, então uma grade de 14 jogos (até 28 times)
 * cabe numa única execução com folga.
 *
 * IMPORTANTE: o tier gratuito só cobre notícias dos últimos ~30 dias e não
 * garante boa cobertura de futebol brasileiro de divisões menores — times
 * sem notícia recente simplesmente voltam com lista vazia (ver `analisarDesfalques`).
 */
const NEWS_API_BASE = "https://newsapi.org/v2/everything";

export interface NoticiaTime {
  titulo: string;
  descricao: string | null;
  publicadoEm: string;
  fonte: string;
  url: string;
}

interface NewsApiResponse {
  status: string;
  articles?: Array<{
    title: string;
    description: string | null;
    publishedAt: string;
    source: { name: string };
    url: string;
  }>;
  message?: string; // presente quando status === "error"
}

export async function fetchNoticiasTime(
  nomeTime: string,
  apiKey: string,
  maxResultados: number = 5
): Promise<NoticiaTime[]> {
  const params = new URLSearchParams({
    q: `"${nomeTime}"`,
    language: "pt",
    sortBy: "publishedAt",
    pageSize: String(maxResultados),
  });

  const res = await fetch(`${NEWS_API_BASE}?${params}`, {
    headers: { "X-Api-Key": apiKey },
  });

  const data = (await res.json()) as NewsApiResponse;

  if (!res.ok || data.status === "error") {
    throw new Error(
      `Falha ao buscar notícias de "${nomeTime}": HTTP ${res.status}. ${data.message ?? ""}`
    );
  }

  return (data.articles ?? []).map((a) => ({
    titulo: a.title,
    descricao: a.description,
    publicadoEm: a.publishedAt,
    fonte: a.source.name,
    url: a.url,
  }));
}
