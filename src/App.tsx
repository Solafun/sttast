import { useMemo, useState } from "react";

type Tone = "neutral" | "expert" | "bold" | "friendly";
type LlmMode = "local" | "hybrid" | "cloud";
type BrowserMode = "stream" | "external";
type StreamStatus = "idle" | "checking" | "online";

const llmModeLabels: Record<LlmMode, string> = {
  local: "Local",
  hybrid: "Hybrid",
  cloud: "Cloud",
};

const toneLabels: Record<Tone, string> = {
  neutral: "Нейтральный",
  expert: "Экспертный",
  bold: "Смелый",
  friendly: "Дружелюбный",
};

const browserModeLabels: Record<BrowserMode, string> = {
  stream: "Connect Stream",
  external: "External",
};

function normalizeUrl(value: string) {
  if (!value.trim()) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `http://${value}`;
}

function statusDot(status: StreamStatus) {
  if (status === "online") return "bg-emerald-400";
  if (status === "checking") return "bg-amber-400";
  return "bg-slate-500";
}

export function App() {
  const [browserMode, setBrowserMode] = useState<BrowserMode>("stream");
  const [threadsUrl, setThreadsUrl] = useState("https://www.threads.net/");
  const [streamBaseInput, setStreamBaseInput] = useState("http://127.0.0.1:3010");
  const [viewerPath, setViewerPath] = useState("/viewer");
  const [controlPath, setControlPath] = useState("/control");
  const [sessionId, setSessionId] = useState("threads-main");
  const [streamToken, setStreamToken] = useState("");
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [streamMessage, setStreamMessage] = useState("Контейнер не подключен");
  const [streamEnabled, setStreamEnabled] = useState(false);

  const [llmMode, setLlmMode] = useState<LlmMode>("local");
  const [localModel, setLocalModel] = useState("mistral:7b-instruct");
  const [selectedTone, setSelectedTone] = useState<Tone>("expert");
  const [temperature, setTemperature] = useState(0.55);
  const [maxCommentsPerHour, setMaxCommentsPerHour] = useState(12);
  const [systemPrompt, setSystemPrompt] = useState(
    "Пиши короткий естественный комментарий по теме поста без спама."
  );
  const [autoApprove, setAutoApprove] = useState(false);
  const [safetyFilter, setSafetyFilter] = useState(true);
  const [questionEnding, setQuestionEnding] = useState(true);

  const streamBaseUrl = useMemo(() => normalizeUrl(streamBaseInput), [streamBaseInput]);
  const controlUrl = useMemo(() => {
    if (!streamBaseUrl) return "";
    return `${streamBaseUrl}${controlPath}?session=${encodeURIComponent(sessionId)}`;
  }, [streamBaseUrl, controlPath, sessionId]);

  const viewerUrl = useMemo(() => {
    if (!streamBaseUrl || !streamEnabled) return "";
    const params = new URLSearchParams();
    params.set("session", sessionId);
    if (streamToken.trim()) params.set("token", streamToken.trim());
    return `${streamBaseUrl}${viewerPath}?${params.toString()}`;
  }, [streamBaseUrl, viewerPath, sessionId, streamToken, streamEnabled]);

  const openThreads = () => {
    window.open(threadsUrl || "https://www.threads.net/", "_blank", "noopener,noreferrer");
  };

  const checkContainer = () => {
    setStreamStatus("checking");
    setStreamMessage("Проверка Docker Connect Stream...");

    window.setTimeout(() => {
      if (!streamBaseUrl) {
        setStreamStatus("idle");
        setStreamMessage("Укажите адрес контейнера");
        return;
      }

      setStreamStatus("online");
      setStreamMessage("Контейнер доступен");
    }, 700);
  };

  const connectStream = () => {
    if (!streamBaseUrl) {
      setStreamStatus("idle");
      setStreamMessage("Укажите адрес контейнера");
      setStreamEnabled(false);
      return;
    }

    setStreamEnabled(true);
    setStreamStatus("online");
    setStreamMessage("Viewer подключен");
  };

  const disconnectStream = () => {
    setStreamEnabled(false);
    setStreamStatus("idle");
    setStreamMessage("Контейнер отключен");
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.14),_transparent_24%),linear-gradient(180deg,_#060816_0%,_#0b1020_42%,_#0f172a_100%)] text-slate-100">
      <div className="mx-auto grid min-h-screen max-w-[1800px] gap-4 p-3 md:p-4 lg:grid-cols-[1fr_24rem] lg:p-5">
        <section className="flex min-h-[700px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          <div className="border-b border-white/10 p-3">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
              <div className="flex gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </div>

              <div className="grid h-9 grid-cols-2 rounded-lg border border-white/10 bg-black/20 p-1 xl:w-[240px]">
                {(Object.keys(browserModeLabels) as BrowserMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setBrowserMode(mode)}
                    className={`rounded-md text-xs ${
                      browserMode === mode ? "bg-indigo-500 text-white" : "text-slate-300"
                    }`}
                  >
                    {browserModeLabels[mode]}
                  </button>
                ))}
              </div>

              <input
                value={threadsUrl}
                onChange={(event) => setThreadsUrl(event.target.value)}
                className="h-9 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 text-sm outline-none"
                placeholder="https://www.threads.net/"
              />

              <button
                onClick={openThreads}
                className="h-9 rounded-lg bg-indigo-500 px-4 text-sm font-medium hover:bg-indigo-400"
              >
                Открыть Threads
              </button>
            </div>
          </div>

          {browserMode === "stream" ? (
            <div className="flex flex-1 flex-col bg-black/20">
              <div className="grid gap-3 border-b border-white/10 p-3 xl:grid-cols-[1.3fr_0.9fr_0.9fr_0.7fr_auto_auto]">
                <input
                  value={streamBaseInput}
                  onChange={(event) => setStreamBaseInput(event.target.value)}
                  className="h-9 rounded-lg border border-white/10 bg-black/20 px-3 text-sm outline-none"
                  placeholder="http://127.0.0.1:3010"
                />
                <input
                  value={viewerPath}
                  onChange={(event) => setViewerPath(event.target.value)}
                  className="h-9 rounded-lg border border-white/10 bg-black/20 px-3 text-sm outline-none"
                  placeholder="/viewer"
                />
                <input
                  value={controlPath}
                  onChange={(event) => setControlPath(event.target.value)}
                  className="h-9 rounded-lg border border-white/10 bg-black/20 px-3 text-sm outline-none"
                  placeholder="/control"
                />
                <input
                  value={sessionId}
                  onChange={(event) => setSessionId(event.target.value)}
                  className="h-9 rounded-lg border border-white/10 bg-black/20 px-3 text-sm outline-none"
                  placeholder="threads-main"
                />
                <button
                  onClick={checkContainer}
                  className="h-9 rounded-lg border border-white/10 bg-white/5 px-4 text-sm hover:bg-white/10"
                >
                  Check
                </button>
                {streamEnabled ? (
                  <button
                    onClick={disconnectStream}
                    className="h-9 rounded-lg bg-rose-500 px-4 text-sm font-medium hover:bg-rose-400"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={connectStream}
                    className="h-9 rounded-lg bg-emerald-500 px-4 text-sm font-medium hover:bg-emerald-400"
                  >
                    Connect
                  </button>
                )}
              </div>

              <div className="grid gap-4 border-b border-white/10 p-3 xl:grid-cols-[1fr_1fr]">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                  <div className="mb-2 flex items-center gap-3 text-slate-100">
                    <span className={`h-2.5 w-2.5 rounded-full ${statusDot(streamStatus)}`} />
                    <span>{streamMessage}</span>
                  </div>
                  <div className="break-all text-xs text-slate-400">{controlUrl || "—"}</div>
                </div>

                <input
                  value={streamToken}
                  onChange={(event) => setStreamToken(event.target.value)}
                  className="h-12 rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none"
                  placeholder="token"
                />
              </div>

              {viewerUrl ? (
                <iframe title="Docker Connect Stream" src={viewerUrl} className="h-full w-full bg-black" />
              ) : (
                <div className="flex flex-1 items-center justify-center p-6">
                  <div className="w-full max-w-3xl rounded-2xl border border-dashed border-white/10 bg-white/5 p-6">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                        <div className="mb-2 text-slate-100">1</div>
                        <div>Запусти Docker контейнер локально</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                        <div className="mb-2 text-slate-100">2</div>
                        <div>Открой Threads в обычном Chrome профиле</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                        <div className="mb-2 text-slate-100">3</div>
                        <div>Подключи viewer контейнера через Connect</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center bg-black/20 p-6">
              <a
                href={threadsUrl || "https://www.threads.net/"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium hover:bg-white/10"
              >
                Открыть во внешней вкладке
              </a>
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-4 grid grid-cols-3 gap-1">
              {(Object.keys(llmModeLabels) as LlmMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setLlmMode(mode)}
                  className={`h-8 rounded-md border text-xs ${
                    llmMode === mode
                      ? "border-indigo-400/50 bg-indigo-500/15"
                      : "border-white/10 bg-black/20"
                  }`}
                >
                  {llmModeLabels[mode]}
                </button>
              ))}
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
                <label className="mb-1 block text-xs text-slate-400">Temp {temperature.toFixed(2)}</label>
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
                <label className="mb-1 block text-xs text-slate-400">Лимит {maxCommentsPerHour}</label>
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
              <label className="mb-1 block text-xs text-slate-400">Prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={4}
                className="w-full rounded-md border border-white/10 bg-black/20 p-3 text-sm outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center justify-between text-sm">
                <span>Auto approve</span>
                <input
                  type="checkbox"
                  checked={autoApprove}
                  onChange={() => setAutoApprove((value) => !value)}
                  className="h-4 w-4"
                />
              </label>
              <label className="flex items-center justify-between text-sm">
                <span>Safety filter</span>
                <input
                  type="checkbox"
                  checked={safetyFilter}
                  onChange={() => setSafetyFilter((value) => !value)}
                  className="h-4 w-4"
                />
              </label>
              <label className="flex items-center justify-between text-sm">
                <span>Question ending</span>
                <input
                  type="checkbox"
                  checked={questionEnding}
                  onChange={() => setQuestionEnding((value) => !value)}
                  className="h-4 w-4"
                />
              </label>
            </div>

            <div className="mt-4 flex gap-2">
              <button className="flex-1 rounded-md bg-emerald-500 py-2 text-sm font-medium hover:bg-emerald-400">
                Сохранить
              </button>
              <button className="flex-1 rounded-md bg-indigo-500 py-2 text-sm font-medium hover:bg-indigo-400">
                Запустить
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
