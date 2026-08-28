"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { strings } from "@/lib/strings";

// Loaded on first open so ai/@ai-sdk/react never enter the initial map
// bundle — the home page's first paint is already gated on maplibre.
const ChatPanel = dynamic(() => import("./ChatPanel").then((m) => m.ChatPanel), {
  ssr: false,
});

/**
 * Floating launcher for the complaint chat assistant, mounted next to
 * MapHome on the home page. bottom-10 keeps it clear of maplibre's
 * attribution control in the bottom-right corner.
 */
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);

  return (
    <>
      {!open && (
        <button
          type="button"
          aria-label={strings.chat.launcherLabel}
          onClick={() => {
            setOpen(true);
            setEverOpened(true);
          }}
          className="fixed right-3 bottom-10 z-20 rounded-full bg-black text-white dark:bg-white dark:text-black px-4 py-3 text-sm font-medium shadow-sm hover:opacity-90"
        >
          {strings.chat.launcherLabel}
        </button>
      )}

      {/* Keep the panel mounted once opened so the transcript survives
          closing and reopening. */}
      {everOpened && (
        <div
          className={
            open
              ? "fixed inset-0 z-40 flex flex-col bg-white dark:bg-neutral-950 sm:inset-auto sm:right-4 sm:bottom-4 sm:w-[380px] sm:h-[600px] sm:max-h-[85dvh] sm:rounded-lg sm:border sm:border-black/10 sm:dark:border-white/10 sm:shadow-lg sm:overflow-hidden"
              : "hidden"
          }
        >
          <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 px-4 py-3">
            <h2 className="text-sm font-semibold">{strings.chat.panelTitle}</h2>
            <button
              type="button"
              aria-label={strings.chat.close}
              onClick={() => setOpen(false)}
              className="text-black/60 dark:text-white/60 hover:opacity-70 text-lg leading-none"
            >
              ×
            </button>
          </div>
          <ChatPanel />
        </div>
      )}
    </>
  );
}
