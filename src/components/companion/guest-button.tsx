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
      variant="ghost"
      onClick={enter}
      disabled={pending}
      className={cn("h-11 rounded-full text-sm text-muted-foreground hover:bg-transparent hover:text-foreground", className)}
    >
      {pending ? "در حال ورود…" : "ورود مهمان"}
    </Button>
  );
}
