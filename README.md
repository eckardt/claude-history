# cchistory

Get shell commands from Claude Code conversation history. Because commands Claude runs via the Bash tool don't appear in your shell history.

```bash
$ cchistory --global | tail -5
  47  [api-server     ] git pull origin main
  48  [api-server     ] git log --oneline -5
  49  [api-server     ] docker-compose up -d
  50  [api-server     ] curl -I localhost:8080/health
  51  [frontend       ] git status
```

## Install

```bash
npm install -g cchistory
```

Or use `npx` to try without installing:
```bash
npx cchistory
```

## Usage

```bash
cchistory                    # Current project history
cchistory --global           # All projects
cchistory --list-projects    # See all available projects
cchistory | grep docker      # Find Docker commands  
cchistory | tail -5          # Last 5 commands
cchistory my-app | tail -10  # Last 10 from specific project
cchistory ~/code/my-app      # Project by full path
```

## What It Does

- Find commands Claude executed via the Bash tool across all your projects
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
cchistory --global | grep npm

# Get last 20 Docker commands
cchistory --global | grep docker | tail -20

# Count commands by type
cchistory --global | sed 's/.*] //' | awk '{print $1}' | sort | uniq -c | sort -nr | head -10
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
cchistory [project-name]     # Show history for specific project (by name or path)
cchistory --global          # Show history from all projects  
cchistory --list-projects   # List all available Claude projects
cchistory --help            # Show usage info
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

`cchistory` does one thing well: extract shell commands. Use it with standard Unix tools:

- `grep` for filtering
- `head`/`tail` for limiting output  
- `awk` for field processing
- `sort`/`uniq` for analysis
- Pipe to files for documentation
