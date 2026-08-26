/**
 * Central home for user-facing copy.
 *
 * Every string a user sees — page copy, labels, error/status messages —
 * should be added here rather than inlined at the call site. This keeps the
 * app i18n-ready: a future translation layer only needs to swap out this
 * one module (or the values it exports) per locale.
 */
export const strings = {
  app: {
    name: "CorruptionFix",
    tagline: "Report corruption at government offices. See it on the map.",
  },
  health: {
    ok: "All systems operational.",
    degraded: "Service is degraded — the database is unreachable.",
  },
  auth: {
    otpEmail: {
      subject: "Your CorruptionFix verification code",
      body: (code: string) =>
        `Your CorruptionFix verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
    },
    errors: {
      invalidEmail: "Enter a valid email address.",
      invalidCode: "Enter the 6-digit code we emailed you.",
      rateLimited: "Too many attempts. Please try again later.",
      cooldown: "Please wait before requesting another code.",
      codeNotFound: "Request a new code first.",
      codeExpired: "That code has expired. Request a new one.",
      codeIncorrect: "That code isn't right. Check your email and try again.",
      tooManyAttempts: "Too many incorrect attempts. Request a new code.",
      badOrigin: "Request rejected.",
      serverError: "Something went wrong. Please try again.",
    },
  },
} as const;
