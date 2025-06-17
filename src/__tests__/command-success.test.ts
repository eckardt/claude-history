import { describe, expect, it } from 'vitest';
import { JSONLStreamParser } from '../jsonl-stream-parser.js';
import type { ClaudeCommand } from '../types.js';

describe('Command Success Tracking', () => {
  const parser = new JSONLStreamParser();

  it('should track command success based on tool result is_error field', async () => {
    // Create a mock JSONL content with successful and failed commands
    const jsonlContent = [
      // Successful "true" command
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_01HRSTz5AS7B8XadmwBQgo9w',
              name: 'Bash',
              input: {
                command: 'true',
                description: 'Run the true command (no-op)',
              },
            },
          ],
        },
        timestamp: '2025-06-17T10:08:01.597Z',
        cwd: '/Users/test/dev/cchistory',
      }),
      // Tool result for successful command
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              tool_use_id: 'toolu_01HRSTz5AS7B8XadmwBQgo9w',
              type: 'tool_result',
              content: '',
              is_error: false,
            },
          ],
        },
        timestamp: '2025-06-17T10:08:04.628Z',
      }),
      // Failed "false" command
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_01LwzHSRHwCxCZwzy7xqqE4u',
              name: 'Bash',
              input: {
                command: 'false',
                description: 'Run the false command (always fails)',
              },
            },
          ],
        },
        timestamp: '2025-06-17T10:08:13.023Z',
        cwd: '/Users/test/dev/cchistory',
      }),
      // Tool result for failed command
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              content: 'Error',
              is_error: true,
              tool_use_id: 'toolu_01LwzHSRHwCxCZwzy7xqqE4u',
            },
          ],
        },
        timestamp: '2025-06-17T10:08:18.075Z',
      }),
    ].join('\n');

    // Process through streaming parser
    const commands: ClaudeCommand[] = [];
    const lines = jsonlContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('"Bash"') || line.includes('tool_result')) {
        const generator = (
          parser as unknown as {
            processEntry: (
              line: string,
              lineNumber: number,
              filePath: string
            ) => AsyncGenerator<ClaudeCommand>;
          }
        ).processEntry(line, i + 1, 'test.jsonl');
        for await (const command of generator) {
          commands.push(command);
        }
      }
    }

    // Flush any remaining pending commands
    const pendingGenerator = (
      parser as unknown as {
        flushPendingCommands: () => Generator<ClaudeCommand>;
      }
    ).flushPendingCommands();
    for (const command of pendingGenerator) {
      commands.push(command);
    }

    // Verify we got both commands with correct success values
    expect(commands).toHaveLength(2);

    const trueCommand = commands.find((cmd) => cmd.command === 'true');
    const falseCommand = commands.find((cmd) => cmd.command === 'false');

    expect(trueCommand).toBeTruthy();
    expect(trueCommand.success).toBe(true);

    expect(falseCommand).toBeTruthy();
    expect(falseCommand.success).toBe(false);
  });

  it('should handle missing tool results gracefully', async () => {
    const jsonlContent = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_orphaned_command',
            name: 'Bash',
            input: {
              command: 'ls -la',
              description: 'List files',
            },
          },
        ],
      },
      timestamp: '2025-06-17T10:08:01.597Z',
      cwd: '/Users/test/dev/cchistory',
    });

    const commands: ClaudeCommand[] = [];

    // Process the tool use entry
    const generator = (
      parser as unknown as {
        processEntry: (
          line: string,
          lineNumber: number,
          filePath: string
        ) => AsyncGenerator<ClaudeCommand>;
      }
    ).processEntry(jsonlContent, 1, 'test.jsonl');
    for await (const command of generator) {
      commands.push(command);
    }

    // Flush pending commands (this should yield the orphaned command with success=true)
    const pendingGenerator = (
      parser as unknown as {
        flushPendingCommands: () => Generator<ClaudeCommand>;
      }
    ).flushPendingCommands();
    for (const command of pendingGenerator) {
      commands.push(command);
    }

    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command.command).toBe('ls -la');
    expect(command.success).toBe(true); // Should default to true for orphaned commands
  });

  it('should match tool uses with results by ID even when not sequential', async () => {
    // Create JSONL content with commands and results in non-sequential order
    const jsonlContent = [
      // First tool use
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_first',
              name: 'Bash',
              input: { command: 'echo "first"' },
            },
          ],
        },
        timestamp: '2025-06-17T10:08:01.597Z',
      }),
      // Second tool use
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_second',
              name: 'Bash',
              input: { command: 'echo "second"' },
            },
          ],
        },
        timestamp: '2025-06-17T10:08:02.597Z',
      }),
      // Result for second command (comes first)
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              tool_use_id: 'toolu_second',
              type: 'tool_result',
              is_error: true,
            },
          ],
        },
        timestamp: '2025-06-17T10:08:03.597Z',
      }),
      // Result for first command (comes second)
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              tool_use_id: 'toolu_first',
              type: 'tool_result',
              is_error: false,
            },
          ],
        },
        timestamp: '2025-06-17T10:08:04.597Z',
      }),
    ].join('\n');

    const commands: ClaudeCommand[] = [];
    const lines = jsonlContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('"Bash"') || line.includes('tool_result')) {
        const generator = (
          parser as unknown as {
            processEntry: (
              line: string,
              lineNumber: number,
              filePath: string
            ) => AsyncGenerator<ClaudeCommand>;
          }
        ).processEntry(line, i + 1, 'test.jsonl');
        for await (const command of generator) {
          commands.push(command);
        }
      }
    }

    // Should have exactly 2 commands with correct success values
    expect(commands).toHaveLength(2);

    const firstCommand = commands.find((cmd) => cmd.command === 'echo "first"');
    const secondCommand = commands.find(
      (cmd) => cmd.command === 'echo "second"'
    );

    expect(firstCommand).toBeTruthy();
    expect(firstCommand.success).toBe(true); // matches result1 (is_error: false)

    expect(secondCommand).toBeTruthy();
    expect(secondCommand.success).toBe(false); // matches result2 (is_error: true)
  });
});
