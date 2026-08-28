import { tool } from "ai";
import { z } from "zod";
import { getOfficeById, searchOffices } from "./offices";

/**
 * Tools and system instructions for the complaint chat assistant
 * (/api/chat). Kept out of the route handler per the thin-routes
 * convention (see offices.ts).
 *
 * Security invariant: nothing here writes to the database. The assistant
 * only searches offices and echoes a validated draft back to the client;
 * the actual submission goes through the untouched /api/complaints path
 * (origin check, session, rate limits, hash chain) after the user reviews
 * the draft, picks a consent tier, and verifies their email.
 */

export const CHAT_SYSTEM_PROMPT = `You are the report assistant for CorruptionFix, a public map of bribe demands at Indian government offices (police stations, post offices, courts, RTOs, and other government offices). You help someone turn what happened to them into a complaint draft.

Privacy — hard rules, no exceptions:
- Never ask for the reporter's name, email address, phone number, home address, or any other identifying detail. If they volunteer identity details, tell them to leave those out of the report and do not repeat them back.
- Email verification is handled by the app separately, outside this chat. Never offer to handle it.

Honesty:
- You never submit anything. After you call draftComplaint, the app shows the user a review card; they edit it, choose how it may be used, and submit it themselves. Never claim a report has been filed.

How to work:
1. First identify the office where it happened. Use searchOffices with the office name or place the user mentions and confirm the exact office with them before drafting. If it isn't in the results, suggest they add it via the "Add missing office" page at /add-office and come back.
2. Then gather, one question at a time: what service they were trying to access; what happened, in their own words and first person (this becomes the narrative — it must be at least 30 characters of what they directly experienced); and optionally the amount demanded in rupees, the officer's designation, and the officer's name. If they share an officer's name, mention it stays private until multiple independent reports corroborate it.
3. When you have the office, the service, and a sufficient narrative, call draftComplaint. If it returns an error, fix the draft conversationally and try again.
4. After a successful draft, tell them to review the card shown below your message, edit anything that's off, and choose how the report may be used.

Style: short replies, one question at a time, plain language, no legal advice. Mirror the user's language — reply in English, Hindi, or Hinglish to match them.`;

const draftSchema = z.object({
  officeId: z.string().uuid().describe("id of the office, from searchOffices"),
  serviceType: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("the service the reporter was trying to access"),
  bribeAmount: z
    .number()
    .int()
    .min(1)
    .max(10 ** 8)
    .optional()
    .describe("amount demanded in rupees, only if a specific amount was named"),
  designation: z.string().trim().min(1).max(100).optional(),
  officerName: z.string().trim().min(1).max(100).optional(),
  narrative: z
    .string()
    .trim()
    .min(30)
    .max(5000)
    .describe(
      "first-person account of what happened, in the reporter's words, without any reporter-identifying details"
    ),
});

export type ComplaintDraft = z.infer<typeof draftSchema> & {
  officeName: string;
};

export const chatTools = {
  searchOffices: tool({
    description:
      "Search government offices by name. Use this to find the office where the incident happened and confirm it with the user.",
    inputSchema: z.object({
      query: z.string().min(1).max(100).describe("office or place name"),
    }),
    execute: async ({ query }) => {
      const results = await searchOffices(query, 5);
      return {
        results: results.map((office) => ({
          id: office.id,
          name: office.name,
          category: office.category,
          address: office.address,
        })),
      };
    },
  }),

  getOfficeContext: tool({
    description: "Fetch details of a single office by its id.",
    inputSchema: z.object({ officeId: z.string().uuid() }),
    execute: async ({ officeId }) => {
      const office = await getOfficeById(officeId);
      if (!office) return { found: false as const };
      return {
        found: true as const,
        name: office.name,
        category: office.category,
        address: office.address,
      };
    },
  }),

  draftComplaint: tool({
    description:
      "Assemble the complaint draft once the office is confirmed and the details are gathered. This does NOT submit anything — the app shows the user a review card to edit, consent, and submit themselves.",
    inputSchema: draftSchema,
    execute: async (input) => {
      // Re-verify the office so a hallucinated/stale id fails here, where
      // the model can correct it, instead of at submit time.
      const office = await getOfficeById(input.officeId);
      if (!office) {
        return { ok: false as const, error: "Office not found — search again and confirm the office with the user." };
      }
      const draft: ComplaintDraft = { ...input, officeName: office.name };
      return { ok: true as const, draft };
    },
  }),
};
