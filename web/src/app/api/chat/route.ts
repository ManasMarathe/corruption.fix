import { type NextRequest } from "next/server";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { CHAT_SYSTEM_PROMPT, chatTools } from "@/lib/chat-tools";
import { checkOrigin, clientIp, errorResponse } from "@/lib/http";
import { log } from "@/lib/log";
import { limit } from "@/lib/ratelimit";
import { strings } from "@/lib/strings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// No auth to chat — the assistant only helps draft; authentication (and
// every other guard) happens on /api/complaints when the user submits the
// reviewed draft. Rate limits below bound abuse and AI spend instead.
const BURST_LIMIT = { max: 30, windowSec: 10 * 60 };
const DAILY_LIMIT = { max: 200, windowSec: 24 * 60 * 60 };

const MAX_MESSAGES = 40;
const MAX_BODY_BYTES = 32 * 1024;

// The complaint chat assistant. Streams model output (via the Vercel AI
// Gateway — OIDC on Vercel, AI_GATEWAY_API_KEY locally) back to useChat.
// Transcripts are never persisted server-side.
export async function POST(request: NextRequest) {
  if (!checkOrigin(request)) {
    return errorResponse(403, "bad_origin", strings.chat.errors.badOrigin);
  }

  const ip = clientIp(request);
  const burst = await limit("chat-ip", ip, BURST_LIMIT.max, BURST_LIMIT.windowSec);
  if (!burst.allowed) {
    return errorResponse(429, "rate_limited", strings.chat.errors.rateLimited, {
      "Retry-After": String(burst.retryAfterSec),
    });
  }
  const daily = await limit("chat-ip-day", ip, DAILY_LIMIT.max, DAILY_LIMIT.windowSec);
  if (!daily.allowed) {
    return errorResponse(429, "rate_limited", strings.chat.errors.rateLimited, {
      "Retry-After": String(daily.retryAfterSec),
    });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return errorResponse(400, "invalid_body", strings.chat.errors.chatFailed);
  }
  let messages: UIMessage[];
  try {
    const body = JSON.parse(raw) as { messages?: UIMessage[] };
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return errorResponse(400, "invalid_body", strings.chat.errors.chatFailed);
    }
    messages = body.messages;
  } catch {
    return errorResponse(400, "invalid_body", strings.chat.errors.chatFailed);
  }
  if (messages.length > MAX_MESSAGES) {
    return errorResponse(400, "invalid_body", strings.chat.errors.chatFailed);
  }

  try {
    const result = streamText({
      model: "anthropic/claude-sonnet-5",
      instructions: CHAT_SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools: chatTools,
      stopWhen: isStepCount(6),
      onError: ({ error }) => {
        log.error({ err: error }, "chat stream failed");
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        // Never leak provider/internal error details to the client.
        onError: () => strings.chat.errors.serverError,
      }),
    });
  } catch (error) {
    log.error({ err: error }, "chat request failed");
    return errorResponse(500, "server_error", strings.chat.errors.serverError);
  }
}
