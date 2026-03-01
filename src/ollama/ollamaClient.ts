/**
 * Client for the local Ollama API.
 * Sends code snapshots to a locally running Ollama instance and returns
 * generated questions for the student to answer.
 *
 * Requires Ollama to be running locally: https://ollama.ai
 * And the codellama model to be pulled: `ollama pull codellama`
 */

/** The fallback question returned if Ollama is unreachable or returns an error */
const FALLBACK_QUESTION = 'Can you explain what your code does?';

/**
 * Sends a code snapshot to Ollama and returns a single exam question.
 * The question is designed to verify the student genuinely understands the code.
 *
 * @param code     - The full code snapshot to analyse
 * @param language - The programming language of the code, used in the prompt (default: 'code')
 * @returns A single question string, or a fallback question if Ollama is unavailable
 *
 * @example
 * const question = await generateQuestion('def add(a, b): return a + b', 'Python');
 * // → "What would happen if you called add() with two strings instead of numbers?"
 */
export async function generateQuestion(
    code: string,
    language: string = 'code'
): Promise<string> {

    const prompt = `You are an exam proctor. A student submitted the following ${language} code.
Write ONE short, specific question to verify the student actually understands what they wrote.
Return only the question, no explanation, no preamble, no numbering.

Code:
${code}`;

    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'codellama',
                prompt: prompt,
                stream: false
            })
        });

        if (!response.ok) {
            console.error(`[Ollama] HTTP error: ${response.status} ${response.statusText}`);
            return FALLBACK_QUESTION;
        }

        const data = await response.json() as { response: string };
        return data.response.trim();

    } catch (err) {
        console.error('[Ollama] Failed to reach Ollama — is it running?', err);
        return FALLBACK_QUESTION;
    }
}