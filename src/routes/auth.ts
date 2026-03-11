import { Router, Request, Response } from 'express';
import { sessionStore } from '../sessions/sessionStore';
import { getQuery, verifyStudentCredentials } from '../db/database';

/**
 * Helper to check if an exam code is currently valid (exists, active, and within time limits).
 */
export async function validateExamCode(code: string): Promise<{
    isValid: boolean;
    reason?: 'inactive' | 'not_started' | 'expired' | 'not_found';
    startTime?: number;
}> {
    const row = await getQuery<{ active: number; start_time: number; duration: number }>(
        'SELECT active, start_time, duration FROM exams WHERE exam_code = ?',
        [code]
    );

    if (!row) return { isValid: false, reason: 'not_found' };
    if (!row.active) return { isValid: false, reason: 'inactive' };

    const now = Date.now();
    const startTime = Number(row.start_time);
    const durationMs = (row.duration || 0) * 60 * 1000;

    if (startTime && now < startTime) {
        return { isValid: false, reason: 'not_started', startTime };
    }

    if (startTime && durationMs && now > (startTime + durationMs)) {
        return { isValid: false, reason: 'expired' };
    }

    return { isValid: true };
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
     * POST /auth/verify
     * Validates the student's exam code, student ID, and password against SQLite.
     */
    router.post('/auth/verify', async (req: Request, res: Response): Promise<void> => {
        const { studentId, examCode, password } = req.body as { studentId?: string; examCode?: string; password?: string };

        if (!studentId || !examCode || !password) {
            res.status(400).json({ success: false, message: 'studentId, examCode, and password are required.' });
            return;
        }

        const authStatus = await validateExamCode(examCode);
        if (!authStatus.isValid) {
            let message = 'Invalid or inactive exam code.';
            if (authStatus.reason === 'not_started' && authStatus.startTime) {
                const startTimeStr = new Date(authStatus.startTime).toLocaleTimeString();
                message = `Exam has not started yet. It is scheduled for ${startTimeStr}.`;
            } else if (authStatus.reason === 'expired') {
                message = 'This exam session has already ended.';
            }

            console.warn(`[Auth] Rejected — ${authStatus.reason}: ${examCode}`);
            res.status(401).json({ success: false, message });
            return;
        }

        const isValid = await verifyStudentCredentials(studentId, examCode, password);
        if (!isValid) {
            console.warn(`[Auth] Rejected — invalid credentials for student: ${studentId}`);
            res.status(401).json({ success: false, message: 'Invalid student ID or password.' });
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

    return router;
}