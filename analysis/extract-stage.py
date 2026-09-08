#!/usr/bin/env python3
"""Add a stage column to an exported Copilot turns CSV."""

import argparse
import csv
import re
from pathlib import Path


ACTIVE_STAGE_PATTERN = re.compile(r"🔵\s*(?P<stage>[^·\r\n]+)")
DURATION_PATTERN = re.compile(r"(?:(?P<minutes>\d+)m\s*)?(?P<seconds>\d+)s")


def extract_stage(message: str) -> str | None:
    match = ACTIVE_STAGE_PATTERN.search(message)
    return match.group("stage").strip() if match else None


def duration_seconds(duration: str) -> int:
    if not duration.strip():
        return 0

    match = DURATION_PATTERN.fullmatch(duration.strip())
    if not match:
        raise ValueError(f"Invalid duration: {duration!r}")

    return int(match.group("minutes") or 0) * 60 + int(match.group("seconds"))


def format_duration(total_seconds: int) -> str:
    minutes, seconds = divmod(total_seconds, 60)
    return f"{minutes}m {seconds}s" if minutes else f"{seconds}s"


def write_stage_summary(message_rows: list[dict[str, str]], output_path: Path) -> None:
    summary: dict[str, dict[str, int]] = {}
    for row in message_rows:
        stage = row["#stage"]
        stage_summary = summary.setdefault(
            stage, {"seconds": 0, "turns": 0, "user_turns": 0, "copilot_turns": 0}
        )
        stage_summary["seconds"] += duration_seconds(row.get("#duration", ""))
        stage_summary["turns"] += 1
        role = row.get("#user or copilot", "").strip().lower()
        if role in {"user", "copilot"}:
            stage_summary[f"{role}_turns"] += 1

    with output_path.open("w", encoding="utf-8", newline="") as output_file:
        fieldnames = [
            "#stage",
            "#duration",
            "#seconds",
            "#turns",
            "#user turns",
            "#copilot turns",
        ]
        writer = csv.DictWriter(output_file, fieldnames=fieldnames)
        writer.writeheader()
        for stage, values in summary.items():
            writer.writerow(
                {
                    "#stage": stage,
                    "#duration": format_duration(values["seconds"]),
                    "#seconds": values["seconds"],
                    "#turns": values["turns"],
                    "#user turns": values["user_turns"],
                    "#copilot turns": values["copilot_turns"],
                }
            )


def add_stage_column(input_path: Path, output_path: Path, summary_path: Path) -> int:
    with input_path.open("r", encoding="utf-8-sig", newline="") as input_file:
        reader = csv.DictReader(input_file)
        if reader.fieldnames is None or "#message" not in reader.fieldnames:
            raise ValueError("Input CSV must contain a '#message' column")

        fieldnames = [name for name in reader.fieldnames if name != "#stage"]
        message_rows = list(reader)

    detected_stages = [
        extract_stage(row["#message"])
        if row.get("#user or copilot", "").strip().lower() == "copilot"
        else None
        for row in message_rows
    ]
    if not any(detected_stages):
        raise ValueError("No active stage marked with '🔵' was found in #message")

    for row in message_rows:
        row["#stage"] = "Unassigned"

    transitions: list[tuple[int, str]] = []
    for marker_index, detected_stage in enumerate(detected_stages):
        if not detected_stage:
            continue

        start_index = marker_index
        while (
            start_index > 0
            and message_rows[start_index].get("#user or copilot", "").lower()
            != "user"
        ):
            start_index -= 1
        transitions.append((start_index, detected_stage))

    for transition_index, (start_index, stage) in enumerate(transitions):
        end_index = (
            transitions[transition_index + 1][0]
            if transition_index + 1 < len(transitions)
            else len(message_rows)
        )
        for row in message_rows[start_index:end_index]:
            row["#stage"] = stage

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=[*fieldnames, "#stage"])
        writer.writeheader()
        writer.writerows(message_rows)

    write_stage_summary(message_rows, summary_path)
    return len(message_rows)


def default_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}-with-stage.csv")


def default_summary_path(output_path: Path) -> Path:
    return output_path.with_name(f"{output_path.stem}-summary.csv")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract the active (blue) stage from the #message column."
    )
    parser.add_argument("input", type=Path, help="CSV file containing #message")
    parser.add_argument("output", type=Path, nargs="?", help="Output CSV path")
    parser.add_argument("--summary", type=Path, help="Stage summary CSV path")
    args = parser.parse_args()

    output_path = args.output or default_output_path(args.input)
    summary_path = args.summary or default_summary_path(output_path)
    row_count = add_stage_column(args.input, output_path, summary_path)
    print(f"Wrote {row_count} rows to {output_path}")
    print(f"Wrote stage totals to {summary_path}")


if __name__ == "__main__":
    main()