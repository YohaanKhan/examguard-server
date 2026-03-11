import sqlite3 from 'sqlite3';
import path from 'path';

const DB_PATH = path.join(__dirname, '../../examguard.sqlite');

export const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('[DB] Error opening database:', err.message);
    } else {
        console.log('[DB] Connected to SQLite database.');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        // Create exams table
        db.run(`
            CREATE TABLE IF NOT EXISTS exams (
                exam_code TEXT PRIMARY KEY,
                name TEXT,
                active BOOLEAN DEFAULT 1,
                start_time BIGINT,
                duration INTEGER
            )
        `);

        // Migration for existing tables
        db.run("ALTER TABLE exams ADD COLUMN start_time BIGINT", (err) => { /* ignore if already exists */ });
        db.run("ALTER TABLE exams ADD COLUMN duration INTEGER", (err) => { /* ignore if already exists */ });

        // Create students table
        db.run(`
            CREATE TABLE IF NOT EXISTS students (
                student_id TEXT,
                exam_code TEXT,
                password TEXT,
                PRIMARY KEY (student_id, exam_code),
                FOREIGN KEY (exam_code) REFERENCES exams (exam_code)
            )
        `);
        console.log('[DB] Database tables initialized.');
    });
}

/** Wrapper to run a query that returns no rows (INSERT, UPDATE, DELETE) */
export function runQuery(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve();
        });
    });
}

/** Wrapper to run a query that returns multiple rows (SELECT) */
export function allQuery<T>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows as T[]);
        });
    });
}

/** Wrapper to run a query that returns a single row (SELECT) */
export function getQuery<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row as T | undefined);
        });
    });
}

// --- Helper Functions ---

export async function createExam(examCode: string, name: string, startTime?: number, duration?: number): Promise<void> {
    const sql = `INSERT INTO exams (exam_code, name, start_time, duration) VALUES (?, ?, ?, ?)`;
    await runQuery(sql, [examCode, name, startTime || Date.now(), duration || 60]);
}

export async function getExams(): Promise<any[]> {
    const sql = `SELECT * FROM exams`;
    return await allQuery(sql);
}

export async function addStudentToExam(studentId: string, examCode: string, password: string): Promise<void> {
    const sql = `INSERT INTO students (student_id, exam_code, password) VALUES (?, ?, ?)`;
    await runQuery(sql, [studentId, examCode, password]);
}

export async function bulkAddStudents(examCode: string, students: { studentId: string; password: string }[]): Promise<void> {
    // Basic transaction/batch emulation using serialize
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            const stmt = db.prepare(`INSERT INTO students (student_id, exam_code, password) VALUES (?, ?, ?)`);
            students.forEach((s) => {
                stmt.run(s.studentId, examCode, s.password);
            });
            stmt.finalize();
            db.run("COMMIT", (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

export async function getStudentsForExam(examCode: string): Promise<any[]> {
    const sql = `SELECT student_id, exam_code FROM students WHERE exam_code = ?`;
    return await allQuery(sql, [examCode]);
}

export async function deleteExam(examCode: string): Promise<void> {
    // Delete students first due to foreign key (though ON DELETE CASCADE isn't set, let's be safe)
    await runQuery(`DELETE FROM students WHERE exam_code = ?`, [examCode]);
    await runQuery(`DELETE FROM exams WHERE exam_code = ?`, [examCode]);
}

export async function deleteStudent(studentId: string, examCode: string): Promise<void> {
    await runQuery(`DELETE FROM students WHERE student_id = ? AND exam_code = ?`, [studentId, examCode]);
}

export async function verifyStudentCredentials(studentId: string, examCode: string, password: string): Promise<boolean> {
    const sql = `SELECT 1 FROM students WHERE student_id = ? AND exam_code = ? AND password = ?`;
    const row = await getQuery(sql, [studentId, examCode, password]);
    return !!row;
}

export async function updateStudentPassword(studentId: string, examCode: string, newPassword: string): Promise<void> {
    const sql = `UPDATE students SET password = ? WHERE student_id = ? AND exam_code = ?`;
    await runQuery(sql, [newPassword, studentId, examCode]);
}
