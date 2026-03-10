import { Router, Request, Response } from 'express';

/**
 * Valid exam codes — in production these would be loaded from a database or config file
 * that the teacher creates before the exam starts.
 *
 * Format: examCode → expiry timestamp (Unix ms). 0 = never expire.
 */
const VALID_EXAM_CODES: Record<string, number> = {
    'EXAM2024': 0,
    'EXAM2025': 0,
};

/**
 * Router for student authentication.
 * Handles exam code + student ID verification before a session begins.
 *
 * Routes:
 *  POST /api/auth/verify  — validate exam code and student ID
 *  POST /api/exams        — register a new exam code (teacher-side)
 */
export function authRouter(): Router {
    const router = Router();

    /**
     * POST /api/auth/verify
     * Validates the student's exam code and student ID.
     * Returns 401 if the exam code is unknown or expired.
     *
     * @body studentId - The student's unique ID e.g. 's12345678'
     * @body examCode  - The exam code e.g. 'EXAM2024'
     */
    router.post('/auth/verify', (req: Request, res: Response) => {
        const { studentId, examCode } = req.body as { studentId?: string; examCode?: string };

        if (!studentId || !examCode) {
            res.status(400).json({ success: false, message: 'studentId and examCode are required.' });
            return;
        }

        const expiry = VALID_EXAM_CODES[examCode];

        if (expiry === undefined) {
            console.warn(`[Auth] Rejected — unknown exam code: ${examCode}`);
            res.status(401).json({ success: false, message: 'Invalid exam code.' });
            return;
        }

        if (expiry !== 0 && Date.now() > expiry) {
            console.warn(`[Auth] Rejected — exam code expired: ${examCode}`);
            res.status(401).json({ success: false, message: 'This exam has ended.' });
            return;
        }

        console.log(`[Auth] Verified — studentId: ${studentId}, examCode: ${examCode}`);
        res.json({ success: true });
    });

    /**
     * POST /api/exams
     * Registers a new exam code so students can authenticate with it.
     * In a real system this would persist to a database and require teacher auth.
     *
     * @body code      - The exam code string e.g. 'MIDTERM_2025'
     * @body expiresAt - Unix timestamp (ms) after which the code is invalid. 0 = never.
     */
    router.post('/api/exams', (req: Request, res: Response) => {
        const { code, expiresAt } = req.body as { code?: string; expiresAt?: number };

        if (!code) {
            res.status(400).json({ success: false, message: 'code is required.' });
            return;
        }

        VALID_EXAM_CODES[code] = expiresAt ?? 0;
        console.log(`[Auth] New exam registered — code: ${code}, expiresAt: ${expiresAt ?? 'never'}`);
        res.json({ success: true, code });
    });

    return router;
}