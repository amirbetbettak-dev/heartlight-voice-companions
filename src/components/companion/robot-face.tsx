import { useEffect, useId, useRef, useState, type RefObject } from "react";

import type { AudioLevels } from "@/hooks/use-audio-levels";
import type { FaceExpression } from "@/lib/emotion";
import type { Persona } from "@/lib/personas";
import { cn } from "@/lib/utils";

export type FaceState = "idle" | "connecting" | "listening" | "thinking" | "speaking";

type Props = {
  persona: Pick<Persona, "eyeShape">;
  state: FaceState;
  expression: FaceExpression;
  levels?: RefObject<AudioLevels>;
  /** Simulated mouth movement while a typed reply streams in. */
  textSpeaking?: boolean;
  className?: string;
  size?: "lg" | "sm" | "xs";
};

const EYE = { round: { w: 50, h: 58, r: 25 }, pill: { w: 42, h: 66, r: 21 }, soft: { w: 52, h: 56, r: 16 } };

type Pose = { upper: number; angle: number; lower: number; scale: number; gazeX: number; gazeY: number; smile: number };

function poseFor(state: FaceState, expression: FaceExpression): Pose {
  const base: Pose = { upper: 0, angle: 0, lower: 0, scale: 1, gazeX: 0, gazeY: 0, smile: 6 };
  const byExpression: Record<FaceExpression, Partial<Pose>> = {
    neutral: {},
    happy: { lower: 30, smile: 14, scale: 1.02 },
    empathetic: { upper: 14, angle: 16, smile: -2, gazeY: 4 },
    concerned: { upper: 10, angle: -12, smile: 0 },
    curious: { scale: 1.08, gazeX: -6, smile: 4 },
  };
  const byState: Record<FaceState, Partial<Pose>> = {
    idle: {},
    connecting: { gazeY: -6, upper: 6 },
    listening: { scale: 1.06 },
    thinking: { gazeX: 10, gazeY: -10, upper: 8, smile: 2 },
    speaking: {},
  };
  return { ...base, ...byExpression[expression], ...byState[state] };
}

export function RobotFace({ persona, state, expression, levels, textSpeaking, className, size = "lg" }: Props) {
  const [blink, setBlink] = useState(false);
  const [mouth, setMouth] = useState(0);
  const [micPulse, setMicPulse] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const textRef = useRef(textSpeaking);
  textRef.current = textSpeaking;

  // Natural blinking at random intervals.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 140);
        schedule();
      }, 2200 + Math.random() * 3800);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  // Mouth and listening pulse follow live audio levels.
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const loop = (time: number) => {
      frame = requestAnimationFrame(loop);
      if (time - last < 33) return;
      last = time;
      const live = levels?.current;
      let open = 0;
      if (textRef.current) {
        open = 0.25 + 0.35 * Math.abs(Math.sin(time / 90)) * Math.abs(Math.sin(time / 233));
      } else if (live) {
        open = live.speaker > 0.03 ? Math.min(1, live.speaker * 1.4) : 0;
      }
      setMouth((previous) => (Math.abs(previous - open) > 0.02 ? open : previous));
      const mic = stateRef.current === "listening" && live ? Math.min(1, live.mic * 1.5) : 0;
      setMicPulse((previous) => (Math.abs(previous - mic) > 0.03 ? mic : previous));
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [levels]);

  const pose = poseFor(state, expression);
  const eye = EYE[persona.eyeShape];
  const eyeScaleY = blink ? 0.08 : pose.scale + micPulse * 0.06;
  const eyeScaleX = pose.scale + micPulse * 0.04;

  // Mouth path: a smile curve that opens with speech loudness.
  const open = mouth * 26;
  const width = 64 + mouth * 10;
  const left = 150 - width / 2;
  const right = 150 + width / 2;
  const y = 214;
  const curve = pose.smile;
  const mouthPath = `M ${left} ${y} Q 150 ${y + curve} ${right} ${y} Q 150 ${y + curve + open * 2} ${left} ${y} Z`;

  const uid = useId().replace(/:/g, "");
  const glowId = `face-glow-${uid}`;
  const shellId = `face-shell-${uid}`;
  const showHalo = state === "listening" || state === "speaking" || state === "connecting";

  return (
    <div
      className={cn(
        "relative aspect-square select-none",
        size === "lg" && "w-[min(78vw,22rem)]",
        size === "sm" && "w-28",
        size === "xs" && "w-14",
        className,
      )}
      role="img"
      aria-label="چهره‌ی همدم"
    >
      {size !== "xs" && (
        <>
          <div
            className="absolute inset-[6%] rounded-[38%] bg-glow-soft blur-2xl"
            style={{ animation: "halo-breathe 4.5s ease-in-out infinite" }}
          />
          {showHalo && (
            <div
              className="absolute inset-[4%] rounded-[38%] border-2 border-glow/50"
              style={{ animation: `halo-ripple ${state === "speaking" ? 1.2 : 2}s ease-out infinite` }}
            />
          )}
        </>
      )}
      <svg viewBox="0 0 300 300" className="relative h-full w-full drop-shadow-2xl">
        <defs>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id={shellId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--face-shell-edge)" />
            <stop offset="1" stopColor="var(--face-shell)" />
          </linearGradient>
        </defs>
        {/* Head shell and screen */}
        <rect x="18" y="22" width="264" height="256" rx="96" fill={`url(#${shellId})`} />
        <rect x="18.5" y="22.5" width="263" height="255" rx="95.5" fill="none" stroke="var(--glow)" strokeOpacity="0.35" />
        <rect x="38" y="44" width="224" height="212" rx="80" fill="var(--face-screen)" />
        {/* Antenna light */}
        <circle cx="150" cy="30" r="5" fill="var(--glow)" filter={`url(#${glowId})`} opacity={state === "idle" ? 0.5 : 1} />

        {[-1, 1].map((side) => {
          const cx = 150 + side * 52;
          const cy = 136;
          return (
            <g key={side} transform={`translate(${cx + pose.gazeX} ${cy + pose.gazeY})`}>
              <g className="face-part" style={{ transform: `scale(${eyeScaleX}, ${eyeScaleY})` }}>
                <rect
                  x={-eye.w / 2}
                  y={-eye.h / 2}
                  width={eye.w}
                  height={eye.h}
                  rx={eye.r}
                  fill="var(--glow)"
                  filter={`url(#${glowId})`}
                />
                <circle cx={-eye.w / 5} cy={-eye.h / 4.5} r={5} fill="var(--face-screen)" opacity="0.35" />
                {/* Upper lid tilts for empathy / concern */}
                <rect
                  className="face-part"
                  x={-eye.w}
                  y={-eye.h / 2 - 50}
                  width={eye.w * 2}
                  height={50}
                  fill="var(--face-screen)"
                  style={{ transform: `translateY(${pose.upper}px) rotate(${pose.angle * side}deg)` }}
                />
                {/* Lower lid rises into happy crescents */}
                <ellipse
                  className="face-part"
                  cx={0}
                  cy={eye.h / 2 + 34}
                  rx={eye.w}
                  ry={36}
                  fill="var(--face-screen)"
                  style={{ transform: `translateY(${-pose.lower}px)` }}
                />
              </g>
            </g>
          );
        })}

        {state === "thinking" ? (
          <g fill="var(--glow)" filter={`url(#${glowId})`}>
            {[0, 1, 2].map((index) => (
              <circle
                key={index}
                cx={132 + index * 18}
                cy={214}
                r={5}
                style={{ animation: `think-dot 1.1s ease-in-out ${index * 0.15}s infinite` }}
              />
            ))}
          </g>
        ) : (
          <path
            d={mouthPath}
            fill="var(--glow)"
            stroke="var(--glow)"
            strokeWidth="7"
            strokeLinejoin="round"
            strokeLinecap="round"
            filter={`url(#${glowId})`}
          />
        )}
        {/* Cheeks when happy */}
        {expression === "happy" && (
          <g fill="var(--glow)" opacity="0.18">
            <ellipse cx="78" cy="190" rx="16" ry="8" />
            <ellipse cx="222" cy="190" rx="16" ry="8" />
          </g>
        )}
      </svg>
    </div>
  );
}
