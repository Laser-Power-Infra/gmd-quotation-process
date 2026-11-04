"use client";

import { CircleAlert } from "lucide-react";

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export default function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-xl">
      <div className="text-center max-w-lg">
        <CircleAlert size={48} className="text-error mb-md inline-block" />
        <h3 className="font-headline-sm text-headline-sm text-on-surface mb-sm">Failed to load data</h3>
        <p className="text-body-md text-on-surface-variant mb-lg">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-md py-2 bg-primary text-primary-foreground rounded-lg font-label-md font-bold hover:shadow-lg transition-all active:scale-95"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
