import { useChat } from "@ai-sdk/react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import { Keyboard, Loader2, Mic, MicOff, PhoneOff, Settings2, Volume2, AudioLines } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ChatPanel, type Caption } from "@/components/companion/chat-panel";
import { RobotFace, type FaceState } from "@/components/companion/robot-face";
import { SettingsSheet } from "@/components/companion/settings-sheet";
import { Button } from "@/components/ui/button";
import { useAudioLevels } from "@/hooks/use-audio-levels";
import { useLiveVoice, type LiveEvent } from "@/hooks/use-live-voice";
import { supabase } from "@/integrations/supabase/client";
import { companionQuery, fetchMessages, savePersona, type ChatMessage } from "@/lib/companion-data";
import { detectExpression, type FaceExpression } from "@/lib/emotion";
import { refreshMemoryFn } from "@/lib/memory.functions";
import { getPersona, type PersonaId } from "@/lib/personas";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/talk")({
  head: () => ({
    meta: [
      { title: "گفت‌وگو با همدم" },
      { name: "description", content: "صوتی یا متنی با همدمت حرف بزن؛ شخصیت و صدایش را از تنظیمات عوض کن." },
      { property: "og:title", content: "گفت‌وگو با همدم" },
      { property: "og:description", content: "یک همراه هوشمند و همدل برای درد و دل، با صدای طبیعی." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(companionQuery),
  component: TalkPage,
});

async function accessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

function TalkPage() {
  const { data } = useSuspenseQuery(companionQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [personaId, setPersonaId] = useState<PersonaId>(data.personaId);
  const persona = getPersona(personaId);
  const personaRef = useRef(personaId);
  personaRef.current = personaId;

  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expression, setExpression] = useState<FaceExpression>("neutral");
  const expressionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [backendThinking, setBackendThinking] = useState(false);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  const react = useCallback((next: FaceExpression, holdMs = 12_000) => {
    setExpression(next);
    clearTimeout(expressionTimer.current);
    expressionTimer.current = setTimeout(() => setExpression("neutral"), holdMs);
  }, []);
  useEffect(() => () => clearTimeout(expressionTimer.current), []);

  // ---------- Text chat ----------
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: async ({ messages }) => {
          const last = messages[messages.length - 1];
          const text = last?.parts.map((part) => (part.type === "text" ? part.text : "")).join("") ?? "";
          return {
            body: { text, personaId: personaRef.current },
            headers: { Authorization: `Bearer ${await accessToken()}` },
          };
        },
      }),
    [],
  );

  const chat = useChat<ChatMessage>({
    id: "main",
    messages: data.messages,
    transport,
    onFinish: () => {
      void refreshMemoryFn({ data: {} }).catch(() => {});
    },
    onError: (error) => {
      let message = "ارسال پیام ممکن نشد. دوباره امتحان کنید.";
      try {
        const parsed = JSON.parse(error.message) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        if (error.message && !/fetch|network/i.test(error.message)) message = error.message;
      }
      toast.error(message);
    },
  });

  const sendText = useCallback(
    (text: string) => {
      react(detectExpression(text));
      void chat.sendMessage({ text, metadata: { source: "text", personaId: personaRef.current } });
    },
    [chat, react],
  );

  // ---------- Voice call ----------
  const userTurn = useRef("");
  const onVoiceEvent = useCallback(
    (event: LiveEvent) => {
      if (event.type === "app.microphone") {
        setMicStream(event["stream"] as MediaStream);
      } else if (event.type === "app.connected") {
        react("happy", 4000);
      } else if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
        const delta = typeof event["delta"] === "string" ? (event["delta"] as string) : "";
        if (!delta) return;
        const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
        if (role === "assistant") setBackendThinking(false);
        setCaptions((previous) => {
          const last = previous[previous.length - 1];
          if (last && last.role === role) {
            return [...previous.slice(0, -1), { role, text: last.text + delta }];
          }
          if (role === "user") userTurn.current = "";
          return [...previous, { role, text: delta.trimStart() }];
        });
        if (role === "user") {
          userTurn.current += delta;
          const detected = detectExpression(userTurn.current);
          if (detected !== "neutral" && detected !== "curious") react(detected);
        }
      } else if (event.type === "app.delegation.pending") {
        setBackendThinking(true);
      } else if (event.type === "app.closed") {
        setMicStream(null);
        setBackendThinking(false);
        // The server saves the call transcript when it ends; reload the shared conversation.
        const before = chat.messages.length;
        const reload = async (attempt: number) => {
          try {
            const fresh = await fetchMessages();
            if (fresh.length > before || attempt >= 3) {
              chat.setMessages(fresh);
              if (fresh.length > before) setCaptions([]);
              return;
            }
          } catch {
            if (attempt >= 3) return;
          }
          setTimeout(() => void reload(attempt + 1), 2500);
        };
        setTimeout(() => void reload(1), 1500);
      }
    },
    [chat, react],
  );

  const voice = useLiveVoice({
    onEvent: onVoiceEvent,
    getStartPayload: async () => ({ token: await accessToken(), personaId: personaRef.current }),
  });
  const levels = useAudioLevels(voice.audioRef, micStream);
  const inCall = voice.status === "connecting" || voice.status === "connected" || voice.status === "stopping";

  useEffect(() => {
    if (voice.error) toast.error(voice.error);
  }, [voice.error]);

  // Derive who is talking from live audio, a few times per second.
  useEffect(() => {
    if (voice.status !== "connected") {
      setAssistantSpeaking(false);
      setUserSpeaking(false);
      return;
    }
    const timer = setInterval(() => {
      setAssistantSpeaking(levels.current.speaker > 0.05);
      setUserSpeaking(levels.current.mic > 0.08);
    }, 120);
    return () => clearInterval(timer);
  }, [voice.status, levels]);

  const startCall = () => {
    setCaptions([]);
    voice.start();
  };

  // ---------- Persona ----------
  const selectPersona = async (id: PersonaId) => {
    if (id === personaId) return;
    setPersonaId(id);
    react("happy", 3000);
    if (inCall) {
      voice.stop();
      toast(`صدای ${getPersona(id).name} از تماس بعدی فعال می‌شود.`);
    }
    try {
      await savePersona(id);
      queryClient.setQueryData(companionQuery.queryKey, (old) => (old ? { ...old, personaId: id } : old));
    } catch {
      toast.error("ذخیره‌ی شخصیت ممکن نشد.");
    }
  };

  const signOut = async () => {
    voice.stop();
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/", replace: true });
  };

  // ---------- Face state ----------
  const chatBusy = chat.status === "submitted" || chat.status === "streaming";
  let faceState: FaceState = "idle";
  if (voice.status === "connecting") faceState = "connecting";
  else if (voice.status === "connected") {
    faceState = assistantSpeaking ? "speaking" : backendThinking ? "thinking" : "listening";
  } else if (chat.status === "submitted") faceState = "thinking";
  else if (chat.status === "streaming") faceState = "speaking";
  const textSpeaking = chat.status === "streaming" && chat.messages[chat.messages.length - 1]?.role === "assistant";

  const statusLabel: Record<FaceState, string> = {
    idle: "دکمه‌ی میکروفون را بزن تا حرف بزنیم",
    connecting: "در حال اتصال…",
    listening: userSpeaking ? "دارم گوش می‌دم…" : "می‌شنوم، بگو…",
    thinking: "دارم فکر می‌کنم…",
    speaking: `${persona.name} داره حرف می‌زنه`,
  };
  const subtitle = inCall
    ? [...captions].reverse().find((caption) => caption.role === "assistant")?.text.slice(-160)
    : undefined;

  return (
    <div data-persona={persona.id} className="flex h-dvh flex-col overflow-hidden bg-background bg-ambient lg:flex-row">
      {/* Kept mounted for the whole page: plays the companion's voice. */}
      <audio ref={voice.audioRef} className="hidden" />

      <main className={cn("flex min-h-0 flex-col lg:flex-1", mode === "voice" ? "flex-1" : "shrink-0")}>
        <header className="flex items-center justify-between gap-3 px-4 pt-safe">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pe-3 ps-1 backdrop-blur"
            aria-label="تغییر شخصیت"
          >
            <RobotFace persona={persona} state="idle" expression="neutral" size="xs" className="w-9" />
            <span className="text-start leading-tight">
              <span className="block text-sm font-bold text-glow">{persona.name}</span>
              <span className="block text-[11px] text-muted-foreground">{persona.tagline}</span>
            </span>
          </button>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full lg:hidden"
              onClick={() => setMode(mode === "voice" ? "text" : "voice")}
              aria-label={mode === "voice" ? "نوشتن" : "حالت صوتی"}
            >
              {mode === "voice" ? <Keyboard className="size-5" /> : <AudioLines className="size-5" />}
            </Button>
            <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setSettingsOpen(true)} aria-label="تنظیمات">
              <Settings2 className="size-5" />
            </Button>
          </div>
        </header>

        <section
          className={cn(
            "flex min-h-0 flex-col items-center justify-center gap-4 px-6",
            mode === "voice" ? "flex-1" : "py-2 lg:flex-1",
          )}
        >
          <RobotFace
            persona={persona}
            state={faceState}
            expression={expression}
            levels={levels}
            textSpeaking={textSpeaking}
            size={mode === "voice" ? "lg" : "sm"}
            className={cn(mode === "text" && "lg:w-[min(78vw,22rem)]")}
          />
          <div className={cn("flex min-h-16 flex-col items-center gap-2 text-center", mode === "text" && "hidden lg:flex")}>
            <p className="text-sm font-medium text-muted-foreground" aria-live="polite">
              {statusLabel[faceState]}
            </p>
            {subtitle && <p className="line-clamp-2 max-w-md text-base leading-7 text-foreground/90">{subtitle}</p>}
          </div>
        </section>

        <footer className={cn("flex items-center justify-center gap-4 px-6 pb-safe pt-2", mode === "text" && "hidden lg:flex")}>
          {voice.status === "connected" && (
            <Button
              variant="secondary"
              size="icon"
              className="size-12 rounded-full"
              onClick={() => voice.setMuted(!voice.muted)}
              aria-label={voice.muted ? "روشن کردن میکروفون" : "قطع میکروفون"}
            >
              {voice.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </Button>
          )}
          {inCall ? (
            <Button
              size="lg"
              onClick={voice.stop}
              disabled={voice.status === "stopping"}
              className="h-16 gap-2 rounded-full bg-destructive px-8 text-base text-destructive-foreground hover:bg-destructive/90"
            >
              {voice.status === "connecting" ? <Loader2 className="size-5 animate-spin" /> : <PhoneOff className="size-5" />}
              {voice.status === "connecting" ? "لغو" : "پایان گفت‌وگو"}
            </Button>
          ) : (
            <Button size="lg" onClick={startCall} className="h-16 gap-2 rounded-full px-8 text-base shadow-glow">
              <Mic className="size-5" /> شروع گفت‌وگوی صوتی
            </Button>
          )}
          {voice.playbackBlocked && (
            <Button variant="secondary" className="h-12 gap-2 rounded-full" onClick={voice.resumePlayback}>
              <Volume2 className="size-4" /> پخش صدا
            </Button>
          )}
          <Button
            variant="secondary"
            size="icon"
            className="size-12 rounded-full lg:hidden"
            onClick={() => setMode("text")}
            aria-label="نوشتن"
          >
            <Keyboard className="size-5" />
          </Button>
        </footer>
      </main>

      <aside
        className={cn(
          "min-h-0 flex-col border-border lg:flex lg:w-[440px] lg:border-s lg:bg-card/30",
          mode === "text" ? "flex flex-1" : "hidden",
        )}
      >
        <div className="hidden items-center justify-between px-5 pt-5 lg:flex">
          <h2 className="text-sm font-semibold text-muted-foreground">گفت‌وگو</h2>
        </div>
        <ChatPanel
          persona={persona}
          messages={chat.messages}
          captions={captions}
          status={chat.status}
          onSend={sendText}
          onStop={() => void chat.stop()}
          autoFocus={mode === "text"}
        />
      </aside>

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        personaId={personaId}
        onSelectPersona={(id) => void selectPersona(id)}
        onConversationCleared={() => {
          chat.setMessages([]);
          setCaptions([]);
        }}
        onSignOut={() => void signOut()}
        account={{ email: data.email, name: data.name }}
      />
    </div>
  );
}
