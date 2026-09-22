"use client";

import { useCallback, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { History, MousePointer, Plus, Trash2 } from "lucide-react";
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
import { SessionList, type ChatSessionMeta } from "./SessionList";

type View = "chat" | "sessions";

interface ChatViewProps {
  sessionId: string;
  initialMessages: UIMessage[];
  onNewChat: () => void;
  onClear: () => void;
  onOpenSessions: () => void;
}

function ChatView({
  sessionId,
  initialMessages,
  onNewChat,
  onClear,
  onOpenSessions,
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
    throttle: 60,
  });

  const streaming = status === "submitted" || status === "streaming";

  const copy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      sendMessage({ text });
    },
    [sendMessage]
  );

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
            size="icon-lg"
            aria-label="Chat history"
            onClick={onOpenSessions}
            disabled={streaming}
          >
            <History className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="New chat"
            onClick={onNewChat}
            disabled={streaming}
          >
            <Plus className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Clear chat"
            onClick={onClear}
            disabled={streaming || messages.length === 0}
          >
            <Trash2 className="size-5" />
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
  const [view, setView] = useState<View>("chat");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);

  const refreshSessions = () => {
    fetch("/api/chat?list=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => {});
  };

  useEffect(() => {
    if (!open) return;
    setReady(false);
    refreshSessions();
    const query = sessionId
      ? `?id=${encodeURIComponent(sessionId)}`
      : "";
    fetch(`/api/chat${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        setInitialMessages((data.messages as UIMessage[]) ?? []);
        if (!sessionId) setSessionId((data.id as string) ?? crypto.randomUUID());
      })
      .catch(() => {
        if (!sessionId) setSessionId(crypto.randomUUID());
      })
      .finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && view === "sessions") refreshSessions();
  }, [open, view]);

  const resetToNewChat = () => {
    setInitialMessages([]);
    setSessionId(crypto.randomUUID());
    setReady(true);
    setView("chat");
  };

  const clearChat = () => {
    if (sessionId) {
      fetch(`/api/chat?id=${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      }).catch(() => {});
    }
    resetToNewChat();
  };

  const openSession = (id: string) => {
    setReady(false);
    fetch(`/api/chat?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        setInitialMessages((data.messages as UIMessage[]) ?? []);
        setSessionId(id);
        setView("chat");
      })
      .catch(() => {
        toast.error("Could not open conversation");
      })
      .finally(() => setReady(true));
  };

  const deleteSession = (id: string) => {
    fetch(`/api/chat?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(() => {
        if (id === sessionId) resetToNewChat();
        else refreshSessions();
      })
      .catch(() => {
        toast.error("Could not delete conversation");
      });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setView("chat");
      }}
    >
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
        {view === "sessions" ? (
          <SessionList
            sessions={sessions}
            activeId={sessionId}
            onOpen={openSession}
            onDelete={deleteSession}
            onBack={() => setView("chat")}
          />
        ) : (
          sessionId &&
          ready && (
            <ChatView
              key={sessionId}
              sessionId={sessionId}
              initialMessages={initialMessages}
              onNewChat={resetToNewChat}
              onClear={clearChat}
              onOpenSessions={() => setView("sessions")}
            />
          )
        )}
      </SheetContent>
    </Sheet>
  );
}