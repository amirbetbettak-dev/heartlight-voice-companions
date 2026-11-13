import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Check, ChevronLeft, ChevronRight, LogOut, MessagesSquare, Plus, Trash2, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
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
import {
  clearAllConversations,
  clearMemory,
  conversationsQuery,
  deleteConversation,
  memoryQuery,
} from "@/lib/companion-data";
import { memoryItems } from "@/lib/memory-notes";
import { getPersona, PERSONAS, type PersonaId } from "@/lib/personas";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

export type SettingsView = "main" | "persona" | "history" | "memory";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: SettingsView;
  onViewChange: (view: SettingsView) => void;
  personaId: PersonaId;
  conversationId: string;
  onSelectPersona: (id: PersonaId) => void;
  onOpenConversation: (id: string) => void;
  onNewConversation: (personaId: PersonaId) => void;
  onConversationDeleted: (id: string) => void;
  onAllConversationsCleared: () => void;
  onSignOut: () => void;
  account: { email: string; name: string; phone: string; isAnonymous: boolean };
};

function Confirm({
  trigger,
  title,
  description,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent dir="rtl" className="rounded-2xl">
        <AlertDialogHeader className="text-start sm:text-start">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-start">
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => void onConfirm()}
          >
            بله، پاک کن
          </AlertDialogAction>
          <AlertDialogCancel>انصراف</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MenuRow({ icon, title, hint, onClick }: { icon: ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card/70 p-3.5 text-start transition hover:border-glow/50 hover:bg-card"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-glow-soft text-glow">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      <ChevronLeft className="size-4 text-muted-foreground" />
    </button>
  );
}

const dateFormat = new Intl.DateTimeFormat("fa-IR", { month: "long", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" });
function when(iso: string) {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : dateFormat.format(date);
}

export function SettingsSheet(props: Props) {
  const { open, onOpenChange, view, onViewChange, personaId, account } = props;
  const persona = getPersona(personaId);
  const titles: Record<SettingsView, string> = {
    main: "تنظیمات",
    persona: "شخصیت و صدا",
    history: "گفت‌وگوها",
    memory: "حافظه",
  };
  const descriptions: Record<SettingsView, string> = {
    main: "همه‌چیز مرتب، هر بخش جای خودش.",
    persona: "یکی از چهار همدم را انتخاب کن؛ هر کدام صدای ثابت خودش را دارد.",
    history: "تاریخچه‌ی هر شخصیت جداست.",
    memory: "چیزهایی که از گفت‌وگوهایمان یادم مانده.",
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl" className="flex w-full flex-col gap-0 border-border bg-background p-0 sm:max-w-md">
        <SheetHeader className="space-y-1 border-b border-border px-5 pb-4 pt-6 text-start">
          {view !== "main" && (
            <button
              type="button"
              onClick={() => onViewChange("main")}
              className="mb-1 flex items-center gap-1 self-start text-xs text-muted-foreground transition hover:text-foreground"
            >
              <ChevronRight className="size-4" /> تنظیمات
            </button>
          )}
          <SheetTitle className="text-xl">{titles[view]}</SheetTitle>
          <SheetDescription>{descriptions[view]}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {view === "main" && (
            <div className="flex flex-col gap-3">
              <MenuRow
                icon={<RobotFace persona={persona} state="idle" expression="happy" size="xs" className="w-8" />}
                title="شخصیت و صدا"
                hint={`${persona.name} · ${persona.voiceLabel}`}
                onClick={() => onViewChange("persona")}
              />
              <MenuRow
                icon={<MessagesSquare className="size-5" />}
                title="گفت‌وگوها"
                hint="تاریخچه‌ی هر شخصیت و گفت‌وگوی جدید"
                onClick={() => onViewChange("history")}
              />
              <MenuRow
                icon={<Brain className="size-5" />}
                title="حافظه"
                hint="چیزهایی که از تو یادم مانده"
                onClick={() => onViewChange("memory")}
              />
              <AccountCard account={account} onSignOut={props.onSignOut} />
            </div>
          )}
          {view === "persona" && <PersonaPicker personaId={personaId} onSelect={props.onSelectPersona} />}
          {view === "history" && <History {...props} enabled={open} />}
          {view === "memory" && <MemoryView enabled={open} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AccountCard({ account, onSignOut }: { account: Props["account"]; onSignOut: () => void }) {
  const label = account.isAnonymous
    ? "مهمان"
    : account.name || account.email || (account.phone ? formatPhone(account.phone.startsWith("+") ? account.phone : `+${account.phone}`) : "");
  return (
    <div className="mt-4 rounded-2xl border border-border bg-card/40 p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <UserRound className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" dir="auto">
            {label}
          </p>
          {account.isAnonymous ? (
            <p className="text-xs leading-5 text-muted-foreground">با خروج از حساب مهمان، گفت‌وگوها پاک می‌شوند.</p>
          ) : (
            account.name && account.email && <p className="truncate text-xs text-muted-foreground">{account.email}</p>
          )}
        </div>
      </div>
      <Button variant="ghost" className="mt-3 w-full justify-center gap-2 rounded-xl text-muted-foreground" onClick={onSignOut}>
        <LogOut className="size-4" /> خروج از حساب
      </Button>
    </div>
  );
}

function PersonaPicker({ personaId, onSelect }: { personaId: PersonaId; onSelect: (id: PersonaId) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="انتخاب شخصیت">
      {PERSONAS.map((persona) => {
        const selected = persona.id === personaId;
        return (
          <button
            key={persona.id}
            type="button"
            role="radio"
            aria-checked={selected}
            data-persona={persona.id}
            onClick={() => onSelect(persona.id)}
            className={cn(
              "relative flex flex-col items-center gap-2 rounded-2xl border bg-card p-4 text-center transition",
              selected ? "border-glow shadow-glow" : "border-border hover:border-glow/50",
            )}
          >
            <RobotFace persona={persona} state="idle" expression={selected ? "happy" : "neutral"} size="sm" className="w-20" />
            <span className="flex items-center gap-1.5">
              <span className="text-lg font-bold text-glow">{persona.name}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{persona.genderLabel}</span>
            </span>
            <span className="text-xs text-foreground/80">{persona.tagline}</span>
            <span className="text-[11px] leading-5 text-muted-foreground">{persona.voiceLabel}</span>
            {selected && (
              <span className="absolute end-2.5 top-2.5 grid size-5 place-items-center rounded-full bg-glow text-glow-foreground">
                <Check className="size-3" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function History({
  personaId,
  conversationId,
  enabled,
  onOpenConversation,
  onNewConversation,
  onConversationDeleted,
  onAllConversationsCleared,
}: Props & { enabled: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<PersonaId>(personaId);
  const conversations = useQuery({ ...conversationsQuery, enabled });
  const list = (conversations.data ?? []).filter((conversation) => conversation.personaId === filter);
  const filterPersona = getPersona(filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-card/60 p-1.5" role="tablist" aria-label="شخصیت">
        {PERSONAS.map((persona) => (
          <button
            key={persona.id}
            type="button"
            role="tab"
            aria-selected={filter === persona.id}
            data-persona={persona.id}
            onClick={() => setFilter(persona.id)}
            className={cn(
              "rounded-xl py-2 text-sm font-medium transition",
              filter === persona.id ? "bg-glow-soft text-glow" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {persona.name}
          </button>
        ))}
      </div>

      <Button data-persona={filter} onClick={() => onNewConversation(filter)} className="h-11 gap-2 rounded-xl">
        <Plus className="size-4" /> گفت‌وگوی جدید با {filterPersona.name}
      </Button>

      <ul className="flex flex-col gap-2">
        {conversations.isLoading && <li className="py-6 text-center text-sm text-muted-foreground">در حال بارگذاری…</li>}
        {!conversations.isLoading && list.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">هنوز گفت‌وگویی با {filterPersona.name} نداری.</li>
        )}
        {list.map((conversation) => {
          const active = conversation.id === conversationId;
          return (
            <li
              key={conversation.id}
              className={cn(
                "flex items-center gap-1 rounded-2xl border bg-card/60 transition",
                active ? "border-glow/60" : "border-border hover:border-glow/40",
              )}
            >
              <button
                type="button"
                onClick={() => onOpenConversation(conversation.id)}
                className="min-w-0 flex-1 px-4 py-3 text-start"
              >
                <span className="block truncate text-sm font-medium" dir="auto">
                  {conversation.title || "گفت‌وگوی تازه"}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {active ? "همین گفت‌وگو · " : ""}
                  {when(conversation.updatedAt)}
                </span>
              </button>
              <Confirm
                title="این گفت‌وگو پاک شود؟"
                description="پیام‌های این گفت‌وگو برای همیشه پاک می‌شوند."
                onConfirm={async () => {
                  try {
                    await deleteConversation(conversation.id);
                    await queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
                    onConversationDeleted(conversation.id);
                  } catch {
                    toast.error("پاک کردن ممکن نشد.");
                  }
                }}
                trigger={
                  <Button variant="ghost" size="icon" className="me-1 shrink-0 rounded-full text-muted-foreground" aria-label="پاک کردن گفت‌وگو">
                    <Trash2 className="size-4" />
                  </Button>
                }
              />
            </li>
          );
        })}
      </ul>

      {(conversations.data?.length ?? 0) > 0 && (
        <Confirm
          title="همه‌ی گفت‌وگوها پاک شود؟"
          description="تاریخچه‌ی همه‌ی شخصیت‌ها برای همیشه پاک می‌شود. حافظه دست نمی‌خورد."
          onConfirm={async () => {
            try {
              await clearAllConversations();
              await queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
              onAllConversationsCleared();
            } catch {
              toast.error("پاک کردن ممکن نشد.");
            }
          }}
          trigger={
            <Button variant="ghost" className="mt-2 gap-2 self-center rounded-xl text-xs text-muted-foreground">
              <Trash2 className="size-3.5" /> پاک کردن همه‌ی گفت‌وگوها
            </Button>
          }
        />
      )}
    </div>
  );
}

function MemoryView({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const memory = useQuery({ ...memoryQuery, enabled });
  const items = memoryItems(memory.data?.summary ?? "");

  if (memory.isLoading) return <p className="py-6 text-center text-sm text-muted-foreground">در حال بارگذاری…</p>;

  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
          <Brain className="size-8 text-glow" />
          <p className="text-sm leading-7 text-muted-foreground">
            هنوز چیزی یادم نمانده. کمی که با هم حرف بزنیم، چیزهای مهمی که از خودت می‌گویی اینجا جمع می‌شوند.
          </p>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((item, index) => (
              <li key={index} className="flex gap-3 rounded-2xl border border-border bg-card/60 p-3.5 text-sm leading-7">
                <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-glow" />
                <span dir="auto">{item}</span>
              </li>
            ))}
          </ul>
          {memory.data?.updatedAt && (
            <p className="text-center text-[11px] text-muted-foreground">آخرین به‌روزرسانی: {when(memory.data.updatedAt)}</p>
          )}
          <Confirm
            title="حافظه پاک شود؟"
            description="همه‌ی چیزهایی که درباره‌ات یاد گرفته‌ام فراموش می‌شود. گفت‌وگوها سر جایشان می‌مانند."
            onConfirm={async () => {
              try {
                await clearMemory();
                await queryClient.invalidateQueries({ queryKey: memoryQuery.queryKey });
                toast.success("حافظه پاک شد.");
              } catch {
                toast.error("پاک کردن حافظه ممکن نشد.");
              }
            }}
            trigger={
              <Button variant="ghost" className="gap-2 self-center rounded-xl text-xs text-muted-foreground">
                <Trash2 className="size-3.5" /> پاک کردن حافظه
              </Button>
            }
          />
        </>
      )}
    </div>
  );
}
