"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
// Type-only import — erased at build time, so this pulls no server-side
// DB dependencies into the client bundle.
import type { ComplaintDraft } from "@/lib/chat-tools";
import { strings } from "@/lib/strings";
import { DraftReviewCard } from "./DraftReviewCard";

type DraftToolOutput =
  | { ok: true; draft: ComplaintDraft }
  | { ok: false; error: string };

/** Conversation surface: transcript, tool status lines, draft card, input. */
export function ChatPanel() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, regenerate } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";

  // Only the newest draft gets a live review card; earlier ones collapse
  // to a "superseded" note so there is exactly one submit path on screen.
  let latestDraftCallId: string | null = null;
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        part.type === "tool-draftComplaint" &&
        part.state === "output-available" &&
        (part.output as DraftToolOutput).ok
      ) {
        latestDraftCallId = part.toolCallId;
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <p className="px-4 py-2 text-xs text-black/50 dark:text-white/50 border-b border-black/10 dark:border-white/10">
        {strings.chat.disclosure}
      </p>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {messages.length === 0 && (
          <p className="text-sm text-black/60 dark:text-white/60">
            {strings.chat.emptyState}
          </p>
        )}

        {messages.map((message) => (
          <div key={message.id} className="flex flex-col gap-2">
            {message.parts.map((part, i) => {
              const key = `${message.id}-${i}`;
              if (part.type === "text") {
                return message.role === "user" ? (
                  <div
                    key={key}
                    className="self-end max-w-[85%] rounded-lg bg-foreground text-background px-3 py-2 text-sm whitespace-pre-wrap"
                  >
                    {part.text}
                  </div>
                ) : (
                  <div
                    key={key}
                    className="self-start max-w-[85%] rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 text-sm whitespace-pre-wrap"
                  >
                    {part.text}
                  </div>
                );
              }
              if (
                part.type === "tool-searchOffices" ||
                part.type === "tool-getOfficeContext"
              ) {
                if (part.state === "input-streaming" || part.state === "input-available") {
                  return (
                    <p key={key} className="text-xs text-black/50 dark:text-white/50">
                      {strings.chat.toolSearching}
                    </p>
                  );
                }
                return null;
              }
              if (part.type === "tool-draftComplaint") {
                if (part.state === "input-streaming" || part.state === "input-available") {
                  return (
                    <p key={key} className="text-xs text-black/50 dark:text-white/50">
                      {strings.chat.toolDrafting}
                    </p>
                  );
                }
                if (part.state === "output-available") {
                  const output = part.output as DraftToolOutput;
                  if (!output.ok) return null;
                  if (part.toolCallId !== latestDraftCallId) {
                    return (
                      <p key={key} className="text-xs text-black/50 dark:text-white/50">
                        {strings.chat.draftSuperseded}
                      </p>
                    );
                  }
                  return <DraftReviewCard key={part.toolCallId} draft={output.draft} />;
                }
                return null;
              }
              return null;
            })}
          </div>
        ))}

        {busy && (
          <p className="text-xs text-black/50 dark:text-white/50">
            {strings.chat.thinking}
          </p>
        )}

        {error && (
          <div className="flex items-center gap-3 text-sm text-red-600 dark:text-red-400">
            <span>{strings.chat.errors.chatFailed}</span>
            <button type="button" onClick={() => regenerate()} className="underline">
              {strings.chat.retry}
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex gap-2 border-t border-black/10 dark:border-white/10 p-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={strings.chat.inputPlaceholder}
          className="flex-1 border rounded px-3 py-2 bg-transparent text-sm"
        />
        <button
          type="submit"
          disabled={busy || input.trim() === ""}
          className="rounded bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {strings.chat.send}
        </button>
      </form>
    </div>
  );
}
