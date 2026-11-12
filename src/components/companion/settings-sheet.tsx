import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Check, LogOut, MessageSquareX, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { RobotFace } from "@/components/companion/robot-face";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { clearConversation, clearMemory, memoryQuery } from "@/lib/companion-data";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personaId: PersonaId;
  onSelectPersona: (id: PersonaId) => void;
  onConversationCleared: () => void;
  onSignOut: () => void;
  account: { email: string; name: string };
};

function ConfirmButton({
  label,
  title,
  description,
  icon,
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  onConfirm: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="w-full justify-start gap-2 rounded-xl border-border bg-transparent" disabled={pending}>
          {icon}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent dir="rtl" className="rounded-2xl">
        <AlertDialogHeader className="text-start sm:text-start">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-start">
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm();
              } finally {
                setPending(false);
              }
            }}
          >
            بله، پاک کن
          </AlertDialogAction>
          <AlertDialogCancel>انصراف</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SettingsSheet({ open, onOpenChange, personaId, onSelectPersona, onConversationCleared, onSignOut, account }: Props) {
  const queryClient = useQueryClient();
  const memory = useQuery({ ...memoryQuery, enabled: open });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl" className="w-full overflow-y-auto border-border bg-background p-0 sm:max-w-md">
        <SheetHeader className="px-5 pb-2 pt-6 text-start">
          <SheetTitle className="text-xl">تنظیمات</SheetTitle>
          <SheetDescription>شخصیت و صدای همدمت را انتخاب کن.</SheetDescription>
        </SheetHeader>

        <section className="space-y-3 px-5 py-3">
          <h3 className="text-sm font-semibold text-muted-foreground">شخصیت‌ها</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="انتخاب شخصیت">
            {PERSONAS.map((persona) => {
              const selected = persona.id === personaId;
              return (
                <button
                  key={persona.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-persona={persona.id}
                  onClick={() => onSelectPersona(persona.id)}
                  className={cn(
                    "relative flex items-center gap-3 rounded-2xl border bg-card p-3 text-start transition sm:flex-col sm:items-start",
                    selected ? "border-glow shadow-glow" : "border-border hover:border-glow/50",
                  )}
                >
                  <RobotFace persona={persona} state="idle" expression={selected ? "happy" : "neutral"} size="xs" className="sm:w-16" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-glow">{persona.name}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{persona.genderLabel}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-foreground/80">{persona.tagline}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{persona.voiceLabel}</p>
                  </div>
                  {selected && (
                    <span className="absolute end-3 top-3 grid size-5 place-items-center rounded-full bg-glow text-glow-foreground">
                      <Check className="size-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            {PERSONAS.find((p) => p.id === personaId)?.description}
          </p>
        </section>

        <section className="space-y-3 px-5 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Brain className="size-4" /> حافظه
          </h3>
          <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-border bg-card p-4 text-sm leading-7 text-foreground/90">
            {memory.isLoading
              ? "در حال بارگذاری…"
              : memory.data?.summary || "هنوز چیزی به خاطر نسپرده‌ام. بعد از چند گفت‌وگو، چیزهای مهمی که از خودت می‌گویی اینجا جمع می‌شود."}
          </div>
          <ConfirmButton
            label="پاک کردن حافظه"
            title="حافظه پاک شود؟"
            description="همه‌ی چیزهایی که همدم درباره‌ی تو به خاطر سپرده پاک می‌شود. گفت‌وگوها باقی می‌مانند."
            icon={<Trash2 className="size-4" />}
            onConfirm={async () => {
              try {
                await clearMemory();
                await queryClient.invalidateQueries({ queryKey: memoryQuery.queryKey });
                toast.success("حافظه پاک شد.");
              } catch {
                toast.error("پاک کردن حافظه ممکن نشد.");
              }
            }}
          />
          <ConfirmButton
            label="پاک کردن همه‌ی گفت‌وگوها"
            title="همه‌ی گفت‌وگوها پاک شود؟"
            description="تمام پیام‌های متنی و صوتی ذخیره‌شده برای همیشه حذف می‌شوند."
            icon={<MessageSquareX className="size-4" />}
            onConfirm={async () => {
              try {
                await clearConversation();
                onConversationCleared();
                toast.success("گفت‌وگوها پاک شد.");
              } catch {
                toast.error("پاک کردن گفت‌وگوها ممکن نشد.");
              }
            }}
          />
        </section>

        <section className="space-y-3 border-t border-border px-5 py-5">
          <div className="text-sm">
            <div className="font-medium">{account.name || "حساب کاربری"}</div>
            <div className="text-muted-foreground" dir="ltr">{account.email}</div>
          </div>
          <Button variant="ghost" className="w-full justify-start gap-2 rounded-xl text-destructive hover:text-destructive" onClick={onSignOut}>
            <LogOut className="size-4" /> خروج از حساب
          </Button>
        </section>
      </SheetContent>
    </Sheet>
  );
}
