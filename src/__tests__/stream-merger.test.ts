import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ProjectInfo, StreamMerger } from '../stream-merger.js';
import type { ClaudeCommand } from '../types.js';

// Mock the resilient command stream
vi.mock('../jsonl-stream-parser.js', () => ({
  JSONLStreamParser: vi.fn(),
  createResilientCommandStream: vi.fn(),
}));

describe('StreamMerger', () => {
  let merger: StreamMerger;

  beforeEach(() => {
    merger = new StreamMerger();
    vi.clearAllMocks();
  });

  // Helper to create async generator from array
  async function* createMockStream(
    commands: ClaudeCommand[]
  ): AsyncGenerator<ClaudeCommand> {
    for (const command of commands) {
      yield command;
    }
  }

  // Helper to create test command
  function createCommand(
    command: string,
    timestamp: string,
    projectPath?: string
  ): ClaudeCommand {
    return {
      timestamp: new Date(timestamp),
      command,
      source: 'bash' as const,
      projectPath,
    };
  }

  describe('chronologicalMerge', () => {
    it('should handle empty streams array', async () => {
      const result = [];
      for await (const command of merger.chronologicalMerge([])) {
        result.push(command);
      }
      expect(result).toHaveLength(0);
    });

    it('should pass through single stream unchanged', async () => {
      const commands = [
        createCommand('echo 1', '2025-06-07T12:00:00.000Z'),
        createCommand('echo 2', '2025-06-07T12:01:00.000Z'),
      ];

      const streams = [createMockStream(commands)];
      const result = [];

      for await (const command of merger.chronologicalMerge(streams)) {
        result.push(command);
      }

      expect(result).toHaveLength(2);
      expect(result[0].command).toBe('echo 1');
      expect(result[1].command).toBe('echo 2');
    });

    it('should merge two streams chronologically', async () => {
      const stream1Commands = [
        createCommand('echo 1', '2025-06-07T12:00:00.000Z'),
        createCommand('echo 3', '2025-06-07T12:02:00.000Z'),
        createCommand('echo 5', '2025-06-07T12:04:00.000Z'),
      ];

      const stream2Commands = [
        createCommand('echo 2', '2025-06-07T12:01:00.000Z'),
        createCommand('echo 4', '2025-06-07T12:03:00.000Z'),
        createCommand('echo 6', '2025-06-07T12:05:00.000Z'),
      ];

      const streams = [
        createMockStream(stream1Commands),
        createMockStream(stream2Commands),
      ];

      const result = [];
      for await (const command of merger.chronologicalMerge(streams)) {
        result.push(command);
      }

      expect(result).toHaveLength(6);
      expect(result.map((c) => c.command)).toEqual([
        'echo 1',
        'echo 2',
        'echo 3',
        'echo 4',
        'echo 5',
        'echo 6',
      ]);
    });

    it('should handle streams of different lengths', async () => {
      const stream1Commands = [
        createCommand('echo 1', '2025-06-07T12:00:00.000Z'),
        createCommand('echo 3', '2025-06-07T12:02:00.000Z'),
      ];

      const stream2Commands = [
        createCommand('echo 2', '2025-06-07T12:01:00.000Z'),
        createCommand('echo 4', '2025-06-07T12:03:00.000Z'),
        createCommand('echo 5', '2025-06-07T12:04:00.000Z'),
        createCommand('echo 6', '2025-06-07T12:05:00.000Z'),
      ];

      const streams = [
        createMockStream(stream1Commands),
        createMockStream(stream2Commands),
      ];

      const result = [];
      for await (const command of merger.chronologicalMerge(streams)) {
        result.push(command);
      }

      expect(result).toHaveLength(6);
      expect(result.map((c) => c.command)).toEqual([
        'echo 1',
        'echo 2',
        'echo 3',
        'echo 4',
        'echo 5',
        'echo 6',
      ]);
    });

    it('should handle three streams', async () => {
      const stream1Commands = [
        createCommand('echo 1', '2025-06-07T12:00:00.000Z'),
        createCommand('echo 4', '2025-06-07T12:03:00.000Z'),
      ];

      const stream2Commands = [
        createCommand('echo 2', '2025-06-07T12:01:00.000Z'),
        createCommand('echo 5', '2025-06-07T12:04:00.000Z'),
      ];

      const stream3Commands = [
        createCommand('echo 3', '2025-06-07T12:02:00.000Z'),
        createCommand('echo 6', '2025-06-07T12:05:00.000Z'),
      ];

      const streams = [
        createMockStream(stream1Commands),
        createMockStream(stream2Commands),
        createMockStream(stream3Commands),
      ];

      const result = [];
      for await (const command of merger.chronologicalMerge(streams)) {
        result.push(command);
      }

      expect(result).toHaveLength(6);
      expect(result.map((c) => c.command)).toEqual([
        'echo 1',
        'echo 2',
        'echo 3',
        'echo 4',
        'echo 5',
        'echo 6',
      ]);
    });

    it('should handle empty streams mixed with non-empty streams', async () => {
      const stream1Commands = [
        createCommand('echo 1', '2025-06-07T12:00:00.000Z'),
        createCommand('echo 2', '2025-06-07T12:01:00.000Z'),
      ];

      const emptyStream: ClaudeCommand[] = [];

      const streams = [
        createMockStream(stream1Commands),
        createMockStream(emptyStream),
      ];

      const result = [];
      for await (const command of merger.chronologicalMerge(streams)) {
        result.push(command);
      }

      expect(result).toHaveLength(2);
      expect(result.map((c) => c.command)).toEqual(['echo 1', 'echo 2']);
    });

    it('should handle streams with identical timestamps', async () => {
      const stream1Commands = [
        createCommand('echo 1', '2025-06-07T12:00:00.000Z'),
        createCommand('echo 3', '2025-06-07T12:01:00.000Z'),
      ];

      const stream2Commands = [
        createCommand('echo 2', '2025-06-07T12:00:00.000Z'),
        createCommand('echo 4', '2025-06-07T12:01:00.000Z'),
      ];

      const streams = [
        createMockStream(stream1Commands),
        createMockStream(stream2Commands),
      ];

      const result = [];
      for await (const command of merger.chronologicalMerge(streams)) {
        result.push(command);
      }

      expect(result).toHaveLength(4);
      // When timestamps are identical, the order depends on which stream is processed first
      // The important thing is that all commands are included
      expect(result.map((c) => c.command).sort()).toEqual([
        'echo 1',
        'echo 2',
        'echo 3',
        'echo 4',
      ]);
    });
  });

  describe('mergeProjectStreams', () => {
    it('should handle empty projects array', async () => {
      const projects: ProjectInfo[] = [];

      const result = [];
      for await (const command of merger.mergeProjectStreams(projects)) {
        result.push(command);
      }

      expect(result).toHaveLength(0);
    });

    it('should handle single project', async () => {
      const { createResilientCommandStream } = await import(
        '../jsonl-stream-parser.js'
      );

      const mockCommands = [
        createCommand('echo 1', '2025-06-07T12:00:00.000Z'),
        createCommand('echo 2', '2025-06-07T12:01:00.000Z'),
      ];

      vi.mocked(createResilientCommandStream).mockReturnValue(
        createMockStream(mockCommands)
      );

      const projects: ProjectInfo[] = [
        {
          name: 'project1',
          actualPath: '/Users/test/project1',
          claudePath: '/home/.claude/projects/-Users-test-project1',
          encodedName: '-Users-test-project1',
          lastModified: new Date(),
        },
      ];

      const result = [];
      for await (const command of merger.mergeProjectStreams(projects)) {
        result.push(command);
      }

      expect(result).toHaveLength(2);
      expect(result[0].command).toBe('echo 1');
      expect(result[1].command).toBe('echo 2');
      expect(createResilientCommandStream).toHaveBeenCalledWith(
        projects[0].claudePath
      );
    });

    it('should merge multiple projects chronologically', async () => {
      const { createResilientCommandStream } = await import(
        '../jsonl-stream-parser.js'
      );

      const project1Commands = [
        createCommand(
          'echo 1',
          '2025-06-07T12:00:00.000Z',
          '/Users/test/project1'
        ),
        createCommand(
          'echo 3',
          '2025-06-07T12:02:00.000Z',
          '/Users/test/project1'
        ),
      ];

      const project2Commands = [
        createCommand(
          'echo 2',
          '2025-06-07T12:01:00.000Z',
          '/Users/test/project2'
        ),
        createCommand(
          'echo 4',
          '2025-06-07T12:03:00.000Z',
          '/Users/test/project2'
        ),
      ];

      // Mock createResilientCommandStream to return different streams based on path
      vi.mocked(createResilientCommandStream).mockImplementation(
        (path: string) => {
          if (path === '/home/.claude/projects/-Users-test-project1') {
            return createMockStream(project1Commands);
          }
          if (path === '/home/.claude/projects/-Users-test-project2') {
            return createMockStream(project2Commands);
          }
          return createMockStream([]);
        }
      );

      const projects: ProjectInfo[] = [
        {
          name: 'project1',
          actualPath: '/Users/test/project1',
          claudePath: '/home/.claude/projects/-Users-test-project1',
          encodedName: '-Users-test-project1',
          lastModified: new Date(),
        },
        {
          name: 'project2',
          actualPath: '/Users/test/project2',
          claudePath: '/home/.claude/projects/-Users-test-project2',
          encodedName: '-Users-test-project2',
          lastModified: new Date(),
        },
      ];

      const result = [];
      for await (const command of merger.mergeProjectStreams(projects)) {
        result.push(command);
      }

      expect(result).toHaveLength(4);
      expect(result.map((c) => c.command)).toEqual([
        'echo 1',
        'echo 2',
        'echo 3',
        'echo 4',
      ]);
    });
  });

  describe('createSortedBuffer', () => {
    it('should sort commands from multiple streams', async () => {
      const stream1Commands = [
        createCommand('echo 3', '2025-06-07T12:02:00.000Z'),
        createCommand('echo 1', '2025-06-07T12:00:00.000Z'),
      ];

      const stream2Commands = [
        createCommand('echo 4', '2025-06-07T12:03:00.000Z'),
        createCommand('echo 2', '2025-06-07T12:01:00.000Z'),
      ];

      const streams = [
        createMockStream(stream1Commands),
        createMockStream(stream2Commands),
      ];

      const result = [];
      for await (const command of merger.createSortedBuffer(streams, 10)) {
        result.push(command);
      }

      expect(result).toHaveLength(4);
      expect(result.map((c) => c.command)).toEqual([
        'echo 1',
        'echo 2',
        'echo 3',
        'echo 4',
      ]);
    });

    it('should handle empty streams', async () => {
      const streams = [createMockStream([])];

      const result = [];
      for await (const command of merger.createSortedBuffer(streams, 10)) {
        result.push(command);
      }

      expect(result).toHaveLength(0);
    });

    it('should respect buffer size', async () => {
      const commands = Array.from({ length: 25 }, (_, i) =>
        createCommand(
          `echo ${i}`,
          `2025-06-07T12:${i.toString().padStart(2, '0')}:00.000Z`
        )
      );

      const streams = [createMockStream(commands)];
      const result = [];

      for await (const command of merger.createSortedBuffer(streams, 10)) {
        result.push(command);
      }

      expect(result).toHaveLength(25);
      expect(result.map((c) => c.command)).toEqual(
        commands.map((c) => c.command)
      );
    });
  });

  describe('error handling', () => {
    it('should handle stream errors gracefully in chronological merge', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      async function* errorStream(): AsyncGenerator<ClaudeCommand> {
        yield createCommand('echo 1', '2025-06-07T12:00:00.000Z');
        throw new Error('Stream error');
      }

      const goodStream = createMockStream([
        createCommand('echo 2', '2025-06-07T12:01:00.000Z'),
      ]);

      const streams = [errorStream(), goodStream];
      const result = [];

      for await (const command of merger.chronologicalMerge(streams)) {
        result.push(command);
      }

      expect(result).toHaveLength(2);
      expect(result.map((c) => c.command)).toEqual(['echo 1', 'echo 2']);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle initialization errors', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      async function* errorStream(): AsyncGenerator<ClaudeCommand> {
        throw new Error('Initialization error');
      }

      const goodStream = createMockStream([
        createCommand('echo 1', '2025-06-07T12:00:00.000Z'),
      ]);

      const streams = [errorStream(), goodStream];
      const result = [];

      for await (const command of merger.chronologicalMerge(streams)) {
        result.push(command);
      }

      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('echo 1');
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
