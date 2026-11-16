import { useCallback, useEffect, useRef, useState } from "react";

import { pickPersianVoice, takeSpeakable } from "@/lib/speech-text";

/**
 * Free voice conversation (no paid live session):
 * - hearing: the browser's SpeechRecognition, or Android's own recognizer inside the app (Capacitor plugin);
 * - thinking: the normal text chat (/api/chat);
 * - speaking: natural Persian neural voices from /api/tts, sentence by sentence, prefetched while the
 *   previous sentence plays. Falls back to the device's Persian voice, then to captions only.
 */
export type SpeechStatus = "idle" | "listening" | "thinking" | "speaking";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;

type CapacitorGlobal = { isNativePlatform?: () => boolean; isPluginAvailable?: (name: string) => boolean };

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Inside the Android app: the native speech recognizer plugin is available. */
function nativeRecognitionAvailable() {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(cap?.isNativePlatform?.() && cap.isPluginAvailable?.("SpeechRecognition"));
}

/** Whether this device can run the free voice mode (call after hydration). */
export function browserSpeechSupported() {
  return nativeRecognitionAvailable() || recognitionCtor() !== null;
}

const isAndroidBrowser = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/** Quiet time after the last heard word before the sentence is sent. */
const END_OF_SPEECH_MS = 900;
const END_OF_SPEECH_INTERIM_MS = 1400;
const MAX_QUIET_RESTARTS = 40;

type Options = {
  personaId: string;
  gender: "female" | "male";
  tuning: { pitch: number; rate: number };
  getToken: () => Promise<string>;
  /** The user finished a sentence: send it to the chat. */
  onUtterance: (text: string) => void;
  onError: (message: string) => void;
  /** Shown once when no voice can be played (replies then appear as captions only). */
  onNoVoice: () => void;
};

type QueueItem = { text: string; audio: Promise<AudioBuffer | null> };

export function useSpeechChat(options: Options) {
  const [status, setStatusState] = useState<SpeechStatus>("idle");
  const [heard, setHeard] = useState("");
  const [playingAudio, setPlayingAudio] = useState(false);
  const statusRef = useRef<SpeechStatus>("idle");
  const latest = useRef(options);
  latest.current = options;

  const active = useRef(false);
  const session = useRef(0);
  const recognition = useRef<Recognition | null>(null);
  const nativeListening = useRef(false);
  const restarts = useRef(0);
  const endTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const levelBuffer = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const queue = useRef<QueueItem[]>([]);
  const busy = useRef(false);
  const currentSource = useRef<AudioBufferSourceNode | null>(null);
  const silentTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const generation = useRef(0);
  const reply = useRef<{ id: string; offset: number; done: boolean } | null>(null);
  const noVoiceNoticed = useRef(false);
  const ignoredReply = useRef<string | null>(null);

  const setStatus = useCallback((next: SpeechStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  // ---------- Hearing ----------
  const stopRecognition = useCallback(() => {
    clearTimeout(endTimer.current);
    session.current += 1;
    const rec = recognition.current;
    recognition.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      rec.onspeechstart = null;
      try {
        rec.abort();
      } catch {
        // Already stopped.
      }
    }
    if (nativeListening.current) {
      nativeListening.current = false;
      void import("@capacitor-community/speech-recognition")
        .then(({ SpeechRecognition }) => SpeechRecognition.stop())
        .catch(() => {});
    }
  }, []);

  // ---------- Speaking ----------
  const stopSpeaking = useCallback(() => {
    generation.current += 1;
    queue.current = [];
    busy.current = false;
    clearTimeout(silentTimer.current);
    const source = currentSource.current;
    currentSource.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Not started.
      }
    }
    setPlayingAudio(false);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const stop = useCallback(() => {
    active.current = false;
    reply.current = null;
    stopRecognition();
    stopSpeaking();
    setHeard("");
    setStatus("idle");
  }, [setStatus, stopRecognition, stopSpeaking]);

  const handleHeard = useCallback(
    (text: string) => {
      restarts.current = 0;
      setStatus("thinking");
      latest.current.onUtterance(text);
    },
    [setStatus],
  );

  const quietRestart = useCallback(
    (again: () => void) => {
      restarts.current += 1;
      if (restarts.current > MAX_QUIET_RESTARTS) {
        stop();
        return;
      }
      const mySession = session.current;
      setTimeout(() => {
        if (active.current && statusRef.current === "listening" && session.current === mySession) again();
      }, 250);
    },
    [stop],
  );

  const listenNative = useCallback(async () => {
    const mySession = session.current;
    setHeard("");
    setStatus("listening");
    try {
      const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
      let permission = await SpeechRecognition.checkPermissions();
      if (permission.speechRecognition !== "granted") permission = await SpeechRecognition.requestPermissions();
      if (permission.speechRecognition !== "granted") {
        latest.current.onError("اجازه‌ی میکروفون داده نشده. از تنظیمات گوشی به همدم اجازه‌ی میکروفون بده.");
        stop();
        return;
      }
      if (session.current !== mySession || !active.current) return;
      nativeListening.current = true;
      const result = await SpeechRecognition.start({ language: "fa-IR", maxResults: 1, partialResults: false, popup: false });
      nativeListening.current = false;
      if (session.current !== mySession || !active.current) return;
      const text = result?.matches?.[0]?.trim() ?? "";
      if (text) {
        setHeard(text);
        handleHeard(text);
      } else {
        quietRestart(() => void listenNativeRef.current());
      }
    } catch (error) {
      nativeListening.current = false;
      if (session.current !== mySession || !active.current) return;
      const message = error instanceof Error ? error.message : String(error);
      if (/permission/i.test(message)) {
        latest.current.onError("اجازه‌ی میکروفون داده نشده. از تنظیمات گوشی به همدم اجازه‌ی میکروفون بده.");
        stop();
      } else if (/not available|unavailable/i.test(message)) {
        latest.current.onError("تشخیص گفتار روی این گوشی فعال نیست. برنامه‌ی Google را نصب یا به‌روز کن.");
        stop();
      } else if (/network/i.test(message)) {
        latest.current.onError("تشخیص گفتار به اینترنت نیاز دارد؛ اتصالت را بررسی کن.");
        stop();
      } else {
        // No speech / no match / busy: keep listening hands-free.
        quietRestart(() => void listenNativeRef.current());
      }
    }
  }, [handleHeard, quietRestart, setStatus, stop]);
  const listenNativeRef = useRef(listenNative);
  listenNativeRef.current = listenNative;

  const listenWeb = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setHeard("");
    setStatus("listening");
    const rec = new Ctor();
    rec.lang = "fa-IR";
    // Continuous keeps one microphone session open on desktop instead of restarting every few seconds.
    // Android Chrome repeats words in continuous mode, so it uses single-utterance sessions.
    rec.continuous = !isAndroidBrowser();
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finals = "";
    let interim = "";
    let sent = false;
    const finish = () => {
      clearTimeout(endTimer.current);
      const text = `${finals} ${interim}`.replace(/\s+/g, " ").trim();
      if (sent || !text || recognition.current !== rec) return;
      sent = true;
      stopRecognition();
      handleHeard(text);
    };
    rec.onspeechstart = () => {
      restarts.current = 0;
    };
    rec.onresult = (event) => {
      finals = "";
      interim = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]!;
        if (result.isFinal) finals += ` ${result[0].transcript}`;
        else interim += ` ${result[0].transcript}`;
      }
      setHeard(`${finals} ${interim}`.replace(/\s+/g, " ").trim());
      // Our own end-of-speech detection: send soon after the user pauses instead of waiting for the browser.
      clearTimeout(endTimer.current);
      endTimer.current = setTimeout(finish, interim.trim() ? END_OF_SPEECH_INTERIM_MS : END_OF_SPEECH_MS);
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        latest.current.onError("اجازه‌ی میکروفون داده نشده. از تنظیمات مرورگر اجازه بده و دوباره امتحان کن.");
        stop();
      } else if (event.error === "network") {
        latest.current.onError("تشخیص گفتار به اینترنت نیاز دارد؛ اتصالت را بررسی کن.");
        stop();
      } else if (event.error === "language-not-supported") {
        latest.current.onError("این مرورگر تشخیص گفتار فارسی ندارد. با Chrome امتحان کن، یا بنویس.");
        stop();
      } else if (event.error === "audio-capture") {
        latest.current.onError("میکروفون پیدا نشد یا برنامه‌ی دیگری از آن استفاده می‌کند.");
        stop();
      }
      // "no-speech" / "aborted": onend restarts listening.
    };
    rec.onend = () => {
      if (recognition.current !== rec) return;
      if (`${finals} ${interim}`.trim()) {
        finish();
        return;
      }
      recognition.current = null;
      if (!active.current) return;
      quietRestart(() => listenRef.current());
    };
    recognition.current = rec;
    try {
      rec.start();
    } catch {
      latest.current.onError("میکروفون شروع نشد. دوباره امتحان کن.");
      stop();
    }
  }, [handleHeard, quietRestart, setStatus, stop, stopRecognition]);

  const listen = useCallback(() => {
    if (!active.current) return;
    stopRecognition();
    if (nativeRecognitionAvailable()) void listenNative();
    else listenWeb();
  }, [listenNative, listenWeb, stopRecognition]);
  const listenRef = useRef(listen);
  listenRef.current = listen;

  const fetchAudio = useCallback(async (text: string): Promise<AudioBuffer | null> => {
    const ctx = audioContext.current;
    if (!ctx) return null;
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${await latest.current.getToken()}` },
        body: JSON.stringify({ text, personaId: latest.current.personaId }),
      });
      if (!response.ok) return null;
      return await ctx.decodeAudioData(await response.arrayBuffer());
    } catch {
      return null;
    }
  }, []);

  const pump = useCallback(async () => {
    if (!active.current || busy.current) return;
    const item = queue.current.shift();
    if (!item) {
      if (reply.current?.done) {
        reply.current = null;
        listen();
      }
      return;
    }
    busy.current = true;
    const gen = generation.current;
    const next = () => {
      if (gen !== generation.current) return;
      busy.current = false;
      currentSource.current = null;
      setPlayingAudio(false);
      void pumpRef.current();
    };
    const buffer = await item.audio;
    if (gen !== generation.current || !active.current) return;
    setStatus("speaking");

    const ctx = audioContext.current;
    if (buffer && ctx && analyser.current) {
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser.current);
      source.onended = next;
      currentSource.current = source;
      setPlayingAudio(true);
      source.start();
      return;
    }

    // The natural voice failed: use the device's Persian voice if it has one, otherwise captions only.
    const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
    const voice = synth ? pickPersianVoice(synth.getVoices(), latest.current.gender) : null;
    if (synth && voice) {
      const utterance = new SpeechSynthesisUtterance(item.text);
      utterance.lang = voice.lang;
      utterance.voice = voice;
      utterance.pitch = latest.current.tuning.pitch;
      utterance.rate = latest.current.tuning.rate;
      utterance.onend = next;
      utterance.onerror = next;
      synth.speak(utterance);
      return;
    }
    if (!noVoiceNoticed.current) {
      noVoiceNoticed.current = true;
      latest.current.onNoVoice();
    }
    silentTimer.current = setTimeout(next, Math.max(1200, item.text.length * 65));
  }, [listen, setStatus]);
  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  /** Feed the streaming assistant reply; each complete sentence starts loading its voice right away. */
  const feedReply = useCallback(
    (id: string, text: string, done: boolean) => {
      if (!active.current || ignoredReply.current === id) return;
      if (reply.current?.id !== id) reply.current = { id, offset: 0, done: false };
      const state = reply.current;
      const { speak, consumed } = takeSpeakable(text.slice(state.offset), done);
      state.offset += consumed;
      state.done = done;
      if (speak) queue.current.push({ text: speak, audio: fetchAudio(speak) });
      void pump();
    },
    [fetchAudio, pump],
  );

  /** The chat failed before any reply: go back to listening. */
  const replyFailed = useCallback(() => {
    if (!active.current) return;
    reply.current = null;
    listen();
  }, [listen]);

  const start = useCallback(() => {
    if (!browserSpeechSupported()) return false;
    active.current = true;
    restarts.current = 0;
    noVoiceNoticed.current = false;
    ignoredReply.current = null;
    // Create and unlock audio playback inside the tap (required on iOS and in the Android app).
    try {
      if (!audioContext.current) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctor();
        const node = ctx.createAnalyser();
        node.fftSize = 512;
        node.smoothingTimeConstant = 0.5;
        node.connect(ctx.destination);
        audioContext.current = ctx;
        analyser.current = node;
        levelBuffer.current = new Uint8Array(new ArrayBuffer(512));
      }
      const ctx = audioContext.current;
      void ctx.resume().catch(() => {});
      const blip = ctx.createBufferSource();
      blip.buffer = ctx.createBuffer(1, 1, 22050);
      blip.connect(ctx.destination);
      blip.start();
    } catch {
      // Without Web Audio, replies fall back to the device voice or captions.
    }
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
    listen();
    return true;
  }, [listen]);

  /** Cut the companion off and listen to the user right away. */
  const interrupt = useCallback(() => {
    if (!active.current) return;
    stopSpeaking();
    // The rest of the interrupted reply is not spoken, even if it is still streaming in.
    ignoredReply.current = reply.current?.id ?? null;
    reply.current = null;
    listen();
  }, [listen, stopSpeaking]);

  /** Loudness (0..1) of the voice being played, for the robot's mouth. */
  const speakerLevel = useCallback(() => {
    const node = analyser.current;
    const buffer = levelBuffer.current;
    if (!node || !buffer || !currentSource.current) return 0;
    node.getByteTimeDomainData(buffer);
    let sum = 0;
    for (const value of buffer) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    return Math.min(1, Math.sqrt(sum / buffer.length) * 4.5);
  }, []);

  useEffect(
    () => () => {
      stop();
      void audioContext.current?.close().catch(() => {});
      audioContext.current = null;
    },
    [stop],
  );

  return {
    status,
    heard,
    active: status !== "idle",
    playingAudio,
    start,
    stop,
    feedReply,
    replyFailed,
    interrupt,
    speakerLevel,
  };
}
