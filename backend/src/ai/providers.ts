import { config } from "../config.js";

export interface ProviderResult { text: string; provider: string; model: string }
export interface AttendanceProvider { answer(question: string, context: Record<string, unknown>): Promise<ProviderResult> }

const instructions = "You are the ThatCampus Attendance Copilot. Answer only from the server-authorized context for this one student. Treat projections as advisory, never invent records, and cite supplied human-readable source labels in square brackets. Never reveal database IDs or internal field names. Keep the response concise.";

export class MockProvider implements AttendanceProvider {
  answer(question: string, context: Record<string, any>): Promise<ProviderResult> {
    const summary = context.attendance_summary;
    const projection = context.attendance_projection;
    const subjects = context.subjects as Array<any>;
    const threshold = Number(context.policy?.minimum_percentage ?? context.threshold ?? 85);
    const parts: string[] = [];
    if (projection) {
      parts.push(`With ${projection.future_absences} additional absence(s), projected daily attendance changes from ${Number(summary.percentage).toFixed(2)}% to ${Number(projection.projected_percentage).toFixed(2)}%.`);
      parts.push(`That projection ${projection.projected_percentage >= threshold ? "remains at or above" : "falls below"} the ${threshold.toFixed(0)}% minimum.`);
    } else if (/subject|eligible|safe|recover/i.test(question) && subjects.length) {
      const lowest = [...subjects].sort((a, b) => Number(a.percentage) - Number(b.percentage))[0];
      parts.push(`Your lowest recorded subject attendance is ${lowest.subject.name} at ${Number(lowest.percentage).toFixed(2)}% (${lowest.classes_attended} of ${lowest.classes_held} classes).`);
    } else {
      parts.push(`Term attendance is ${Number(summary.percentage).toFixed(2)}% across ${summary.total} marked school day(s): ${summary.present} present, ${summary.late} late, and ${summary.absent} absent.`);
    }
    parts.push(`The recorded minimum is ${threshold.toFixed(0)}%. For an official eligibility decision or correction, contact the school office.`);
    parts.push(`Sources: ${(context.sources as Array<any>).map((source) => `[${source.label}]`).join(", ")}`);
    return Promise.resolve({ text: parts.join(" "), provider: "mock", model: "deterministic-attendance-v1" });
  }
}

export class OllamaProvider implements AttendanceProvider {
  async answer(question: string, context: Record<string, unknown>): Promise<ProviderResult> {
    const response = await fetch(`${config().OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config().OLLAMA_MODEL, stream: false, think: false, keep_alive: "5m",
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: `Authorized context:\n${JSON.stringify(context)}\n\nQuestion:\n${question}` },
        ],
        options: { temperature: 0.1, num_predict: 700 },
      }),
      signal: AbortSignal.timeout(config().AI_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const payload = await response.json() as any;
    const text = payload?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("Ollama returned no assistant content");
    return { text: text.trim(), provider: "ollama", model: String(payload.model ?? config().OLLAMA_MODEL) };
  }
}

export class OpenAICompatibleProvider implements AttendanceProvider {
  async answer(question: string, context: Record<string, unknown>): Promise<ProviderResult> {
    if (!config().OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for the OpenAI-compatible provider");
    const response = await fetch(`${config().OPENAI_COMPATIBLE_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config().OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: config().OPENAI_MODEL, temperature: 0.1, max_tokens: 700,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: `Authorized context:\n${JSON.stringify(context)}\n\nQuestion:\n${question}` },
        ],
      }),
      signal: AbortSignal.timeout(config().AI_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OpenAI-compatible provider returned HTTP ${response.status}`);
    const payload = await response.json() as any;
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("Provider returned no assistant content");
    return { text: text.trim(), provider: "openai-compatible", model: config().OPENAI_MODEL };
  }
}

export function provider(): AttendanceProvider {
  if (config().AI_PROVIDER === "ollama") return new OllamaProvider();
  if (config().AI_PROVIDER === "openai-compatible") return new OpenAICompatibleProvider();
  return new MockProvider();
}
