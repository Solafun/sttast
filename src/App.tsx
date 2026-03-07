import { useEffect, useMemo, useState } from "react";

type Tone = "neutral" | "expert" | "bold" | "friendly";
type LlmMode = "local" | "hybrid" | "cloud";
type ControlMode = "extension" | "remote" | "external";
type BridgeStatus = "disconnected" | "searching" | "connected";

type ActiveTabInfo = {
  id?: number;
  title?: string;
  url?: string;
  origin?: "extension" | "bridge";
};

type BridgeMessage = {
  source?: string;
  type?: string;
  payload?: ActiveTabInfo;
};

const modeLabels: Record<LlmMode, string> = {
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

const controlModeLabels: Record<ControlMode, string> = {
  extension: "Extension",
  remote: "Remote",
  external: "External",
};

function normalizeUrl(value: string) {
  if (!value.trim()) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `https://${value}`;
}

function getStatusClasses(status: BridgeStatus) {
  if (status === "connected") return "bg-emerald-400";
  if (status === "searching") return "bg-amber-400";
  return "bg-slate-500";
}

export function App() {
  const [controlMode, setControlMode] = useState<ControlMode>("extension");
  const [browserUrl, setBrowserUrl] = useState("https://www.threads.com/");
  const [remoteSessionInput, setRemoteSessionInput] = useState("");
  const [remoteSessionUrl, setRemoteSessionUrl] = useState("");
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>("disconnected");
  const [bridgeMessage, setBridgeMessage] = useState("Нет подключения");
  const [activeTab, setActiveTab] = useState<ActiveTabInfo | null>(null);
  const [llmMode, setLlmMode] = useState<LlmMode>("local");
  const [localModel, setLocalModel] = useState("mistral:7b-instruct");
  const [selectedTone, setSelectedTone] = useState<Tone>("expert");
  const [temperature, setTemperature] = useState(0.55);
  const [maxCommentsPerHour, setMaxCommentsPerHour] = useState(12);
  const [systemPrompt, setSystemPrompt] = useState(
    "Пиши короткий, естественный и умный комментарий без спама."
  );
  const [autoApprove, setAutoApprove] = useState(false);
  const [semanticFilter, setSemanticFilter] = useState(true);
  const [includeQuestion, setIncludeQuestion] = useState(true);

  const normalizedBrowserUrl = useMemo(() => normalizeUrl(browserUrl), [browserUrl]);
  const normalizedRemoteInput = useMemo(() => normalizeUrl(remoteSessionInput), [remoteSessionInput]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<BridgeMessage>) => {
      const data = event.data;
      if (!data || data.source !== "threads-control-bridge") return;

      if (data.type === "pong") {
        setBridgeStatus("connected");
        setBridgeMessage("Расширение обнаружено");
      }

      if (data.type === "active-tab") {
        setBridgeStatus("connected");
        setActiveTab(data.payload ?? null);
        setBridgeMessage("Активная вкладка подключена");
      }

      if (data.type === "tab-not-found") {
        setBridgeStatus("connected");
        setActiveTab(null);
        setBridgeMessage("Вкладка Threads не найдена");
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const openExternal = () => {
    if (!normalizedBrowserUrl) return;
    window.open(normalizedBrowserUrl, "_blank", "noopener,noreferrer");
  };

  const connectRemote = () => {
    if (!normalizedRemoteInput) return;
    setRemoteSessionUrl(normalizedRemoteInput);
  };

  const disconnectRemote = () => {
    setRemoteSessionUrl("");
  };

  const detectExtension = () => {
    setBridgeStatus("searching");
    setBridgeMessage("Поиск расширения...");
    window.postMessage(
      {
        source: "threads-control-panel",
        type: "ping",
      },
      "*"
    );

    window.setTimeout(() => {
      setBridgeStatus((current) => {
        if (current === "connected") return current;
        setBridgeMessage("Расширение не отвечает");
        return "disconnected";
      });
    }, 1200);
  };

  const requestActiveTab = () => {
    setBridgeStatus("searching");
    setBridgeMessage("Поиск вкладки Threads...");
    window.postMessage(
      {
        source: "threads-control-panel",
        type: "get-active-threads-tab",
      },
      "*"
    );

    window.setTimeout(() => {
      setBridgeStatus((current) => {
        if (current === "connected") return current;
        setBridgeMessage("Нет ответа от bridge");
        return "disconnected";
      });
    }, 1400);
  };

  const connectCurrentTab = () => {
    if (!activeTab?.id) return;
    window.postMessage(
      {
        source: "threads-control-panel",
        type: "attach-tab",
        payload: { id: activeTab.id },
      },
      "*"
    );
    setBridgeMessage("Команда attach отправлена");
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),_transparent_24%),linear-gradient(180deg,_#060816_0%,_#0b1020_42%,_#0f172a_100%)] text-slate-100">
      <div className="mx-auto grid min-h-screen max-w-[1800px] gap-4 p-3 md:p-4 lg:grid-cols-[1fr_24rem] lg:p-5">
        <section className="flex min-h-[680px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          <div className="border-b border-white/10 p-3">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
              <div className="flex gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </div>

              <div className="grid h-9 grid-cols-3 rounded-lg border border-white/10 bg-black/20 p-1 xl:w-[250px]">
                {(Object.keys(controlModeLabels) as ControlMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setControlMode(mode)}
                    className={`rounded-md text-xs ${
                      controlMode === mode ? "bg-indigo-500 text-white" : "text-slate-300"
                    }`}
                  >
                    {controlModeLabels[mode]}
                  </button>
                ))}
              </div>

              <input
                value={browserUrl}
                onChange={(event) => setBrowserUrl(event.target.value)}
                className="h-9 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 text-sm outline-none"
                placeholder="https://www.threads.com/"
              />

              <button
                onClick={openExternal}
                className="h-9 rounded-lg bg-indigo-500 px-4 text-sm font-medium hover:bg-indigo-400"
              >
                Открыть
              </button>
            </div>
          </div>

          {controlMode === "extension" ? (
            <div className="flex flex-1 flex-col bg-black/20 p-4">
              <div className="mb-4 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${getStatusClasses(bridgeStatus)}`} />
                  <span className="text-sm">{bridgeMessage}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={detectExtension}
                    className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm hover:bg-white/10"
                  >
                    Найти bridge
                  </button>
                  <button
                    onClick={requestActiveTab}
                    className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm hover:bg-white/10"
                  >
                    Найти вкладку
                  </button>
                </div>
              </div>

              <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="text-sm font-medium">Текущая вкладка</div>
                    <button
                      onClick={connectCurrentTab}
                      disabled={!activeTab?.id}
                      className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Взять контроль
                    </button>
                  </div>

                  <div className="space-y-3 text-sm text-slate-300">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-1 text-xs text-slate-400">Title</div>
                      <div>{activeTab?.title || "—"}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-1 text-xs text-slate-400">URL</div>
                      <div className="break-all">{activeTab?.url || "—"}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-1 text-xs text-slate-400">Tab ID</div>
                      <div>{activeTab?.id ?? "—"}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                  <div className="mb-3 font-medium text-slate-100">Как это работает</div>
                  <div className="space-y-3">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      1. Открыть Threads в обычной вкладке браузера
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      2. Расширение находит вкладку через Chrome Tabs API
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      3. Панель отправляет команды в extension/local bridge
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      4. Уже extension управляет страницей Threads
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : controlMode === "remote" ? (
            <div className="flex flex-1 flex-col">
              <div className="flex flex-col gap-2 border-b border-white/10 p-3 md:flex-row">
                <input
                  value={remoteSessionInput}
                  onChange={(event) => setRemoteSessionInput(event.target.value)}
                  className="h-9 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 text-sm outline-none"
                  placeholder="https://remote-session-url"
                />
                {remoteSessionUrl ? (
                  <button
                    onClick={disconnectRemote}
                    className="h-9 rounded-lg bg-rose-500 px-4 text-sm font-medium hover:bg-rose-400"
                  >
                    Отключить
                  </button>
                ) : (
                  <button
                    onClick={connectRemote}
                    className="h-9 rounded-lg bg-emerald-500 px-4 text-sm font-medium hover:bg-emerald-400"
                  >
                    Подключить
                  </button>
                )}
              </div>

              {remoteSessionUrl ? (
                <iframe title="Remote Browser Session" src={remoteSessionUrl} className="h-full w-full bg-white" />
              ) : (
                <div className="flex flex-1 items-center justify-center bg-black/20 p-6">
                  <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-slate-300">
                    Remote session
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center bg-black/20 p-6">
              <a
                href={normalizedBrowserUrl || "https://www.threads.com/"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium hover:bg-white/10"
              >
                Открыть Threads
              </a>
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-4 grid grid-cols-3 gap-1">
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
                  checked={semanticFilter}
                  onChange={() => setSemanticFilter((value) => !value)}
                  className="h-4 w-4"
                />
              </label>
              <label className="flex items-center justify-between text-sm">
                <span>Question ending</span>
                <input
                  type="checkbox"
                  checked={includeQuestion}
                  onChange={() => setIncludeQuestion((value) => !value)}
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
