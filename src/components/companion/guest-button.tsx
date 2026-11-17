import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export function GuestButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);

  async function enter() {
    setPending(true);
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      setPending(false);
      toast.error("ورود مهمان انجام نشد. دوباره امتحان کنید.");
    }
    // On success the landing page's auth listener opens the companion.
  }

  return (
    <Button
      type="button"
      onClick={enter}
      disabled={pending}
      className={cn(
        "h-14 gap-2 rounded-full bg-glow text-base font-bold text-glow-foreground shadow-[0_0_40px_-8px_var(--glow)] transition-[background,box-shadow] duration-[2000ms] hover:bg-glow/90",
        className,
      )}
    >
      {pending ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
      {pending ? "در حال ورود…" : "ورود سریع مهمان"}
    </Button>
  );
}
