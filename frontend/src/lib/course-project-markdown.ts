import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** HTML body for repo-root Course-Project-Information.md (server-only). */
export function getCourseProjectHtml(): string {
	const mdPath = path.resolve(__dirname, '../../../Course-Project-Information.md');
	const raw = readFileSync(mdPath, 'utf-8');
	return marked.parse(raw, { async: false }) as string;
}
