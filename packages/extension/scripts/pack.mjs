#!/usr/bin/env node
/**
 * Pack the built extension into release/sigx-devtools-extension-vX.Y.Z.zip
 * ready for upload to the Chrome Web Store (and Edge Add-ons, etc.).
 *
 * Reads the version from public/manifest.json — the same value the
 * extension reports to the host browser — so the zip name and the
 * manifest never drift apart.
 *
 * Zero deps: shells out to the system `zip` binary (preinstalled on
 * macOS and ubuntu-latest). Excludes .DS_Store and source-map files
 * if you want a slimmer review zip; right now we ship the maps
 * because reviewers can use them.
 */

import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const distDir = resolve(pkgRoot, 'dist');
const releaseDir = resolve(pkgRoot, 'release');

if (!existsSync(distDir)) {
    console.error(`[pack] dist/ not found at ${distDir}. Run "pnpm build" first.`);
    process.exit(1);
}

const manifestPath = resolve(pkgRoot, 'public', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const version = manifest.version;
if (typeof version !== 'string' || !version) {
    console.error('[pack] manifest.json has no "version" field.');
    process.exit(1);
}

const zipName = `sigx-devtools-extension-v${version}.zip`;
const zipPath = resolve(releaseDir, zipName);

mkdirSync(releaseDir, { recursive: true });
if (existsSync(zipPath)) {
    rmSync(zipPath);
}

// Zip from inside dist/ so the archive's top level is the extension
// root (manifest.json, content-script.js, panel.html, assets/, etc.)
// — that's what the store unpacks.
try {
    execSync(`zip -r "${zipPath}" . -x "*.DS_Store"`, {
        cwd: distDir,
        stdio: 'inherit',
    });
} catch (err) {
    console.error('[pack] zip failed:', err.message);
    process.exit(1);
}

const sizeBytes = execSync(`stat -f %z "${zipPath}"`).toString().trim();
const sizeKb = (Number(sizeBytes) / 1024).toFixed(1);
console.log(`\n[pack] ${zipName} — ${sizeKb} KB`);
console.log(`[pack] ${zipPath}`);
