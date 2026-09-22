import type { Anthropic } from "@anthropic-ai/sdk";
import * as z from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { NoticiaTime } from "../data/news.js";
import type { DesfalqueAnalise } from "../types.js";

/**
 * Modelo pequeno (Haiku) escolhido de propósito: essa é uma classificação
 * simples de texto curto (título+descrição de notícia → nível de impacto),
 * rodando até ~28x por concurso. Um modelo maior encareceria sem ganho
 * relevante de qualidade pra essa tarefa específica.
 */
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";

const AnaliseSchema = z.object({
  impacto: z.enum(["nenhum", "baixo", "medio", "alto"]),
  motivo: z.string(),
});

const SYSTEM_PROMPT =
  "Você analisa notícias de futebol em português pra avaliar se um time tem " +
  "desfalques relevantes (jogadores importantes lesionados, suspensos ou " +
  "fora por qualquer motivo) pro próximo jogo. Seja conservador: só marque " +
  "impacto 'alto' se a notícia for específica e recente sobre jogador(es) " +
  "titular(es)/chave. Notícias vagas, antigas, sobre outro assunto (ex: " +
  "transferências, eleição de diretoria) ou sem relação direta com " +
  "desfalques contam como 'nenhum'. O 'motivo' deve ser uma frase curta " +
  "em português explicando a classificação.";

/**
 * Classifica o nível de impacto de desfalques de um time a partir de
 * notícias recentes. Se não houver notícias, retorna "nenhum" sem chamar a
 * API (evita gasto desnecessário).
 */
export async function analisarDesfalques(
  nomeTime: string,
  noticias: NoticiaTime[],
  client: Anthropic
): Promise<DesfalqueAnalise> {
  if (noticias.length === 0) {
    return {
      time: nomeTime,
      impacto: "nenhum",
      motivo: "Nenhuma notícia recente encontrada.",
    };
  }

  const resumoNoticias = noticias
    .map((n, i) => `${i + 1}. [${n.publicadoEm}] ${n.titulo} — ${n.descricao ?? "(sem descrição)"}`)
    .join("\n");

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Time: ${nomeTime}\n\nNotícias recentes:\n${resumoNoticias}\n\nClassifique o impacto de desfalques no próximo jogo.`,
      },
    ],
    output_config: { format: zodOutputFormat(AnaliseSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    return {
      time: nomeTime,
      impacto: "nenhum",
      motivo: "Falha ao interpretar resposta do modelo; assumindo sem impacto.",
    };
  }

  return { time: nomeTime, impacto: parsed.impacto, motivo: parsed.motivo };
}
