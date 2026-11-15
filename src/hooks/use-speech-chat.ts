import { useCallback, useEffect, useRef, useState } from "react";

import { pickPersianVoice, takeSpeakable } from "@/lib/speech-text";

/**
 * Voice conversation with the browser's own speech services (no paid live session):
 * SpeechRecognition hears the user in Persian, the text goes through the normal chat,
 * and SpeechSynthesis reads the reply aloud sentence by sentence as it streams in.
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

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this browser can run the free voice mode (call after hydration). */
export function browserSpeechSupported() {
  return recognitionCtor() !== null && typeof window !== "undefined" && "speechSynthesis" in window;
}

type Options = {
  gender: "female" | "male";
  tuning: { pitch: number; rate: number };
  /** The user finished a sentence: send it to the chat. */
  onUtterance: (text: string) => void;
  onError: (message: string) => void;
  /** Shown once when the device has no Persian voice (replies then appear as captions only). */
  onNoPersianVoice: () => void;
};

export function useSpeechChat(options: Options) {
  const [status, setStatusState] = useState<SpeechStatus>("idle");
  const [heard, setHeard] = useState("");
  const statusRef = useRef<SpeechStatus>("idle");
  const latest = useRef(options);
  latest.current = options;

  const active = useRef(false);
  const recognition = useRef<Recognition | null>(null);
  const restarts = useRef(0);
  const queue = useRef<string[]>([]);
  const current = useRef<SpeechSynthesisUtterance | null>(null);
  const silentTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const generation = useRef(0);
  const reply = useRef<{ id: string; offset: number; done: boolean } | null>(null);
  const noVoiceNoticed = useRef(false);
  const ignoredReply = useRef<string | null>(null);

  const setStatus = useCallback((next: SpeechStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const stopRecognition = useCallback(() => {
    const rec = recognition.current;
    recognition.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onend = null;
    rec.onerror = null;
    rec.onspeechstart = null;
    try {
      rec.abort();
    } catch {
      // Already stopped.
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    generation.current += 1;
    queue.current = [];
    current.current = null;
    clearTimeout(silentTimer.current);
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

  const listen = useCallback(() => {
    if (!active.current) return;
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    stopRecognition();
    setHeard("");
    setStatus("listening");
    const rec = new Ctor();
    rec.lang = "fa-IR";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onspeechstart = () => {
      restarts.current = 0;
    };
    rec.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]!;
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      setHeard((finalText + " " + interim).trim());
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        latest.current.onError("اجازه‌ی میکروفون داده نشده. از تنظیمات مرورگر اجازه بده و دوباره امتحان کن.");
        stop();
      } else if (event.error === "network") {
        latest.current.onError("تشخیص گفتار به اینترنت نیاز دارد؛ اتصالت را بررسی کن.");
        stop();
      } else if (event.error === "language-not-supported") {
        latest.current.onError("این مرورگر تشخیص گفتار فارسی ندارد. با Chrome یا Edge امتحان کن، یا بنویس.");
        stop();
      }
      // "no-speech" / "aborted": onend restarts listening.
    };
    rec.onend = () => {
      if (recognition.current !== rec) return;
      recognition.current = null;
      if (!active.current) return;
      const text = finalText.trim();
      if (text) {
        restarts.current = 0;
        setStatus("thinking");
        latest.current.onUtterance(text);
        return;
      }
      // Silence: keep listening hands-free, but give up after a long quiet stretch.
      restarts.current += 1;
      if (restarts.current > 20) {
        stop();
        return;
      }
      setTimeout(() => {
        if (active.current && statusRef.current === "listening" && !recognition.current) listen();
      }, 250);
    };
    recognition.current = rec;
    try {
      rec.start();
    } catch {
      latest.current.onError("میکروفون شروع نشد. دوباره امتحان کن.");
      stop();
    }
  }, [setStatus, stop, stopRecognition]);

  const pump = useCallback(() => {
    if (!active.current || current.current) return;
    const next = queue.current.shift();
    if (next === undefined) {
      if (reply.current?.done) {
        reply.current = null;
        listen();
      }
      return;
    }
    const gen = generation.current;
    const done = () => {
      if (gen !== generation.current) return;
      current.current = null;
      pump();
    };
    setStatus("speaking");
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const voice = pickPersianVoice(voices, latest.current.gender);
    if (voices.length > 0 && !voice) {
      // No Persian voice on this device: show the caption and animate the face for a natural duration.
      if (!noVoiceNoticed.current) {
        noVoiceNoticed.current = true;
        latest.current.onNoPersianVoice();
      }
      const placeholder = new SpeechSynthesisUtterance(next);
      current.current = placeholder;
      silentTimer.current = setTimeout(done, Math.max(1200, next.length * 65));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(next);
    utterance.lang = voice?.lang ?? "fa-IR";
    if (voice) utterance.voice = voice;
    utterance.pitch = latest.current.tuning.pitch;
    utterance.rate = latest.current.tuning.rate;
    utterance.onend = done;
    utterance.onerror = done;
    current.current = utterance;
    synth.speak(utterance);
  }, [listen, setStatus]);

  /** Feed the streaming assistant reply; complete sentences are spoken right away. */
  const feedReply = useCallback(
    (id: string, text: string, done: boolean) => {
      if (!active.current || ignoredReply.current === id) return;
      if (reply.current?.id !== id) reply.current = { id, offset: 0, done: false };
      const state = reply.current;
      const { speak, consumed } = takeSpeakable(text.slice(state.offset), done);
      state.offset += consumed;
      state.done = done;
      if (speak) queue.current.push(speak);
      pump();
    },
    [pump],
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
    // Unlock speech playback inside the tap (required on iOS) and warm up the voice list.
    const synth = window.speechSynthesis;
    synth.cancel();
    synth.getVoices();
    synth.speak(new SpeechSynthesisUtterance(""));
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

  useEffect(() => () => stop(), [stop]);

  return { status, heard, active: status !== "idle", start, stop, feedReply, replyFailed, interrupt };
}
