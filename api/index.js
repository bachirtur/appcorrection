// Fichier généré automatiquement par scripts/build-vercel-api.mjs — aucun secret inclus.

// server/index.ts
import express from "express";
import cors from "cors";
import multer from "multer";
import crypto2 from "node:crypto";
import { fileURLToPath } from "node:url";

// server/store.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var EMPTY_STATE = {
  teachers: {},
  exams: {},
  examSecrets: {},
  examSessions: {},
  submissions: {},
  auditLogs: [],
  emailLogs: []
};
var PrivateVaultStore = class {
  baseDir;
  dbFilePath;
  subjectsDir;
  correctionsDir;
  state;
  constructor(customBaseDir) {
    const defaultBaseDir = process.env.VERCEL ? path.join(os.tmpdir(), "eduexam-vault") : path.resolve(process.cwd(), "server", ".data");
    this.baseDir = customBaseDir || process.env.EDUEXAM_DATA_DIR || defaultBaseDir;
    this.dbFilePath = path.join(this.baseDir, "db.json");
    this.subjectsDir = path.join(this.baseDir, "private_subjects");
    this.correctionsDir = path.join(this.baseDir, "confidential_corrections");
    fs.mkdirSync(this.subjectsDir, { recursive: true });
    fs.mkdirSync(this.correctionsDir, { recursive: true });
    if (fs.existsSync(this.dbFilePath)) {
      try {
        const raw = fs.readFileSync(this.dbFilePath, "utf8");
        this.state = { ...structuredClone(EMPTY_STATE), ...JSON.parse(raw) };
      } catch {
        this.state = structuredClone(EMPTY_STATE);
      }
    } else {
      this.state = structuredClone(EMPTY_STATE);
      this.persist();
    }
  }
  get data() {
    return this.state;
  }
  persist() {
    const tmpPath = `${this.dbFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(tmpPath, this.dbFilePath);
  }
  savePrivatePdf(kind, examId, buffer) {
    const safeExamId = examId.replace(/[^a-zA-Z0-9_-]/g, "");
    const fileName = `${safeExamId}_${kind}.pdf`;
    const dir = kind === "subject" ? this.subjectsDir : this.correctionsDir;
    const fullPath = path.join(dir, fileName);
    fs.writeFileSync(fullPath, buffer);
    return fileName;
  }
  readPrivatePdf(kind, fileName) {
    const baseName = path.basename(fileName);
    const dir = kind === "subject" ? this.subjectsDir : this.correctionsDir;
    const fullPath = path.join(dir, baseName);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath);
  }
  deletePrivatePdf(kind, fileName) {
    if (!fileName) return;
    const baseName = path.basename(fileName);
    const dir = kind === "subject" ? this.subjectsDir : this.correctionsDir;
    const fullPath = path.join(dir, baseName);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }
};

// server/crypto.ts
import crypto from "node:crypto";
var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var RUNTIME_HMAC_SECRET = process.env.SESSION_HMAC_SECRET || crypto.randomBytes(48).toString("hex");
function generateSecureReadableCode(groups = 3, groupLen = 4) {
  const total = groups * groupLen;
  const bytes = crypto.randomBytes(total * 2);
  let chars = "";
  let idx = 0;
  const maxUnbiased = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  while (chars.length < total && idx < bytes.length) {
    const val = bytes[idx++];
    if (val < maxUnbiased) {
      chars += ALPHABET[val % ALPHABET.length];
    }
  }
  while (chars.length < total) {
    chars += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  const parts = [];
  for (let i = 0; i < groups; i++) {
    parts.push(chars.slice(i * groupLen, (i + 1) * groupLen));
  }
  return parts.join("-");
}
function generateExamPublicId() {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  return `EXM-${year}-${generateSecureReadableCode(1, 6)}`;
}
function generateSubmissionPublicId() {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  return `SUB-${year}-${generateSecureReadableCode(1, 6)}`;
}
function hashPasswordOrCode(plain, normalizeUpper = false, existingSalt) {
  const normalized = normalizeUpper ? plain.trim().toUpperCase().replace(/\s+/g, "") : plain;
  const salt = existingSalt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(normalized, salt, 64).toString("hex");
  return { hash, salt };
}
function verifyPasswordOrCode(plain, expectedHash, salt, normalizeUpper = false) {
  if (!plain || !expectedHash || !salt) return false;
  const { hash } = hashPasswordOrCode(plain, normalizeUpper, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function signToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", RUNTIME_HMAC_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}
function verifyToken(token, expectedKind) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac("sha256", RUNTIME_HMAC_SECRET).update(encoded).digest("base64url");
  const bufA = Buffer.from(sig);
  const bufB = Buffer.from(expectedSig);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (parsed.kind !== expectedKind) return null;
    if (!Number.isFinite(parsed.exp) || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}
function computeStudentFingerprint(firstName, lastName, className, email) {
  const raw = [
    (lastName || "").trim().toLowerCase(),
    (firstName || "").trim().toLowerCase(),
    (className || "").trim().toLowerCase(),
    (email || "").trim().toLowerCase()
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

// server/mailer.ts
import nodemailer from "nodemailer";
function escapeHtml(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
async function dispatchTeacherSubmissionEmail(input) {
  const subject = `Nouvelle copie re\xE7ue \u2014 ${input.examTitle}`;
  if (!input.teacherEmailVerified) {
    return {
      status: "failed",
      recipient: input.teacherEmail,
      subject,
      error: "Adresse e-mail professeur non v\xE9rifi\xE9e \u2014 consultation directe dans l'espace s\xE9curis\xE9 uniquement."
    };
  }
  const submittedFormatted = new Date(input.submittedAtIso).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC"
  });
  const scoreRow = input.validatedScoreDisplay ? `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Note calcul\xE9e et valid\xE9e</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(input.validatedScoreDisplay)}</td></tr>` : `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Correction</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">En attente de validation dans votre espace professeur</td></tr>`;
  const canAttach = input.pdfBuffer && input.pdfBuffer.byteLength > 0 && input.pdfBuffer.byteLength <= 4 * 1024 * 1024;
  const html = `
    <div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:#1e3a8a;color:#fff;padding:18px 24px;">
        <h2 style="margin:0;font-size:18px;">EduExam \u2014 Nouvelle copie re\xE7ue</h2>
      </div>
      <div style="padding:24px;color:#0f172a;">
        <p>Bonjour,</p>
        <p>Une nouvelle copie a \xE9t\xE9 soumise d\xE9finitivement :</p>
        <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px;font-size:14px;">
          <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Identifiant examen</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(input.examCode)}</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Titre</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(input.examTitle)}</td></tr>
          <tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">\xC9l\xE8ve</td><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(input.studentFullName)}</td></tr>
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
  const fromAddress = process.env.MAIL_FROM || "EduExam <no-reply@eduexam.local>";
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const payload = {
        from: fromAddress,
        to: [input.teacherEmail],
        subject,
        html
      };
      if (canAttach && input.pdfBuffer) {
        payload.attachments = [
          {
            filename: input.pdfFileName || `Copie_${input.examCode}.pdf`,
            content: input.pdfBuffer.toString("base64")
          }
        ];
      }
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        return {
          status: "failed",
          recipient: input.teacherEmail,
          subject,
          error: `Service e-mail HTTP ${resp.status}`
        };
      }
      return {
        status: "sent",
        sentAt: (/* @__PURE__ */ new Date()).toISOString(),
        recipient: input.teacherEmail,
        subject
      };
    } catch (err) {
      return {
        status: "failed",
        recipient: input.teacherEmail,
        subject,
        error: err instanceof Error ? err.message : "Erreur r\xE9seau service e-mail"
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
          pass: process.env.SMTP_PASS
        }
      });
      await transporter.sendMail({
        from: fromAddress,
        to: input.teacherEmail,
        subject,
        html,
        attachments: canAttach && input.pdfBuffer ? [{ filename: input.pdfFileName || `Copie_${input.examCode}.pdf`, content: input.pdfBuffer }] : []
      });
      return {
        status: "sent",
        sentAt: (/* @__PURE__ */ new Date()).toISOString(),
        recipient: input.teacherEmail,
        subject
      };
    } catch (err) {
      return {
        status: "failed",
        recipient: input.teacherEmail,
        subject,
        error: err instanceof Error ? err.message : "Erreur SMTP"
      };
    }
  }
  return {
    status: "logged_no_smtp",
    sentAt: (/* @__PURE__ */ new Date()).toISOString(),
    recipient: input.teacherEmail,
    subject,
    error: "Notification journalis\xE9e c\xF4t\xE9 serveur (configurez RESEND_API_KEY ou SMTP_* dans les secrets serveur pour activer l\u2019exp\xE9dition SMTP/API externe)."
  };
}

// src/services/grading.ts
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function computeAppreciation(scoreOn20) {
  if (scoreOn20 >= 16) return "Excellent";
  if (scoreOn20 >= 14) return "Bien";
  if (scoreOn20 >= 12) return "Assez bien";
  if (scoreOn20 >= 10) return "Passable";
  return "Insuffisant";
}
function normalizeText(input, caseSensitive = false) {
  const trimmed = (input || "").trim().replace(/\s+/g, " ");
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}
function normalizeMathExpression(input) {
  return (input || "").replace(/\s+/g, "").replace(/,/g, ".").replace(/×/g, "*").replace(/÷/g, "/").toLowerCase();
}
function parseFrenchNumber(raw) {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
function extractFullAnswerTextForAssist(question, answer) {
  if (!answer) return "";
  const chunks = [];
  if (answer.text) chunks.push(answer.text);
  if (answer.code) chunks.push(answer.code);
  if (answer.formula) chunks.push(answer.formula);
  if (answer.structuredValues) {
    chunks.push(...Object.values(answer.structuredValues));
  }
  return chunks.join(" \n ");
}
function gradeSingleQuestion(question, rubric, answer) {
  const maxPoints = question.maxPoints;
  if (question.gradingMode === "mode_c_manual" || !rubric) {
    return {
      questionId: question.id,
      pointsObtained: 0,
      maxPoints,
      state: "manual_pending",
      comment: "En attente de correction manuelle par le professeur.",
      expectedAnswerDisplay: rubric?.expectedAnswer || ""
    };
  }
  if (question.gradingMode === "mode_b_assisted") {
    if (rubric.enableIndicativeAiAssist && rubric.criteria && rubric.criteria.length > 0) {
      const textCorpus = normalizeText(extractFullAnswerTextForAssist(question, answer), false);
      let suggestedPoints = 0;
      const matchedIds = [];
      for (const crit of rubric.criteria) {
        const keywords = (crit.keywords || []).map((k) => k.trim().toLowerCase()).filter(Boolean);
        if (keywords.length > 0 && textCorpus.length > 0) {
          const matchedCount = keywords.filter((kw) => textCorpus.includes(kw)).length;
          if (matchedCount >= Math.ceil(keywords.length * 0.6)) {
            suggestedPoints += crit.points;
            matchedIds.push(crit.id);
          }
        }
      }
      const capped = round2(Math.min(maxPoints, Math.max(0, suggestedPoints)));
      return {
        questionId: question.id,
        pointsObtained: capped,
        maxPoints,
        state: "assisted_indicative",
        isIndicativeAi: true,
        matchedCriteriaIds: matchedIds,
        comment: "Pr\xE9-\xE9valuation assist\xE9e indicative bas\xE9e sur les crit\xE8res attendus \u2014 validation humaine du professeur requise.",
        expectedAnswerDisplay: rubric.expectedAnswer || ""
      };
    }
    return {
      questionId: question.id,
      pointsObtained: 0,
      maxPoints,
      state: "manual_pending",
      comment: "Correction assist\xE9e par grille de crit\xE8res \u2014 en attente de validation du professeur.",
      expectedAnswerDisplay: rubric.expectedAnswer || ""
    };
  }
  switch (question.type) {
    case "mcq_single": {
      const selected = answer?.selectedOptionIds || [];
      const correct = rubric.correctOptionIds || [];
      const isCorrect = selected.length === 1 && correct.length === 1 && selected[0] === correct[0];
      return {
        questionId: question.id,
        pointsObtained: isCorrect ? maxPoints : 0,
        maxPoints,
        state: "auto_graded",
        comment: isCorrect ? rubric.pedagogicalExplanation || "Bonne r\xE9ponse." : rubric.pedagogicalExplanation || "R\xE9ponse incorrecte.",
        expectedAnswerDisplay: rubric.expectedAnswer || correct.map((id) => question.options?.find((o) => o.id === id)?.label || id).join(", ")
      };
    }
    case "mcq_multiple": {
      const selected = [...answer?.selectedOptionIds || []].sort();
      const correct = [...rubric.correctOptionIds || []].sort();
      const exactMatch = selected.length === correct.length && selected.every((val, idx) => val === correct[idx]);
      return {
        questionId: question.id,
        pointsObtained: exactMatch ? maxPoints : 0,
        maxPoints,
        state: "auto_graded",
        comment: exactMatch ? rubric.pedagogicalExplanation || "Combinaison exacte." : rubric.pedagogicalExplanation || "Combinaison incompl\xE8te ou erron\xE9e.",
        expectedAnswerDisplay: rubric.expectedAnswer || correct.map((id) => question.options?.find((o) => o.id === id)?.label || id).join(" ; ")
      };
    }
    case "true_false": {
      const hasAnswered = answer?.booleanValue === true || answer?.booleanValue === false;
      const isCorrect = hasAnswered && answer?.booleanValue === rubric.expectedBoolean;
      return {
        questionId: question.id,
        pointsObtained: isCorrect ? maxPoints : 0,
        maxPoints,
        state: "auto_graded",
        comment: isCorrect ? rubric.pedagogicalExplanation || "R\xE9ponse exacte." : rubric.pedagogicalExplanation || "R\xE9ponse inexacte.",
        expectedAnswerDisplay: rubric.expectedAnswer || (rubric.expectedBoolean ? "Vrai" : "Faux")
      };
    }
    case "numeric": {
      const parsedStudent = parseFrenchNumber(answer?.numericInput);
      const expectedVal = rubric.numericValue;
      const tolerance = Math.abs(rubric.numericTolerance ?? 0);
      if (expectedVal === void 0 || expectedVal === null || Number.isNaN(expectedVal)) {
        return {
          questionId: question.id,
          pointsObtained: 0,
          maxPoints,
          state: "manual_pending",
          comment: "Valeur cible non configur\xE9e \u2014 v\xE9rification manuelle requise.",
          expectedAnswerDisplay: rubric.expectedAnswer || ""
        };
      }
      if (parsedStudent === null) {
        return {
          questionId: question.id,
          pointsObtained: 0,
          maxPoints,
          state: "auto_graded",
          comment: "Aucune valeur num\xE9rique valide fournie.",
          expectedAnswerDisplay: rubric.expectedAnswer || `${expectedVal}${rubric.expectedUnit ? " " + rubric.expectedUnit : ""}`
        };
      }
      const valueMatches = Math.abs(parsedStudent - expectedVal) <= tolerance + 1e-9;
      if (!valueMatches) {
        return {
          questionId: question.id,
          pointsObtained: 0,
          maxPoints,
          state: "auto_graded",
          comment: rubric.pedagogicalExplanation || "Valeur hors tol\xE9rance accept\xE9e.",
          expectedAnswerDisplay: rubric.expectedAnswer || `${expectedVal}${tolerance > 0 ? ` (\xB1${tolerance})` : ""}${rubric.expectedUnit ? " " + rubric.expectedUnit : ""}`
        };
      }
      if (question.requireUnit && rubric.expectedUnit?.trim()) {
        const studentUnit = normalizeText(answer?.unitInput || "", false);
        const targetUnit = normalizeText(rubric.expectedUnit, false);
        if (studentUnit !== targetUnit) {
          const partial = round2(maxPoints * 0.75);
          return {
            questionId: question.id,
            pointsObtained: partial,
            maxPoints,
            state: "auto_graded",
            comment: `Valeur num\xE9rique exacte, mais unit\xE9 absente ou incorrecte (attendu : ${rubric.expectedUnit}).`,
            expectedAnswerDisplay: `${expectedVal} ${rubric.expectedUnit}`
          };
        }
      }
      return {
        questionId: question.id,
        pointsObtained: maxPoints,
        maxPoints,
        state: "auto_graded",
        comment: rubric.pedagogicalExplanation || "Valeur num\xE9rique exacte.",
        expectedAnswerDisplay: rubric.expectedAnswer || `${expectedVal}${rubric.expectedUnit ? " " + rubric.expectedUnit : ""}`
      };
    }
    case "short_text": {
      const caseSens = Boolean(rubric.caseSensitive);
      const studentVal = normalizeText(answer?.text || "", caseSens);
      const candidates = [rubric.expectedAnswer, ...rubric.acceptedAlternatives || []].filter(Boolean).map((c) => normalizeText(c, caseSens));
      if (candidates.length === 0) {
        return {
          questionId: question.id,
          pointsObtained: 0,
          maxPoints,
          state: "manual_pending",
          comment: "Aucune r\xE9ponse de r\xE9f\xE9rence param\xE9tr\xE9e \u2014 v\xE9rification par le professeur.",
          expectedAnswerDisplay: ""
        };
      }
      const matched = studentVal.length > 0 && candidates.includes(studentVal);
      return {
        questionId: question.id,
        pointsObtained: matched ? maxPoints : 0,
        maxPoints,
        state: "auto_graded",
        comment: matched ? rubric.pedagogicalExplanation || "R\xE9ponse exacte." : rubric.pedagogicalExplanation || "R\xE9ponse diff\xE9rente des r\xE9ponses accept\xE9es.",
        expectedAnswerDisplay: rubric.expectedAnswer
      };
    }
    case "math_formula": {
      const studentExpr = normalizeMathExpression(answer?.formula || "");
      const candidates = [rubric.expectedAnswer, ...rubric.acceptedAlternatives || []].filter(Boolean).map((c) => normalizeMathExpression(c));
      if (candidates.length === 0) {
        return {
          questionId: question.id,
          pointsObtained: 0,
          maxPoints,
          state: "manual_pending",
          comment: "V\xE9rification math\xE9matique manuelle requise.",
          expectedAnswerDisplay: rubric.expectedAnswer || ""
        };
      }
      const matched = studentExpr.length > 0 && candidates.includes(studentExpr);
      return {
        questionId: question.id,
        pointsObtained: matched ? maxPoints : 0,
        maxPoints,
        state: "auto_graded",
        comment: matched ? rubric.pedagogicalExplanation || "Expression math\xE9matique conforme." : "Expression diff\xE9rente de la forme attendue (peut \xEAtre v\xE9rifi\xE9e par le professeur si \xE9quivalente).",
        expectedAnswerDisplay: rubric.expectedAnswer
      };
    }
    case "table": {
      const expectedGrid = rubric.expectedTable;
      const studentGrid = answer?.tableValues;
      if (!expectedGrid || expectedGrid.length === 0) {
        return {
          questionId: question.id,
          pointsObtained: 0,
          maxPoints,
          state: "manual_pending",
          comment: "Tableau en attente de correction par le professeur.",
          expectedAnswerDisplay: rubric.expectedAnswer || ""
        };
      }
      let totalCells = 0;
      let correctCells = 0;
      expectedGrid.forEach((row, rIdx) => {
        row.forEach((expectedCell, cIdx) => {
          const templateCell = question.tableTemplate?.rows?.[rIdx]?.[cIdx] ?? "";
          const isEditable = question.tableTemplate?.editableMask?.[rIdx]?.[cIdx] ?? templateCell.trim() === "";
          if (isEditable && expectedCell.trim() !== "") {
            totalCells += 1;
            const got = normalizeText(studentGrid?.[rIdx]?.[cIdx] || "", false);
            if (got === normalizeText(expectedCell, false)) {
              correctCells += 1;
            }
          }
        });
      });
      const points = totalCells > 0 ? round2(correctCells / totalCells * maxPoints) : 0;
      return {
        questionId: question.id,
        pointsObtained: points,
        maxPoints,
        state: "auto_graded",
        comment: `${correctCells}/${totalCells} cellules attendues exactes.`,
        expectedAnswerDisplay: rubric.expectedAnswer || "Voir grille du tableau corrig\xE9."
      };
    }
    // Pour les rédactions longues, programmes ou pièces jointes même si Mode A a été laissé :
    // refus honnête d'une pseudo-correction automatique trompeuse -> renvoi en revue enseignant.
    default:
      return {
        questionId: question.id,
        pointsObtained: 0,
        maxPoints,
        state: "manual_pending",
        comment: "Question ouverte / complexe : n\xE9cessite l\u2019\xE9valuation p\xE9dagogique du professeur.",
        expectedAnswerDisplay: rubric.expectedAnswer || ""
      };
  }
}
function evaluateFullSubmission(questions, rubrics, answers, examMaxScore = 20) {
  const questionGrades = {};
  let rawPointsObtained = 0;
  let rawPointsMax = 0;
  let requiresHumanReview = false;
  for (const q of questions) {
    const res = gradeSingleQuestion(q, rubrics[q.id], answers[q.id]);
    questionGrades[q.id] = res;
    rawPointsObtained += res.pointsObtained;
    rawPointsMax += q.maxPoints;
    if (res.state !== "auto_graded" && res.state !== "validated") {
      requiresHumanReview = true;
    }
  }
  if (questions.length === 0) {
    requiresHumanReview = true;
    rawPointsMax = examMaxScore > 0 ? examMaxScore : 20;
  }
  rawPointsObtained = round2(rawPointsObtained);
  rawPointsMax = round2(rawPointsMax);
  const ratio = rawPointsMax > 0 ? rawPointsObtained / rawPointsMax : 0;
  const percentage = round2(ratio * 100);
  const finalScoreOutOfMax = round2(ratio * (examMaxScore > 0 ? examMaxScore : 20));
  const normalizedScoreOn20 = round2(ratio * 20);
  const appreciation = computeAppreciation(normalizedScoreOn20);
  return {
    questionGrades,
    rawPointsObtained,
    rawPointsMax,
    finalScoreOutOfMax,
    normalizedScoreOn20,
    percentage,
    appreciation,
    gradingStatus: requiresHumanReview ? "pending_review" : "auto_graded"
  };
}
function recalculateSummaryFromQuestionGrades(questionGrades, examMaxScore = 20, forceValidated = false) {
  const entries = Object.values(questionGrades);
  let rawPointsObtained = 0;
  let rawPointsMax = 0;
  let hasPending = false;
  for (const g of entries) {
    rawPointsObtained += g.pointsObtained;
    rawPointsMax += g.maxPoints;
    if (!forceValidated && g.state !== "auto_graded" && g.state !== "validated") {
      hasPending = true;
    }
  }
  if (entries.length === 0) {
    rawPointsMax = examMaxScore > 0 ? examMaxScore : 20;
  }
  rawPointsObtained = round2(Math.max(0, Math.min(rawPointsMax, rawPointsObtained)));
  rawPointsMax = round2(rawPointsMax);
  const ratio = rawPointsMax > 0 ? rawPointsObtained / rawPointsMax : 0;
  const percentage = round2(ratio * 100);
  const finalScoreOutOfMax = round2(ratio * (examMaxScore > 0 ? examMaxScore : 20));
  const normalizedScoreOn20 = round2(ratio * 20);
  const appreciation = computeAppreciation(normalizedScoreOn20);
  return {
    rawPointsObtained,
    rawPointsMax,
    finalScoreOutOfMax,
    normalizedScoreOn20,
    percentage,
    appreciation,
    gradingStatus: forceValidated ? "validated" : hasPending ? "pending_review" : "auto_graded"
  };
}

// server/index.ts
var upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
    // Plafond serveur absolu : 25 Mo
  }
});
function sanitizeTeacherProfile(record) {
  return {
    uid: record.uid,
    firstName: record.firstName,
    lastName: record.lastName,
    email: record.email,
    emailVerified: Boolean(record.emailVerified),
    institution: record.institution || "",
    defaultSubject: record.defaultSubject || "",
    retentionDays: Number(record.retentionDays || 365),
    acceptedTerms: Boolean(record.acceptedTerms),
    acceptedTermsAt: record.acceptedTermsAt,
    createdAt: record.createdAt,
    role: "teacher"
  };
}
function splitEditorQuestions(items) {
  const publicQuestions = [];
  const rubrics = {};
  for (const item of items || []) {
    const { rubric, ...publicPart } = item;
    publicQuestions.push(publicPart);
    if (rubric) {
      rubrics[item.id] = {
        ...rubric,
        questionId: item.id
      };
    }
  }
  return { publicQuestions, rubrics };
}
function buildStudentReceipt(sub) {
  const canViewScore = Boolean(sub.showScoreToStudent) && (sub.gradingStatus === "auto_graded" || sub.gradingStatus === "validated");
  const canViewExpectedAnswers = canViewScore && Boolean(sub.showExpectedAnswersToStudent);
  let sanitizedGrades;
  if (canViewScore) {
    sanitizedGrades = {};
    for (const [qid, g] of Object.entries(sub.questionGrades || {})) {
      sanitizedGrades[qid] = {
        questionId: qid,
        pointsObtained: g.pointsObtained,
        maxPoints: g.maxPoints,
        state: g.state,
        comment: g.comment,
        expectedAnswerDisplay: canViewExpectedAnswers ? g.expectedAnswerDisplay : void 0
      };
    }
  }
  return {
    submissionId: sub.id,
    examCode: sub.examCode,
    examTitle: sub.examTitle,
    subject: sub.subject,
    student: sub.student,
    startedAt: sub.startedAt,
    submittedAt: sub.submittedAt,
    durationSeconds: sub.durationSeconds,
    autoSubmitted: sub.autoSubmitted,
    gradingStatus: sub.gradingStatus,
    canViewScore,
    canViewExpectedAnswers,
    examMaxScore: sub.examMaxScore,
    rawPointsObtained: canViewScore ? sub.rawPointsObtained : void 0,
    rawPointsMax: canViewScore ? sub.rawPointsMax : void 0,
    finalScoreOutOfMax: canViewScore ? sub.finalScoreOutOfMax : void 0,
    normalizedScoreOn20: canViewScore ? sub.normalizedScoreOn20 : void 0,
    percentage: canViewScore ? sub.percentage : void 0,
    appreciation: canViewScore ? sub.appreciation : void 0,
    generalComment: canViewScore ? sub.generalComment : void 0,
    questions: sub.questionsSnapshot,
    answers: sub.answers,
    questionGrades: sanitizedGrades
  };
}
function createApp(customDataDir) {
  const store = new PrivateVaultStore(customDataDir);
  const app = express();
  const rateBuckets = /* @__PURE__ */ new Map();
  function rateLimit(maxReqs, windowMs) {
    return (req, res, next) => {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const key = `${req.path}:${ip}`;
      const now = Date.now();
      const bucket = rateBuckets.get(key);
      if (!bucket || now > bucket.resetAt) {
        rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
        next();
        return;
      }
      bucket.count += 1;
      if (bucket.count > maxReqs) {
        res.status(429).json({
          error: "Trop de tentatives rapproch\xE9es. Veuillez patienter quelques instants avant de r\xE9essayer."
        });
        return;
      }
      next();
    };
  }
  app.use(cors());
  app.use(express.json({ limit: "8mb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  function requireTeacherAuth(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : void 0;
    const payload = verifyToken(token, "teacher");
    if (!payload || !store.data.teachers[payload.sub]) {
      res.status(401).json({ error: "Session professeur expir\xE9e ou non authentifi\xE9e." });
      return;
    }
    req.teacherId = payload.sub;
    next();
  }
  app.get("/api/health", (_req, res) => {
    const smtpConfigured = Boolean(
      process.env.RESEND_API_KEY || process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
    );
    res.json({
      status: "ok",
      service: "EduExam Secure Backend",
      firebaseProjectLinked: "appcorrection",
      emailProviderConfigured: smtpConfigured,
      serverTime: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.post("/api/auth/register", rateLimit(15, 6e4), (req, res) => {
    const { firstName, lastName, email, password, confirmPassword, acceptedTerms, institution } = req.body || {};
    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !password) {
      res.status(400).json({ error: "Tous les champs obligatoires doivent \xEAtre renseign\xE9s." });
      return;
    }
    const cleanEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: "Veuillez saisir une adresse e-mail professionnelle valide." });
      return;
    }
    if (password !== confirmPassword) {
      res.status(400).json({ error: "Le mot de passe et sa confirmation ne correspondent pas." });
      return;
    }
    if (String(password).length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      res.status(400).json({
        error: "Le mot de passe doit contenir au moins 8 caract\xE8res, dont une majuscule, une minuscule et un chiffre."
      });
      return;
    }
    if (acceptedTerms !== true) {
      res.status(400).json({
        error: "Vous devez accepter les conditions d\u2019utilisation et la politique de confidentialit\xE9."
      });
      return;
    }
    const existing = Object.values(store.data.teachers).find((t) => t.email === cleanEmail);
    if (existing) {
      res.status(409).json({
        error: "Impossible de finaliser l\u2019inscription avec ces informations. Si vous poss\xE9dez d\xE9j\xE0 un compte, connectez-vous."
      });
      return;
    }
    const uid = `tch_${crypto2.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const { hash, salt } = hashPasswordOrCode(password, false);
    const verificationCode = generateSecureReadableCode(2, 3);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const record = {
      uid,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email: cleanEmail,
      emailVerified: false,
      institution: institution ? String(institution).trim() : "",
      defaultSubject: "",
      retentionDays: 365,
      acceptedTerms: true,
      acceptedTermsAt: nowIso,
      createdAt: nowIso,
      role: "teacher",
      passwordHash: hash,
      passwordSalt: salt,
      emailVerificationCode: verificationCode,
      failedLoginCount: 0
    };
    store.data.teachers[uid] = record;
    store.persist();
    const token = signToken({
      kind: "teacher",
      sub: uid,
      exp: Date.now() + 8 * 3600 * 1e3
    });
    res.status(201).json({
      token,
      teacher: sanitizeTeacherProfile(record),
      verificationCodePreview: verificationCode
    });
  });
  app.post("/api/auth/login", rateLimit(20, 6e4), (req, res) => {
    const { email, password } = req.body || {};
    if (!email?.trim() || !password) {
      res.status(400).json({ error: "Veuillez renseigner votre adresse e-mail et votre mot de passe." });
      return;
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const teacher = Object.values(store.data.teachers).find((t) => t.email === cleanEmail);
    const genericAuthErr = "Identifiants de connexion incorrects.";
    if (!teacher) {
      res.status(401).json({ error: genericAuthErr });
      return;
    }
    if (teacher.lockedUntilMs && Date.now() < teacher.lockedUntilMs) {
      const waitMin = Math.ceil((teacher.lockedUntilMs - Date.now()) / 6e4);
      res.status(423).json({
        error: `Compte temporairement prot\xE9g\xE9 suite \xE0 plusieurs \xE9checs. R\xE9essayez dans ${waitMin} min.`
      });
      return;
    }
    const ok = verifyPasswordOrCode(password, teacher.passwordHash, teacher.passwordSalt, false);
    if (!ok) {
      teacher.failedLoginCount = (teacher.failedLoginCount || 0) + 1;
      if (teacher.failedLoginCount >= 5) {
        teacher.lockedUntilMs = Date.now() + 10 * 60 * 1e3;
      }
      store.persist();
      res.status(401).json({ error: genericAuthErr });
      return;
    }
    teacher.failedLoginCount = 0;
    teacher.lockedUntilMs = void 0;
    store.persist();
    const token = signToken({
      kind: "teacher",
      sub: teacher.uid,
      exp: Date.now() + 8 * 3600 * 1e3
    });
    res.json({
      token,
      teacher: sanitizeTeacherProfile(teacher)
    });
  });
  app.get("/api/auth/me", requireTeacherAuth, (req, res) => {
    const teacher = store.data.teachers[req.teacherId];
    res.json({
      teacher: sanitizeTeacherProfile(teacher),
      verificationCodePreview: teacher.emailVerified ? void 0 : teacher.emailVerificationCode
    });
  });
  app.post("/api/auth/verify-email", requireTeacherAuth, (req, res) => {
    const teacher = store.data.teachers[req.teacherId];
    const { code } = req.body || {};
    if (teacher.emailVerified) {
      res.json({ teacher: sanitizeTeacherProfile(teacher) });
      return;
    }
    if (!code || String(code).trim().toUpperCase() !== teacher.emailVerificationCode) {
      res.status(400).json({ error: "Code de v\xE9rification invalide." });
      return;
    }
    teacher.emailVerified = true;
    teacher.emailVerificationCode = void 0;
    store.persist();
    res.json({ teacher: sanitizeTeacherProfile(teacher) });
  });
  app.post("/api/auth/reauthenticate", requireTeacherAuth, (req, res) => {
    const teacher = store.data.teachers[req.teacherId];
    const { password } = req.body || {};
    if (!password || !verifyPasswordOrCode(password, teacher.passwordHash, teacher.passwordSalt, false)) {
      res.status(401).json({ error: "Mot de passe actuel incorrect. Identit\xE9 non confirm\xE9e." });
      return;
    }
    res.json({ verified: true, verifiedAt: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app.put("/api/auth/profile", requireTeacherAuth, (req, res) => {
    const teacher = store.data.teachers[req.teacherId];
    const { firstName, lastName, institution, defaultSubject, retentionDays } = req.body || {};
    if (firstName?.trim()) teacher.firstName = String(firstName).trim();
    if (lastName?.trim()) teacher.lastName = String(lastName).trim();
    if (institution !== void 0) teacher.institution = String(institution).trim();
    if (defaultSubject !== void 0) teacher.defaultSubject = String(defaultSubject).trim();
    if (retentionDays !== void 0) {
      const days = Number(retentionDays);
      if (Number.isFinite(days) && days >= 7 && days <= 1825) {
        teacher.retentionDays = Math.round(days);
      }
    }
    store.persist();
    res.json({ teacher: sanitizeTeacherProfile(teacher) });
  });
  app.post("/api/auth/change-password", requireTeacherAuth, (req, res) => {
    const teacher = store.data.teachers[req.teacherId];
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !verifyPasswordOrCode(currentPassword, teacher.passwordHash, teacher.passwordSalt, false)) {
      res.status(401).json({ error: "Votre mot de passe actuel est incorrect." });
      return;
    }
    if (!newPassword || String(newPassword).length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      res.status(400).json({
        error: "Le nouveau mot de passe doit contenir au moins 8 caract\xE8res (majuscule, minuscule, chiffre)."
      });
      return;
    }
    const { hash, salt } = hashPasswordOrCode(newPassword, false);
    teacher.passwordHash = hash;
    teacher.passwordSalt = salt;
    store.persist();
    res.json({ updated: true });
  });
  app.post("/api/auth/reset-password-request", rateLimit(10, 6e4), (req, res) => {
    const { email } = req.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    const teacher = Object.values(store.data.teachers).find((t) => t.email === cleanEmail);
    let devResetToken;
    if (teacher) {
      devResetToken = signToken({
        kind: "password_reset",
        sub: teacher.uid,
        exp: Date.now() + 30 * 60 * 1e3
      });
    }
    res.json({
      message: "Si un compte professionnel correspond \xE0 cette adresse, les instructions de r\xE9initialisation ont \xE9t\xE9 g\xE9n\xE9r\xE9es.",
      resetTokenPreview: !process.env.RESEND_API_KEY && !process.env.SMTP_HOST ? devResetToken : void 0
    });
  });
  app.post("/api/auth/reset-password-confirm", rateLimit(10, 6e4), (req, res) => {
    const { resetToken, newPassword } = req.body || {};
    const payload = verifyToken(resetToken, "password_reset");
    if (!payload || !store.data.teachers[payload.sub]) {
      res.status(400).json({ error: "Jeton de r\xE9initialisation invalide ou expir\xE9." });
      return;
    }
    if (!newPassword || String(newPassword).length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      res.status(400).json({
        error: "Le mot de passe doit contenir au moins 8 caract\xE8res, une majuscule, une minuscule et un chiffre."
      });
      return;
    }
    const teacher = store.data.teachers[payload.sub];
    const { hash, salt } = hashPasswordOrCode(newPassword, false);
    teacher.passwordHash = hash;
    teacher.passwordSalt = salt;
    teacher.failedLoginCount = 0;
    teacher.lockedUntilMs = void 0;
    store.persist();
    res.json({ reset: true });
  });
  app.get("/api/teacher/dashboard", requireTeacherAuth, (req, res) => {
    const uid = req.teacherId;
    const now = Date.now();
    const myExams = Object.values(store.data.exams).filter((e) => e.teacherId === uid).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const mySubmissions = Object.values(store.data.submissions).filter((s) => s.teacherId === uid).sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
    let publishedCount = 0;
    let activeNowCount = 0;
    let finishedCount = 0;
    for (const ex of myExams) {
      const sMs = Date.parse(ex.startAt);
      const eMs = Date.parse(ex.endAt);
      if (ex.status === "published") {
        publishedCount += 1;
        if ((!Number.isFinite(sMs) || now >= sMs) && (!Number.isFinite(eMs) || now <= eMs)) {
          activeNowCount += 1;
        } else if (Number.isFinite(eMs) && now > eMs) {
          finishedCount += 1;
        }
      } else if (ex.status === "closed" || ex.status === "archived") {
        finishedCount += 1;
      }
    }
    const gradedSubs = mySubmissions.filter(
      (s) => s.gradingStatus === "auto_graded" || s.gradingStatus === "validated"
    );
    const globalAverageOn20 = gradedSubs.length > 0 ? round2(gradedSubs.reduce((acc, s) => acc + s.normalizedScoreOn20, 0) / gradedSubs.length) : null;
    const passRatePercent = gradedSubs.length > 0 ? round2(gradedSubs.filter((s) => s.normalizedScoreOn20 >= 10).length / gradedSubs.length * 100) : null;
    const examAverages = myExams.map((ex) => {
      const subs = mySubmissions.filter((s) => s.examId === ex.id);
      const graded = subs.filter((s) => s.gradingStatus === "auto_graded" || s.gradingStatus === "validated");
      const avg = graded.length > 0 ? round2(graded.reduce((a, b) => a + b.normalizedScoreOn20, 0) / graded.length) : null;
      const pass = graded.length > 0 ? round2(graded.filter((s) => s.normalizedScoreOn20 >= 10).length / graded.length * 100) : null;
      return {
        examId: ex.id,
        examCode: ex.examCode,
        title: ex.title,
        subject: ex.subject,
        className: ex.className,
        submissionCount: subs.length,
        averageOn20: avg,
        passRatePercent: pass
      };
    });
    const metrics = {
      totalExams: myExams.length,
      publishedExams: publishedCount,
      activeExamsNow: activeNowCount,
      finishedExams: finishedCount,
      totalSubmissions: mySubmissions.length,
      globalAverageOn20,
      passRatePercent,
      examAverages,
      recentSubmissions: mySubmissions.slice(0, 8)
    };
    res.json(metrics);
  });
  app.get("/api/exams", requireTeacherAuth, (req, res) => {
    const uid = req.teacherId;
    const exams = Object.values(store.data.exams).filter((e) => e.teacherId === uid).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    res.json({ exams });
  });
  app.post("/api/exams", requireTeacherAuth, (req, res) => {
    const uid = req.teacherId;
    const body = req.body || {};
    if (!body.title?.trim() || !body.subject?.trim() || !body.className?.trim()) {
      res.status(400).json({ error: "Titre, mati\xE8re et classe sont obligatoires." });
      return;
    }
    const examId = `exam_${crypto2.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const examCode = generateExamPublicId();
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const { publicQuestions, rubrics } = splitEditorQuestions(body.editorQuestions || []);
    const exam = {
      id: examId,
      examCode,
      teacherId: uid,
      title: String(body.title).trim(),
      subject: String(body.subject).trim(),
      level: body.level || "lycee",
      className: String(body.className).trim(),
      description: String(body.description || "").trim(),
      durationMinutes: Math.max(5, Math.min(480, Number(body.durationMinutes || 60))),
      startAt: body.startAt || nowIso,
      endAt: body.endAt || new Date(Date.now() + 7 * 86400 * 1e3).toISOString(),
      maxScore: Math.max(1, Number(body.maxScore || 20)),
      language: body.language || "fr",
      maxAttempts: Math.max(1, Math.min(10, Number(body.maxAttempts || 1))),
      allowModifyBeforeSubmit: body.allowModifyBeforeSubmit !== false,
      requireStudentEmail: Boolean(body.requireStudentEmail),
      allowSubjectDownload: body.allowSubjectDownload !== false,
      showScoreToStudent: body.showScoreToStudent !== false,
      showExpectedAnswersToStudent: Boolean(body.showExpectedAnswersToStudent),
      autoSaveIntervalSeconds: Math.max(10, Math.min(300, Number(body.autoSaveIntervalSeconds || 20))),
      enableIntegrityMonitoring: body.enableIntegrityMonitoring !== false,
      defaultGradingMode: body.defaultGradingMode || "mode_a_auto",
      maxPdfSizeMb: Math.max(1, Math.min(25, Number(body.maxPdfSizeMb || 15))),
      hasSubjectPdf: false,
      hasCorrectionPdf: false,
      questions: publicQuestions,
      status: "draft",
      createdAt: nowIso,
      updatedAt: nowIso
    };
    store.data.exams[examId] = exam;
    store.data.examSecrets[examId] = {
      examId,
      teacherId: uid,
      rubrics: body.rubrics || rubrics
    };
    store.persist();
    res.status(201).json({
      exam: {
        ...exam,
        rubrics: store.data.examSecrets[examId].rubrics
      }
    });
  });
  app.get("/api/exams/:examId", requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: "Examen introuvable." });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: "Acc\xE8s interdit aux examens d\u2019un autre professeur." });
      return;
    }
    const secret = store.data.examSecrets[exam.id];
    res.json({
      exam: {
        ...exam,
        rubrics: secret?.rubrics || {},
        accessCodePreviewHint: secret?.accessCodePreviewHint
      }
    });
  });
  app.put("/api/exams/:examId", requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: "Examen introuvable." });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: "Acc\xE8s interdit aux examens d\u2019un autre professeur." });
      return;
    }
    const body = req.body || {};
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (body.title !== void 0) exam.title = String(body.title).trim();
    if (body.subject !== void 0) exam.subject = String(body.subject).trim();
    if (body.level !== void 0) exam.level = body.level;
    if (body.className !== void 0) exam.className = String(body.className).trim();
    if (body.description !== void 0) exam.description = String(body.description).trim();
    if (body.durationMinutes !== void 0) {
      exam.durationMinutes = Math.max(5, Math.min(480, Number(body.durationMinutes)));
    }
    if (body.startAt !== void 0) exam.startAt = body.startAt;
    if (body.endAt !== void 0) {
      exam.endAt = body.endAt;
      exam.expiresAt = body.endAt;
    }
    if (body.maxScore !== void 0) exam.maxScore = Math.max(1, Number(body.maxScore));
    if (body.language !== void 0) exam.language = body.language;
    if (body.maxAttempts !== void 0) {
      exam.maxAttempts = Math.max(1, Math.min(10, Number(body.maxAttempts)));
    }
    if (body.allowModifyBeforeSubmit !== void 0) {
      exam.allowModifyBeforeSubmit = Boolean(body.allowModifyBeforeSubmit);
    }
    if (body.requireStudentEmail !== void 0) {
      exam.requireStudentEmail = Boolean(body.requireStudentEmail);
    }
    if (body.allowSubjectDownload !== void 0) {
      exam.allowSubjectDownload = Boolean(body.allowSubjectDownload);
    }
    if (body.showScoreToStudent !== void 0) {
      exam.showScoreToStudent = Boolean(body.showScoreToStudent);
    }
    if (body.showExpectedAnswersToStudent !== void 0) {
      exam.showExpectedAnswersToStudent = Boolean(body.showExpectedAnswersToStudent);
    }
    if (body.autoSaveIntervalSeconds !== void 0) {
      exam.autoSaveIntervalSeconds = Math.max(10, Math.min(300, Number(body.autoSaveIntervalSeconds)));
    }
    if (body.enableIntegrityMonitoring !== void 0) {
      exam.enableIntegrityMonitoring = Boolean(body.enableIntegrityMonitoring);
    }
    if (body.defaultGradingMode !== void 0) {
      exam.defaultGradingMode = body.defaultGradingMode;
    }
    if (body.maxPdfSizeMb !== void 0) {
      exam.maxPdfSizeMb = Math.max(1, Math.min(25, Number(body.maxPdfSizeMb)));
    }
    const secret = store.data.examSecrets[exam.id] || (store.data.examSecrets[exam.id] = { examId: exam.id, teacherId: exam.teacherId, rubrics: {} });
    if (Array.isArray(body.editorQuestions)) {
      const { publicQuestions, rubrics } = splitEditorQuestions(body.editorQuestions);
      exam.questions = publicQuestions;
      secret.rubrics = rubrics;
    } else {
      if (Array.isArray(body.questions)) {
        exam.questions = body.questions;
      }
      if (body.rubrics && typeof body.rubrics === "object") {
        secret.rubrics = body.rubrics;
      }
    }
    exam.updatedAt = nowIso;
    store.persist();
    res.json({
      exam: {
        ...exam,
        rubrics: secret.rubrics,
        accessCodePreviewHint: secret.accessCodePreviewHint
      }
    });
  });
  app.post(
    "/api/exams/:examId/upload-pdf",
    requireTeacherAuth,
    upload.single("file"),
    (req, res) => {
      const exam = store.data.exams[req.params.examId];
      if (!exam) {
        res.status(404).json({ error: "Examen introuvable." });
        return;
      }
      if (exam.teacherId !== req.teacherId) {
        res.status(403).json({ error: "Acc\xE8s refus\xE9." });
        return;
      }
      const kind = req.body?.kind === "correction" ? "correction" : "subject";
      const file = req.file;
      if (!file || !file.buffer) {
        res.status(400).json({ error: "Aucun fichier PDF re\xE7u." });
        return;
      }
      const maxBytes = (exam.maxPdfSizeMb || 15) * 1024 * 1024;
      if (file.size > maxBytes) {
        res.status(413).json({
          error: `Le fichier d\xE9passe la taille maximale configur\xE9e (${exam.maxPdfSizeMb} Mo).`
        });
        return;
      }
      const magicHeader = file.buffer.subarray(0, 5).toString("ascii");
      if (file.mimetype !== "application/pdf" || magicHeader !== "%PDF-") {
        res.status(400).json({
          error: "Format invalide : seuls les v\xE9ritables documents PDF (%PDF-) sont accept\xE9s."
        });
        return;
      }
      const storedName = store.savePrivatePdf(kind, exam.id, file.buffer);
      const secret = store.data.examSecrets[exam.id] || (store.data.examSecrets[exam.id] = { examId: exam.id, teacherId: exam.teacherId, rubrics: {} });
      if (kind === "subject") {
        exam.hasSubjectPdf = true;
        exam.subjectFileName = file.originalname || "Sujet.pdf";
        exam.subjectFileSize = file.size;
        secret.subjectPrivateFile = storedName;
      } else {
        exam.hasCorrectionPdf = true;
        exam.correctionFileName = file.originalname || "Correction_Officielle.pdf";
        exam.correctionFileSize = file.size;
        secret.correctionPrivateFile = storedName;
      }
      exam.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      store.persist();
      res.json({
        uploaded: true,
        kind,
        fileName: kind === "subject" ? exam.subjectFileName : exam.correctionFileName,
        fileSize: file.size
      });
    }
  );
  app.delete("/api/exams/:examId/pdf/:kind", requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: "Examen introuvable." });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: "Acc\xE8s interdit." });
      return;
    }
    const kind = req.params.kind === "correction" ? "correction" : "subject";
    const secret = store.data.examSecrets[exam.id];
    if (kind === "subject") {
      store.deletePrivatePdf("subject", secret?.subjectPrivateFile);
      if (secret) secret.subjectPrivateFile = void 0;
      exam.hasSubjectPdf = false;
      exam.subjectFileName = void 0;
      exam.subjectFileSize = void 0;
    } else {
      store.deletePrivatePdf("correction", secret?.correctionPrivateFile);
      if (secret) secret.correctionPrivateFile = void 0;
      exam.hasCorrectionPdf = false;
      exam.correctionFileName = void 0;
      exam.correctionFileSize = void 0;
    }
    exam.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    store.persist();
    res.json({ deleted: true, kind });
  });
  app.get("/api/exams/:examId/teacher-pdf/:kind", requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: "Examen introuvable." });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: "Acc\xE8s interdit aux documents d\u2019un autre professeur." });
      return;
    }
    const kind = req.params.kind === "correction" ? "correction" : "subject";
    const secret = store.data.examSecrets[exam.id];
    const privateFile = kind === "subject" ? secret?.subjectPrivateFile : secret?.correctionPrivateFile;
    if (!privateFile) {
      res.status(404).json({ error: "Document PDF non import\xE9." });
      return;
    }
    const buf = store.readPrivatePdf(kind, privateFile);
    if (!buf) {
      res.status(404).json({ error: "Fichier introuvable dans le coffre priv\xE9." });
      return;
    }
    const displayName = (kind === "subject" ? exam.subjectFileName : exam.correctionFileName) || `${kind}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(displayName)}"`);
    res.send(buf);
  });
  app.post("/api/exams/:examId/publish", requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: "Examen introuvable." });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: "Acc\xE8s interdit." });
      return;
    }
    const { regenerateCode } = req.body || {};
    const secret = store.data.examSecrets[exam.id] || (store.data.examSecrets[exam.id] = { examId: exam.id, teacherId: exam.teacherId, rubrics: {} });
    let plainAccessCode = null;
    if (!secret.accessCodeHash || regenerateCode) {
      plainAccessCode = generateSecureReadableCode(3, 4);
      const hashed = hashPasswordOrCode(plainAccessCode, true);
      secret.accessCodeHash = hashed.hash;
      secret.accessCodeSalt = hashed.salt;
      secret.accessCodePreviewHint = `${plainAccessCode.slice(0, 4)}-****-${plainAccessCode.slice(-2)}`;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    exam.status = "published";
    exam.publishedAt = exam.publishedAt || nowIso;
    exam.expiresAt = exam.endAt;
    exam.updatedAt = nowIso;
    store.persist();
    res.json({
      examId: exam.id,
      examCode: exam.examCode,
      accessCode: plainAccessCode,
      accessCodePreviewHint: secret.accessCodePreviewHint,
      status: exam.status,
      publishedAt: exam.publishedAt
    });
  });
  app.post("/api/exams/:examId/status", requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: "Examen introuvable." });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: "Acc\xE8s interdit." });
      return;
    }
    const { status } = req.body || {};
    if (!["draft", "published", "closed", "archived"].includes(status)) {
      res.status(400).json({ error: "\xC9tat invalide." });
      return;
    }
    exam.status = status;
    exam.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    store.persist();
    res.json({ exam });
  });
  app.delete("/api/exams/:examId", requireTeacherAuth, (req, res) => {
    const exam = store.data.exams[req.params.examId];
    if (!exam) {
      res.status(404).json({ error: "Examen introuvable." });
      return;
    }
    if (exam.teacherId !== req.teacherId) {
      res.status(403).json({ error: "Acc\xE8s interdit." });
      return;
    }
    const teacher = store.data.teachers[req.teacherId];
    const password = req.body?.password || req.headers["x-confirm-password"];
    if (!password || !verifyPasswordOrCode(String(password), teacher.passwordHash, teacher.passwordSalt, false)) {
      res.status(401).json({
        error: "Confirmation du mot de passe requise pour supprimer d\xE9finitivement un examen."
      });
      return;
    }
    const secret = store.data.examSecrets[exam.id];
    store.deletePrivatePdf("subject", secret?.subjectPrivateFile);
    store.deletePrivatePdf("correction", secret?.correctionPrivateFile);
    delete store.data.examSecrets[exam.id];
    delete store.data.exams[exam.id];
    for (const [sid, sess] of Object.entries(store.data.examSessions)) {
      if (sess.examId === exam.id) delete store.data.examSessions[sid];
    }
    for (const [subId, sub] of Object.entries(store.data.submissions)) {
      if (sub.examId === exam.id) delete store.data.submissions[subId];
    }
    store.persist();
    res.json({ deleted: true });
  });
  function buildSessionResponse(session, exam, sessionToken) {
    const now = Date.now();
    const endMs = Date.parse(exam.endAt);
    const deadlineMs = session.deadlineAt ? Date.parse(session.deadlineAt) : Math.min(now + exam.durationMinutes * 60 * 1e3, Number.isFinite(endMs) ? endMs : Infinity);
    return {
      sessionId: session.sessionId,
      sessionToken,
      examId: exam.id,
      examCode: exam.examCode,
      title: exam.title,
      subject: exam.subject,
      level: exam.level,
      className: exam.className,
      description: exam.description,
      durationMinutes: exam.durationMinutes,
      maxScore: exam.maxScore,
      language: exam.language,
      allowModifyBeforeSubmit: exam.allowModifyBeforeSubmit,
      allowSubjectDownload: exam.allowSubjectDownload,
      autoSaveIntervalSeconds: exam.autoSaveIntervalSeconds,
      enableIntegrityMonitoring: exam.enableIntegrityMonitoring,
      hasSubjectPdf: exam.hasSubjectPdf,
      subjectFileName: exam.subjectFileName || "Sujet_Examen.pdf",
      questionCount: exam.questions.length,
      questions: session.status === "in_progress" ? exam.questions : [],
      student: session.student,
      attemptNumber: session.attemptNumber,
      status: session.status,
      startedAt: session.startedAt,
      deadlineAt: session.deadlineAt,
      serverNow: new Date(now).toISOString(),
      remainingSeconds: Math.max(0, Math.floor((deadlineMs - now) / 1e3)),
      revision: session.revision,
      savedAnswers: session.savedAnswers,
      integrityEvents: session.integrityEvents,
      submissionId: session.submissionId
    };
  }
  app.post("/api/student/access", rateLimit(25, 6e4), (req, res) => {
    const { firstName, lastName, email, className, examCode, accessCode } = req.body || {};
    if (!firstName?.trim() || !lastName?.trim() || !className?.trim() || !examCode?.trim() || !accessCode?.trim()) {
      res.status(400).json({ error: "Veuillez renseigner tous les champs d\u2019identification." });
      return;
    }
    const cleanExamCode = String(examCode).trim().toUpperCase();
    const exam = Object.values(store.data.exams).find((e) => e.examCode === cleanExamCode);
    const genericDenied = "Identifiant de l\u2019examen ou mot de passe incorrect, ou \xE9valuation non accessible.";
    if (!exam || exam.status !== "published") {
      res.status(403).json({ error: genericDenied });
      return;
    }
    const secret = store.data.examSecrets[exam.id];
    if (!secret?.accessCodeHash || !secret?.accessCodeSalt || !verifyPasswordOrCode(String(accessCode), secret.accessCodeHash, secret.accessCodeSalt, true)) {
      res.status(403).json({ error: genericDenied });
      return;
    }
    const now = Date.now();
    const startMs = Date.parse(exam.startAt);
    const endMs = Date.parse(exam.endAt);
    if (Number.isFinite(startMs) && now < startMs) {
      res.status(403).json({
        error: "Cette \xE9valuation n\u2019est pas encore ouverte. Veuillez r\xE9essayer \xE0 l\u2019heure pr\xE9vue."
      });
      return;
    }
    if (Number.isFinite(endMs) && now > endMs) {
      res.status(403).json({
        error: "La p\xE9riode d\u2019ouverture de cette \xE9valuation est expir\xE9e."
      });
      return;
    }
    if (exam.requireStudentEmail && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim()))) {
      res.status(400).json({ error: "Une adresse e-mail valide est exig\xE9e pour cette \xE9valuation." });
      return;
    }
    const fp = computeStudentFingerprint(firstName, lastName, className, email);
    const matchingSessions = Object.values(store.data.examSessions).filter(
      (s) => s.examId === exam.id && s.studentFingerprint === fp
    );
    const submittedCount = matchingSessions.filter((s) => s.status === "submitted").length;
    let activeSession = matchingSessions.find(
      (s) => s.status === "in_progress" || s.status === "authorized_waiting"
    );
    if (!activeSession && submittedCount >= exam.maxAttempts) {
      res.status(403).json({
        error: `Vous avez d\xE9j\xE0 soumis votre copie et atteint le nombre maximal de tentatives autoris\xE9es (${exam.maxAttempts}).`
      });
      return;
    }
    if (!activeSession) {
      const sessionId = `ses_${crypto2.randomUUID().replace(/-/g, "").slice(0, 18)}`;
      const nowIso = new Date(now).toISOString();
      activeSession = {
        sessionId,
        examId: exam.id,
        examCode: exam.examCode,
        teacherId: exam.teacherId,
        studentFingerprint: fp,
        student: {
          firstName: String(firstName).trim(),
          lastName: String(lastName).trim(),
          email: email ? String(email).trim() : "",
          className: String(className).trim()
        },
        attemptNumber: submittedCount + 1,
        status: "authorized_waiting",
        revision: 0,
        savedAnswers: {},
        integrityEvents: [],
        createdAt: nowIso,
        updatedAt: nowIso
      };
      store.data.examSessions[sessionId] = activeSession;
      store.persist();
    }
    const sessionToken = signToken({
      kind: "student_session",
      sub: activeSession.sessionId,
      exp: now + Math.max(exam.durationMinutes * 60 * 1e3, 6 * 3600 * 1e3)
    });
    res.json(buildSessionResponse(activeSession, exam, sessionToken));
  });
  function requireStudentSession(req, res) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : void 0;
    const sessionId = req.params.sessionId;
    const payload = verifyToken(token, "student_session");
    if (!payload || payload.sub !== sessionId) {
      res.status(401).json({ error: "Jeton de session d\u2019examen invalide ou expir\xE9." });
      return null;
    }
    const session = store.data.examSessions[sessionId];
    if (!session) {
      res.status(404).json({ error: "Session d\u2019examen introuvable." });
      return null;
    }
    const exam = store.data.exams[session.examId];
    if (!exam) {
      res.status(404).json({ error: "Examen associ\xE9 introuvable." });
      return null;
    }
    return { session, exam, token };
  }
  app.get("/api/student/sessions/:sessionId", (req, res) => {
    const ctx = requireStudentSession(req, res);
    if (!ctx) return;
    res.json(buildSessionResponse(ctx.session, ctx.exam, ctx.token));
  });
  app.post("/api/student/sessions/:sessionId/start", (req, res) => {
    const ctx = requireStudentSession(req, res);
    if (!ctx) return;
    const { session, exam, token } = ctx;
    if (session.status === "submitted") {
      res.status(409).json({ error: "Cette copie a d\xE9j\xE0 \xE9t\xE9 soumise d\xE9finitivement." });
      return;
    }
    const now = Date.now();
    const endMs = Date.parse(exam.endAt);
    if (Number.isFinite(endMs) && now > endMs) {
      res.status(403).json({ error: "La p\xE9riode d\u2019ouverture de l\u2019examen est termin\xE9e." });
      return;
    }
    if (!session.startedAt) {
      const startedIso = new Date(now).toISOString();
      const computedDeadline = Math.min(
        now + exam.durationMinutes * 60 * 1e3,
        Number.isFinite(endMs) ? endMs : now + exam.durationMinutes * 60 * 1e3
      );
      session.status = "in_progress";
      session.startedAt = startedIso;
      session.deadlineAt = new Date(computedDeadline).toISOString();
      session.updatedAt = startedIso;
      store.persist();
    }
    res.json(buildSessionResponse(session, exam, token));
  });
  app.post("/api/student/sessions/:sessionId/subject-token", (req, res) => {
    const ctx = requireStudentSession(req, res);
    if (!ctx) return;
    const { exam, session } = ctx;
    if (!exam.hasSubjectPdf) {
      res.status(404).json({ error: "Aucun sujet PDF n\u2019est attach\xE9 \xE0 cet examen." });
      return;
    }
    const pdfToken = signToken({
      kind: "pdf_access",
      sub: session.sessionId,
      scope: `subject:${exam.id}`,
      exp: Date.now() + 15 * 60 * 1e3
    });
    res.json({
      viewUrl: `/api/student/subject-pdf?token=${encodeURIComponent(pdfToken)}`,
      downloadUrl: exam.allowSubjectDownload ? `/api/student/subject-pdf?token=${encodeURIComponent(pdfToken)}&download=1` : null,
      fileName: exam.subjectFileName || "Sujet_Examen.pdf",
      allowDownload: exam.allowSubjectDownload
    });
  });
  app.get("/api/student/subject-pdf", (req, res) => {
    const rawToken = String(req.query.token || "");
    const payload = verifyToken(rawToken, "pdf_access");
    if (!payload || !payload.scope?.startsWith("subject:")) {
      res.status(403).json({ error: "Autorisation temporaire invalide ou expir\xE9e." });
      return;
    }
    const examId = payload.scope.slice("subject:".length);
    const exam = store.data.exams[examId];
    const secret = store.data.examSecrets[examId];
    if (!exam || !secret?.subjectPrivateFile) {
      res.status(404).json({ error: "Sujet PDF introuvable." });
      return;
    }
    const wantsDownload = req.query.download === "1";
    if (wantsDownload && !exam.allowSubjectDownload) {
      res.status(403).json({
        error: "Le t\xE9l\xE9chargement hors ligne du sujet n\u2019est pas autoris\xE9 pour cette \xE9valuation."
      });
      return;
    }
    const buf = store.readPrivatePdf("subject", secret.subjectPrivateFile);
    if (!buf) {
      res.status(404).json({ error: "Fichier introuvable." });
      return;
    }
    const fileName = exam.subjectFileName || "Sujet_Examen.pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader(
      "Content-Disposition",
      `${wantsDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(fileName)}"`
    );
    res.send(buf);
  });
  app.get("/api/student/correction-pdf", (_req, res) => {
    res.status(403).json({
      error: "Acc\xE8s strictement interdit : la correction officielle est confidentielle."
    });
  });
  app.post("/api/student/sessions/:sessionId/autosave", (req, res) => {
    const ctx = requireStudentSession(req, res);
    if (!ctx) return;
    const { session, exam } = ctx;
    if (session.status === "submitted") {
      res.status(409).json({ error: "Copie d\xE9j\xE0 soumise et verrouill\xE9e contre toute modification." });
      return;
    }
    const now = Date.now();
    const deadlineMs = session.deadlineAt ? Date.parse(session.deadlineAt) : Infinity;
    if (now > deadlineMs + 15e3) {
      res.status(410).json({
        error: "Le temps imparti est \xE9coul\xE9.",
        expired: true,
        remainingSeconds: 0
      });
      return;
    }
    const { answers, clientRevision, integrityEvents } = req.body || {};
    const conflictDetected = clientRevision !== void 0 && Number(clientRevision) < session.revision;
    if (answers && typeof answers === "object") {
      if (!exam.allowModifyBeforeSubmit) {
        const merged = { ...session.savedAnswers };
        for (const [qid, incomingVal] of Object.entries(answers)) {
          if (merged[qid]?.lockedByStudent) {
            continue;
          }
          merged[qid] = incomingVal;
        }
        session.savedAnswers = merged;
      } else {
        session.savedAnswers = answers;
      }
    }
    if (Array.isArray(integrityEvents)) {
      session.integrityEvents = integrityEvents.slice(0, 250);
    }
    session.revision += 1;
    session.updatedAt = new Date(now).toISOString();
    store.persist();
    res.json({
      savedAt: session.updatedAt,
      serverNow: session.updatedAt,
      remainingSeconds: Math.max(0, Math.floor((deadlineMs - now) / 1e3)),
      revision: session.revision,
      conflictDetected
    });
  });
  app.post("/api/student/sessions/:sessionId/integrity", (req, res) => {
    const ctx = requireStudentSession(req, res);
    if (!ctx) return;
    const { session } = ctx;
    if (session.status === "submitted") {
      res.json({ logged: false });
      return;
    }
    const { type, details } = req.body || {};
    const validTypes = ["tab_hidden", "window_blur", "fullscreen_exit", "copy_paste_attempt"];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: "Type d\u2019\xE9v\xE9nement invalide." });
      return;
    }
    const ev = {
      id: crypto2.randomUUID(),
      type,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      details: String(details || "").slice(0, 300)
    };
    session.integrityEvents.push(ev);
    store.persist();
    res.json({ logged: true, event: ev });
  });
  app.post("/api/student/sessions/:sessionId/submit", async (req, res) => {
    const ctx = requireStudentSession(req, res);
    if (!ctx) return;
    const { session, exam } = ctx;
    if (session.status === "submitted" && session.submissionId) {
      const existingSub = store.data.submissions[session.submissionId];
      if (existingSub) {
        res.json({
          alreadySubmitted: true,
          receipt: buildStudentReceipt(existingSub)
        });
        return;
      }
    }
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const deadlineMs = session.deadlineAt ? Date.parse(session.deadlineAt) : now;
    const incomingAnswers = req.body?.answers;
    let finalAnswers = session.savedAnswers || {};
    if (incomingAnswers && typeof incomingAnswers === "object" && now <= deadlineMs + 45e3) {
      if (!exam.allowModifyBeforeSubmit) {
        const merged = { ...session.savedAnswers };
        for (const [qid, val] of Object.entries(incomingAnswers)) {
          if (!merged[qid]?.lockedByStudent) {
            merged[qid] = val;
          }
        }
        finalAnswers = merged;
      } else {
        finalAnswers = incomingAnswers;
      }
    }
    const incomingEvents = Array.isArray(req.body?.integrityEvents) ? req.body.integrityEvents.slice(0, 250) : session.integrityEvents;
    const secret = store.data.examSecrets[exam.id];
    const evalSummary = evaluateFullSubmission(
      exam.questions,
      secret?.rubrics || {},
      finalAnswers,
      exam.maxScore
    );
    const startedMs = session.startedAt ? Date.parse(session.startedAt) : now;
    const durationSeconds = Math.max(
      1,
      Math.round((Math.min(now, deadlineMs + 5e3) - startedMs) / 1e3)
    );
    const submissionId = generateSubmissionPublicId();
    const autoSubmitted = Boolean(req.body?.autoSubmitted || now > deadlineMs);
    const initialAudit = {
      id: crypto2.randomUUID(),
      submissionId,
      examId: exam.id,
      teacherId: exam.teacherId,
      action: "submission_locked",
      reason: autoSubmitted ? "Soumission automatique d\xE9clench\xE9e \xE0 l\u2019expiration du chronom\xE8tre serveur" : "Soumission d\xE9finitive confirm\xE9e par l\u2019\xE9l\xE8ve",
      timestamp: nowIso
    };
    const submission = {
      id: submissionId,
      sessionId: session.sessionId,
      examId: exam.id,
      examCode: exam.examCode,
      examTitle: exam.title,
      subject: exam.subject,
      level: exam.level,
      examMaxScore: exam.maxScore,
      teacherId: exam.teacherId,
      student: session.student,
      attemptNumber: session.attemptNumber,
      startedAt: session.startedAt || nowIso,
      submittedAt: nowIso,
      durationSeconds,
      autoSubmitted,
      locked: true,
      answers: finalAnswers,
      questionsSnapshot: exam.questions,
      ...evalSummary,
      generalComment: "",
      showScoreToStudent: exam.showScoreToStudent,
      showExpectedAnswersToStudent: exam.showExpectedAnswersToStudent,
      emailNotification: {
        status: "pending",
        attempts: 0
      },
      integrityEvents: incomingEvents,
      auditTrail: [initialAudit]
    };
    session.status = "submitted";
    session.submittedAt = nowIso;
    session.submissionId = submissionId;
    session.savedAnswers = finalAnswers;
    session.integrityEvents = incomingEvents;
    session.updatedAt = nowIso;
    store.data.submissions[submissionId] = submission;
    store.data.auditLogs.push(initialAudit);
    store.persist();
    const teacher = store.data.teachers[exam.teacherId];
    if (teacher) {
      const origin = String(req.body?.appOriginUrl || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
      const secureCopyUrl = `${origin}/#/professeur/copies?submissionId=${encodeURIComponent(submissionId)}`;
      const mailResult = await dispatchTeacherSubmissionEmail({
        teacherEmail: teacher.email,
        teacherEmailVerified: teacher.emailVerified,
        examCode: exam.examCode,
        examTitle: exam.title,
        studentFullName: `${submission.student.firstName} ${submission.student.lastName}`,
        className: submission.student.className,
        submittedAtIso: submission.submittedAt,
        validatedScoreDisplay: submission.gradingStatus === "auto_graded" ? `${submission.normalizedScoreOn20}/20 (${submission.percentage}% \u2014 ${submission.appreciation})` : void 0,
        secureCopyUrl
      });
      submission.emailNotification = {
        ...mailResult,
        attempts: 1
      };
      store.data.emailLogs.push({
        id: crypto2.randomUUID(),
        teacherId: teacher.uid,
        submissionId,
        recipient: teacher.email,
        subject: mailResult.subject,
        status: mailResult.status,
        error: mailResult.error,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      store.persist();
    }
    res.status(201).json({
      alreadySubmitted: false,
      receipt: buildStudentReceipt(submission)
    });
  });
  app.get("/api/student/receipt/:submissionId", (req, res) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : void 0;
    const payload = verifyToken(token, "student_session");
    const sub = store.data.submissions[req.params.submissionId];
    if (!payload || !sub || sub.sessionId !== payload.sub) {
      res.status(403).json({ error: "Acc\xE8s non autoris\xE9 \xE0 ce r\xE9sultat." });
      return;
    }
    res.json({ receipt: buildStudentReceipt(sub) });
  });
  app.get("/api/submissions", requireTeacherAuth, (req, res) => {
    const uid = req.teacherId;
    let list = Object.values(store.data.submissions).filter((s) => s.teacherId === uid);
    const { examId, className, subject, gradingStatus, minScore, maxScore, fromDate, toDate } = req.query;
    if (examId) list = list.filter((s) => s.examId === String(examId));
    if (className) {
      const q = String(className).toLowerCase();
      list = list.filter((s) => s.student.className.toLowerCase().includes(q));
    }
    if (subject) {
      const q = String(subject).toLowerCase();
      list = list.filter((s) => s.subject.toLowerCase().includes(q));
    }
    if (gradingStatus) {
      list = list.filter((s) => s.gradingStatus === String(gradingStatus));
    }
    if (minScore !== void 0 && minScore !== "") {
      list = list.filter((s) => s.normalizedScoreOn20 >= Number(minScore));
    }
    if (maxScore !== void 0 && maxScore !== "") {
      list = list.filter((s) => s.normalizedScoreOn20 <= Number(maxScore));
    }
    if (fromDate) {
      const fMs = Date.parse(String(fromDate));
      if (Number.isFinite(fMs)) list = list.filter((s) => Date.parse(s.submittedAt) >= fMs);
    }
    if (toDate) {
      const tMs = Date.parse(String(toDate)) + 86399999;
      if (Number.isFinite(tMs)) list = list.filter((s) => Date.parse(s.submittedAt) <= tMs);
    }
    list.sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
    res.json({ submissions: list });
  });
  app.get("/api/submissions/:submissionId", requireTeacherAuth, (req, res) => {
    const sub = store.data.submissions[req.params.submissionId];
    if (!sub) {
      res.status(404).json({ error: "Copie introuvable." });
      return;
    }
    if (sub.teacherId !== req.teacherId) {
      res.status(403).json({ error: "Acc\xE8s strictement interdit aux copies d\u2019un autre professeur." });
      return;
    }
    const secret = store.data.examSecrets[sub.examId];
    const exam = store.data.exams[sub.examId];
    res.json({
      submission: sub,
      rubrics: secret?.rubrics || {},
      hasCorrectionPdf: Boolean(exam?.hasCorrectionPdf),
      hasSubjectPdf: Boolean(exam?.hasSubjectPdf)
    });
  });
  app.put("/api/submissions/:submissionId/grade", requireTeacherAuth, (req, res) => {
    const sub = store.data.submissions[req.params.submissionId];
    if (!sub) {
      res.status(404).json({ error: "Copie introuvable." });
      return;
    }
    if (sub.teacherId !== req.teacherId) {
      res.status(403).json({ error: "Acc\xE8s interdit." });
      return;
    }
    const {
      questionGrades,
      manualDirectScoreOutOfMax,
      generalComment,
      validateNow,
      showScoreToStudent,
      showExpectedAnswersToStudent,
      auditReason
    } = req.body || {};
    const wasAlreadyValidated = sub.gradingStatus === "validated";
    if (wasAlreadyValidated && (!auditReason || String(auditReason).trim().length < 3)) {
      res.status(400).json({
        error: "Cette note a d\xE9j\xE0 \xE9t\xE9 valid\xE9e : un motif explicite est obligatoire pour toute modification (journal d\u2019audit)."
      });
      return;
    }
    const previousScoreOn20 = sub.normalizedScoreOn20;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (questionGrades && typeof questionGrades === "object" && Object.keys(questionGrades).length > 0) {
      const sanitized = {};
      for (const [qid, g] of Object.entries(questionGrades)) {
        const clamped = round2(Math.max(0, Math.min(Number(g.maxPoints || 0), Number(g.pointsObtained || 0))));
        sanitized[qid] = {
          ...g,
          pointsObtained: clamped,
          state: validateNow ? "validated" : g.state,
          isIndicativeAi: validateNow ? false : g.isIndicativeAi
        };
      }
      sub.questionGrades = sanitized;
      const summary = recalculateSummaryFromQuestionGrades(
        sanitized,
        sub.examMaxScore,
        Boolean(validateNow || wasAlreadyValidated)
      );
      sub.rawPointsObtained = summary.rawPointsObtained;
      sub.rawPointsMax = summary.rawPointsMax;
      sub.finalScoreOutOfMax = summary.finalScoreOutOfMax;
      sub.normalizedScoreOn20 = summary.normalizedScoreOn20;
      sub.percentage = summary.percentage;
      sub.appreciation = summary.appreciation;
      sub.gradingStatus = summary.gradingStatus;
    } else if (manualDirectScoreOutOfMax !== void 0) {
      const clamped = round2(
        Math.max(0, Math.min(sub.examMaxScore, Number(manualDirectScoreOutOfMax)))
      );
      const ratio = sub.examMaxScore > 0 ? clamped / sub.examMaxScore : 0;
      sub.rawPointsObtained = clamped;
      sub.rawPointsMax = sub.examMaxScore;
      sub.finalScoreOutOfMax = clamped;
      sub.normalizedScoreOn20 = round2(ratio * 20);
      sub.percentage = round2(ratio * 100);
      const summary = recalculateSummaryFromQuestionGrades({}, sub.examMaxScore, Boolean(validateNow));
      sub.appreciation = sub.normalizedScoreOn20 >= 16 ? "Excellent" : sub.normalizedScoreOn20 >= 14 ? "Bien" : sub.normalizedScoreOn20 >= 12 ? "Assez bien" : sub.normalizedScoreOn20 >= 10 ? "Passable" : "Insuffisant";
      sub.gradingStatus = validateNow || wasAlreadyValidated ? "validated" : summary.gradingStatus;
    }
    if (generalComment !== void 0) sub.generalComment = String(generalComment);
    if (showScoreToStudent !== void 0) sub.showScoreToStudent = Boolean(showScoreToStudent);
    if (showExpectedAnswersToStudent !== void 0) {
      sub.showExpectedAnswersToStudent = Boolean(showExpectedAnswersToStudent);
    }
    if (validateNow) {
      sub.validatedAt = nowIso;
      sub.validatedBy = req.teacherId;
      sub.gradingStatus = "validated";
    }
    const auditEntry = {
      id: crypto2.randomUUID(),
      submissionId: sub.id,
      examId: sub.examId,
      teacherId: req.teacherId,
      action: wasAlreadyValidated ? "grade_modified_after_validation" : "grade_validated",
      previousScoreOn20,
      newScoreOn20: sub.normalizedScoreOn20,
      reason: String(auditReason || "").trim() || (validateNow ? "Validation officielle de la note par le professeur" : "Enregistrement des points de correction"),
      timestamp: nowIso
    };
    sub.auditTrail.push(auditEntry);
    store.data.auditLogs.push(auditEntry);
    store.persist();
    res.json({ submission: sub, auditEntry });
  });
  app.post("/api/submissions/:submissionId/resend-email", requireTeacherAuth, async (req, res) => {
    const sub = store.data.submissions[req.params.submissionId];
    if (!sub) {
      res.status(404).json({ error: "Copie introuvable." });
      return;
    }
    if (sub.teacherId !== req.teacherId) {
      res.status(403).json({ error: "Acc\xE8s interdit." });
      return;
    }
    const teacher = store.data.teachers[req.teacherId];
    const origin = String(req.body?.appOriginUrl || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const secureCopyUrl = `${origin}/#/professeur/copies?submissionId=${encodeURIComponent(sub.id)}`;
    let pdfBuffer;
    if (req.body?.pdfBase64 && typeof req.body.pdfBase64 === "string") {
      pdfBuffer = Buffer.from(req.body.pdfBase64, "base64");
    }
    const mailRes = await dispatchTeacherSubmissionEmail({
      teacherEmail: teacher.email,
      teacherEmailVerified: teacher.emailVerified,
      examCode: sub.examCode,
      examTitle: sub.examTitle,
      studentFullName: `${sub.student.firstName} ${sub.student.lastName}`,
      className: sub.student.className,
      submittedAtIso: sub.submittedAt,
      validatedScoreDisplay: sub.gradingStatus === "validated" || sub.gradingStatus === "auto_graded" ? `${sub.normalizedScoreOn20}/20 (${sub.percentage}% \u2014 ${sub.appreciation})` : void 0,
      secureCopyUrl,
      pdfBuffer,
      pdfFileName: `Rapport_Professeur_${sub.id}.pdf`
    });
    sub.emailNotification = {
      ...mailRes,
      attempts: (sub.emailNotification?.attempts || 0) + 1
    };
    const auditEntry = {
      id: crypto2.randomUUID(),
      submissionId: sub.id,
      examId: sub.examId,
      teacherId: req.teacherId,
      action: "email_resent",
      reason: `Relance manuelle de la notification (${mailRes.status})`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    sub.auditTrail.push(auditEntry);
    store.data.auditLogs.push(auditEntry);
    store.persist();
    res.json({ emailNotification: sub.emailNotification });
  });
  app.delete("/api/submissions/:submissionId", requireTeacherAuth, (req, res) => {
    const sub = store.data.submissions[req.params.submissionId];
    if (!sub) {
      res.status(404).json({ error: "Copie introuvable." });
      return;
    }
    if (sub.teacherId !== req.teacherId) {
      res.status(403).json({ error: "Acc\xE8s interdit." });
      return;
    }
    delete store.data.submissions[sub.id];
    if (store.data.examSessions[sub.sessionId]) {
      delete store.data.examSessions[sub.sessionId];
    }
    store.persist();
    res.json({ deleted: true });
  });
  app.get("/api/audit-logs", requireTeacherAuth, (req, res) => {
    const logs = store.data.auditLogs.filter((l) => l.teacherId === req.teacherId).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    res.json({ auditLogs: logs });
  });
  return { app, store };
}
var isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectExecution) {
  const port = Number(process.env.PORT || 3001);
  const host = process.env.API_HOST || "127.0.0.1";
  const { app } = createApp();
  app.listen(port, host, () => {
    console.log(`[EduExam API] Serveur s\xE9curis\xE9 d\xE9marr\xE9 sur http://${host}:${port}`);
  });
}

// server/vercel-entry.ts
var { app: expressApp } = createApp();
function handler(req, res) {
  if (req.url && !req.url.startsWith("/api")) {
    req.url = `/api${req.url.startsWith("/") ? req.url : `/${req.url}`}`;
  }
  return expressApp(req, res);
}
export {
  handler as default
};
