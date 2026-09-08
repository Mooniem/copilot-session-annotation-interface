# Copilot session analysis

This folder contains code for transforming and analyzing exported Copilot session
Markdown files.

## Export turns

From the repository root, export one session Markdown file to CSV:

```sh
npm run export-turns -- copilot-session-example.md
```

You can also pass a directory to process all Markdown files recursively.

## Extract stages

Add the active stage and generate stage totals from an exported turns CSV:

```sh
python analysis/extract-stage.py copilot-session-example-turns.csv
```

The generated summary CSV includes duration, total turns, user turns, and
Copilot turns for each stage.

Stages are observed only from blue (`🔵`) markers in Copilot messages. Each
stage begins at the nearest preceding User turn, which is treated as the request
that prompted the marked Copilot response. Turns before that first user boundary
are reported as `Unassigned` rather than backfilled into the first stage.
