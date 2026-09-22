"use client";

import { useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { MousePointer, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";

interface ChatViewProps {
  sessionId: string;
  initialMessages: UIMessage[];
  onNewChat: () => void;
  onClear: () => void;
}

function ChatView({
  sessionId,
  initialMessages,
  onNewChat,
  onClear,
}: ChatViewProps) {
  const {
    messages,
    sendMessage,
    stop,
    regenerate,
    status,
    error,
    clearError,
  } = useChat({
    id: sessionId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const streaming = status === "submitted" || status === "streaming";

  const copy = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  };

  const handleSend = (text: string) => {
    sendMessage({ text });
  };

  return (
    <>
      <div className="flex h-auto shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative flex size-2 items-center justify-center">
            <span
              className={cn(
                "absolute inline-flex size-2 animate-ping rounded-sm",
                streaming ? "bg-[#0f62fe]/40" : "bg-border"
              )}
            />
            <span
              className={cn(
                "relative inline-flex size-2 rounded-sm",
                status === "error"
                  ? "bg-destructive"
                  : streaming
                    ? "bg-[#0f62fe]"
                    : "bg-muted-foreground/60"
              )}
            />
          </span>
          <div className="flex flex-col">
            <p className="text-[10px] font-semibold uppercase leading-3 tracking-[0.05em] text-muted-foreground">
              GMD Assistant
            </p>
            <p className="text-sm font-semibold leading-4 text-foreground">
              Quotation Console
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New chat"
            onClick={onNewChat}
            disabled={streaming}
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear chat"
            onClick={onClear}
            disabled={streaming || messages.length === 0}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <ChatMessageList
        messages={messages}
        streaming={streaming}
        error={error}
        onDismissError={clearError}
        onCopy={copy}
        onRetry={regenerate}
        onPickSuggestion={handleSend}
      />

      <ChatInput streaming={streaming} onSend={handleSend} onStop={stop} />
    </>
  );
}

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);

  useEffect(() => {
    if (!open || sessionId) return;
    fetch("/api/chat")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        setInitialMessages((data.messages as UIMessage[]) ?? []);
        setSessionId((data.id as string) ?? crypto.randomUUID());
      })
      .catch(() => {
        setSessionId(crypto.randomUUID());
      });
  }, [open, sessionId]);

  const resetToNewChat = () => {
    setInitialMessages([]);
    setSessionId(crypto.randomUUID());
  };

  const clearChat = () => {
    if (sessionId) {
      fetch(`/api/chat?id=${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      }).catch(() => {});
    }
    resetToNewChat();
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open chat assistant"
            className="text-muted-foreground transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-foreground"
          />
        }
      >
        <MousePointer className="size-5 stroke-[1.5]" />
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 shadow-[0_32px_64px_-24px_rgba(0,0,0,0.25)] sm:max-w-[40vw]!"
        showCloseButton={false}
      >
        {sessionId && (
          <ChatView
            key={sessionId}
            sessionId={sessionId}
            initialMessages={initialMessages}
            onNewChat={resetToNewChat}
            onClear={clearChat}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}