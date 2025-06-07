import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all dependencies
vi.mock('../project-discovery.js');
vi.mock('../stream-merger.js');
vi.mock('../output-formatter.js');
vi.mock('../jsonl-stream-parser.js');

// Import the functions we want to test
import {
  createCommandStream,
  handleListProjects,
  processCommandStream,
} from '../cli.js';
import { createResilientCommandStream } from '../jsonl-stream-parser.js';
import { OutputFormatter } from '../output-formatter.js';
import { ProjectDiscovery } from '../project-discovery.js';
import type { ProjectInfo } from '../project-discovery.js';
import { StreamMerger } from '../stream-merger.js';
import type { CLIOptions, ClaudeCommand } from '../types.js';

// Create properly typed mock instances
type MockedProjectDiscovery = {
  getAllProjects: ReturnType<typeof vi.fn>;
  getProject: ReturnType<typeof vi.fn>;
  getCurrentProject?: ReturnType<typeof vi.fn>;
};

type MockedOutputFormatter = {
  formatProjectList: ReturnType<typeof vi.fn>;
  formatCommandLine: ReturnType<typeof vi.fn>;
  writeLineWithSigpipeCheck: ReturnType<typeof vi.fn>;
};

type MockedStreamMerger = {
  mergeProjectStreams: ReturnType<typeof vi.fn>;
};

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const _mockConsoleError = vi
  .spyOn(console, 'error')
  .mockImplementation(() => {});
const _mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit');
});

describe('CLI Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleListProjects', () => {
    it('should list projects and log formatted output', async () => {
      const mockProjects = [
        {
          name: 'project1',
          actualPath: '/Users/test/project1',
          claudePath: '/home/.claude/projects/-Users-test-project1',
          encodedName: '-Users-test-project1',
          lastModified: new Date(),
        },
      ];

      const mockDiscovery = {
        getAllProjects: vi.fn().mockResolvedValue(mockProjects),
      };
      const mockFormatter = {
        formatProjectList: vi
          .fn()
          .mockReturnValue('project1 (/Users/test/project1)'),
      };

      vi.mocked(ProjectDiscovery).mockImplementation(
        () => mockDiscovery as MockedProjectDiscovery
      );
      vi.mocked(OutputFormatter).mockImplementation(
        () => mockFormatter as MockedOutputFormatter
      );

      await handleListProjects();

      expect(mockDiscovery.getAllProjects).toHaveBeenCalled();
      expect(mockFormatter.formatProjectList).toHaveBeenCalledWith(
        mockProjects
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        'project1 (/Users/test/project1)'
      );
    });
  });

  describe('createCommandStream', () => {
    it('should return global stream when --global is set', async () => {
      const mockProjects = [
        {
          name: 'project1',
          actualPath: '/Users/test/project1',
          claudePath: '/home/.claude/projects/-Users-test-project1',
          encodedName: '-Users-test-project1',
          lastModified: new Date(),
        },
      ];

      const mockStream = (async function* () {
        yield {
          timestamp: new Date(),
          command: 'test',
          source: 'bash' as const,
        };
      })();

      const mockDiscovery = {
        getAllProjects: vi.fn().mockResolvedValue(mockProjects),
      };
      const mockStreamMerger = {
        mergeProjectStreams: vi.fn().mockReturnValue(mockStream),
      };

      vi.mocked(ProjectDiscovery).mockImplementation(
        () => mockDiscovery as MockedProjectDiscovery
      );
      vi.mocked(StreamMerger).mockImplementation(
        () => mockStreamMerger as MockedStreamMerger
      );

      const options: CLIOptions = { global: true };

      const result = await createCommandStream(undefined, options);

      expect(mockDiscovery.getAllProjects).toHaveBeenCalled();
      expect(mockStreamMerger.mergeProjectStreams).toHaveBeenCalledWith(
        mockProjects
      );
      expect(result.isGlobal).toBe(true);
    });

    it('should return single project stream when project is found', async () => {
      const mockProject = {
        name: 'project1',
        actualPath: '/Users/test/project1',
        claudePath: '/home/.claude/projects/-Users-test-project1',
        encodedName: '-Users-test-project1',
        lastModified: new Date(),
      };

      const mockStream = (async function* () {
        yield {
          timestamp: new Date(),
          command: 'test',
          source: 'bash' as const,
        };
      })();

      const mockDiscovery = {
        getProject: vi.fn().mockResolvedValue(mockProject),
      };

      vi.mocked(ProjectDiscovery).mockImplementation(
        () => mockDiscovery as MockedProjectDiscovery
      );
      vi.mocked(createResilientCommandStream).mockReturnValue(mockStream);

      const projectName = 'project1';
      const options: CLIOptions = {};

      const result = await createCommandStream(projectName, options);

      expect(mockDiscovery.getProject).toHaveBeenCalledWith(projectName);
      expect(createResilientCommandStream).toHaveBeenCalledWith(
        mockProject.claudePath
      );
      expect(result.isGlobal).toBe(false);
    });

    it('should fall back to global mode when no project found', async () => {
      const mockProjects = [
        {
          name: 'project1',
          actualPath: '/Users/test/project1',
          claudePath: '/home/.claude/projects/-Users-test-project1',
          encodedName: '-Users-test-project1',
          lastModified: new Date(),
        },
      ];

      const mockStream = (async function* () {
        yield {
          timestamp: new Date(),
          command: 'test',
          source: 'bash' as const,
        };
      })();

      const mockDiscovery = {
        getProject: vi.fn().mockResolvedValue(null),
        getAllProjects: vi.fn().mockResolvedValue(mockProjects),
      };
      const mockStreamMerger = {
        mergeProjectStreams: vi.fn().mockReturnValue(mockStream),
      };

      vi.mocked(ProjectDiscovery).mockImplementation(
        () => mockDiscovery as MockedProjectDiscovery
      );
      vi.mocked(StreamMerger).mockImplementation(
        () => mockStreamMerger as MockedStreamMerger
      );

      const projectName = 'nonexistent';
      const options: CLIOptions = {};

      await expect(createCommandStream(projectName, options)).rejects.toThrow(
        "Project 'nonexistent' not found"
      );
    });
  });

  describe('processCommandStream', () => {
    it('should process commands and output formatted lines', async () => {
      const mockCommands: ClaudeCommand[] = [
        {
          timestamp: new Date('2025-06-07T12:00:00.000Z'),
          command: 'npm install',
          source: 'bash',
          success: true,
        },
        {
          timestamp: new Date('2025-06-07T12:01:00.000Z'),
          command: 'npm test',
          source: 'user',
          success: true,
        },
      ];

      const mockStream = (async function* () {
        for (const command of mockCommands) {
          yield command;
        }
      })();

      const mockFormatter = {
        formatCommandLine: vi
          .fn()
          .mockReturnValueOnce('   1  npm install')
          .mockReturnValueOnce('   2  npm test'),
        writeLineWithSigpipeCheck: vi.fn().mockReturnValue(true),
      };

      vi.mocked(OutputFormatter).mockImplementation(
        () => mockFormatter as MockedOutputFormatter
      );

      const options: CLIOptions = {};
      const isGlobal = false;

      await processCommandStream(mockStream, options, isGlobal);

      expect(mockFormatter.formatCommandLine).toHaveBeenCalledTimes(2);
      expect(mockFormatter.formatCommandLine).toHaveBeenNthCalledWith(
        1,
        mockCommands[0],
        1,
        false
      );
      expect(mockFormatter.formatCommandLine).toHaveBeenNthCalledWith(
        2,
        mockCommands[1],
        2,
        false
      );
      expect(mockFormatter.writeLineWithSigpipeCheck).toHaveBeenCalledTimes(2);
    });

    it('should filter out failed commands when includeFailed is false', async () => {
      const mockCommands: ClaudeCommand[] = [
        {
          timestamp: new Date('2025-06-07T12:00:00.000Z'),
          command: 'npm install',
          source: 'bash',
          success: true,
        },
        {
          timestamp: new Date('2025-06-07T12:01:00.000Z'),
          command: 'npm test',
          source: 'bash',
          success: false,
        },
      ];

      const mockStream = (async function* () {
        for (const command of mockCommands) {
          yield command;
        }
      })();

      const mockFormatter = {
        formatCommandLine: vi.fn().mockReturnValue('   1  npm install'),
        writeLineWithSigpipeCheck: vi.fn().mockReturnValue(true),
      };

      vi.mocked(OutputFormatter).mockImplementation(
        () => mockFormatter as MockedOutputFormatter
      );

      const options: CLIOptions = { includeFailed: false };
      const isGlobal = false;

      await processCommandStream(mockStream, options, isGlobal);

      expect(mockFormatter.formatCommandLine).toHaveBeenCalledTimes(1);
      expect(mockFormatter.formatCommandLine).toHaveBeenCalledWith(
        mockCommands[0],
        1,
        false
      );
    });

    it('should respect count limit', async () => {
      const mockCommands: ClaudeCommand[] = [
        {
          timestamp: new Date('2025-06-07T12:00:00.000Z'),
          command: 'npm install',
          source: 'bash',
        },
        {
          timestamp: new Date('2025-06-07T12:01:00.000Z'),
          command: 'npm test',
          source: 'bash',
        },
        {
          timestamp: new Date('2025-06-07T12:02:00.000Z'),
          command: 'npm build',
          source: 'bash',
        },
      ];

      const mockStream = (async function* () {
        for (const command of mockCommands) {
          yield command;
        }
      })();

      const mockFormatter = {
        formatCommandLine: vi
          .fn()
          .mockReturnValueOnce('   1  npm install')
          .mockReturnValueOnce('   2  npm test'),
        writeLineWithSigpipeCheck: vi.fn().mockReturnValue(true),
      };

      vi.mocked(OutputFormatter).mockImplementation(
        () => mockFormatter as MockedOutputFormatter
      );

      const options: CLIOptions = { count: 2 };
      const isGlobal = false;

      await processCommandStream(mockStream, options, isGlobal);

      expect(mockFormatter.formatCommandLine).toHaveBeenCalledTimes(2);
    });

    it('should stop processing when SIGPIPE is detected', async () => {
      const mockCommands: ClaudeCommand[] = [
        {
          timestamp: new Date('2025-06-07T12:00:00.000Z'),
          command: 'npm install',
          source: 'bash',
        },
        {
          timestamp: new Date('2025-06-07T12:01:00.000Z'),
          command: 'npm test',
          source: 'bash',
        },
      ];

      const mockStream = (async function* () {
        for (const command of mockCommands) {
          yield command;
        }
      })();

      const mockFormatter = {
        formatCommandLine: vi.fn().mockReturnValue('   1  npm install'),
        writeLineWithSigpipeCheck: vi.fn().mockReturnValue(false), // SIGPIPE detected
      };

      vi.mocked(OutputFormatter).mockImplementation(
        () => mockFormatter as MockedOutputFormatter
      );

      const options: CLIOptions = {};
      const isGlobal = false;

      await expect(
        processCommandStream(mockStream, options, isGlobal)
      ).rejects.toThrow('process.exit');

      expect(mockFormatter.formatCommandLine).toHaveBeenCalledTimes(1);
      expect(mockFormatter.writeLineWithSigpipeCheck).toHaveBeenCalledTimes(1);
    });

    it('should exit with code 2 when no commands are found', async () => {
      const mockStream = (async function* () {
        // Empty stream
      })();

      const mockFormatter = {
        formatCommandLine: vi.fn(),
        writeLineWithSigpipeCheck: vi.fn(),
      };

      vi.mocked(OutputFormatter).mockImplementation(
        () => mockFormatter as MockedOutputFormatter
      );

      const options: CLIOptions = {};
      const isGlobal = false;

      await expect(
        processCommandStream(mockStream, options, isGlobal)
      ).rejects.toThrow('process.exit');
    });
  });
});
