#!/usr/bin/env node

// Simple entry point that imports and runs the CLI
import { program } from '../dist/cli.js';

program.parse();
