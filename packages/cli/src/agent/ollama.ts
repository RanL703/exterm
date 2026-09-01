export interface OllamaModel {
  name: string;
  modified_at?: string;
  size?: number;
}

export async function listOllamaModels(baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434"): Promise<OllamaModel[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`);
  if (!response.ok) throw new Error(`Ollama model lookup failed: ${response.status} ${await response.text()}`);
  const payload = await response.json() as { models?: OllamaModel[] };
  return (payload.models || []).filter((model) => typeof model.name === "string" && model.name.length > 0);
}
