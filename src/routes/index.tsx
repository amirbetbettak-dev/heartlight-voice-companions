import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

import { HamdamLogo } from "@/components/brand/hamdam-logo";
import { GoogleButton } from "@/components/companion/google-button";
import { GuestButton } from "@/components/companion/guest-button";
import { PhoneSignIn } from "@/components/companion/phone-sign-in";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { PERSONAS } from "@/lib/personas";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "همدم — همراه هوشمند تو" },
      { name: "description", content: "همدم؛ همراه هوشمند و همدل برای گفت‌وگوی صوتی و متنی به فارسی." },
      { property: "og:title", content: "همدم — همراه هوشمند تو" },
      { property: "og:description", content: "همراه هوشمند و همدل برای گفت‌وگوی صوتی و متنی به فارسی." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [phoneMode, setPhoneMode] = useState(false);
  const persona = PERSONAS[index % PERSONAS.length]!;

  // Signed-in visitors go straight to the companion.
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) void navigate({ to: "/talk", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) void navigate({ to: "/talk", replace: true });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [navigate]);

  // The brand glow slowly drifts through the four persona colours.
  useEffect(() => {
    const timer = setInterval(() => setIndex((value) => value + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <main data-persona={persona.id} className="relative min-h-dvh overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-landing-aurora transition-[background] duration-[2000ms]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-landing-grid" />

      <div className="relative mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 pb-safe pt-safe">
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-glow-soft blur-3xl" />
            <HamdamLogo className="relative size-32 sm:size-36" />
          </div>
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-6xl font-black tracking-tight">همدم</h1>
            <p dir="ltr" className="text-[11px] font-medium uppercase tracking-[0.5em] text-muted-foreground">
              Hamdam · AI
            </p>
          </div>
        </div>

        <div className="flex w-full flex-col items-center gap-3 pb-6">
          {phoneMode ? (
            <PhoneSignIn onBack={() => setPhoneMode(false)} />
          ) : (
            <>
              <GoogleButton className="w-full" />
              <Button
                variant="outline"
                onClick={() => setPhoneMode(true)}
                className="h-12 w-full gap-2 rounded-full border-border bg-card/40 text-[15px] backdrop-blur hover:bg-card/70"
              >
                <Smartphone className="size-[18px]" /> ورود با شماره موبایل
              </Button>
              <GuestButton className="w-full" />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
