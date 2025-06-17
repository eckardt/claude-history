#!/usr/bin/env node

import { Command } from 'commander';
import { createResilientCommandStream } from './jsonl-stream-parser.js';
import { OutputFormatter } from './output-formatter.js';
import { ProjectDiscovery } from './project-discovery.js';
import { StreamMerger } from './stream-merger.js';
import type { CLIOptions, ClaudeCommand } from './types.js';
import { version } from './version.js';

// Handle SIGPIPE gracefully (when piped to head, tail, etc.)
process.on('SIGPIPE', () => {
  process.exit(0);
});

// Handle broken pipe errors
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') {
    process.exit(0);
  } else {
    console.error(`Stdout error: ${error.message}`, { file: 'stderr' });
    process.exit(1);
  }
});

const program = new Command();

export async function handleListProjects(): Promise<void> {
  const discovery = new ProjectDiscovery();
  const formatter = new OutputFormatter();

  const projects = await discovery.getAllProjects();
  const projectList = formatter.formatProjectList(projects);
  console.log(projectList);
}

export async function createCommandStream(
  projectName: string | undefined,
  options: CLIOptions
): Promise<{ stream: AsyncGenerator<ClaudeCommand>; isGlobal: boolean }> {
  const discovery = new ProjectDiscovery();
  const streamMerger = new StreamMerger();

  if (options.global) {
    const projects = await discovery.getAllProjects();
    return {
      stream: streamMerger.mergeProjectStreams(projects),
      isGlobal: true,
    };
  }

  const project = projectName
    ? await discovery.getProject(projectName)
    : await discovery.getCurrentProject();

  if (!project) {
    if (projectName) {
      // User explicitly provided a project name that doesn't exist
      throw new Error(`Project '${projectName}' not found`);
    }
    // No project name provided and current directory has no project - fall back to global
    console.error(
      'No project found. Showing global history from all projects.',
      { file: 'stderr' }
    );
    const projects = await discovery.getAllProjects();
    return {
      stream: streamMerger.mergeProjectStreams(projects),
      isGlobal: true,
    };
  }

  return {
    stream: createResilientCommandStream(project.claudePath),
    isGlobal: false,
  };
}

export async function processCommandStream(
  stream: AsyncGenerator<ClaudeCommand>,
  options: CLIOptions,
  isGlobal: boolean
): Promise<void> {
  const formatter = new OutputFormatter();
  let index = 1;
  let commandCount = 0;

  for await (const command of stream) {
    if (!options.includeFailed && command.success === false) {
      continue;
    }

    const line = formatter.formatCommandLine(command, index, isGlobal);
    const shouldContinue = formatter.writeLineWithSigpipeCheck(line);

    if (!shouldContinue) {
      break;
    }

    index++;
    commandCount++;
  }

  if (commandCount === 0) {
    process.exit(2);
  }
}

async function main(
  projectName: string | undefined,
  options: CLIOptions
): Promise<void> {
  try {
    if (options.listProjects) {
      return handleListProjects();
    }

    const { stream, isGlobal } = await createCommandStream(
      projectName,
      options
    );
    await processCommandStream(stream, options, isGlobal);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`, { file: 'stderr' });
    process.exit(1);
  }
}

// Set up CLI with Commander.js
program
  .name('cchistory')
  .description('Show shell command history from Claude Code conversation logs')
  .version(version)
  .argument('[project]', 'project name or path (default: current directory)')
  .option('-g, --global', 'show history from all projects chronologically')
  .option('-l, --list-projects', 'list all available Claude projects')
  .option(
    '--include-failed',
    'include failed command executions (default: only successful)'
  )
  .action(async (project: string | undefined, options: CLIOptions) => {
    await main(project, options);
  });

// Export the program for the entry point to use
export { program };
