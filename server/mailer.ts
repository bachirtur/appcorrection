import nodemailer from 'nodemailer';

export interface ServerMailInput {
  teacherEmail: string;
  teacherEmailVerified: boolean;
  examCode: string;
  examTitle: string;
  studentFullName: string;
  className: string;
  submittedAtIso: string;
  validatedScoreDisplay?: string;
  secureCopyUrl: string;
  pdfBuffer?: Buffer;
  pdfFileName?: string;
}

export interface ServerMailOutput {
  status: 'sent' | 'logged_no_smtp' | 'failed';
  sentAt?: string;
  recipient: string;
  subject: string;
  error?: string;
}

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function dispatchTeacherSubmissionEmail(
  input: ServerMailInput
): Promise<ServerMailOutput> {
  const subject = `Nouvelle copie reçue — ${input.examTitle}`;

  if (!input.teacherEmailVerified) {
    return {
      status: 'failed',
      recipient: input.teacherEmail,
      subject,
      error: "Adresse e-mail professeur non vérifiée — consultation directe dans l'espace sécurisé uniquement.",
    };
  }

  const submittedFormatted = new Date(input.submittedAtIso).toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  });

  const scoreRow = input.validatedScoreDisplay
    ? `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Note calculée et validée</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(input.validatedScoreDisplay)}</td></tr>`
    : `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Correction</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">En attente de validation dans votre espace professeur</td></tr>`;

  const canAttach =
    input.pdfBuffer && input.pdfBuffer.byteLength > 0 && input.pdfBuffer.byteLength <= 4 * 1024 * 1024;

  const html = `
    <div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:#1e3a8a;color:#fff;padding:18px 24px;">
        <h2 style="margin:0;font-size:18px;">EduExam — Nouvelle copie reçue</h2>
      </div>
      <div style="padding:24px;color:#0f172a;">
        <p>Bonjour,</p>
        <p>Une nouvelle copie a été soumise définitivement :</p>
        <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px;font-size:14px;">
          <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Identifiant examen</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(input.examCode)}</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Titre</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(input.examTitle)}</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Élève</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(input.studentFullName)}</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Classe</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(input.className)}</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Heure de soumission (UTC)</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(submittedFormatted)}</td></tr>
          ${scoreRow}
        </table>
        <p style="margin-top:20px;">
          <a href="${escapeHtml(input.secureCopyUrl)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Consulter la copie dans l'espace professeur</a>
        </p>
      </div>
    </div>
  `;

  const fromAddress = process.env.MAIL_FROM || 'EduExam <no-reply@eduexam.local>';
  const resendKey = process.env.RESEND_API_KEY;

  if (resendKey) {
    try {
      const payload: Record<string, unknown> = {
        from: fromAddress,
        to: [input.teacherEmail],
        subject,
        html,
      };
      if (canAttach && input.pdfBuffer) {
        payload.attachments = [
          {
            filename: input.pdfFileName || `Copie_${input.examCode}.pdf`,
            content: input.pdfBuffer.toString('base64'),
          },
        ];
      }
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        return {
          status: 'failed',
          recipient: input.teacherEmail,
          subject,
          error: `Service e-mail HTTP ${resp.status}`,
        };
      }
      return {
        status: 'sent',
        sentAt: new Date().toISOString(),
        recipient: input.teacherEmail,
        subject,
      };
    } catch (err) {
      return {
        status: 'failed',
        recipient: input.teacherEmail,
        subject,
        error: err instanceof Error ? err.message : 'Erreur réseau service e-mail',
      };
    }
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT || 587) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      await transporter.sendMail({
        from: fromAddress,
        to: input.teacherEmail,
        subject,
        html,
        attachments:
          canAttach && input.pdfBuffer
            ? [{ filename: input.pdfFileName || `Copie_${input.examCode}.pdf`, content: input.pdfBuffer }]
            : [],
      });
      return {
        status: 'sent',
        sentAt: new Date().toISOString(),
        recipient: input.teacherEmail,
        subject,
      };
    } catch (err) {
      return {
        status: 'failed',
        recipient: input.teacherEmail,
        subject,
        error: err instanceof Error ? err.message : 'Erreur SMTP',
      };
    }
  }

  return {
    status: 'logged_no_smtp',
    sentAt: new Date().toISOString(),
    recipient: input.teacherEmail,
    subject,
    error:
      'Notification journalisée côté serveur (configurez RESEND_API_KEY ou SMTP_* dans les secrets serveur pour activer l’expédition SMTP/API externe).',
  };
}
