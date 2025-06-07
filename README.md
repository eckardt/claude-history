# claude-history

Get shell commands from Claude Code conversation history. Because Claude's commands don't appear in your shell history.

```bash
$ claude-history --global | tail -5
   1  [my-app         ] npm install express
   2  [data-project   ] python analyze.py --input data.csv
   3  [my-app         ] docker build -t myapp .
   4  [claude-history ] npm run check
   5  [my-app         ] npm test
```

## Install

```bash
npm install -g claude-history
```

Or use `npx` to try without installing:
```bash
npx claude-history | tail -5
```

## Usage

```bash
claude-history                    # Current project history
claude-history --global           # All projects
claude-history --list-projects    # See all available projects
claude-history | grep docker      # Find Docker commands  
claude-history | tail -5          # Last 5 commands
claude-history my-app | tail -10  # Last 10 from specific project
claude-history ~/dev/my-app       # Project by full path
```

## What It Does

- Find commands Claude executed across all your projects
- Search command history with standard Unix tools (`grep`, `awk`, etc.)
- Copy command sequences from past sessions
- See which project each command came from

## How It Works

Claude Code stores conversation history in `~/.claude/projects/`. This tool:

1. Finds your Claude projects
2. Streams through conversation logs  
3. Extracts shell commands Claude executed
4. Formats them like traditional shell history

## Advanced Usage

```bash
# Find all npm commands across projects
claude-history --global | grep npm

# Get last 20 Docker commands
claude-history --global | grep docker | tail -20

# Export project history for documentation
claude-history my-api > project-commands.txt

# Count commands by type
claude-history --global | awk '{print $NF}' | sort | uniq -c
```

## Command Sources

Extracts commands from:
- **Bash tool usage**: Commands Claude executes via the Bash tool
- **User "!" commands**: Commands you run with `! command` in Claude

## Requirements

- Node.js 18+ 
- Claude Code with conversation history in `~/.claude/projects/`

## Options

```
claude-history [project-name]     # Show history for specific project (by name or path)
claude-history --global          # Show history from all projects  
claude-history --list-projects   # List all available Claude projects
claude-history --count N         # Show last N commands
claude-history --help            # Show usage info
```

## Output Format

Each line shows:
```
[sequence] [project-name] command
```

- **sequence**: Command number (oldest first)
- **project-name**: Which Claude project ran the command
- **command**: The actual shell command

Multi-line commands use zsh history format with `\\n` for newlines.

## Unix Philosophy

`claude-history` does one thing well: extract shell commands. Use it with standard Unix tools:

- `grep` for filtering
- `head`/`tail` for limiting output  
- `awk` for field processing
- `sort`/`uniq` for analysis
- Pipe to files for documentation