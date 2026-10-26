#!/usr/bin/env python3
"""
Copy a pgAdmin node's SQL templates into a module and convert them from Jinja to Twig.

    tools/port-pgadmin-templates.py <pgadmin templates dir> <module sql dir> [--dry-run]

    tools/port-pgadmin-templates.py \
        ../pgadmin4/web/pgadmin/browser/server_groups/servers/databases/templates/databases/sql \
        Modules/Databases/resources/sql/databases

The version folders (default, 12_plus, …) are kept; a "pg/" variant is flattened and a "ppas/"
one skipped. The conversion is the mechanical part of the Jinja→Twig checklist in
tmp/03-architecture.md; anything it could not translate is reported so it can be fixed by hand.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"{%(-?)\s*elif\b"), r"{%\1 elseif"),
    (re.compile(r"\bis\s+not\s+none\b"), "is not null"),
    (re.compile(r"\bis\s+none\b"), "is null"),
    (re.compile(r"\bis\s+sameas\s+True\b"), "is same as(true)"),
    (re.compile(r"\bis\s+sameas\s+False\b"), "is same as(false)"),
    # Twig's == is PHP's loose comparison ('on' == true), Jinja's is strict: compare identity.
    (re.compile(r"==\s*True\b"), "is same as(true)"),
    (re.compile(r"==\s*False\b"), "is same as(false)"),
    (re.compile(r"!=\s*True\b"), "is not same as(true)"),
    (re.compile(r"!=\s*False\b"), "is not same as(false)"),
    (re.compile(r"(?<![\w.'\"])True(?![\w'\"])"), "true"),
    (re.compile(r"(?<![\w.'\"])False(?![\w'\"])"), "false"),
    (re.compile(r"(?<![\w.'\"])None(?![\w'\"])"), "null"),
    # A if C else B  →  (C ? A : B)   (Jinja's conditional expression; Twig has the ternary)
    (re.compile(r"""('[^']*'|[\w.]+)\s+if\s+([\w.' ]+?)\s+else\s+('[^']*'|[\w.]+)"""), r"(\2 ? \1 : \3)"),
    # 'key' in data  →  data.key is defined   (dict membership; Twig's "in" tests values)
    (re.compile(r"'([A-Za-z_][A-Za-z0-9_]*)'\s+in\s+([A-Za-z_][A-Za-z0-9_.]*)(?=\s*(?:%}|and|or|\)))"), r"\2.\1 is defined"),
    (re.compile(r"'([A-Za-z_][A-Za-z0-9_]*)'\s+not\s+in\s+([A-Za-z_][A-Za-z0-9_.]*)(?=\s*(?:%}|and|or|\)))"), r"\2.\1 is not defined"),
    # Python string methods
    (re.compile(r"\.rstrip\(([^)]*)\)"), r"|trim(\1, 'right')"),
    (re.compile(r"\.lstrip\(([^)]*)\)"), r"|trim(\1, 'left')"),
    (re.compile(r"\.strip\(\)"), "|trim"),
    (re.compile(r"\.lower\(\)"), "|lower"),
    (re.compile(r"\.upper\(\)"), "|upper"),
    # Twig's "not" binds tighter than "starts with", Python's looser: keep the test together.
    (re.compile(r"\bnot\s+([A-Za-z_][A-Za-z0-9_.]*)\.startswith\(([^)]*)\)"), r"not (\1 starts with \2)"),
    (re.compile(r"([A-Za-z_][A-Za-z0-9_.]*)\.startswith\(([^)]*)\)"), r"\1 starts with \2"),
    (re.compile(r"([A-Za-z_][A-Za-z0-9_.]*)\.endswith\(([^)]*)\)"), r"\1 ends with \2"),
    (re.compile(r"\.items\(\)"), ""),
    # namespace(a=1, b=2) → namespace({a: 1, b: 2}); {% set ns.a = x %} → {% do ns.set('a', x) %}
    (re.compile(r"namespace\(([^()]*)\)"), lambda m: "namespace({" + re.sub(r"(\w+)\s*=", r"\1:", m.group(1)) + "})"),
    (re.compile(r"{%(-?)\s*set\s+(\w+)\.(\w+)\s*=\s*(.*?)\s*(-?)%}"), r"{%\1 do \2.set('\3', \4) \5%}"),
    # tuples in membership tests: x in ('a', 'b') → x in ['a', 'b']
    (re.compile(r"\bin\s+\(('[^']*'(?:\s*,\s*'[^']*')*)\)"), r"in [\1]"),
    # |default(x, true) → |default(x)
    (re.compile(r"\|default\(([^,()]*),\s*true\)"), r"|default(\1)"),
    # psycopg placeholders escaping, not needed with $n parameters
    (re.compile(r"\|replace\(\"%\",\s*\"%%\"\)"), ""),
]

UNHANDLED = [
    (re.compile(r"{%-?\s*for\s+\w+\s*,\s*\w+\s+in\s+\["), "tuple unpacking in for (rewrite with pair[0], pair[1])"),
    (re.compile(r"\.replace\("), ".replace( (use |replace({from: to}))"),
    (re.compile(r"\.split\("), ".split( (use |split())"),
    (re.compile(r"\|string\b|\|int\b"), "|string / |int (provided by TwigExtension, check the value)"),
    (re.compile(r"\bself\."), "self. (pgAdmin bug: use the macro argument)"),
    (re.compile(r"\[\s*-?\d+\s*:\s*-?\d*\s*\]"), "slicing (use |slice())"),
    (re.compile(r"\bif\s+'0'|==\s*'0'\s*%}"), "string '0' truthiness (falsy in PHP)"),
]


TAG = re.compile(r"{%.*?%}|{{.*?}}|{#.*?#}", re.S)


def convert(text: str) -> str:
    """Apply the rules inside Jinja tags only; the SQL between them is left as it is."""

    def inside(match: re.Match[str]) -> str:
        tag = match.group(0)
        if tag.startswith("{#"):
            return tag
        for pattern, replacement in RULES:
            tag = pattern.sub(replacement, tag)  # type: ignore[arg-type]
        return tag

    return TAG.sub(inside, text)


def report(path: Path, text: str) -> list[str]:
    notes = []
    for pattern, note in UNHANDLED:
        for match in pattern.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            notes.append(f"{path}:{line}: {note}")
    return notes


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    source, target = Path(argv[1]), Path(argv[2])
    dry = "--dry-run" in argv
    notes: list[str] = []
    copied = 0

    for file in sorted(source.rglob("*")):
        if not file.is_file():
            continue
        rel = file.relative_to(source)
        parts = list(rel.parts)
        if "ppas" in parts:
            continue
        parts = [p for p in parts if p != "pg"]
        # pgAdmin sometimes nests "<version>/sql/<file>" (views, functions); flatten "sql".
        parts = [p for p in parts if p != "sql"]
        dest = target.joinpath(*parts)
        text = convert(file.read_text(encoding="utf-8"))
        notes += report(dest, text)
        if not dry:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text, encoding="utf-8")
        copied += 1

    print(f"{'would copy' if dry else 'copied'} {copied} files from {source} to {target}")
    for note in notes:
        print("  check:", note)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
