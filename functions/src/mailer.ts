import * as nodemailer from 'nodemailer';

export interface TeacherEmailPayload {
  teacherEmail: string;
  teacherEmailVerified: boolean;
  examCode: string;
  examTitle: string;
  studentFullName: string;
  className: string;
  submittedAtIso: string;
  validatedScoreDisplay?: string; // Uniquement si calculée et validée
  secureCopyUrl: string;
  pdfBuffer?: Buffer;
  pdfFileName?: string;
}

export interface EmailSendResult {
  status: 'sent' | 'logged_no_smtp' | 'failed';
  sentAt?: string;
  recipient: string;
  subject: string;
  error?: string;
}

export async function sendSubmissionEmailToTeacher(
  payload: TeacherEmailPayload,
  secrets: {
    resendApiKey?: string;
    smtpHost?: string;
    smtpPort?: string;
    smtpUser?: string;
    smtpPass?: string;
    mailFrom?: string;
  }
): Promise<EmailSendResult> {
  const subject = `Nouvelle copie reçue — ${payload.examTitle}`;

  // Sécurité Section 13 : ne jamais envoyer de données personnelles d'élèves à une adresse non vérifiée
  if (!payload.teacherEmailVerified) {
    return {
      status: 'failed',
      recipient: payload.teacherEmail,
      subject,
      error: "L'adresse e-mail du professeur n'est pas encore vérifiée. Consultation disponible dans l'espace sécurisé.",
    };
  }

  const submittedDate = new Date(payload.submittedAtIso).toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  });

  const scoreLineHtml = payload.validatedScoreDisplay
    ? `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Note calculée et validée</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(payload.validatedScoreDisplay)}</td></tr>`
    : `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">État de correction</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">En attente de validation dans votre espace professeur</td></tr>`;

  const canAttachPdf =
    payload.pdfBuffer && payload.pdfBuffer.byteLength > 0 && payload.pdfBuffer.byteLength <= 4 * 1024 * 1024;

  const html = `
    <div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto;color:#0f172a;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:#1e3a8a;color:#ffffff;padding:20px 24px;">
        <h2 style="margin:0;font-size:18px;">EduExam — Notification de soumission</h2>
        <p style="margin:4px 0 0;font-size:13px;opacity:0.9;">Plateforme d’évaluation scolaire sécurisée</p>
      </div>
      <div style="padding:24px;">
        <p style="margin-top:0;">Bonjour,</p>
        <p>Une nouvelle copie vient d'être soumise définitivement pour votre évaluation :</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;background:#f8fafc;border-radius:8px;">
          <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Examen</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(payload.examTitle)} (${escapeHtml(payload.examCode)})</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Élève</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(payload.studentFullName)}</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Classe / Groupe</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(payload.className)}</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Heure de soumission (UTC)</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(submittedDate)}</td></tr>
          ${scoreLineHtml}
        </table>
        <p style="margin:20px 0;">
          <a href="${escapeHtml(payload.secureCopyUrl)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px;">
            Ouvrir la copie dans l'espace professeur
          </a>
        </p>
        <p style="font-size:12px;color:#64748b;margin-bottom:0;">
          ${canAttachPdf ? 'Le rapport confidentiel PDF A est joint à ce message.' : 'Consultez et téléchargez le rapport PDF A complet depuis votre espace authentifié.'}
        </p>
      </div>
    </div>
  `;

  const fromAddress = secrets.mailFrom || 'EduExam Notification <no-reply@eduexam.local>';

  // 1. Envoi via API transactionnelle Resend si configurée côté serveur
  if (secrets.resendApiKey) {
    try {
      const body: Record<string, unknown> = {
        from: fromAddress,
        to: [payload.teacherEmail],
        subject,
        html,
      };
      if (canAttachPdf && payload.pdfBuffer) {
        body.attachments = [
          {
            filename: payload.pdfFileName || `Copie_${payload.examCode}.pdf`,
            content: payload.pdfBuffer.toString('base64'),
          },
        ];
      }
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secrets.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errTxt = await resp.text();
        return {
          status: 'failed',
          recipient: payload.teacherEmail,
          subject,
          error: `Erreur Resend (${resp.status}): ${errTxt.slice(0, 180)}`,
        };
      }
      return {
        status: 'sent',
        sentAt: new Date().toISOString(),
        recipient: payload.teacherEmail,
        subject,
      };
    } catch (err) {
      return {
        status: 'failed',
        recipient: payload.teacherEmail,
        subject,
        error: err instanceof Error ? err.message : 'Échec réseau service e-mail',
      };
    }
  }

  // 2. Envoi via serveur SMTP Nodemailer si configuré côté serveur
  if (secrets.smtpHost && secrets.smtpUser && secrets.smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: secrets.smtpHost,
        port: Number(secrets.smtpPort || 587),
        secure: Number(secrets.smtpPort || 587) === 465,
        auth: {
          user: secrets.smtpUser,
          pass: secrets.smtpPass,
        },
      });
      await transporter.sendMail({
        from: fromAddress,
        to: payload.teacherEmail,
        subject,
        html,
        attachments:
          canAttachPdf && payload.pdfBuffer
            ? [
                {
                  filename: payload.pdfFileName || `Copie_${payload.examCode}.pdf`,
                  content: payload.pdfBuffer,
                },
              ]
            : [],
      });
      return {
        status: 'sent',
        sentAt: new Date().toISOString(),
        recipient: payload.teacherEmail,
        subject,
      };
    } catch (err) {
      return {
        status: 'failed',
        recipient: payload.teacherEmail,
        subject,
        error: err instanceof Error ? err.message : 'Erreur SMTP',
      };
    }
  }

  // 3. Aucun secret d'envoi configuré : journalisation honnête sans simulation mensongère
  return {
    status: 'logged_no_smtp',
    sentAt: new Date().toISOString(),
    recipient: payload.teacherEmail,
    subject,
    error:
      'Notification enregistrée dans le journal serveur (configurez RESEND_API_KEY ou SMTP_* dans les secrets serveur pour l’envoi sortant réel).',
  };
}

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
