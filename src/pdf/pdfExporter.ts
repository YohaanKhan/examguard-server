import puppeteer from 'puppeteer';
import { Session } from '../sessions/sessionStore';

/**
 * Builds an HTML report for a student session and renders it to a PDF buffer
 * using Puppeteer (headless Chromium).
 *
 * Called by `GET /api/sessions/:id/export/pdf`.
 *
 * @param session - The full student session object
 * @returns A Buffer containing the PDF bytes, ready to pipe to the HTTP response
 */
export async function generateSessionPdf(session: Omit<Session, 'ws'>): Promise<Buffer> {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setContent(buildHtmlReport(session), { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({ format: 'A4', printBackground: true });
        return Buffer.from(pdf);
    } finally {
        await browser.close();
    }
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

/**
 * Builds a self-contained HTML string for the student's exam report.
 * All styles are inlined so Puppeteer renders them correctly without network access.
 */
function buildHtmlReport(session: Omit<Session, 'ws'>): string {
    const pasteCount = session.events.filter(e => e.type === 'PASTE').length;
    const focusLossCount = session.events.filter(e => e.type === 'FOCUS_LOST').length;
    // Client sends batched keystrokes — sum the `chars` field across KEYSTROKE_BATCH events
    const keystrokeCount = session.events
        .filter(e => e.type === 'KEYSTROKE_BATCH')
        .reduce((sum, e) => sum + (typeof e.chars === 'number' ? e.chars : 0), 0);
    const snapshotCount = session.snapshots.length;
    const terminalCount = session.events.filter(e => e.type === 'TERMINAL_COMMAND').length;
    const screenshotCount = (session as unknown as { screenshots?: unknown[] }).screenshots?.length ?? 0;

    const joinedAt = new Date(session.joinedAt).toLocaleString();
    const score = session.suspicionScore;
    const scoreColor = score >= 70 ? '#e53935' : score >= 40 ? '#fb8c00' : '#43a047';

    const pasteRows = session.events
        .filter(e => e.type === 'PASTE')
        .map(e => `
            <tr>
                <td>${new Date(e.timeStamp).toLocaleTimeString()}</td>
                <td>${String(e.file ?? '—').split('/').pop()}</td>
                <td><pre class="paste-content">${escapeHtml(String(e.content ?? ''))}</pre></td>
            </tr>
        `).join('');

    const focusRows = session.events
        .filter(e => e.type === 'FOCUS_LOST' || e.type === 'FOCUS_GAINED')
        .map(e => `
            <tr>
                <td>${new Date(e.timeStamp).toLocaleTimeString()}</td>
                <td class="${e.type === 'FOCUS_LOST' ? 'focus-lost' : 'focus-gained'}">${e.type}</td>
            </tr>
        `).join('');

    const terminalRows = session.events
        .filter(e => e.type === 'TERMINAL_COMMAND')
        .map(e => `
            <tr>
                <td>${new Date(e.timeStamp).toLocaleTimeString()}</td>
                <td>${escapeHtml(String((e as { shell?: string }).shell ?? '—'))}</td>
                <td><pre class="paste-content">${escapeHtml(String((e as { command?: string }).command ?? ''))}</pre></td>
            </tr>
        `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #212121; padding: 40px; }
  h1   { font-size: 22px; margin-bottom: 4px; }
  h2   { font-size: 15px; margin: 24px 0 8px; border-bottom: 2px solid #e0e0e0; padding-bottom: 4px; color: #424242; }
  .meta { color: #757575; font-size: 12px; margin-bottom: 20px; }
  .score-box { display: inline-block; padding: 10px 22px; border-radius: 6px;
               background: ${scoreColor}; color: #fff; font-size: 28px; font-weight: bold;
               margin: 8px 0 20px; }
  .stats { display: flex; gap: 24px; margin-bottom: 20px; }
  .stat  { background: #f5f5f5; border-radius: 6px; padding: 10px 18px; text-align: center; }
  .stat .num  { font-size: 22px; font-weight: bold; color: #1565C0; }
  .stat .label { font-size: 11px; color: #757575; margin-top: 2px; }
  table  { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px; }
  th     { background: #1565C0; color: #fff; text-align: left; padding: 6px 10px; }
  td     { padding: 6px 10px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
  tr:nth-child(even) td { background: #fafafa; }
  .paste-content { font-family: monospace; white-space: pre-wrap; word-break: break-all;
                   background: #fff3e0; padding: 4px 6px; border-radius: 3px; max-height: 80px;
                   overflow: hidden; font-size: 11px; }
  .focus-lost   { color: #e53935; font-weight: bold; }
  .focus-gained { color: #43a047; font-weight: bold; }
  .footer { margin-top: 32px; font-size: 11px; color: #bdbdbd; text-align: center; }
</style>
</head>
<body>

<h1>ExamGuard — Student Report</h1>
<div class="meta">
  Student ID: <strong>${escapeHtml(session.studentId)}</strong> &nbsp;|&nbsp;
  Exam: <strong>${escapeHtml(session.examCode)}</strong> &nbsp;|&nbsp;
  Session started: <strong>${joinedAt}</strong>
</div>

<h2>Suspicion Score</h2>
<div class="score-box">${score} / 100</div>

<div class="stats">
  <div class="stat"><div class="num">${pasteCount}</div><div class="label">Pastes</div></div>
  <div class="stat"><div class="num">${focusLossCount}</div><div class="label">Focus Losses</div></div>
  <div class="stat"><div class="num">${keystrokeCount}</div><div class="label">Keystrokes</div></div>
  <div class="stat"><div class="num">${snapshotCount}</div><div class="label">Snapshots</div></div>
  <div class="stat"><div class="num">${terminalCount}</div><div class="label">Terminal Cmds</div></div>
  <div class="stat"><div class="num">${screenshotCount}</div><div class="label">Screenshots</div></div>
</div>

${pasteRows ? `
<h2>Paste Events</h2>
<table>
  <thead><tr><th>Time</th><th>File</th><th>Content</th></tr></thead>
  <tbody>${pasteRows}</tbody>
</table>` : '<h2>Paste Events</h2><p style="color:#757575;margin-bottom:12px">None recorded.</p>'}

${focusRows ? `
<h2>Focus Events</h2>
<table>
  <thead><tr><th>Time</th><th>Event</th></tr></thead>
  <tbody>${focusRows}</tbody>
</table>` : '<h2>Focus Events</h2><p style="color:#757575;margin-bottom:12px">None recorded.</p>'}

${terminalRows ? `
<h2>Terminal Commands</h2>
<table>
  <thead><tr><th>Time</th><th>Shell</th><th>Command</th></tr></thead>
  <tbody>${terminalRows}</tbody>
</table>` : '<h2>Terminal Commands</h2><p style="color:#757575;margin-bottom:12px">None recorded.</p>'}

<div class="footer">Generated by ExamGuard &nbsp;·&nbsp; ${new Date().toLocaleString()}</div>
</body>
</html>`;
}

/** Escapes HTML special characters to prevent XSS in the generated report. */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
