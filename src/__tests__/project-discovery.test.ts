import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectDiscovery } from '../project-discovery.js';

// Helper function to create mock JSONL files with proper cwd field
async function createMockProject(
  projectDir: string,
  actualPath: string,
  additionalEntries: unknown[] = []
) {
  await mkdir(projectDir, { recursive: true });

  const baseEntry = {
    cwd: actualPath,
    type: 'user',
    message: { role: 'user', content: [] },
    timestamp: new Date().toISOString(),
  };

  const entries = [baseEntry, ...additionalEntries];
  const jsonlContent = entries.map((entry) => JSON.stringify(entry)).join('\n');

  await writeFile(join(projectDir, 'session1.jsonl'), jsonlContent);
}

// Mock os.homedir to return our test directory
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(() => '/test-home'),
  };
});

describe('ProjectDiscovery', () => {
  let discovery: ProjectDiscovery;
  let testHomeDir: string;
  let testClaudeDir: string;

  beforeEach(async () => {
    testHomeDir = join(tmpdir(), `test-home-${Date.now()}`);
    testClaudeDir = join(testHomeDir, '.claude', 'projects');

    // Mock the homedir function to return our test directory
    const { homedir } = await import('node:os');
    vi.mocked(homedir).mockReturnValue(testHomeDir);

    discovery = new ProjectDiscovery();

    await mkdir(testClaudeDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testHomeDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('getAllProjects', () => {
    it('should return empty array when no projects exist', async () => {
      const projects = await discovery.getAllProjects();
      expect(projects).toEqual([]);
    });

    it('should return all project directories', async () => {
      // Create test project directories
      const project1 = join(testClaudeDir, '-Users-test-project1');
      const project2 = join(testClaudeDir, '-Users-test-project2');

      // Create mock projects with cwd field
      await createMockProject(project1, '/Users/test/project1');
      await createMockProject(project2, '/Users/test/project2');

      const projects = await discovery.getAllProjects();

      expect(projects).toHaveLength(2);
      expect(projects.map((p) => p.name)).toContain('project1');
      expect(projects.map((p) => p.name)).toContain('project2');
      expect(projects.map((p) => p.actualPath)).toContain(
        '/Users/test/project1'
      );
      expect(projects.map((p) => p.actualPath)).toContain(
        '/Users/test/project2'
      );
      expect(projects.map((p) => p.encodedName)).toContain(
        '-Users-test-project1'
      );
      expect(projects.map((p) => p.encodedName)).toContain(
        '-Users-test-project2'
      );
    });

    it('should sort projects by last modified (most recent first)', async () => {
      const project1 = join(testClaudeDir, '-Users-test-old');
      const project2 = join(testClaudeDir, '-Users-test-new');

      await createMockProject(project1, '/Users/test/old');

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await createMockProject(project2, '/Users/test/new');

      const projects = await discovery.getAllProjects();

      expect(projects).toHaveLength(2);
      // Most recent should be first
      expect(projects[0].name).toBe('new');
      expect(projects[1].name).toBe('old');
    });

    it('should handle access errors gracefully', async () => {
      // Create a non-directory file to test error handling
      await writeFile(join(testClaudeDir, 'not-a-directory'), 'content');

      const projects = await discovery.getAllProjects();
      expect(projects).toEqual([]);
    });
  });

  describe('getProject', () => {
    beforeEach(async () => {
      // Set up test projects with proper cwd fields
      const projects = [
        { encoded: '-Users-test-my-app', actual: '/Users/test/my/app' },
        {
          encoded: '-Users-test-another-project',
          actual: '/Users/test/another/project',
        },
        {
          encoded: '-Users-different-path-myapp',
          actual: '/Users/different/path/myapp',
        },
      ];

      for (const project of projects) {
        const projectDir = join(testClaudeDir, project.encoded);
        await createMockProject(projectDir, project.actual);
      }
    });

    it('should find project by exact encoded name match', async () => {
      const project = await discovery.getProject('-Users-test-my-app');

      expect(project).toBeTruthy();
      expect(project?.encodedName).toBe('-Users-test-my-app');
      expect(project?.actualPath).toBe('/Users/test/my/app');
      expect(project?.name).toBe('app'); // basename
    });

    it('should find project by exact decoded name match', async () => {
      const project = await discovery.getProject('app');

      expect(project).toBeTruthy();
      expect(project?.actualPath).toBe('/Users/test/my/app');
      expect(project?.name).toBe('app');
    });

    it('should find project by partial name match', async () => {
      const project = await discovery.getProject('my');

      expect(project).toBeTruthy();
      expect(project?.actualPath).toBe('/Users/test/my/app');
    });

    it('should return null for non-existent project', async () => {
      const project = await discovery.getProject('non-existent');
      expect(project).toBeNull();
    });

    it('should resolve ambiguous matches by preferring shorter path', async () => {
      // 'test' should match both paths, but prefer the shorter one
      const project = await discovery.getProject('test');

      expect(project).toBeTruthy();
      // Should get the shorter path (/Users/test/my/app vs /Users/test/another/project)
      expect(project?.actualPath).toBe('/Users/test/my/app');
    });

    it('should prefer exact directory name match over partial matches', async () => {
      // Set up projects that would cause the real-world issue
      const projects = [
        {
          encoded: '-Users-test-codetracker',
          actual: '/Users/test/codetracker',
        },
        {
          encoded: '-Users-test-codetracker-vespa-app',
          actual: '/Users/test/codetracker/vespa_app',
        },
      ];

      for (const project of projects) {
        const projectDir = join(testClaudeDir, project.encoded);
        await createMockProject(projectDir, project.actual);
      }

      // This should find exact match for "codetracker" directory, not be ambiguous
      const project = await discovery.getProject('codetracker');

      expect(project).toBeTruthy();
      expect(project?.actualPath).toBe('/Users/test/codetracker'); // Exact match, not the vespa_app one
      expect(project?.name).toBe('codetracker');
      expect(project?.encodedName).toBe('-Users-test-codetracker');
    });
  });

  describe('getProjectFiles', () => {
    it('should return all JSONL files in project directory', async () => {
      const projectDir = join(testClaudeDir, 'test-project');
      await mkdir(projectDir);

      // Create various files
      await writeFile(join(projectDir, 'session1.jsonl'), '{}');
      await writeFile(join(projectDir, 'session2.jsonl'), '{}');
      await writeFile(join(projectDir, 'not-jsonl.txt'), 'text');
      await writeFile(join(projectDir, 'another.jsonl'), '{}');

      const files = await discovery.getProjectFiles(projectDir);

      expect(files).toHaveLength(3);
      expect(files.every((file) => file.endsWith('.jsonl'))).toBe(true);
      expect(files.some((file) => file.includes('session1.jsonl'))).toBe(true);
      expect(files.some((file) => file.includes('session2.jsonl'))).toBe(true);
      expect(files.some((file) => file.includes('another.jsonl'))).toBe(true);
    });

    it('should return empty array for empty directory', async () => {
      const projectDir = join(testClaudeDir, 'empty-project');
      await mkdir(projectDir);

      const files = await discovery.getProjectFiles(projectDir);
      expect(files).toEqual([]);
    });

    it('should throw error for non-existent directory', async () => {
      const nonExistentDir = join(testClaudeDir, 'non-existent');

      await expect(discovery.getProjectFiles(nonExistentDir)).rejects.toThrow(
        'Cannot read project files'
      );
    });
  });

  describe('path encoding/decoding', () => {
    it('should encode and decode paths correctly', async () => {
      const originalPath = '/Users/test/my/project/with/subdirs';
      const encoded = originalPath.replace(/\//g, '-');
      const decoded = encoded.replace(/-/g, '/');

      expect(encoded).toBe('-Users-test-my-project-with-subdirs');
      expect(decoded).toBe(originalPath);
    });
  });
});
