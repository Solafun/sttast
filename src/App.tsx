import { useState } from "react";

type Tone = "neutral" | "expert" | "bold" | "friendly";
type LlmMode = "local" | "hybrid" | "cloud";

const modeLabels: Record<LlmMode, string> = {
  local: "Local LLM",
  hybrid: "Hybrid",
  cloud: "Cloud fallback",
};

const toneLabels: Record<Tone, string> = {
  neutral: "Нейтральный",
  expert: "Экспертный",
  bold: "Смелый",
  friendly: "Дружелюбный",
};

export function App() {
  const [browserUrl, setBrowserUrl] = useState("https://www.threads.com/");
  const [llmMode, setLlmMode] = useState<LlmMode>("local");
  const [localModel, setLocalModel] = useState("mistral:7b-instruct");
  const [selectedTone, setSelectedTone] = useState<Tone>("expert");
  const [temperature, setTemperature] = useState(0.55);
  const [maxCommentsPerHour, setMaxCommentsPerHour] = useState(12);
  const [systemPrompt, setSystemPrompt] = useState(
    "Ты AI-бот для Threads. Анализируй пост, пиши короткий, умный и естественный комментарий, который выглядит как сообщение опытного человека, а не как спам."
  );
  const [autoApprove, setAutoApprove] = useState(false);
  const [semanticFilter, setSemanticFilter] = useState(true);
  const [includeQuestion, setIncludeQuestion] = useState(true);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),_transparent_24%),linear-gradient(180deg,_#060816_0%,_#0b1020_42%,_#0f172a_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col gap-4 p-3 md:p-4 lg:p-5">
        <header className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="text-sm font-medium">Threads Reply Bot</div>
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs">{modeLabels[llmMode]}</div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs">{localModel}</div>
          </div>
        </header>

        <main className="grid flex-1 gap-4 xl:grid-cols-[1fr_24rem]">
          <section className="flex min-h-[600px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <div className="border-b border-white/10 p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  </div>
                </div>
                <input
                  value={browserUrl}
                  onChange={(event) => setBrowserUrl(event.target.value)}
                  className="h-9 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 text-sm outline-none"
                  placeholder="https://www.threads.com/"
                />
                <button className="h-9 rounded-lg bg-indigo-500 px-4 text-sm font-medium hover:bg-indigo-400">Открыть</button>
              </div>
            </div>
            <div className="relative flex-1">
              <div className="absolute left-3 top-3 z-10 rounded-lg border border-amber-300/25 bg-amber-500/10 px-2 py-1 text-xs text-amber-100">
                Threads может блокировать iframe. Используйте remote browser session.
              </div>
              <iframe title="Threads" src={browserUrl} className="h-full w-full bg-white" />
            </div>
          </section>

          <aside className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-3 text-sm font-medium">Настройки</div>
              
              <div className="mb-4">
                <label className="mb-1 block text-xs text-slate-400">Режим</label>
                <div className="grid grid-cols-3 gap-1">
                  {(Object.keys(modeLabels) as LlmMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setLlmMode(mode)}
                      className={`h-8 rounded-md border text-xs ${
                        llmMode === mode
                          ? "border-indigo-400/50 bg-indigo-500/15"
                          : "border-white/10 bg-black/20"
                      }`}
                    >
                      {modeLabels[mode]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs text-slate-400">Модель</label>
                <select
                  value={localModel}
                  onChange={(event) => setLocalModel(event.target.value)}
                  className="h-9 w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm outline-none"
                >
                  <option>mistral:7b-instruct</option>
                  <option>llama3.1:8b</option>
                  <option>qwen2.5:7b</option>
                  <option>phi-4-mini</option>
                </select>
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs text-slate-400">Тон</label>
                <select
                  value={selectedTone}
                  onChange={(event) => setSelectedTone(event.target.value as Tone)}
                  className="h-9 w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm outline-none"
                >
                  {(Object.keys(toneLabels) as Tone[]).map((tone) => (
                    <option key={tone} value={tone}>
                      {toneLabels[tone]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Temp: {temperature.toFixed(2)}</label>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={temperature}
                    onChange={(event) => setTemperature(Number(event.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Лимит: {maxCommentsPerHour}</label>
                  <input
                    type="range"
                    min="2"
                    max="30"
                    step="1"
                    value={maxCommentsPerHour}
                    onChange={(event) => setMaxCommentsPerHour(Number(event.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="mb-1 block text-xs text-slate-400">System prompt</label>
                <textarea
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  rows={4}
                  className="w-full rounded-md border border-white/10 bg-black/20 p-3 text-sm outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center justify-between">
                  <span className="text-sm">Auto approve</span>
                  <input
                    type="checkbox"
                    checked={autoApprove}
                    onChange={() => setAutoApprove((value) => !value)}
                    className="h-4 w-4"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span className="text-sm">Safety filter</span>
                  <input
                    type="checkbox"
                    checked={semanticFilter}
                    onChange={() => setSemanticFilter((value) => !value)}
                    className="h-4 w-4"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span className="text-sm">Question ending</span>
                  <input
                    type="checkbox"
                    checked={includeQuestion}
                    onChange={() => setIncludeQuestion((value) => !value)}
                    className="h-4 w-4"
                  />
                </label>
              </div>

              <div className="mt-4 flex gap-2">
                <button className="flex-1 rounded-md bg-emerald-500 py-2 text-sm font-medium hover:bg-emerald-400">Сохранить</button>
                <button className="flex-1 rounded-md bg-indigo-500 py-2 text-sm font-medium hover:bg-indigo-400">Запустить</button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 text-sm font-medium">Status</div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Supabase</span>
                  <span className="text-emerald-400">connected</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Vercel</span>
                  <span className="text-emerald-400">online</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Local LLM</span>
                  <span className="text-emerald-400">ready</span>
                </div>
              </div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
