import type { ClaudeCommand } from './types.js';

export interface ProjectInfo {
  name: string;
  actualPath: string;
  claudePath: string;
  encodedName: string;
  lastModified: Date;
}

export class OutputFormatter {
  private sigpipeDetected = false;

  /**
   * Format a single command line for shell history-like output
   */
  formatCommandLine(
    command: ClaudeCommand,
    index: number,
    isGlobal: boolean
  ): string {
    const indexStr = index.toString().padStart(4);

    if (isGlobal && command.projectPath) {
      // Extract project name from path for global view
      const projectName = this.extractProjectName(command.projectPath);
      const projectPrefix = `[${projectName.padEnd(15)}] `;
      return `${indexStr}  ${projectPrefix}${command.command}`;
    }

    return `${indexStr}  ${command.command}`;
  }

  /**
   * Format project list (non-streaming output)
   */
  formatProjectList(projects: ProjectInfo[]): string {
    if (projects.length === 0) {
      return 'No Claude projects found in ~/.claude/projects/';
    }

    const lines = projects.map((project) => {
      const projectName = project.name; // Already basename from actualPath
      const nameColumn = projectName.padEnd(20);
      const pathColumn = `(${project.actualPath})`;
      return `${nameColumn} ${pathColumn}`;
    });

    return lines.join('\n');
  }

  /**
   * Write line to stdout with SIGPIPE detection
   * Returns false if pipe was closed (should stop processing)
   */
  writeLineWithSigpipeCheck(line: string): boolean {
    if (this.sigpipeDetected) {
      return false;
    }

    try {
      process.stdout.write(`${line}\n`);
      return true;
    } catch (error) {
      // Handle EPIPE (broken pipe) - downstream process closed
      if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
        this.sigpipeDetected = true;
        return false;
      }

      // Handle other stdout errors
      console.error(`Error writing to stdout: ${(error as Error).message}`, {
        file: 'stderr',
      });
      return false;
    }
  }

  /**
   * Check if SIGPIPE has been detected
   */
  isSigpipeDetected(): boolean {
    return this.sigpipeDetected;
  }

  /**
   * Reset SIGPIPE detection state (useful for testing)
   */
  resetSigpipeState(): void {
    this.sigpipeDetected = false;
  }

  /**
   * Extract a short project name from full path
   * /Users/test/dev/codetracker -> codetracker
   * /Users/test/dev/cchistory -> cchistory
   */
  private extractProjectName(projectPath: string): string {
    // Should only receive decoded paths like "/Users/test/dev/codetracker"
    return projectPath.split('/').pop() || projectPath;
  }
}
