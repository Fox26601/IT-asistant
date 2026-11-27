/**
 * Back-compat re-exports. Prefer importing from `./corpMail.js`.
 * Corp mail prefers Resend HTTP; SMTP is fallback. No SMTP_FROM_NAME.
 */
export {
  sendCorpMail,
  smtpConfigured,
  smtpStatus,
  mailConfigured,
  mailStatus,
  resendConfigured,
  preferredMailProvider,
  type CorpMailPayload,
  type MailProvider,
} from "./corpMail.js";
