import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSONLStreamParser } from '../jsonl-stream-parser.js';
import type { ConversationEntry } from '../types.js';

describe('JSONLStreamParser', () => {
  let parser: JSONLStreamParser;
  let testDir: string;

  beforeEach(async () => {
    parser = new JSONLStreamParser();
    testDir = join(tmpdir(), `cchistory-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('extractBashCommand', () => {
    it('should extract bash command from assistant message', () => {
      const entry: ConversationEntry = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: {
                command: 'npm install commander',
                description: 'Install Commander.js CLI framework',
              },
            },
          ],
        },
        timestamp: '2025-06-07T12:00:00.000Z',
        cwd: '/Users/test/project',
      };

      const result = parser.extractBashCommand(entry);

      expect(result).toEqual({
        timestamp: new Date('2025-06-07T12:00:00.000Z'),
        command: 'npm install commander',
        source: 'bash',
        description: 'Install Commander.js CLI framework',
        projectPath: '/Users/test/project',
      });
    });

    it('should return null for user messages', () => {
      const entry: ConversationEntry = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      };

      const result = parser.extractBashCommand(entry);
      expect(result).toBeNull();
    });

    it('should return null for assistant messages without bash tools', () => {
      const entry: ConversationEntry = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Edit',
              input: {
                file_path: '/test',
                old_string: 'old',
                new_string: 'new',
              },
            },
          ],
        },
      };

      const result = parser.extractBashCommand(entry);
      expect(result).toBeNull();
    });
  });

  describe('extractUserCommand', () => {
    it('should extract user command from <bash-input> tags', () => {
      const entry: ConversationEntry = {
        type: 'user',
        message: {
          role: 'user',
          content: '<bash-input>npm test</bash-input>',
        },
        timestamp: '2025-06-07T12:00:00.000Z',
        cwd: '/Users/test/project',
      };

      const result = parser.extractUserCommand(entry);

      expect(result).toEqual({
        timestamp: new Date('2025-06-07T12:00:00.000Z'),
        command: 'npm test',
        source: 'user',
        projectPath: '/Users/test/project',
      });
    });

    it('should return null for regular user text', () => {
      const entry: ConversationEntry = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Regular message' }],
        },
      };

      const result = parser.extractUserCommand(entry);
      expect(result).toBeNull();
    });

    it('should return null for assistant messages', () => {
      const entry: ConversationEntry = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '! npm test' }],
        },
      };

      const result = parser.extractUserCommand(entry);
      expect(result).toBeNull();
    });
  });

  describe('normalizeBashCommand', () => {
    it('should handle single line commands', () => {
      const result = parser.normalizeBashCommand('npm install');
      expect(result).toBe('npm install');
    });

    it('should normalize multi-line commands with zsh format', () => {
      const multiLine = `npm install
        --save
        commander`;

      const result = parser.normalizeBashCommand(multiLine);
      expect(result).toBe('npm install\\n--save\\ncommander');
    });

    it('should filter out empty lines', () => {
      const multiLine = `npm install

        commander`;

      const result = parser.normalizeBashCommand(multiLine);
      expect(result).toBe('npm install\\ncommander');
    });
  });

  describe('createFileStream', () => {
    it('should stream commands from JSONL file', async () => {
      const jsonlContent = [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: {
                  command: 'echo "test1"',
                  description: 'Test command 1',
                },
              },
            ],
          },
          timestamp: '2025-06-07T12:00:00.000Z',
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: '<bash-input>echo "test2"</bash-input>',
          },
          timestamp: '2025-06-07T12:01:00.000Z',
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n');

      const testFile = join(testDir, 'test.jsonl');
      await writeFile(testFile, jsonlContent);

      const commands = [];
      for await (const command of parser.createFileStream(testFile)) {
        commands.push(command);
      }

      expect(commands).toHaveLength(2);
      expect(commands[0].command).toBe('echo "test1"');
      expect(commands[0].source).toBe('bash');
      expect(commands[1].command).toBe('echo "test2"');
      expect(commands[1].source).toBe('user');
    });

    it('should handle corrupted JSON lines gracefully', async () => {
      const jsonlContent = [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'echo "valid"' },
              },
            ],
          },
        }),
        '{ invalid json',
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: '<bash-input>echo "valid2"</bash-input>',
          },
        }),
      ].join('\n');

      const testFile = join(testDir, 'corrupted.jsonl');
      await writeFile(testFile, jsonlContent);

      const commands = [];
      for await (const command of parser.createFileStream(testFile)) {
        commands.push(command);
      }

      // Should skip corrupted line and continue
      expect(commands).toHaveLength(2);
      expect(commands[0].command).toBe('echo "valid"');
      expect(commands[1].command).toBe('echo "valid2"');
    });

    it('should handle empty files', async () => {
      const testFile = join(testDir, 'empty.jsonl');
      await writeFile(testFile, '');

      const commands = [];
      for await (const command of parser.createFileStream(testFile)) {
        commands.push(command);
      }

      expect(commands).toHaveLength(0);
    });
  });

  describe('createProjectStream', () => {
    it('should stream commands from multiple JSONL files in chronological order', async () => {
      // Create multiple files with different timestamps
      const file1Content = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'echo "first"' },
            },
          ],
        },
        timestamp: '2025-06-07T12:00:00.000Z',
      });

      const file2Content = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'echo "second"' },
            },
          ],
        },
        timestamp: '2025-06-07T12:01:00.000Z',
      });

      const file1 = join(testDir, 'file1.jsonl');
      const file2 = join(testDir, 'file2.jsonl');

      await writeFile(file1, file1Content);
      // Wait a bit to ensure different modification times
      await new Promise((resolve) => setTimeout(resolve, 10));
      await writeFile(file2, file2Content);

      const commands = [];
      for await (const command of parser.createProjectStream(testDir)) {
        commands.push(command);
      }

      expect(commands).toHaveLength(2);
      // Files should be processed in chronological order (by modification time)
      expect(commands[0].command).toBe('echo "first"');
      expect(commands[1].command).toBe('echo "second"');
    });

    it('should handle missing project directory', async () => {
      const nonExistentDir = join(testDir, 'nonexistent');

      const commands = [];
      for await (const command of parser.createProjectStream(nonExistentDir)) {
        commands.push(command);
      }

      expect(commands).toHaveLength(0);
    });
  });
});
