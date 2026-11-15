import { useChat } from "@ai-sdk/react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import { Keyboard, Loader2, Mic, MicOff, PhoneOff, Settings2, Volume2, AudioLines, SquarePen, Hand } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ChatPanel, type Caption } from "@/components/companion/chat-panel";
import { RobotFace, type FaceState } from "@/components/companion/robot-face";
import { SettingsSheet, type SettingsView } from "@/components/companion/settings-sheet";
import { Button } from "@/components/ui/button";
import { useAudioLevels } from "@/hooks/use-audio-levels";
import { useLiveVoice, type LiveEvent } from "@/hooks/use-live-voice";
import { browserSpeechSupported, useSpeechChat } from "@/hooks/use-speech-chat";
import { supabase } from "@/integrations/supabase/client";
import {
  companionQuery,
  conversationQuery,
  conversationsQuery,
  createConversation,
  fetchMessages,
  resolveConversation,
  savePersona,
  type ChatMessage,
} from "@/lib/companion-data";
import { detectExpression, type FaceExpression } from "@/lib/emotion";
import { refreshMemoryFn } from "@/lib/memory.functions";
import { getPersona, type PersonaId } from "@/lib/personas";
import { cn } from "@/lib/utils";

const CHAT_STALL_TIMEOUT_MS = 120_000;

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
  validateSearch: (search: Record<string, unknown>): { c?: string } =>
    typeof search["c"] === "string" ? { c: search["c"] } : {},
  loaderDeps: ({ search }) => ({ c: search.c }),
  loader: async ({ context, deps }) => {
    const account = await context.queryClient.ensureQueryData(companionQuery);
    // Without a conversation in the URL, open the current persona's latest one.
    if (!deps.c) {
      throw redirect({ to: "/talk", search: { c: await resolveConversation(account.personaId) }, replace: true });
    }
    const conversation = await context.queryClient.fetchQuery({ ...conversationQuery(deps.c), staleTime: 0 });
    if (!conversation) throw redirect({ to: "/talk", search: {}, replace: true });
  },
  component: TalkPage,
});

function messageText(message: ChatMessage) {
  return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function lastAssistantId(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === "assistant") return messages[index]!.id;
  }
  return null;
}

async function accessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

function TalkPage() {
  const { c } = Route.useSearch();
  const [mode, setMode] = useState<"voice" | "text">("voice");
  if (!c) return null;
  // Each conversation gets a fresh chat + call state, so messages never bleed between them.
  return <TalkView key={c} conversationId={c} mode={mode} setMode={setMode} />;
}

function TalkView({
  conversationId,
  mode,
  setMode,
}: {
  conversationId: string;
  mode: "voice" | "text";
  setMode: (mode: "voice" | "text") => void;
}) {
  const { data } = useSuspenseQuery(companionQuery);
  const { data: conversation } = useSuspenseQuery(conversationQuery(conversationId));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const personaId: PersonaId = conversation?.personaId ?? data.personaId;
  const persona = getPersona(personaId);
  const personaRef = useRef(personaId);
  personaRef.current = personaId;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>("main");
  const openSettings = (view: SettingsView) => {
    setSettingsView(view);
    setSettingsOpen(true);
  };

  // Remember the persona of the conversation being viewed for next time.
  useEffect(() => {
    if (data.personaId === personaId) return;
    savePersona(personaId)
      .then(() => queryClient.setQueryData(companionQuery.queryKey, (old) => (old ? { ...old, personaId } : old)))
      .catch(() => {});
  }, [data.personaId, personaId, queryClient]);
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
  const messagesRef = useRef<ChatMessage[]>([]);
  const chatRef = useRef<{ clearError: () => void } | null>(null);
  // Last assistant message before the current request, so an old reply is never mistaken for the new one.
  const replyBaseline = useRef<string | null>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: async ({ messages }) => {
          const last = messages[messages.length - 1];
          const text = last?.parts.map((part) => (part.type === "text" ? part.text : "")).join("") ?? "";
          const source = last?.metadata?.source === "voice" ? "voice" : "text";
          return {
            body: { text, conversationId, source },
            headers: { Authorization: `Bearer ${await accessToken()}` },
          };
        },
      }),
    [conversationId],
  );

  const chat = useChat<ChatMessage>({
    id: conversationId,
    messages: conversation?.messages ?? [],
    transport,
    onFinish: () => {
      void queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
      void refreshMemoryFn({ data: {} }).catch(() => {});
    },
    onError: (error) => {
      // A reply that already arrived in full is never followed by an error message.
      const last = messagesRef.current[messagesRef.current.length - 1];
      if (last?.role === "assistant" && last.id !== replyBaseline.current && messageText(last).trim()) {
        console.warn("Ignoring chat error after a complete reply", error);
        chatRef.current?.clearError();
        return;
      }
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

  messagesRef.current = chat.messages;
  chatRef.current = chat;

  // Last-resort watchdog: if nothing arrives for a long stretch, stop waiting instead of spinning forever.
  const chatWaiting = chat.status === "submitted" || chat.status === "streaming";
  const lastChatMessage = chat.messages[chat.messages.length - 1];
  const lastChatProgress = lastChatMessage
    ? `${lastChatMessage.id}:${lastChatMessage.parts.map((part) => (part.type === "text" ? part.text.length : 0)).join(",")}`
    : "";
  const stopChatRef = useRef(chat.stop);
  stopChatRef.current = chat.stop;
  useEffect(() => {
    if (!chatWaiting) return;
    const timer = setTimeout(() => {
      void stopChatRef.current();
      toast.error("پاسخی نیامد. اتصال یا سرویس هوش مصنوعی را بررسی کنید و دوباره امتحان کنید.");
    }, CHAT_STALL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [chatWaiting, lastChatProgress]);

  const sendChat = useCallback(
    (text: string, source: "text" | "voice") => {
      react(detectExpression(text));
      replyBaseline.current = lastAssistantId(messagesRef.current);
      void chat.sendMessage({ text, metadata: { source, personaId: personaRef.current } });
    },
    [chat, react],
  );
  const sendText = useCallback((text: string) => sendChat(text, "text"), [sendChat]);

  // ---------- Free voice mode (browser speech → /api/chat → browser voice) ----------
  const [speechSupported, setSpeechSupported] = useState(false);
  useEffect(() => setSpeechSupported(browserSpeechSupported()), []);
  const awaitingSpokenReply = useRef(false);
  const speech = useSpeechChat({
    gender: persona.gender,
    tuning: persona.speech,
    onUtterance: (text) => {
      awaitingSpokenReply.current = true;
      sendChat(text, "voice");
    },
    onError: (message) => toast.error(message),
    onNoPersianVoice: () =>
      toast("این دستگاه صدای فارسی ندارد؛ پاسخ‌ها نوشته نمایش داده می‌شوند. برای شنیدن صدا، Microsoft Edge یا Chrome اندروید را امتحان کن.", {
        duration: 8000,
      }),
  });
  const speechFeed = useRef(speech);
  speechFeed.current = speech;
  const lastMessage = chat.messages[chat.messages.length - 1];
  const lastText = lastMessage ? messageText(lastMessage) : "";
  useEffect(() => {
    if (!speech.active || !awaitingSpokenReply.current) return;
    const done = chat.status === "ready" || chat.status === "error";
    const isNewReply = lastMessage?.role === "assistant" && lastMessage.id !== replyBaseline.current;
    if (isNewReply) {
      speechFeed.current.feedReply(lastMessage.id, lastText, done);
      if (done) awaitingSpokenReply.current = false;
    } else if (done) {
      awaitingSpokenReply.current = false;
      speechFeed.current.replyFailed();
    }
  }, [speech.active, chat.status, lastMessage?.id, lastMessage?.role, lastText]);

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
            const fresh = await fetchMessages(conversationId);
            if (fresh.length > before || attempt >= 3) {
              chat.setMessages(fresh);
              if (fresh.length > before) {
                setCaptions([]);
                void queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
              }
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
    [chat, react, conversationId, queryClient],
  );

  const voice = useLiveVoice({
    onEvent: onVoiceEvent,
    getStartPayload: async () => ({ token: await accessToken(), conversationId }),
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
    // Free browser voice first; the paid live call only where the browser has no speech recognition.
    if (speechSupported && speech.start()) return;
    voice.start();
  };

  // ---------- Persona & conversations ----------
  const openConversation = (id: string) => {
    setSettingsOpen(false);
    if (id === conversationId) return;
    if (inCall) voice.stop();
    speech.stop();
    void navigate({ to: "/talk", search: { c: id } });
  };

  const selectPersona = async (id: PersonaId) => {
    setSettingsOpen(false);
    if (id === personaId) return;
    if (inCall) voice.stop();
    speech.stop();
    try {
      await savePersona(id);
      queryClient.setQueryData(companionQuery.queryKey, (old) => (old ? { ...old, personaId: id } : old));
      void navigate({ to: "/talk", search: { c: await resolveConversation(id) } });
    } catch {
      toast.error("تغییر شخصیت ممکن نشد. دوباره امتحان کنید.");
    }
  };

  const newConversation = async (forPersona: PersonaId = personaId) => {
    if (forPersona === personaId && chat.messages.length === 0 && captions.length === 0) {
      setSettingsOpen(false);
      toast("همین الان یک گفت‌وگوی تازه باز است.");
      return;
    }
    if (inCall) voice.stop();
    try {
      const id = await createConversation(forPersona);
      void queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
      setSettingsOpen(false);
      void navigate({ to: "/talk", search: { c: id } });
    } catch {
      toast.error("شروع گفت‌وگوی جدید ممکن نشد.");
    }
  };

  const signOut = async () => {
    voice.stop();
    speech.stop();
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/", replace: true });
  };

  // ---------- Face state ----------
  const chatBusy = chat.status === "submitted" || chat.status === "streaming";
  let faceState: FaceState = "idle";
  if (speech.active) faceState = speech.status === "idle" ? "idle" : speech.status;
  else if (voice.status === "connecting") faceState = "connecting";
  else if (voice.status === "connected") {
    faceState = assistantSpeaking ? "speaking" : backendThinking ? "thinking" : "listening";
  } else if (chat.status === "submitted") faceState = "thinking";
  else if (chat.status === "streaming") faceState = "speaking";
  const textSpeaking = speech.active
    ? speech.status === "speaking"
    : chat.status === "streaming" && chat.messages[chat.messages.length - 1]?.role === "assistant";

  const statusLabel: Record<FaceState, string> = {
    idle: "دکمه‌ی میکروفون را بزن تا حرف بزنیم",
    connecting: "در حال اتصال…",
    listening: userSpeaking || (speech.active && speech.heard) ? "دارم گوش می‌دم…" : "می‌شنوم، بگو…",
    thinking: "دارم فکر می‌کنم…",
    speaking: `${persona.name} داره حرف می‌زنه`,
  };
  let subtitle = inCall
    ? [...captions].reverse().find((caption) => caption.role === "assistant")?.text.slice(-160)
    : undefined;
  if (speech.active) {
    subtitle =
      speech.status === "speaking" && lastMessage?.role === "assistant"
        ? lastText.trim().slice(-160)
        : speech.heard || undefined;
  }

  return (
    <div data-persona={persona.id} className="flex h-dvh flex-col overflow-hidden bg-background bg-ambient lg:flex-row">
      {/* Kept mounted for the whole page: plays the companion's voice. */}
      <audio ref={voice.audioRef} className="hidden" />

      <main className={cn("flex min-h-0 flex-col lg:flex-1", mode === "voice" ? "flex-1" : "shrink-0")}>
        <header className="flex items-center justify-between gap-3 px-4 pt-safe">
          <button
            type="button"
            onClick={() => openSettings("persona")}
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
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => void newConversation()}
              aria-label="گفت‌وگوی جدید"
              title="گفت‌وگوی جدید"
            >
              <SquarePen className="size-5" />
            </Button>
            <Button variant="ghost" size="icon" className="rounded-full" onClick={() => openSettings("main")} aria-label="تنظیمات">
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
          {speech.active ? (
            <>
              {speech.status === "speaking" && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="size-12 rounded-full"
                  onClick={speech.interrupt}
                  aria-label="حرفش را قطع کن و خودت بگو"
                  title="حرفش را قطع کن و خودت بگو"
                >
                  <Hand className="size-5" />
                </Button>
              )}
              <Button
                size="lg"
                onClick={speech.stop}
                className="h-16 gap-2 rounded-full bg-destructive px-8 text-base text-destructive-foreground hover:bg-destructive/90"
              >
                <PhoneOff className="size-5" /> پایان گفت‌وگو
              </Button>
            </>
          ) : inCall ? (
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
        view={settingsView}
        onViewChange={setSettingsView}
        personaId={personaId}
        conversationId={conversationId}
        onSelectPersona={(id) => void selectPersona(id)}
        onOpenConversation={openConversation}
        onNewConversation={(id) => void newConversation(id)}
        onConversationDeleted={(id) => {
          if (id !== conversationId) return;
          setSettingsOpen(false);
          if (inCall) voice.stop();
          void navigate({ to: "/talk", search: {}, replace: true });
        }}
        onAllConversationsCleared={() => {
          setSettingsOpen(false);
          if (inCall) voice.stop();
          void navigate({ to: "/talk", search: {}, replace: true });
        }}
        onSignOut={() => void signOut()}
        account={{ email: data.email, name: data.name, phone: data.phone, isAnonymous: data.isAnonymous }}
      />
    </div>
  );
}
