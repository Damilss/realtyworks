#!/usr/bin/env python3
"""Turn semgrep JSON output into GitHub Actions annotations.

Usage: semgrep-annotations.py <semgrep.json>

Emits one ::error/::warning/::notice workflow command per finding so results
show up as PR annotations. SARIF upload to the Security tab would need GHAS
on private repos; workflow commands are free everywhere.
"""

import json
import sys

# Semgrep severities: legacy ERROR/WARNING/INFO and newer CRITICAL/HIGH/MEDIUM/LOW.
LEVELS = {
    "CRITICAL": "error",
    "HIGH": "error",
    "ERROR": "error",
    "MEDIUM": "warning",
    "WARNING": "warning",
    "LOW": "notice",
    "INFO": "notice",
}


def esc_data(s):
    return s.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def esc_prop(s):
    return esc_data(s).replace(":", "%3A").replace(",", "%2C")


def main():
    try:
        with open(sys.argv[1]) as f:
            results = json.load(f)["results"]
    except FileNotFoundError:
        # The scan step died before writing output (config fetch error etc.);
        # its own log has the story, so don't fail this step too.
        print(f"::notice::{sys.argv[1]} not found - semgrep produced no output")
        return
    for r in results:
        level = LEVELS.get(r["extra"]["severity"], "warning")
        props = "file={},line={},endLine={},title={}".format(
            esc_prop(r["path"]),
            r["start"]["line"],
            r["end"]["line"],
            esc_prop("Semgrep: " + r["check_id"]),
        )
        print(f"::{level} {props}::{esc_data(r['extra']['message'])}")
    print(f"{len(results)} finding(s) annotated")


if __name__ == "__main__":
    main()
