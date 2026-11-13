import { useId } from "react";

import { cn } from "@/lib/utils";

/** Modern AI mark: a glowing squircle "screen" with two eyes and a smile, wrapped in an orbit ring. */
export function HamdamLogo({ className, animated = true }: { className?: string; animated?: boolean }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 120 120" className={cn("size-24", className)} role="img" aria-label="لوگوی همدم">
      <defs>
        <linearGradient id={`ring-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--glow)" />
          <stop offset="0.55" stopColor="var(--glow)" stopOpacity="0.15" />
          <stop offset="1" stopColor="var(--glow)" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id={`shell-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--face-shell-edge)" />
          <stop offset="1" stopColor="var(--face-shell)" />
        </linearGradient>
        <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g style={animated ? { transformOrigin: "60px 60px", animation: "logo-orbit 14s linear infinite" } : undefined}>
        <circle cx="60" cy="60" r="56" fill="none" stroke={`url(#ring-${uid})`} strokeWidth="1.5" />
        <circle cx="60" cy="4" r="2.6" fill="var(--glow)" filter={`url(#glow-${uid})`} />
      </g>
      <rect x="22" y="24" width="76" height="72" rx="30" fill={`url(#shell-${uid})`} />
      <rect x="22.5" y="24.5" width="75" height="71" rx="29.5" fill="none" stroke="var(--glow)" strokeOpacity="0.4" />
      <rect x="29" y="31" width="62" height="58" rx="24" fill="var(--face-screen)" />
      <g fill="var(--glow)" filter={`url(#glow-${uid})`}>
        <rect x="44" y="47" width="9" height="15" rx="4.5" style={animated ? { transformBox: "fill-box", transformOrigin: "center", animation: "logo-blink 5s ease-in-out infinite" } : undefined} />
        <rect x="67" y="47" width="9" height="15" rx="4.5" style={animated ? { transformBox: "fill-box", transformOrigin: "center", animation: "logo-blink 5s ease-in-out infinite" } : undefined} />
      </g>
      <path d="M50 72 Q60 79 70 72" fill="none" stroke="var(--glow)" strokeWidth="3" strokeLinecap="round" filter={`url(#glow-${uid})`} />
    </svg>
  );
}
