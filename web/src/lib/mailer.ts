import { Resend } from "resend";
import { env } from "./env";
import { log } from "./log";
import { strings } from "./strings";

/**
 * OTP email delivery. Two transports:
 *  - console: logs the code (dev/test, or when Resend isn't configured).
 *  - resend: real email, used only in production with RESEND_API_KEY set.
 */
export interface Mailer {
  sendOtpEmail(to: string, code: string): Promise<void>;
}

const consoleMailer: Mailer = {
  async sendOtpEmail(to, code) {
    // Intentionally a plain, greppable string — dev/test tooling (and
    // otp.test.ts-adjacent manual testing) can find the code in logs.
    log.info(`OTP for ${to}: ${code}`);
  },
};

function buildResendMailer(apiKey: string): Mailer {
  const client = new Resend(apiKey);
  const from = env.EMAIL_FROM ?? "CorruptionFix <no-reply@corruptionfix.org>";

  return {
    async sendOtpEmail(to, code) {
      const { error } = await client.emails.send({
        from,
        to,
        subject: strings.auth.otpEmail.subject,
        text: strings.auth.otpEmail.body(code),
      });

      if (error) {
        log.error({ err: error }, "failed to send OTP email via Resend");
        throw new Error("failed to send OTP email");
      }
    },
  };
}

let cachedMailer: Mailer | undefined;

function getMailer(): Mailer {
  if (!cachedMailer) {
    cachedMailer =
      env.NODE_ENV === "production" && env.RESEND_API_KEY
        ? buildResendMailer(env.RESEND_API_KEY)
        : consoleMailer;
  }
  return cachedMailer;
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  return getMailer().sendOtpEmail(to, code);
}
