import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectDiscovery } from '../project-discovery.js';

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

      await mkdir(project1);
      await mkdir(project2);

      // Add some content to make them look like real projects
      await writeFile(join(project1, 'session1.jsonl'), '{}');
      await writeFile(join(project2, 'session2.jsonl'), '{}');

      const projects = await discovery.getAllProjects();

      expect(projects).toHaveLength(2);
      expect(projects.map((p) => p.name)).toContain('/Users/test/project1');
      expect(projects.map((p) => p.name)).toContain('/Users/test/project2');
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

      await mkdir(project1);
      await writeFile(join(project1, 'test.jsonl'), '{}');

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await mkdir(project2);
      await writeFile(join(project2, 'test.jsonl'), '{}');

      const projects = await discovery.getAllProjects();

      expect(projects).toHaveLength(2);
      // Most recent should be first
      expect(projects[0].name).toBe('/Users/test/new');
      expect(projects[1].name).toBe('/Users/test/old');
    });

    it('should handle access errors gracefully', async () => {
      // Create a non-directory file to test error handling
      await writeFile(join(testClaudeDir, 'not-a-directory'), 'content');

      const projects = await discovery.getAllProjects();
      expect(projects).toEqual([]);
    });
  });

  describe('getCurrentProject', () => {
    it('should return current project if it exists', async () => {
      const currentDir = process.cwd();
      const encodedCurrentDir = currentDir.replace(/\//g, '-');
      const projectDir = join(testClaudeDir, encodedCurrentDir);

      await mkdir(projectDir);
      await writeFile(join(projectDir, 'test.jsonl'), '{}');

      const project = await discovery.getCurrentProject();

      expect(project).toBeTruthy();
      expect(project?.name).toBe(currentDir);
      expect(project?.encodedName).toBe(encodedCurrentDir);
    });

    it('should return null if current project does not exist', async () => {
      const project = await discovery.getCurrentProject();
      expect(project).toBeNull();
    });
  });

  describe('getProject', () => {
    beforeEach(async () => {
      // Set up test projects
      const projects = [
        '-Users-test-my-app',
        '-Users-test-another-project',
        '-Users-different-path-myapp',
      ];

      for (const project of projects) {
        const projectDir = join(testClaudeDir, project);
        await mkdir(projectDir);
        await writeFile(join(projectDir, 'test.jsonl'), '{}');
      }
    });

    it('should find project by exact encoded name match', async () => {
      const project = await discovery.getProject('-Users-test-my-app');

      expect(project).toBeTruthy();
      expect(project?.encodedName).toBe('-Users-test-my-app');
      expect(project?.name).toBe('/Users/test/my/app');
    });

    it('should find project by exact decoded name match', async () => {
      const project = await discovery.getProject('/Users/test/my/app');

      expect(project).toBeTruthy();
      expect(project?.name).toBe('/Users/test/my/app');
    });

    it('should find project by partial name match', async () => {
      const project = await discovery.getProject('my-app');

      expect(project).toBeTruthy();
      expect(project?.name).toBe('/Users/test/my/app');
    });

    it('should return null for non-existent project', async () => {
      const project = await discovery.getProject('non-existent');
      expect(project).toBeNull();
    });

    it('should throw error for ambiguous matches', async () => {
      // 'test' should match both 'my-app' and 'another-project' (in partial matching)
      await expect(discovery.getProject('test')).rejects.toThrow(
        'Please be more specific'
      );
    });

    it('should prefer exact directory name match over partial matches', async () => {
      // Set up projects that would cause the real-world issue
      const projects = [
        '-Users-test-codetracker',
        '-Users-test-codetracker-vespa-app',
      ];

      for (const project of projects) {
        const projectDir = join(testClaudeDir, project);
        await mkdir(projectDir);
        await writeFile(join(projectDir, 'test.jsonl'), '{}');
      }

      // This should find exact match for "codetracker" directory, not be ambiguous
      const project = await discovery.getProject('codetracker');

      expect(project).toBeTruthy();
      expect(project?.name).toBe('/Users/test/codetracker'); // Exact match, not the vespa/app one
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
