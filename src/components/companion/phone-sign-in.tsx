import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone, normalizePhone } from "@/lib/phone";

function smsError(error: { message?: string | undefined; code?: string | undefined; status?: number | undefined }) {
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (text.includes("provider") || text.includes("disabled") || text.includes("unsupported")) {
    return "ورود با پیامک هنوز فعال نشده است. فعلاً با گوگل یا به‌عنوان مهمان وارد شوید.";
  }
  if (error.status === 429 || text.includes("rate")) return "درخواست زیاد بود؛ کمی صبر کنید و دوباره امتحان کنید.";
  if (text.includes("expired") || text.includes("invalid") || text.includes("token")) return "کد اشتباه است یا منقضی شده.";
  return "ارسال کد ممکن نشد. دوباره امتحان کنید.";
}

export function PhoneSignIn({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [input, setInput] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(target: string) {
    setPending(true);
    setError("");
    const { error: sendError } = await supabase.auth.signInWithOtp({ phone: target });
    setPending(false);
    if (sendError) {
      setError(smsError(sendError));
      return false;
    }
    setCooldown(60);
    return true;
  }

  async function submitPhone(event: React.FormEvent) {
    event.preventDefault();
    const normalized = normalizePhone(input);
    if (!normalized) {
      setError("شماره موبایل درست نیست. مثلاً ۰۹۱۲۳۴۵۶۷۸۹");
      return;
    }
    setPhone(normalized);
    if (await sendCode(normalized)) {
      setCode("");
      setStep("code");
    }
  }

  async function verify(token: string) {
    setPending(true);
    setError("");
    const { error: verifyError } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
    if (verifyError) {
      setPending(false);
      setCode("");
      setError(smsError(verifyError));
    }
    // On success the landing page's auth listener opens the companion.
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <button
        type="button"
        onClick={step === "code" ? () => setStep("phone") : onBack}
        className="flex items-center gap-1.5 self-start text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowRight className="size-4" /> {step === "code" ? "تغییر شماره" : "بازگشت"}
      </button>

      {step === "phone" ? (
        <form onSubmit={submitPhone} className="flex flex-col gap-3">
          <label htmlFor="phone" className="text-sm text-foreground/80">
            شماره موبایل
          </label>
          <Input
            id="phone"
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
            placeholder="0912 345 6789"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="h-12 rounded-full border-border bg-card/60 px-5 text-center text-base tracking-wider"
          />
          <Button type="submit" disabled={pending || !input.trim()} className="h-12 rounded-full text-base shadow-glow">
            {pending ? <Loader2 className="size-5 animate-spin" /> : "دریافت کد"}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-foreground/80">
            کد ۶ رقمی ارسال‌شده به <span dir="ltr" className="font-medium text-foreground">{formatPhone(phone)}</span>
          </p>
          <div dir="ltr">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              onComplete={(value) => void verify(value)}
              disabled={pending}
              autoFocus
              inputMode="numeric"
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <InputOTPSlot key={index} index={index} className="size-11 bg-card/60 text-lg" />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          {pending && <Loader2 className="size-5 animate-spin text-glow" />}
          <button
            type="button"
            disabled={cooldown > 0 || pending}
            onClick={() => void sendCode(phone)}
            className="text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          >
            {cooldown > 0 ? `ارسال دوباره تا ${cooldown.toLocaleString("fa-IR")} ثانیه` : "ارسال دوباره‌ی کد"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-center text-sm leading-6 text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
