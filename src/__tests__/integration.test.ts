import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { version } from '../version.js';

const execFile = promisify(require('node:child_process').execFile);

describe('Integration Tests', () => {
  let testHomeDir: string;
  let testClaudeDir: string;
  let originalHome: string;

  // Handle EPIPE errors globally for pipe tests
  beforeEach(async () => {
    const originalEmit = process.emit;
    process.emit = function (event: string | symbol, ...args: unknown[]) {
      if (
        event === 'uncaughtException' &&
        args[0] &&
        typeof args[0] === 'object' &&
        'code' in args[0] &&
        args[0].code === 'EPIPE'
      ) {
        // Ignore EPIPE errors in tests (expected for pipe operations)
        return false;
      }
      return originalEmit.call(this, event, ...args);
    };

    // Create temporary test environment
    testHomeDir = join(tmpdir(), `claude-history-integration-${Date.now()}`);
    testClaudeDir = join(testHomeDir, '.claude', 'projects');
    await mkdir(testClaudeDir, { recursive: true });

    // Mock HOME environment variable
    originalHome = process.env.HOME || '';
    process.env.HOME = testHomeDir;
  });

  afterEach(async () => {
    // Restore original HOME
    process.env.HOME = originalHome;

    // Clean up test directory
    await rm(testHomeDir, { recursive: true, force: true });
  });

  async function createTestProject(
    projectName: string,
    actualPath: string,
    sessions: Array<{ filename: string; commands: unknown[] }>
  ) {
    const projectDir = join(testClaudeDir, projectName);
    await mkdir(projectDir, { recursive: true });

    for (const session of sessions) {
      const sessionPath = join(projectDir, session.filename);

      // Add a base entry with cwd field if commands array is empty or doesn't have cwd
      const baseEntry = {
        cwd: actualPath,
        type: 'user',
        message: { role: 'user', content: [] },
        timestamp: new Date().toISOString(),
      };

      const allCommands =
        session.commands.length === 0 ? [baseEntry] : [...session.commands];

      // Ensure each command has a cwd field
      const commandsWithCwd = allCommands.map((cmd) => {
        if (typeof cmd === 'object' && cmd !== null && !('cwd' in cmd)) {
          return { ...cmd, cwd: actualPath };
        }
        return cmd;
      });

      const jsonlContent = commandsWithCwd
        .map((cmd) => JSON.stringify(cmd))
        .join('\n');
      await writeFile(sessionPath, jsonlContent);
    }
  }

  async function runCLI(
    args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const result = await execFile(
        'node',
        ['bin/claude-history.js', ...args],
        {
          cwd: process.cwd(),
          env: { ...process.env, HOME: testHomeDir },
        }
      );
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: 0,
      };
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || '',
        exitCode: err.code || 1,
      };
    }
  }

  describe('CLI End-to-End Tests', () => {
    it('should show help when run with --help', async () => {
      const result = await runCLI(['--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        'Show shell command history from Claude Code'
      );
      expect(result.stdout).toContain('--global');
      expect(result.stdout).toContain('--list-projects');
      expect(result.stdout).toContain('--count');
      expect(result.stdout).toContain('--include-failed');
    });

    it('should show version when run with --version', async () => {
      const result = await runCLI(['--version']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(version);
    });

    it('should list projects when run with --list-projects', async () => {
      await createTestProject('-Users-test-project1', '/Users/test/project1', [
        { filename: 'session1.jsonl', commands: [] },
      ]);
      await createTestProject('-Users-test-project2', '/Users/test/project2', [
        { filename: 'session2.jsonl', commands: [] },
      ]);

      const result = await runCLI(['--list-projects']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('/Users/test/project1');
      expect(result.stdout).toContain('/Users/test/project2');
    });

    it('should handle empty projects directory', async () => {
      const result = await runCLI(['--list-projects']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No Claude projects found');
    });

    it('should show global history with bash commands', async () => {
      const bashCommand = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: {
                command: 'npm install commander',
                description: 'Install CLI framework',
              },
            },
          ],
        },
        timestamp: '2025-06-07T12:00:00.000Z',
        cwd: '/Users/test/project1',
      };

      await createTestProject('-Users-test-project1', '/Users/test/project1', [
        { filename: 'session1.jsonl', commands: [bashCommand] },
      ]);

      const result = await runCLI(['--global']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('npm install commander');
      expect(result.stdout).toContain('[project1');
    });

    it('should show global history with user commands', async () => {
      const userCommand = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '! git status' }],
        },
        timestamp: '2025-06-07T12:01:00.000Z',
        cwd: '/Users/test/project1',
      };

      await createTestProject('-Users-test-project1', '/Users/test/project1', [
        { filename: 'session1.jsonl', commands: [userCommand] },
      ]);

      const result = await runCLI(['--global']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('git status');
      expect(result.stdout).toContain('[project1');
    });

    it('should respect count limit', async () => {
      const commands = Array.from({ length: 5 }, (_, i) => ({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: `echo ${i + 1}` },
            },
          ],
        },
        timestamp: `2025-06-07T12:0${i}:00.000Z`,
      }));

      await createTestProject('-Users-test-project1', '/Users/test/project1', [
        { filename: 'session1.jsonl', commands },
      ]);

      const result = await runCLI(['--global', '--count', '3']);

      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(result.stdout).toContain('echo 1');
      expect(result.stdout).toContain('echo 2');
      expect(result.stdout).toContain('echo 3');
      expect(result.stdout).not.toContain('echo 4');
    });

    it('should merge multiple projects chronologically', async () => {
      const project1Commands = [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'echo first' },
              },
            ],
          },
          timestamp: '2025-06-07T12:00:00.000Z',
        },
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'echo third' },
              },
            ],
          },
          timestamp: '2025-06-07T12:02:00.000Z',
        },
      ];

      const project2Commands = [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'echo second' },
              },
            ],
          },
          timestamp: '2025-06-07T12:01:00.000Z',
        },
      ];

      await createTestProject('-Users-test-project1', '/Users/test/project1', [
        { filename: 'session1.jsonl', commands: project1Commands },
      ]);
      await createTestProject('-Users-test-project2', '/Users/test/project2', [
        { filename: 'session1.jsonl', commands: project2Commands },
      ]);

      const result = await runCLI(['--global']);

      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('echo first');
      expect(lines[1]).toContain('echo second');
      expect(lines[2]).toContain('echo third');
    });

    it('should handle specific project by name', async () => {
      const commands = [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'npm test' },
              },
            ],
          },
          timestamp: '2025-06-07T12:00:00.000Z',
        },
      ];

      await createTestProject(
        '-Users-test-myproject',
        '/Users/test/myproject',
        [{ filename: 'session1.jsonl', commands }]
      );

      const result = await runCLI(['myproject']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('npm test');
      expect(result.stdout).not.toContain('[myproject'); // No project prefix in single project mode
    });

    it('should fall back to global mode when project not found', async () => {
      const existingCommands = [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'echo from existing' },
              },
            ],
          },
          timestamp: '2025-06-07T12:00:00.000Z',
          cwd: '/Users/test/existing',
        },
      ];

      const anotherCommands = [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'echo from another' },
              },
            ],
          },
          timestamp: '2025-06-07T12:01:00.000Z',
          cwd: '/Users/test/another',
        },
      ];

      // Create two projects with commands so global mode shows project prefixes
      await createTestProject('-Users-test-existing', '/Users/test/existing', [
        { filename: 'session1.jsonl', commands: existingCommands },
      ]);
      await createTestProject('-Users-test-another', '/Users/test/another', [
        { filename: 'session1.jsonl', commands: anotherCommands },
      ]);

      const result = await runCLI(['nonexistent']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Project 'nonexistent' not found");
    });

    it('should handle corrupted JSONL gracefully', async () => {
      const validCommand = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'echo valid' },
            },
          ],
        },
        timestamp: '2025-06-07T12:00:00.000Z',
        cwd: '/Users/test/project1',
      };

      const sessionContent = [
        JSON.stringify(validCommand),
        '{ invalid json',
        JSON.stringify(validCommand),
      ].join('\n');

      const projectDir = join(testClaudeDir, '-Users-test-project1');
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(projectDir, 'session1.jsonl'), sessionContent);

      const result = await runCLI(['--global']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('echo valid');
      // Should see the command twice (before and after corrupted line)
      const lines = result.stdout.trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    it('should exit with code 2 when no commands found', async () => {
      // Create empty project
      await createTestProject('-Users-test-empty', '/Users/test/empty', [
        { filename: 'session1.jsonl', commands: [] },
      ]);

      const result = await runCLI(['--global']);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe('');
    });

    it('should handle invalid count parameter', async () => {
      const result = await runCLI(['--global', '--count', 'invalid']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Count must be a positive number');
    });
  });
});
