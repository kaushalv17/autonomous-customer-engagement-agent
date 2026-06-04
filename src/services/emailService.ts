import nodemailer from 'nodemailer';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
  }
  return transporter;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<SendResult> {
  if (!config.smtp.user || !config.smtp.pass) {
    logger.warn(`SMTP not configured — simulating send to ${to}`);
    return { success: true, messageId: `simulated-${Date.now()}` };
  }

  try {
    const info = await getTransporter().sendMail({
      from: config.smtp.from,
      to,
      subject,
      text: body,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;line-height:1.6">${body.replace(/\n/g, '<br>')}</div>`,
    });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function verifySmtp(): Promise<boolean> {
  if (!config.smtp.user || !config.smtp.pass) return false;
  try {
    await getTransporter().verify();
    return true;
  } catch {
    return false;
  }
}
