import { Router, Request, Response, RequestHandler } from 'express';
import {
    createExam,
    getExams,
    addStudentToExam,
    bulkAddStudents,
    getStudentsForExam,
    deleteExam,
    deleteStudent,
    updateStudentPassword
} from '../db/database';
import { sessionStore } from '../sessions/sessionStore';

const router = Router();

router.get('/exams', (async (req: Request, res: Response) => {
    try {
        const exams = await getExams();
        res.json(exams);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}) as RequestHandler);

router.post('/exams', (async (req: Request, res: Response) => {
    const { examCode, name, startTime, duration } = req.body as {
        examCode?: string;
        name?: string;
        startTime?: number;
        duration?: number
    };

    if (!examCode || !name) {
        res.status(400).json({ error: 'examCode and name are required' });
        return;
    }

    try {
        await createExam(examCode, name, startTime, duration);
        res.status(201).json({ message: 'Exam created successfully' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}) as RequestHandler);

router.post('/exams/:code/students', (async (req: Request, res: Response) => {
    const code = req.params.code as string;
    const { studentId, password } = req.body;
    if (!studentId || !password) {
        res.status(400).json({ error: 'studentId and password are required' });
        return;
    }
    try {
        await addStudentToExam(studentId, code, password);
        res.status(201).json({ message: 'Student added successfully' });
    } catch (err: any) {
        res.status(500).json({ error: 'Could not add student, possibly duplicate' });
    }
}) as RequestHandler);

router.post('/exams/:code/students/bulk', (async (req: Request, res: Response) => {
    const code = req.params.code as string;
    const { students } = req.body; // Expects an array: [{studentId, password}]
    if (!students || !Array.isArray(students)) {
        res.status(400).json({ error: 'students array is required' });
        return;
    }
    try {
        await bulkAddStudents(code, students);
        res.status(201).json({ message: `${students.length} students added successfully` });
    } catch (err: any) {
        res.status(500).json({ error: 'Could not bulk add students' });
    }
}) as RequestHandler);

router.get('/exams/:code/students', (async (req: Request, res: Response) => {
    const code = req.params.code as string;
    try {
        const students = await getStudentsForExam(code);
        res.json(students);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}) as RequestHandler);

router.delete('/exams/:code', (async (req: Request, res: Response) => {
    const code = req.params.code as string;
    try {
        await deleteExam(code);
        sessionStore.clearExamSessions(code); // Wipe from memory too
        res.json({ message: 'Exam and all its students deleted successfully' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}) as RequestHandler);

router.delete('/exams/:code/students/:id', (async (req: Request, res: Response) => {
    const code = req.params.code as string;
    const studentId = req.params.id as string;
    try {
        await deleteStudent(studentId, code);
        res.json({ message: 'Student deleted successfully' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}) as RequestHandler);

router.patch('/exams/:code/students/:id/password', (async (req: Request, res: Response) => {
    const code = req.params.code as string;
    const studentId = req.params.id as string;
    const { password } = req.body;

    if (!password) {
        res.status(400).json({ error: 'New password is required' });
        return;
    }

    try {
        await updateStudentPassword(studentId, code, password);
        res.json({ message: 'Password updated successfully' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
}) as RequestHandler);

export default router;
