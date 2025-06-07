#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));
const version = packageJson.version;

// Update version.ts file
const versionFile = join(projectRoot, 'src/version.ts');
const content = `export const version = '${version}';\n`;

writeFileSync(versionFile, content);
console.log(`Updated version.ts to ${version}`);
