import { useEffect, useRef, type RefObject } from "react";

export type AudioLevels = { speaker: number; mic: number };

/**
 * Tracks loudness (0..1) of the companion's voice (the call's <audio> element stream) and the
 * user's microphone. Values live in a ref so the face can read them every frame without re-rendering.
 */
export function useAudioLevels(audioRef: RefObject<HTMLAudioElement | null>, micStream: MediaStream | null) {
  const levels = useRef<AudioLevels>({ speaker: 0, mic: 0 });
  const micRef = useRef(micStream);
  micRef.current = micStream;

  useEffect(() => {
    let context: AudioContext | null = null;
    let frame = 0;
    const taps = new Map<"speaker" | "mic", { stream: MediaStream; analyser: AnalyserNode; source: MediaStreamAudioSourceNode }>();
    const buffer = new Uint8Array(512);

    function ensureContext() {
      if (!context) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        context = new Ctor();
      }
      if (context.state === "suspended") void context.resume().catch(() => {});
      return context;
    }

    function sync(kind: "speaker" | "mic", stream: MediaStream | null) {
      const current = taps.get(kind);
      if (current?.stream === stream) return current;
      current?.source.disconnect();
      taps.delete(kind);
      if (!stream || stream.getAudioTracks().length === 0) return undefined;
      try {
        const ctx = ensureContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.5;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        const tap = { stream, analyser, source };
        taps.set(kind, tap);
        return tap;
      } catch {
        return undefined;
      }
    }

    function read(kind: "speaker" | "mic", stream: MediaStream | null) {
      const tap = sync(kind, stream);
      if (!tap) return 0;
      tap.analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (const value of buffer) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      return Math.min(1, Math.sqrt(sum / buffer.length) * 4.5);
    }

    function tick() {
      const element = audioRef.current;
      const speakerStream = element?.srcObject instanceof MediaStream ? element.srcObject : null;
      const speaker = read("speaker", speakerStream);
      const mic = read("mic", micRef.current?.active ? micRef.current : null);
      const previous = levels.current;
      levels.current = {
        speaker: speaker > previous.speaker ? speaker : previous.speaker * 0.82 + speaker * 0.18,
        mic: mic > previous.mic ? mic : previous.mic * 0.85 + mic * 0.15,
      };
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      taps.forEach((tap) => tap.source.disconnect());
      void context?.close().catch(() => {});
    };
  }, [audioRef]);

  return levels;
}
