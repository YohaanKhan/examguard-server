import { Router } from 'express';

/**
 * Router for student authentication endpoints.
 * Handles exam code and student ID verification before a session begins.
 *
 * @returns An Express Router with auth endpoints mounted
 */
export function authRouter(): Router {
    const router = Router();

    /**
     * POST /auth/verify
     * Verifies a student's exam code and student ID.
     * Currently just logs and returns success — real validation added when backend is ready.
     *
     * @body studentId - The student's unique ID e.g. 's12345678'
     * @body examCode  - The exam code e.g. 'EXAM2024'
     */
    router.post('/auth/verify', (req, res) => {
        const { studentId, examCode } = req.body;
        console.log(`[Auth] Verify request — studentId: ${studentId}, examCode: ${examCode}`);
        // TODO: validate against a real exam registry
        res.json({ success: true });
    });

    return router;
}