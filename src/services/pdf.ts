import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Exam,
  QuestionRubricSecret,
  StudentQuestionView,
  StudentSubmissionReceipt,
  Submission,
} from '../types';
import { formatStudentAnswerSummary, round2 } from './grading';

function formatDateFr(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remM = mins % 60;
    return `${hrs} h ${remM} min ${secs} s`;
  }
  return `${mins} min ${secs} s`;
}

function computeExerciseBreakdown(
  questions: StudentQuestionView[],
  grades?: Record<string, { pointsObtained: number; maxPoints: number }>
) {
  const map = new Map<string, { title: string; obtained: number; max: number; count: number }>();
  for (const q of questions) {
    const exTitle = q.exerciseTitle?.trim() || 'Questions générales';
    const cur = map.get(exTitle) || { title: exTitle, obtained: 0, max: 0, count: 0 };
    cur.max += q.maxPoints;
    cur.obtained += grades?.[q.id]?.pointsObtained ?? 0;
    cur.count += 1;
    map.set(exTitle, cur);
  }
  return Array.from(map.values()).map((x) => ({
    ...x,
    obtained: round2(x.obtained),
    max: round2(x.max),
  }));
}

function statusLabelFr(status: string): string {
  if (status === 'validated') return 'Note validée par le professeur';
  if (status === 'auto_graded') return 'Calculée automatiquement (barème objectif)';
  return 'En attente de validation du professeur';
}

// ============================================================================
// PDF A — COPIE ET CORRECTION DÉTAILLÉE POUR LE PROFESSEUR (CONFIDENTIEL)
// ============================================================================
export function buildTeacherPdfReportBytes(
  submission: Submission,
  rubrics: Record<string, QuestionRubricSecret> = {}
): { doc: jsPDF; bytes: Uint8Array; fileName: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Bandeau supérieur bleu profond
  doc.setFillColor(30, 58, 138);
  doc.rect(0, 0, 210, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('EDUEXAM — RAPPORT CONFIDENTIEL PROFESSEUR (PDF A)', 14, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(
    `Copie et correction détaillée | Réf. soumission : ${submission.id} | Examen : ${submission.examCode}`,
    14,
    21
  );

  doc.setTextColor(15, 23, 42);
  let y = 38;

  // Bloc d'identité et horodatage
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
    body: [
      [
        'Élève',
        `${submission.student.lastName.toUpperCase()} ${submission.student.firstName}`,
        'Classe / Groupe',
        submission.student.className,
      ],
      [
        'Examen',
        submission.examTitle,
        'Matière',
        submission.subject,
      ],
      [
        'Début épreuve',
        formatDateFr(submission.startedAt),
        'Soumission',
        `${formatDateFr(submission.submittedAt)}${submission.autoSubmitted ? ' (Auto)' : ''}`,
      ],
      [
        'Durée utilisée',
        formatDuration(submission.durationSeconds),
        'État validation',
        statusLabelFr(submission.gradingStatus),
      ],
    ],
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 30, fillColor: [248, 250, 252] },
      2: { fontStyle: 'bold', cellWidth: 30, fillColor: [248, 250, 252] },
    },
  });

  y = (doc as any).lastAutoTable.finalY + 6;

  // Synthèse de la note
  doc.setFillColor(239, 246, 255);
  doc.setDrawColor(191, 219, 254);
  doc.roundedRect(14, y, 182, 22, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(30, 58, 138);
  doc.text(
    `Note finale : ${submission.normalizedScoreOn20} / 20` +
      (submission.examMaxScore !== 20
        ? `  (${submission.finalScoreOutOfMax} / ${submission.examMaxScore})`
        : ''),
    18,
    y + 8
  );
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `Points bruts : ${submission.rawPointsObtained} / ${submission.rawPointsMax}   |   Pourcentage : ${submission.percentage}%   |   Appréciation : ${submission.appreciation}`,
    18,
    y + 16
  );

  y += 28;

  // Points par exercice
  const exercises = computeExerciseBreakdown(
    submission.questionsSnapshot,
    submission.questionGrades
  );
  if (exercises.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('1. Récapitulatif des points par exercice', 14, y);
    y += 3;

    autoTable(doc, {
      startY: y,
      head: [['Exercice / Partie', 'Nombre de questions', 'Points obtenus', 'Barème']],
      body: exercises.map((ex) => [
        ex.title,
        String(ex.count),
        `${ex.obtained} pt`,
        `${ex.max} pt`,
      ]),
      styles: { fontSize: 8.8, cellPadding: 2.2 },
      headStyles: { fillColor: [30, 58, 138], textColor: 255 },
    });
    y = (doc as any).lastAutoTable.finalY + 7;
  }

  // Détail question par question
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  if (y > 260) {
    doc.addPage();
    y = 18;
  }
  doc.text('2. Détail des réponses, barème et commentaires par question', 14, y);
  y += 3;

  const questionRows = submission.questionsSnapshot.map((q) => {
    const ansSummary = formatStudentAnswerSummary(q, submission.answers[q.id]);
    const g = submission.questionGrades[q.id];
    const expected =
      rubrics[q.id]?.expectedAnswer || g?.expectedAnswerDisplay || '—';
    const pts = g ? `${g.pointsObtained} / ${q.maxPoints}` : `0 / ${q.maxPoints}`;
    const comment = g?.comment || '—';
    return [`Q${q.number} (${q.exerciseTitle})`, ansSummary, expected, pts, comment];
  });

  if (questionRows.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Question', 'Réponse de l’élève', 'Réponse attendue (Barème)', 'Points', 'Commentaire']],
      body: questionRows,
      styles: { fontSize: 8.2, cellPadding: 2.2, overflow: 'linebreak' },
      headStyles: { fillColor: [30, 64, 175], textColor: 255 },
      margin: { left: 14, right: 14 },
      columnStyles: {
        0: { cellWidth: 26, fontStyle: 'bold' },
        3: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
      },
    });
    y = (doc as any).lastAutoTable.finalY + 7;
  }

  // Commentaire général
  if (submission.generalComment?.trim()) {
    if (y > 255) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('Commentaire pédagogique général :', 14, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.2);
    const wrapped = doc.splitTextToSize(submission.generalComment.trim(), 180);
    doc.text(wrapped, 14, y);
    y += wrapped.length * 4.5 + 5;
  }

  // Section 3 : Incidents de suivi d'intégrité (UNIQUEMENT dans le PDF A Professeur)
  if (y > 240) {
    doc.addPage();
    y = 18;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('3. Suivi contextuel d’intégrité (réservé au professeur)', 14, y);
  y += 4;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(
    'Note : ces événements techniques (perte de focus, changement d’onglet, sortie plein écran) sont des indicateurs contextuels et non une preuve automatique de fraude.',
    14,
    y,
    { maxWidth: 182 }
  );
  doc.setTextColor(15, 23, 42);
  y += 7;

  if (submission.integrityEvents && submission.integrityEvents.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Horodatage', 'Type d’événement', 'Détails techniques']],
      body: submission.integrityEvents.map((ev) => [
        formatDateFr(ev.timestamp),
        ev.type,
        ev.details || '—',
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [71, 85, 105], textColor: 255 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Aucun incident particulier détecté durant la session.', 14, y);
    y += 7;
  }

  // Journal d'audit des modifications
  if (submission.auditTrail && submission.auditTrail.length > 0) {
    if (y > 245) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('4. Journal d’audit et de validation', 14, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      head: [['Date / Heure', 'Action', 'Évolution note (/20)', 'Motif']],
      body: submission.auditTrail.map((a) => [
        formatDateFr(a.timestamp),
        a.action,
        a.previousScoreOn20 !== undefined && a.newScoreOn20 !== undefined
          ? `${a.previousScoreOn20} -> ${a.newScoreOn20}`
          : '—',
        a.reason,
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [51, 65, 85], textColor: 255 },
    });
  }

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `EduExam — Document confidentiel enseignant (PDF A) — Page ${p}/${pageCount}`,
      14,
      290
    );
  }

  const arrayBuffer = doc.output('arraybuffer');
  const safeStudent = `${submission.student.lastName}_${submission.student.firstName}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );
  const fileName = `PDF_A_Professeur_${submission.examCode}_${safeStudent}.pdf`;

  return { doc, bytes: new Uint8Array(arrayBuffer), fileName };
}

export function downloadTeacherPdfReport(
  submission: Submission,
  rubrics: Record<string, QuestionRubricSecret> = {}
): void {
  const { doc, fileName } = buildTeacherPdfReportBytes(submission, rubrics);
  doc.save(fileName);
}

// ============================================================================
// PDF B — RÉSULTAT DESTINÉ À L'ÉLÈVE (filtré selon paramètres de restitution)
// ============================================================================
export function buildStudentPdfReportBytes(
  receipt: StudentSubmissionReceipt
): { doc: jsPDF; bytes: Uint8Array; fileName: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFillColor(29, 78, 216);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14.5);
  doc.text('EDUEXAM — ATTESTATION DE COPIE & RÉSULTAT ÉLÈVE (PDF B)', 14, 12.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(
    `Référence : ${receipt.submissionId} | Évaluation : ${receipt.examTitle} (${receipt.examCode})`,
    14,
    20.5
  );

  doc.setTextColor(15, 23, 42);
  let y = 36;

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2.5 },
    body: [
      [
        'Élève',
        `${receipt.student.lastName.toUpperCase()} ${receipt.student.firstName}`,
        'Classe',
        receipt.student.className,
      ],
      ['Matière', receipt.subject, 'Durée utilisée', formatDuration(receipt.durationSeconds)],
      [
        'Heure de début',
        formatDateFr(receipt.startedAt),
        'Heure de soumission',
        formatDateFr(receipt.submittedAt),
      ],
      ['État de correction', statusLabelFr(receipt.gradingStatus), '', ''],
    ],
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 32, fillColor: [248, 250, 252] },
      2: { fontStyle: 'bold', cellWidth: 32, fillColor: [248, 250, 252] },
    },
  });

  y = (doc as any).lastAutoTable.finalY + 6;

  // Affichage de la note UNIQUEMENT si autorisé par le professeur et copie corrigée
  if (receipt.canViewScore && receipt.normalizedScoreOn20 !== undefined) {
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
    doc.roundedRect(14, y, 182, 22, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(21, 128, 61);
    doc.text(
      `Note finale : ${receipt.normalizedScoreOn20} / 20` +
        (receipt.examMaxScore !== 20
          ? `  (${receipt.finalScoreOutOfMax} / ${receipt.examMaxScore})`
          : ''),
      18,
      y + 8.5
    );
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `Pourcentage : ${receipt.percentage}%   |   Appréciation : ${receipt.appreciation}`,
      18,
      y + 16.5
    );
    y += 28;

    const exSummary = computeExerciseBreakdown(receipt.questions, receipt.questionGrades);
    if (exSummary.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.text('Points obtenus par exercice', 14, y);
      y += 3;
      autoTable(doc, {
        startY: y,
        head: [['Exercice', 'Points obtenus', 'Barème']],
        body: exSummary.map((ex) => [ex.title, `${ex.obtained}`, `${ex.max}`]),
        styles: { fontSize: 8.5, cellPadding: 2 },
        headStyles: { fillColor: [29, 78, 216], textColor: 255 },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    }
  } else {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(14, y, 182, 14, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(
      'Votre copie a bien été enregistrée. La note détaillée sera communiquée selon les modalités fixées par votre enseignant.',
      18,
      y + 8.5
    );
    y += 20;
  }

  // Tableau des réponses de l'élève (avec ou sans corrigé attendu selon paramètre du professeur)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('Récapitulatif de vos réponses enregistrées', 14, y);
  y += 3;

  const headRow = ['Question', 'Votre réponse'];
  if (receipt.canViewScore) headRow.push('Points', 'Commentaire');
  if (receipt.canViewExpectedAnswers) headRow.push('Éléments attendus');

  const bodyRows = receipt.questions.map((q) => {
    const row = [
      `Q${q.number} — ${q.exerciseTitle}`,
      formatStudentAnswerSummary(q, receipt.answers[q.id]),
    ];
    if (receipt.canViewScore) {
      const g = receipt.questionGrades?.[q.id];
      row.push(g ? `${g.pointsObtained} / ${q.maxPoints}` : `— / ${q.maxPoints}`);
      row.push(g?.comment || '—');
    }
    if (receipt.canViewExpectedAnswers) {
      row.push(receipt.questionGrades?.[q.id]?.expectedAnswerDisplay || '—');
    }
    return row;
  });

  if (bodyRows.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [headRow],
      body: bodyRows,
      styles: { fontSize: 8.3, cellPadding: 2.2, overflow: 'linebreak' },
      headStyles: { fillColor: [29, 78, 216], textColor: 255 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  if (receipt.canViewScore && receipt.generalComment?.trim()) {
    if (y > 255) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Appréciation générale de l’enseignant :', 14, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(doc.splitTextToSize(receipt.generalComment.trim(), 180), 14, y);
  }

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `EduExam — Document élève (PDF B) — Réf. ${receipt.submissionId} — Page ${p}/${pageCount}`,
      14,
      290
    );
  }

  const arrayBuffer = doc.output('arraybuffer');
  const safeStudent = `${receipt.student.lastName}_${receipt.student.firstName}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );
  const fileName = `PDF_B_Resultat_Eleve_${receipt.examCode}_${safeStudent}.pdf`;

  return { doc, bytes: new Uint8Array(arrayBuffer), fileName };
}

export function downloadStudentPdfReport(receipt: StudentSubmissionReceipt): void {
  const { doc, fileName } = buildStudentPdfReportBytes(receipt);
  doc.save(fileName);
}

// ============================================================================
// RAPPORT DE BILAN DE CLASSE PAR EXAMEN (Section Rapports PDF)
// ============================================================================
export function downloadExamClassReportPdf(exam: Exam, submissions: Submission[]): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFillColor(30, 58, 138);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('EDUEXAM — BILAN RÉCAPITULATIF DE CLASSE', 14, 12.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`${exam.title} (${exam.examCode}) — ${exam.subject} — Classe : ${exam.className}`, 14, 20.5);

  doc.setTextColor(15, 23, 42);
  const graded = submissions.filter(
    (s) => s.gradingStatus === 'validated' || s.gradingStatus === 'auto_graded'
  );
  const avg =
    graded.length > 0
      ? round2(graded.reduce((a, b) => a + b.normalizedScoreOn20, 0) / graded.length)
      : 0;
  const passRate =
    graded.length > 0
      ? round2((graded.filter((s) => s.normalizedScoreOn20 >= 10).length / graded.length) * 100)
      : 0;

  doc.setFontSize(10);
  doc.text(
    `Copies reçues : ${submissions.length}   |   Moyenne (/20) : ${graded.length ? avg : '—'}   |   Taux de réussite : ${graded.length ? passRate + '%' : '—'}`,
    14,
    37
  );

  autoTable(doc, {
    startY: 43,
    head: [['Élève', 'Classe', 'Date soumission', 'Durée', 'Note /20', '%', 'Appréciation', 'Statut']],
    body: submissions.map((s) => [
      `${s.student.lastName.toUpperCase()} ${s.student.firstName}`,
      s.student.className,
      formatDateFr(s.submittedAt),
      formatDuration(s.durationSeconds),
      `${s.normalizedScoreOn20}`,
      `${s.percentage}%`,
      s.appreciation,
      s.gradingStatus === 'validated'
        ? 'Validée'
        : s.gradingStatus === 'auto_graded'
        ? 'Auto'
        : 'À valider',
    ]),
    styles: { fontSize: 8.2, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 138], textColor: 255 },
  });

  doc.save(`Bilan_Classe_${exam.examCode}.pdf`);
}

// ============================================================================
// EXPORT CSV UTF-8 BOM (Compatible Excel / LibreOffice français)
// ============================================================================
export function exportSubmissionsToCsv(submissions: Submission[], fileNamePrefix = 'Resultats_EduExam'): void {
  const headers = [
    'ID_Soumission',
    'Code_Examen',
    'Titre_Examen',
    'Matiere',
    'Nom',
    'Prenom',
    'Email_Eleve',
    'Classe',
    'Date_Soumission',
    'Duree_Secondes',
    'Points_Obtenus',
    'Points_Max',
    'Note_Sur_20',
    'Pourcentage',
    'Appreciation',
    'Statut_Correction',
    'Incidents_Integrite',
  ];

  const escapeCsv = (val: unknown) => {
    const s = String(val ?? '').replace(/"/g, '""');
    return `"${s}"`;
  };

  const lines = [
    headers.join(';'),
    ...submissions.map((s) =>
      [
        s.id,
        s.examCode,
        s.examTitle,
        s.subject,
        s.student.lastName,
        s.student.firstName,
        s.student.email || '',
        s.student.className,
        s.submittedAt,
        s.durationSeconds,
        s.rawPointsObtained,
        s.rawPointsMax,
        s.normalizedScoreOn20,
        s.percentage,
        s.appreciation,
        s.gradingStatus,
        s.integrityEvents?.length || 0,
      ]
        .map(escapeCsv)
        .join(';')
    ),
  ];

  // BOM UTF-8 (\uFEFF) pour ouverture directe dans Excel avec accents français intacts
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileNamePrefix}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ============================================================================
// Génération à la demande d'un document PDF pédagogique d'exemple (Sujet ou Corrigé)
// ============================================================================
export function generateSampleSubjectOrCorrectionFile(
  kind: 'subject' | 'correction',
  title: string,
  subjectName: string,
  className: string
): File {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFillColor(kind === 'subject' ? 30 : 124, kind === 'subject' ? 58 : 45, kind === 'subject' ? 138 : 18);
  doc.rect(0, 0, 210, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(
    kind === 'subject'
      ? `SUJET D'ÉVALUATION — ${subjectName.toUpperCase()}`
      : `CORRIGÉ OFFICIEL CONFIDENTIEL — ${subjectName.toUpperCase()}`,
    14,
    12
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${title} | Classe : ${className}`, 14, 20);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Exercice 1 — Connaissances fondamentales et raisonnement (10 points)', 14, 40);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  if (kind === 'subject') {
    doc.text(
      [
        'Consignes : lisez attentivement l’ensemble du sujet avant de répondre dans la colonne de droite.',
        'Toute réponse numérique doit comporter son unité lorsqu’elle est demandée.',
        '',
        'Question 1 (QCM - 3 pts) : Identifiez la proposition exacte parmi les choix proposés.',
        'Question 2 (Calcul numérique - 4 pts) : Déterminez la valeur attendue avec une précision à 0,1 près.',
        'Question 3 (Analyse structurée - 3 pts) : Présentez votre démarche en détaillant hypothèse et conclusion.',
        '',
        'Exercice 2 — Algorithmique et modélisation (10 points)',
        'Question 4 : Écrivez une fonction Python `moyenne_ponderee(notes)` retournant la moyenne des valeurs.',
      ],
      14,
      50
    );
  } else {
    doc.text(
      [
        'DOCUMENT STRICTEMENT RÉSERVÉ À L’ENSEIGNANT — NE PAS DIFFUSER PENDANT L’ÉPREUVE',
        '',
        'Barème détaillé :',
        '- Question 1 (3 pts) : Choix B attendu (Mode A automatique).',
        '- Question 2 (4 pts) : Valeur exacte attendue avec unité SI (tolérance ±0,1).',
        '- Question 3 (3 pts) : 1,5 pt pour la formulation de l’hypothèse, 1,5 pt pour la rigueur de la conclusion.',
        '- Question 4 (10 pts) : 4 pts structure de boucle, 4 pts gestion liste non vide, 2 pts clarté du code.',
      ],
      14,
      50
    );
  }

  const bytes = doc.output('arraybuffer');
  const fileName =
    kind === 'subject' ? 'Sujet_Evaluation_Exemple.pdf' : 'Corrige_Officiel_Confidentiel.pdf';
  return new File([bytes], fileName, { type: 'application/pdf' });
}
