import { access, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ProjectInfo {
  name: string;
  path: string;
  encodedName: string;
  lastModified: Date;
}

export class ProjectDiscovery {
  private claudeProjectsDir: string;

  constructor() {
    this.claudeProjectsDir = join(homedir(), '.claude', 'projects');
  }

  /**
   * Get all available Claude projects
   */
  async getAllProjects(): Promise<ProjectInfo[]> {
    try {
      const projectDirs = await readdir(this.claudeProjectsDir);
      const projects: ProjectInfo[] = [];

      for (const encodedName of projectDirs) {
        try {
          const projectPath = join(this.claudeProjectsDir, encodedName);
          const stats = await stat(projectPath);

          if (stats.isDirectory()) {
            projects.push({
              name: this.decodeProjectPath(encodedName),
              path: projectPath,
              encodedName,
              lastModified: stats.mtime,
            });
          }
        } catch {
          // Skip invalid project directories
        }
      }

      // Sort by last modified (most recent first)
      return projects.sort(
        (a, b) => b.lastModified.getTime() - a.lastModified.getTime()
      );
    } catch (error) {
      throw new Error(
        `Cannot access Claude projects directory: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get current project based on working directory
   */
  async getCurrentProject(): Promise<ProjectInfo | null> {
    const currentDir = process.cwd();
    const encodedPath = this.encodeProjectPath(currentDir);
    const projectPath = join(this.claudeProjectsDir, encodedPath);

    try {
      await access(projectPath);
      const stats = await stat(projectPath);

      return {
        name: currentDir,
        path: projectPath,
        encodedName: encodedPath,
        lastModified: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get project by name with fuzzy matching
   */
  async getProject(searchTerm: string): Promise<ProjectInfo | null> {
    const projects = await this.getAllProjects();

    // Exact match on encoded name
    let match = projects.find((p) => p.encodedName === searchTerm);
    if (match) return match;

    // Exact match on decoded name
    match = projects.find((p) => p.name === searchTerm);
    if (match) return match;

    // Exact match on directory name (last component of path)
    match = projects.find((p) => {
      const dirName = p.name.split('/').pop() || '';
      return dirName.toLowerCase() === searchTerm.toLowerCase();
    });
    if (match) return match;

    // Partial match on name (case insensitive)
    const matches = projects.filter(
      (p) =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.encodedName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (matches.length === 1) {
      return matches[0];
    }

    if (matches.length > 1) {
      console.error(`Multiple projects found matching '${searchTerm}':`);
      for (const match of matches) {
        console.error(`  ${match.name}`);
      }
      throw new Error('Please be more specific');
    }

    return null;
  }

  /**
   * Get all JSONL files for a project
   */
  async getProjectFiles(projectPath: string): Promise<string[]> {
    try {
      const files = await readdir(projectPath);
      return files
        .filter((file) => file.endsWith('.jsonl'))
        .map((file) => join(projectPath, file));
    } catch (error) {
      throw new Error(`Cannot read project files: ${(error as Error).message}`);
    }
  }

  /**
   * Encode file path to Claude project directory name
   */
  private encodeProjectPath(path: string): string {
    return path.replace(/\//g, '-');
  }

  /**
   * Decode Claude project directory name to file path
   */
  private decodeProjectPath(encodedPath: string): string {
    return encodedPath.replace(/-/g, '/');
  }
}
