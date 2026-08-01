import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST?.trim() ?? "";
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpUser = process.env.SMTP_USER?.trim() ?? "";
const smtpPass = process.env.SMTP_PASS ?? "";
const smtpFrom = process.env.SMTP_FROM?.trim() || smtpUser;

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const transporter = smtpHost && smtpUser && smtpPass
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass }
    })
  : null;

export async function sendPasswordResetEmail(input: { email: string; name: string; resetUrl: string }): Promise<void> {
  if (!transporter || !smtpFrom) {
    if (process.env.NODE_ENV === "production") {
      console.warn(`[password-reset] SMTP is not configured; reset email for ${input.email} was not sent.`);
    } else {
      console.warn(`[password-reset] SMTP is not configured. Development reset URL for ${input.email}: ${input.resetUrl}`);
    }
    return;
  }

  const safeName = escapeHtml(input.name);
  const safeResetUrl = escapeHtml(input.resetUrl);
  await transporter.sendMail({
    from: smtpFrom,
    to: input.email,
    subject: "Reset your B9T9 password",
    text: `Hello ${input.name},\n\nUse this secure link to reset your B9T9 password:\n${input.resetUrl}\n\nThis link expires in 30 minutes. If you did not request this, ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;background:#111318;color:#f5f7fa;border-radius:18px"><h2 style="margin-top:0">Reset your B9T9 password</h2><p>Hello ${safeName},</p><p>Use the button below to create a new password. The link expires in 30 minutes.</p><p><a href="${safeResetUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#20b408;color:#fff;text-decoration:none;font-weight:700">Reset password</a></p><p style="color:#9ca3af;font-size:13px">If you did not request this, no action is required.</p></div>`
  });
}
