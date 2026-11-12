import type { ChatStatus } from "ai";
import { Mic } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { RobotFace } from "@/components/companion/robot-face";
import type { ChatMessage } from "@/lib/companion-data";
import type { Persona } from "@/lib/personas";
import { cn } from "@/lib/utils";

export type Caption = { role: "user" | "assistant"; text: string };

type Props = {
  persona: Persona;
  messages: ChatMessage[];
  captions: Caption[];
  status: ChatStatus;
  onSend: (text: string) => void;
  onStop: () => void;
  autoFocus?: boolean;
  className?: string;
};

function messageText(message: ChatMessage) {
  return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function ChatPanel({ persona, messages, captions, status, onSend, onStop, autoFocus, className }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (autoFocus && !busy) textareaRef.current?.focus({ preventScroll: true });
  }, [autoFocus, busy, persona.id]);

  const last = messages[messages.length - 1];
  const waiting = status === "submitted" || (status === "streaming" && last?.role === "user");

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-5 px-4 py-5">
          {messages.length === 0 && captions.length === 0 ? (
            <ConversationEmptyState
              icon={<RobotFace persona={persona} state="idle" expression="happy" size="sm" />}
              title={`سلام! من ${persona.name} هستم`}
              description="هر چیزی توی دلته بنویس، یا با دکمه‌ی میکروفون با هم حرف بزنیم."
            />
          ) : (
            messages.map((message) => {
              const text = messageText(message);
              if (!text) return null;
              return (
                <Message key={message.id} from={message.role}>
                  <MessageContent
                    className={cn(
                      "text-[15px] leading-7",
                      "group-[.is-user]:rounded-2xl group-[.is-user]:rounded-ee-md",
                    )}
                  >
                    {message.role === "assistant" ? <MessageResponse>{text}</MessageResponse> : <p className="whitespace-pre-wrap">{text}</p>}
                  </MessageContent>
                  {message.metadata?.source === "voice" && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground group-[.is-user]:ms-auto">
                      <Mic className="size-3" /> صوتی
                    </span>
                  )}
                </Message>
              );
            })
          )}
          {captions.map((caption, index) => (
            <Message key={`caption-${index}`} from={caption.role}>
              <MessageContent className="text-[15px] leading-7 opacity-80 group-[.is-user]:rounded-2xl group-[.is-user]:rounded-ee-md">
                <p className="whitespace-pre-wrap">{caption.text}</p>
              </MessageContent>
              <span className="flex items-center gap-1 text-[11px] text-glow group-[.is-user]:ms-auto">
                <span className="size-1.5 animate-pulse rounded-full bg-glow" /> زنده
              </span>
            </Message>
          ))}
          {waiting && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer className="text-[15px]">{`${persona.name} داره فکر می‌کنه…`}</Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="px-3 pb-safe pt-2">
        <PromptInput
          className="rounded-2xl bg-card"
          onSubmit={({ text }) => {
            const value = text.trim();
            if (!value || busy) return;
            onSend(value);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        >
          <PromptInputTextarea
            ref={textareaRef}
            dir="auto"
            placeholder={`به ${persona.name} بنویس…`}
            className="min-h-12 text-[15px]"
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={status} onStop={onStop} className="rounded-full" />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
