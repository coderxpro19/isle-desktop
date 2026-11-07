import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { AiMsg, AiProvider } from "@/lib/types";
import { useIsland } from "../store";
import { CloseIcon } from "./icons";

export const AI_PROVIDERS: { id: AiProvider; label: string; hint: string }[] = [
  { id: "gemini", label: "Gemini", hint: "Free key from Google AI Studio" },
  { id: "openai", label: "ChatGPT", hint: "OpenAI API key" },
  { id: "anthropic", label: "Claude", hint: "Anthropic API key" },
  { id: "groq", label: "Groq", hint: "Free, very fast" },
  { id: "custom", label: "Local", hint: "Ollama / any OpenAI-compatible server" },
];

const QUICK: { label: string; prompt: (clip: string) => string }[] = [
  { label: "Summarise", prompt: (c) => `Summarise this in a few bullet points:\n\n${c}` },
  { label: "Fix grammar", prompt: (c) => `Fix the spelling and grammar. Keep my tone:\n\n${c}` },
  { label: "Translate", prompt: (c) => `Translate to English:\n\n${c}` },
  { label: "Explain", prompt: (c) => `Explain this simply:\n\n${c}` },
  { label: "Draft a reply", prompt: (c) => `Write a short, friendly reply to this message:\n\n${c}` },
];

/** Tiny Markdown: paragraphs, bullet/numbered lines, **bold** and `code`. */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
        <b key={i}>{part.slice(2, -2)}</b>
      ) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
        <code key={i} className="rounded bg-white/10 px-1 text-[11.5px]">
          {part.slice(1, -1)}
        </code>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
  return (
    <>
      {text.split("\n").map((line, i) => {
        const bullet = /^\s*([-*•]|\d+[.)])\s+/.exec(line);
        if (!line.trim()) return <div key={i} className="h-1.5" />;
        if (bullet)
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span className="shrink-0 text-white/45">{/\d/.test(bullet[1]!) ? bullet[1] : "•"}</span>
              <span>{inline(line.slice(bullet[0].length))}</span>
            </div>
          );
        const h = /^#{1,4}\s+(.*)/.exec(line);
        return (
          <div key={i} className={h ? "font-semibold text-white" : undefined}>
            {inline(h ? h[1]! : line)}
          </div>
        );
      })}
    </>
  );
}

export function AssistantPanel() {
  const backend = useIsland((s) => s.backend);
  const ai = useIsland((s) => s.settings.ai);
  const updateSettings = useIsland((s) => s.updateSettings);
  const msgs = useIsland((s) => s.aiMessages);
  const busy = useIsland((s) => s.aiBusy);
  const error = useIsland((s) => s.aiError);
  const summoned = useIsland((s) => s.summoned);
  const clip = useIsland((s) => s.clips.find((c) => c.kind === "text" && !!c.text)?.text ?? null);
  const [keys, setKeys] = useState<Record<string, boolean> | null>(null);
  const [setup, setSetup] = useState(false);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => void backend?.aiKeys().then(setKeys, () => setKeys({})), [backend]);
  useEffect(() => {
    if (summoned) requestAnimationFrame(() => input.current?.focus());
  }, [summoned]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [msgs]);

  const ready = ai.provider === "custom" || !!keys?.[ai.provider];
  if (keys && (!ready || setup)) return <Setup keys={keys} onDone={(k) => (setKeys(k), setSetup(false))} canClose={ready} />;

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy || !backend) return;
    setDraft("");
    void ask(t);
  };
  const label = AI_PROVIDERS.find((p) => p.id === ai.provider)?.label ?? ai.provider;

  return (
    <div className="flex h-full flex-col px-4 pb-3" onClick={(e) => e.stopPropagation()}>
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-white/45">
        <button type="button" onClick={() => setSetup(true)} className="rounded-md px-1.5 py-0.5 hover:bg-white/10 hover:text-white" title="Change AI provider or key">
          ✦ {label}
          {ai.model ? ` · ${ai.model}` : ""}
        </button>
        {msgs.length > 0 && (
          <button type="button" onClick={() => useIsland.setState({ aiMessages: [], aiError: null })} className="rounded-md px-1.5 py-0.5 hover:bg-white/10 hover:text-white">
            New chat
          </button>
        )}
      </div>

      <div ref={list} className="isle-scroll min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {msgs.length === 0 && (
          <div className="flex h-full flex-col justify-center gap-2">
            <div className="text-center text-[13px] font-semibold text-white/85">What can I help with?</div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {QUICK.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  disabled={!clip}
                  title={clip ? `Uses your latest copied text: “${clip.slice(0, 80)}”` : "Copy some text first"}
                  onClick={() => clip && send(q.prompt(clip))}
                  className="rounded-full bg-white/[.08] px-3 py-1 text-[11.5px] font-medium text-white/85 ring-1 ring-white/10 hover:bg-white/15 disabled:opacity-35"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <div className="text-center text-[10.5px] text-white/35">{clip ? "Quick actions use the last text you copied" : "Copy some text to use quick actions"}</div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-10 rounded-2xl rounded-br-md bg-white/[.12] px-3 py-1.5 text-[12.5px] leading-snug whitespace-pre-wrap text-white">
              {m.content.length > 400 ? `${m.content.slice(0, 400)}…` : m.content}
            </div>
          ) : (
            <div key={i} className="group mr-4 text-[12.5px] leading-relaxed text-white/90">
              <Markdown text={m.content || "…"} />
              {m.content && !(busy && i === msgs.length - 1) && (
                <div className="mt-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <Small onClick={() => void navigator.clipboard.writeText(m.content)}>Copy</Small>
                  {summoned && (
                    <Small
                      onClick={() => {
                        void backend?.aiPaste(m.content);
                        useIsland.setState({ summoned: false, hovered: false, mode: "compact" });
                      }}
                    >
                      Paste into app
                    </Small>
                  )}
                </div>
              )}
            </div>
          ),
        )}
        {error && (
          <div className="rounded-lg bg-[#ff453a]/15 px-3 py-2 text-[12px] text-[#ff8a80]">
            {error}
            {msgs.at(-1)?.role === "user" && (
              <button
                type="button"
                className="mt-1.5 block font-semibold text-white underline"
                onClick={() => {
                  const last = msgs.at(-1)!.content;
                  useIsland.setState((s) => ({ aiMessages: s.aiMessages.slice(0, -1), aiError: null }));
                  void ask(last);
                }}
              >
                Try again
              </button>
            )}
            {ai.model && /model/i.test(error) && (
              <button
                type="button"
                className="mt-1.5 block font-semibold text-white underline"
                onClick={() => {
                  updateSettings((s) => ({ ...s, ai: { ...s.ai, model: "" } }));
                  useIsland.setState({ aiError: null });
                }}
              >
                Use the recommended model instead
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-end gap-2 rounded-2xl bg-white/[.08] py-1.5 pr-1.5 pl-3 ring-1 ring-white/10 focus-within:ring-white/25">
        <textarea
          ref={input}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          placeholder="Ask anything…"
          className="isle-scroll max-h-20 min-h-[22px] flex-1 resize-none bg-transparent py-0.5 text-[12.5px] text-white outline-none placeholder:text-white/35"
          style={{ height: Math.min(80, 22 + 17 * Math.max(0, draft.split("\n").length - 1)) }}
        />
        {busy ? (
          <button type="button" aria-label="Stop" onClick={() => stop()} className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-black">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-black" />
          </button>
        ) : (
          <button type="button" aria-label="Send" disabled={!draft.trim()} onClick={() => send(draft)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-black disabled:opacity-30">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function Small({ children, onClick }: { children: ReactNode; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md bg-white/[.07] px-2 py-0.5 text-[10.5px] font-medium text-white/70 hover:bg-white/15 hover:text-white">
      {children}
    </button>
  );
}

let current: string | null = null;

/** Model ids are single tokens like "gemini-2.5-flash", "gpt-4o-mini", "llama3.2:3b". */
export function looksLikeModel(m: string): boolean {
  return /^[a-z0-9][a-z0-9._:/-]*$/i.test(m) && /[\d-]/.test(m);
}

/** Send `text` as the next user turn and stream the reply into the store. */
export async function ask(text: string) {
  const { backend, settings, aiMessages } = useIsland.getState();
  if (!backend) return;
  const history: AiMsg[] = [...aiMessages, { role: "user", content: text }];
  const id = `${Date.now()}`;
  current = id;
  useIsland.setState({ aiMessages: [...history, { role: "assistant", content: "" }], aiBusy: true, aiError: null });
  const off = backend.on("ai://chunk", (c) => {
    if (c.id !== id) return;
    useIsland.setState((s) => {
      const m = [...s.aiMessages];
      const last = m[m.length - 1]!;
      m[m.length - 1] = { ...last, content: last.content + c.delta };
      return { aiMessages: m };
    });
  });
  try {
    const full = await backend.aiAsk(id, settings.ai.provider, settings.ai.model, settings.ai.baseUrl, history.slice(-20));
    useIsland.setState((s) => {
      const m = [...s.aiMessages];
      if (full && m.length) m[m.length - 1] = { role: "assistant", content: full };
      return { aiMessages: m };
    });
  } catch (e) {
    useIsland.setState((s) => ({
      aiError: String(e).replace(/^Error:\s*/, ""),
      aiMessages: s.aiMessages.filter((m, i) => !(i === s.aiMessages.length - 1 && m.role === "assistant" && !m.content)),
    }));
  } finally {
    off();
    if (current === id) useIsland.setState({ aiBusy: false });
  }
}

function stop() {
  const { backend } = useIsland.getState();
  if (current) void backend?.aiCancel(current);
  useIsland.setState({ aiBusy: false });
}

function Setup({ keys, onDone, canClose }: { keys: Record<string, boolean>; onDone(k: Record<string, boolean>): void; canClose: boolean }) {
  const backend = useIsland((s) => s.backend);
  const ai = useIsland((s) => s.settings.ai);
  const updateSettings = useIsland((s) => s.updateSettings);
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const p = ai.provider;
  const setAi = (patch: Partial<typeof ai>) => updateSettings((s) => ({ ...s, ai: { ...s.ai, ...patch } }));

  const save = async () => {
    if (!backend) return;
    try {
      if (key.trim()) await backend.aiSetKey(p, key.trim());
      const k = await backend.aiKeys();
      setKey("");
      if (p !== "custom" && !k[p]) return setErr("Paste your API key first.");
      onDone(k);
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="flex h-full flex-col gap-2.5 px-4 pb-3" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-white">Set up the assistant</span>
        {canClose && (
          <button type="button" aria-label="Close" onClick={() => onDone(keys)} className="grid h-6 w-6 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white">
            <CloseIcon size={11} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {AI_PROVIDERS.map((x) => (
          <button
            key={x.id}
            type="button"
            title={x.hint}
            onClick={() => (setAi({ provider: x.id, model: "" }), setErr(null))}
            className={`relative rounded-xl px-1 py-2 text-[11.5px] font-semibold transition ${p === x.id ? "bg-white text-black" : "bg-white/[.07] text-white/80 ring-1 ring-white/10 hover:bg-white/12"}`}
          >
            {x.label}
            {keys[x.id] && <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-[#30d158]" />}
          </button>
        ))}
      </div>
      <div className="text-[11.5px] leading-snug text-white/50">
        {AI_PROVIDERS.find((x) => x.id === p)?.hint}.{" "}
        {p !== "custom" && (
          <button type="button" onClick={() => void backend?.aiKeyPage(p)} className="font-semibold text-[#8ab8ff] hover:underline">
            Get a key →
          </button>
        )}{" "}
        Keys stay in Windows' Credential Locker on this PC.
      </div>
      {p !== "custom" ? (
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          placeholder={keys[p] ? "Key saved — paste a new one to replace it" : "Paste your API key"}
          className="h-8 rounded-lg bg-white/[.08] px-3 text-[12px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-white/30"
        />
      ) : (
        <input
          value={ai.baseUrl}
          onChange={(e) => setAi({ baseUrl: e.target.value })}
          placeholder="Server URL (default http://localhost:11434/v1)"
          className="h-8 rounded-lg bg-white/[.08] px-3 text-[12px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-white/30"
        />
      )}
      {advanced || ai.model ? (
        <div className="flex flex-col gap-1">
          <input
            value={ai.model}
            onChange={(e) => setAi({ model: e.target.value.replace(/\s+/g, "") })}
            placeholder="AI model id, e.g. gemini-3.8-flash (empty = recommended)"
            className={`h-8 rounded-lg bg-white/[.08] px-3 text-[12px] text-white outline-none ring-1 placeholder:text-white/35 focus:ring-white/30 ${
              ai.model && !looksLikeModel(ai.model) ? "ring-[#ff453a]/60" : "ring-white/10"
            }`}
          />
          {ai.model && !looksLikeModel(ai.model) && (
            <span className="text-[11px] text-[#ff8a80]">
              That doesn't look like a model id.{" "}
              <button type="button" className="font-semibold underline" onClick={() => setAi({ model: "" })}>
                Use the recommended model
              </button>
            </span>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setAdvanced(true)} className="self-start text-[11px] text-white/40 hover:text-white/70">
          Advanced: choose a specific model…
        </button>
      )}
      {err && <div className="text-[11.5px] text-[#ff8a80]">{err}</div>}
      <div className="mt-auto flex justify-end gap-2">
        {keys[p] && p !== "custom" && (
          <button
            type="button"
            onClick={async () => {
              await backend?.aiSetKey(p, null);
              setErr(null);
              onDone(await backend!.aiKeys());
            }}
            className="h-8 rounded-full px-3 text-[12px] font-semibold text-[#ff8a80] hover:bg-white/10"
          >
            Remove key
          </button>
        )}
        <button type="button" onClick={() => void save()} className="h-8 rounded-full bg-white px-4 text-[12px] font-semibold text-black">
          Save
        </button>
      </div>
    </div>
  );
}
