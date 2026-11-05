import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, 'dist');
const templatePath = path.join(projectRoot, 'templates', 'index.html');
const mainScriptTag = '<script src="/static/js/main.js"></script>';
const apiBaseUrl = (process.env.API_BASE_URL || '').replace(/\/+$/, '');

let html = await readFile(templatePath, 'utf8');

if (!html.includes(mainScriptTag)) {
  throw new Error(`Could not find the main script tag in ${templatePath}`);
}

const configScript = `<script>window.APP_CONFIG = ${JSON.stringify({ apiBaseUrl })};</script>\n`;
html = html.replace(mainScriptTag, `${configScript}${mainScriptTag}`);

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, 'index.html'), html);
await cp(path.join(projectRoot, 'static'), path.join(outputDirectory, 'static'), { recursive: true });
