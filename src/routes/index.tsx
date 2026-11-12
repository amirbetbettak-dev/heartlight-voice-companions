import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { HeartHandshake, Mic, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { GoogleButton } from "@/components/companion/google-button";
import { RobotFace } from "@/components/companion/robot-face";
import { supabase } from "@/integrations/supabase/client";
import type { FaceExpression } from "@/lib/emotion";
import { PERSONAS } from "@/lib/personas";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "همدم — همراه هوشمند و همدل برای درد و دل" },
      {
        name: "description",
        content: "با نازنین، ترانه، آرش یا کیان صوتی و متنی درد و دل کن. همدم گوش می‌دهد، می‌فهمد و حرف‌هایت را به خاطر می‌سپارد.",
      },
      { property: "og:title", content: "همدم — همراه هوشمند و همدل برای درد و دل" },
      { property: "og:description", content: "چهار شخصیت با صدای طبیعی و انسانی؛ گفت‌وگوی صوتی و متنی با حافظه." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const EXPRESSIONS: FaceExpression[] = ["happy", "neutral", "curious", "happy"];

function Landing() {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
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

  useEffect(() => {
    const timer = setInterval(() => setIndex((value) => value + 1), 3200);
    return () => clearInterval(timer);
  }, []);

  return (
    <main data-persona={persona.id} className="relative min-h-dvh overflow-hidden bg-background bg-ambient transition-colors">
      <div className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center gap-10 px-6 py-12 lg:flex-row lg:justify-between lg:gap-16">
        <div className="flex flex-col items-center gap-4 lg:order-2">
          <RobotFace persona={persona} state="idle" expression={EXPRESSIONS[index % EXPRESSIONS.length]!} />
          <div className="text-center">
            <p className="text-lg font-bold text-glow transition-colors">{persona.name}</p>
            <p className="text-sm text-muted-foreground">{persona.tagline}</p>
          </div>
        </div>

        <div className="flex max-w-md flex-col items-center gap-6 text-center lg:items-start lg:text-start">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
            <HeartHandshake className="size-3.5 text-glow" /> یک گوش شنوا، هر وقت که بخواهی
          </span>
          <h1 className="text-5xl font-extrabold leading-tight tracking-tight sm:text-6xl">
            همدم
          </h1>
          <p className="text-lg leading-8 text-foreground/80">
            بعضی حرف‌ها فقط یک شنونده‌ی مهربان می‌خواهند. با همدم صوتی یا متنی درد و دل کن؛ گوش می‌دهد، احساست را می‌فهمد و
            مثل یک دوست واقعی کنارت است.
          </p>
          <ul className="grid w-full gap-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <Mic className="size-4 text-glow" /> گفت‌وگوی صوتی با صدای طبیعی و انسانی
            </li>
            <li className="flex items-center gap-2">
              <MessageCircle className="size-4 text-glow" /> پیام متنی، هر وقت حرف زدن سخت است
            </li>
            <li className="flex items-center gap-2">
              <HeartHandshake className="size-4 text-glow" /> چهار شخصیت: دو خانم و دو آقا، با حافظه‌ی گفت‌وگوها
            </li>
          </ul>
          <GoogleButton className="w-full sm:w-auto" />
          <p className="text-xs leading-6 text-muted-foreground">
            همدم یک همراه هوش مصنوعی است و جای مشاور یا پزشک را نمی‌گیرد. در شرایط اضطراری با ۱۱۵ یا اورژانس اجتماعی ۱۲۳ تماس
            بگیرید.
          </p>
        </div>
      </div>
    </main>
  );
}
