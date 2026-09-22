"use client";

import { useState } from "react";
import type { UIMessage } from "ai";
import { Check, Copy, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Markdown } from "./Markdown";

interface ChatBubbleProps {
  message: UIMessage;
  streaming: boolean;
  onCopy: (content: string) => void;
  onRetry: () => void;
}

const TYPING_DOT_DELAYS = [0, 150, 300];

function messageText(m: UIMessage): string {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function ChatBubble({
  message,
  streaming,
  onCopy,
  onRetry,
}: ChatBubbleProps) {
  const [copied, setCopied] = useState(false);
  const text = messageText(message);
  const isUser = message.role === "user";

  const handleCopy = () => {
    onCopy(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.99]">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="group/bubble flex flex-col items-start">
      <div
        className={cn(
          "max-w-[85%] rounded-lg border border-border bg-card px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-ring",
          streaming && "border-[#0f62fe]/50"
        )}
      >
        {text && <Markdown>{text}</Markdown>}
        {streaming && !text && (
          <span className="flex items-center gap-1 py-0.5">
            {TYPING_DOT_DELAYS.map((d) => (
              <span
                key={d}
                className="size-1.5 animate-pulse rounded-[2px] bg-[#0f62fe]"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </span>
        )}
        {streaming && text && (
          <span className="ml-0.5 inline-block animate-pulse text-[#0f62fe]">
            ▍
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/bubble:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={copied ? "Copied" : "Copy message"}
          onClick={handleCopy}
          disabled={!text}
        >
          {copied ? <Check className="text-emerald-600" /> : <Copy />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Regenerate answer"
          onClick={onRetry}
        >
          <RotateCcw className="transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:rotate-90" />
        </Button>
      </div>
    </div>
  );
}