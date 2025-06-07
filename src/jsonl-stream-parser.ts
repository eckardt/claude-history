import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ClaudeCommand, ConversationEntry } from './types.js';

export class JSONLStreamParser {
  /**
   * Create resilient streaming parser for single JSONL file
   */
  async *createFileStream(filePath: string): AsyncGenerator<ClaudeCommand> {
    try {
      const fileStream = createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Number.POSITIVE_INFINITY,
      });

      let lineNumber = 0;

      try {
        for await (const line of rl) {
          lineNumber++;

          if (!line.trim()) continue;

          try {
            const entry: ConversationEntry = JSON.parse(line);

            // Extract bash commands from assistant messages
            const bashCommand = this.extractBashCommand(entry);
            if (bashCommand) {
              yield bashCommand;
            }

            // Extract user commands starting with "!"
            const userCommand = this.extractUserCommand(entry);
            if (userCommand) {
              yield userCommand;
            }
          } catch (error) {
            // Log error to stderr but continue processing
            const errorType =
              error instanceof SyntaxError ? 'JSON syntax' : 'parsing';
            console.error(
              `Error parsing line ${lineNumber} in ${filePath}: ${errorType} error`
            );
          }
        }
      } finally {
        rl.close();
      }
    } catch (error) {
      console.error(
        `Error reading file ${filePath}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Create resilient streaming parser for all files in a project
   */
  async *createProjectStream(
    projectPath: string
  ): AsyncGenerator<ClaudeCommand> {
    try {
      const files = await readdir(projectPath);
      const jsonlFiles = files
        .filter((file) => file.endsWith('.jsonl'))
        .map((file) => join(projectPath, file));

      // Sort files by modification time for chronological order
      const fileStats = await Promise.all(
        jsonlFiles.map(async (file) => ({
          path: file,
          mtime: (await stat(file)).mtime,
        }))
      );

      fileStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

      for (const { path: filePath } of fileStats) {
        yield* this.createFileStream(filePath);
      }
    } catch (error) {
      console.error(
        `Error reading project directory ${projectPath}: ${
          (error as Error).message
        }`
      );
    }
  }

  /**
   * Extract bash command from conversation entry
   */
  extractBashCommand(entry: ConversationEntry): ClaudeCommand | null {
    if (entry.type !== 'assistant' || !entry.message?.content) return null;

    const bashBlock = this.findBashToolBlock(entry.message.content);
    if (!bashBlock) return null;

    return this.createClaudeCommand(bashBlock, entry, 'bash');
  }

  /**
   * Find the first Bash tool use block in content
   */
  private findBashToolBlock(content: ConversationEntry['message']['content']) {
    return content.find(
      (block) => block.type === 'tool_use' && block.name === 'Bash'
    );
  }

  /**
   * Create a ClaudeCommand from a tool block and entry
   */
  private createClaudeCommand(
    block: { input?: { command?: string; description?: string } },
    entry: ConversationEntry,
    source: 'bash' | 'user'
  ): ClaudeCommand | null {
    try {
      const command = block.input?.command;
      if (!command) return null;

      return {
        timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
        command: this.normalizeBashCommand(command),
        source,
        description: block.input?.description || undefined,
        projectPath: entry.cwd,
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract user command starting with "!"
   */
  extractUserCommand(entry: ConversationEntry): ClaudeCommand | null {
    if (entry.type !== 'user' || !entry.message?.content) return null;

    const command = this.findUserCommand(entry.message.content);
    if (!command) return null;

    return this.createClaudeCommand({ input: { command } }, entry, 'user');
  }

  /**
   * Find user command from text blocks starting with "!"
   */
  private findUserCommand(
    content: ConversationEntry['message']['content']
  ): string | null {
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        const trimmed = block.text.trim();
        if (trimmed.startsWith('! ')) {
          return trimmed.substring(2).trim();
        }
      }
    }
    return null;
  }

  /**
   * Handle multi-line commands (zsh history format)
   */
  normalizeBashCommand(command: string): string {
    return command
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\\n');
  }
}

/**
 * Create resilient command stream with error boundaries
 */
export async function* createResilientCommandStream(
  projectPath: string
): AsyncGenerator<ClaudeCommand> {
  const parser = new JSONLStreamParser();

  try {
    yield* parser.createProjectStream(projectPath);
  } catch (error) {
    console.error(`Fatal error in command stream: ${(error as Error).message}`);
  }
}
