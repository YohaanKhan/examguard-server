import { Router, Request, Response } from 'express';
import { sessionStore } from '../sessions/sessionStore';

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
 * Helper to check if an exam code is currently valid.
 */
export function validateExamCode(code: string): boolean {
    const expiry = VALID_EXAM_CODES[code];
    if (expiry === undefined) return false;
    if (expiry !== 0 && Date.now() > expiry) return false;
    return true;
}

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

        // Prevent logging in if they are already connected from another window or if grace period expired
        const existingSession = sessionStore.getSession(studentId);
        if (existingSession) {
            if (existingSession.ws) {
                console.warn(`[Auth] Rejected — session already active: ${studentId}`);
                res.status(403).json({ success: false, message: 'You are already connected to this exam in another window.' });
                return;
            } else if (existingSession.disconnectedAt && !existingSession.allowLateRejoin) {
                const timeOffline = Date.now() - existingSession.disconnectedAt;
                if (timeOffline > 2 * 60 * 1000) {
                    console.warn(`[Auth] Rejected — late reconnection: ${studentId}`);
                    res.status(403).json({ success: false, message: 'Reconnection window expired. You were disconnected for more than 2 minutes. Ask your teacher to allow rejoin.' });
                    return;
                }
            }
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

    /**
     * GET /api/exams
     * Returns a list of all registered exam codes and their current expiration status.
     * Used by the teacher dashboard.
     */
    router.get('/api/exams', (req: Request, res: Response) => {
        const now = Date.now();
        const exams = Object.entries(VALID_EXAM_CODES).map(([code, expiresAt]) => {
            const isExpired = expiresAt !== 0 && now > expiresAt;
            return {
                code,
                expiresAt,
                status: isExpired ? 'expired' : 'active'
            };
        });

        // Sort active exams first, then by code name
        exams.sort((a, b) => {
            if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
            return a.code.localeCompare(b.code);
        });

        res.json(exams);
    });

    /**
     * DELETE /api/sessions/:studentId
     * Allows a teacher to forcefully clear a student's session (e.g. if their laptop completely crashed).
     */
    router.delete('/api/sessions/:studentId', (req: Request, res: Response) => {
        const studentId = req.params.studentId as string;
        if (!studentId) {
            res.status(400).json({ success: false, message: 'studentId is required.' });
            return;
        }

        sessionStore.deleteSession(studentId);
        res.json({ success: true, message: `Session cleared for ${studentId}` });
    });

    return router;
}