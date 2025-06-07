import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputFormatter, type ProjectInfo } from '../output-formatter.js';
import type { ClaudeCommand } from '../types.js';

// Mock process.stdout.write
const mockStdoutWrite = vi.fn();
const originalStdoutWrite = process.stdout.write;

describe('OutputFormatter', () => {
  let formatter: OutputFormatter;

  beforeEach(() => {
    formatter = new OutputFormatter();
    mockStdoutWrite.mockClear();
    // Replace process.stdout.write with our mock
    process.stdout.write = mockStdoutWrite as typeof process.stdout.write;
  });

  afterEach(() => {
    // Restore original stdout.write
    process.stdout.write = originalStdoutWrite;
    vi.clearAllMocks();
  });

  describe('formatCommandLine', () => {
    it('should format single project command correctly', () => {
      const command: ClaudeCommand = {
        timestamp: new Date('2025-06-07T12:00:00.000Z'),
        command: 'npm install commander',
        source: 'bash',
        projectPath: '/Users/test/project',
      };

      const result = formatter.formatCommandLine(command, 1, false);
      expect(result).toBe('   1  npm install commander');
    });

    it('should format global command with project prefix', () => {
      const command: ClaudeCommand = {
        timestamp: new Date('2025-06-07T12:00:00.000Z'),
        command: 'npm test',
        source: 'user',
        projectPath: '/Users/test/my-awesome-project',
      };

      const result = formatter.formatCommandLine(command, 42, true);
      expect(result).toBe('  42  [my-awesome-project] npm test');
    });

    it('should format global command with project path containing hyphens', () => {
      const command: ClaudeCommand = {
        timestamp: new Date('2025-06-07T12:00:00.000Z'),
        command: 'git status',
        source: 'bash',
        projectPath: '/Users/test/my-awesome-app',
      };

      const result = formatter.formatCommandLine(command, 5, true);
      expect(result).toBe('   5  [my-awesome-app ] git status');
    });

    it('should handle global command without project path', () => {
      const command: ClaudeCommand = {
        timestamp: new Date('2025-06-07T12:00:00.000Z'),
        command: 'echo hello',
        source: 'bash',
      };

      const result = formatter.formatCommandLine(command, 1, true);
      expect(result).toBe('   1  echo hello');
    });

    it('should pad index numbers correctly', () => {
      const command: ClaudeCommand = {
        timestamp: new Date('2025-06-07T12:00:00.000Z'),
        command: 'test',
        source: 'bash',
      };

      expect(formatter.formatCommandLine(command, 1, false)).toBe('   1  test');
      expect(formatter.formatCommandLine(command, 10, false)).toBe(
        '  10  test'
      );
      expect(formatter.formatCommandLine(command, 100, false)).toBe(
        ' 100  test'
      );
      expect(formatter.formatCommandLine(command, 1000, false)).toBe(
        '1000  test'
      );
    });

    it('should pad project names in global view', () => {
      const command: ClaudeCommand = {
        timestamp: new Date('2025-06-07T12:00:00.000Z'),
        command: 'test',
        source: 'bash',
        projectPath: '/Users/test/app',
      };

      const result = formatter.formatCommandLine(command, 1, true);
      expect(result).toBe('   1  [app            ] test');
    });
  });

  describe('formatProjectList', () => {
    it('should format empty project list', () => {
      const projects: ProjectInfo[] = [];
      const result = formatter.formatProjectList(projects);
      expect(result).toBe('No Claude projects found in ~/.claude/projects/');
    });

    it('should format single project', () => {
      const projects: ProjectInfo[] = [
        {
          name: 'my-project',
          actualPath: '/Users/test/my-project',
          claudePath: '/home/.claude/projects/-Users-test-my-project',
          encodedName: '-Users-test-my-project',
          lastModified: new Date(),
        },
      ];

      const result = formatter.formatProjectList(projects);
      expect(result).toBe('my-project           (/Users/test/my-project)');
    });

    it('should format multiple projects', () => {
      const projects: ProjectInfo[] = [
        {
          name: 'codetracker',
          actualPath: '/Users/test/codetracker',
          claudePath: '/home/.claude/projects/-Users-test-codetracker',
          encodedName: '-Users-test-codetracker',
          lastModified: new Date('2025-06-07T12:01:00.000Z'),
        },
        {
          name: 'app',
          actualPath: '/Users/test/app',
          claudePath: '/home/.claude/projects/-Users-test-app',
          encodedName: '-Users-test-app',
          lastModified: new Date('2025-06-07T12:00:00.000Z'),
        },
      ];

      const result = formatter.formatProjectList(projects);
      const lines = result.split('\n');

      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('codetracker          (/Users/test/codetracker)');
      expect(lines[1]).toBe('app                  (/Users/test/app)');
    });

    it('should handle project names with various lengths', () => {
      const projects: ProjectInfo[] = [
        {
          name: 'very-long-project-name-here',
          actualPath: '/Users/test/very-long-project-name-here',
          claudePath:
            '/home/.claude/projects/-Users-test-very-long-project-name-here',
          encodedName: '-Users-test-very-long-project-name-here',
          lastModified: new Date(),
        },
        {
          name: 'x',
          actualPath: '/Users/test/x',
          claudePath: '/home/.claude/projects/-Users-test-x',
          encodedName: '-Users-test-x',
          lastModified: new Date(),
        },
      ];

      const result = formatter.formatProjectList(projects);
      const lines = result.split('\n');

      expect(lines[0]).toContain('very-long-project-name-here');
      expect(lines[1]).toContain('x                   ');
    });
  });

  describe('writeLineWithSigpipeCheck', () => {
    it('should write line successfully', () => {
      mockStdoutWrite.mockReturnValue(true);

      const result = formatter.writeLineWithSigpipeCheck('test line');

      expect(result).toBe(true);
      expect(mockStdoutWrite).toHaveBeenCalledWith('test line\n');
    });

    it('should handle EPIPE error (broken pipe)', () => {
      const epipeError = new Error('EPIPE') as NodeJS.ErrnoException;
      epipeError.code = 'EPIPE';
      mockStdoutWrite.mockImplementation(() => {
        throw epipeError;
      });

      const result = formatter.writeLineWithSigpipeCheck('test line');

      expect(result).toBe(false);
      expect(formatter.isSigpipeDetected()).toBe(true);
    });

    it('should handle other stdout errors', () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const otherError = new Error('Some other error');
      mockStdoutWrite.mockImplementation(() => {
        throw otherError;
      });

      const result = formatter.writeLineWithSigpipeCheck('test line');

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error writing to stdout: Some other error',
        { file: 'stderr' }
      );

      consoleErrorSpy.mockRestore();
    });

    it('should return false immediately after SIGPIPE detected', () => {
      // First call triggers EPIPE
      const epipeError = new Error('EPIPE') as NodeJS.ErrnoException;
      epipeError.code = 'EPIPE';
      mockStdoutWrite.mockImplementationOnce(() => {
        throw epipeError;
      });

      const firstResult = formatter.writeLineWithSigpipeCheck('first line');
      expect(firstResult).toBe(false);
      expect(formatter.isSigpipeDetected()).toBe(true);

      // Second call should return false immediately without calling stdout.write
      mockStdoutWrite.mockClear();
      const secondResult = formatter.writeLineWithSigpipeCheck('second line');
      expect(secondResult).toBe(false);
      expect(mockStdoutWrite).not.toHaveBeenCalled();
    });
  });

  describe('isSigpipeDetected', () => {
    it('should return false initially', () => {
      expect(formatter.isSigpipeDetected()).toBe(false);
    });

    it('should return true after SIGPIPE detected', () => {
      const epipeError = new Error('EPIPE') as NodeJS.ErrnoException;
      epipeError.code = 'EPIPE';
      mockStdoutWrite.mockImplementation(() => {
        throw epipeError;
      });

      formatter.writeLineWithSigpipeCheck('test');
      expect(formatter.isSigpipeDetected()).toBe(true);
    });
  });

  describe('resetSigpipeState', () => {
    it('should reset SIGPIPE detection state', () => {
      // Trigger SIGPIPE
      const epipeError = new Error('EPIPE') as NodeJS.ErrnoException;
      epipeError.code = 'EPIPE';
      mockStdoutWrite.mockImplementation(() => {
        throw epipeError;
      });

      formatter.writeLineWithSigpipeCheck('test');
      expect(formatter.isSigpipeDetected()).toBe(true);

      // Reset state
      formatter.resetSigpipeState();
      expect(formatter.isSigpipeDetected()).toBe(false);
    });
  });

  describe('extractProjectName (private method behavior)', () => {
    it('should extract project name from regular paths', () => {
      const command: ClaudeCommand = {
        timestamp: new Date(),
        command: 'test',
        source: 'bash',
        projectPath: '/Users/test/dev/codetracker',
      };

      const result = formatter.formatCommandLine(command, 1, true);
      expect(result).toContain('[codetracker    ]');
    });

    it('should extract project name from paths with hyphens', () => {
      const command: ClaudeCommand = {
        timestamp: new Date(),
        command: 'test',
        source: 'bash',
        projectPath: '/Users/test/dev/claude-history',
      };

      const result = formatter.formatCommandLine(command, 1, true);
      expect(result).toContain('[claude-history ]');
    });

    it('should handle paths with no directory separators', () => {
      const command: ClaudeCommand = {
        timestamp: new Date(),
        command: 'test',
        source: 'bash',
        projectPath: 'standalone-project',
      };

      const result = formatter.formatCommandLine(command, 1, true);
      expect(result).toContain('[standalone-project]');
    });

    it('should handle empty project paths', () => {
      const command: ClaudeCommand = {
        timestamp: new Date(),
        command: 'test',
        source: 'bash',
        projectPath: '',
      };

      const result = formatter.formatCommandLine(command, 1, true);
      expect(result).toBe('   1  test'); // No project prefix for empty path
    });
  });
});
