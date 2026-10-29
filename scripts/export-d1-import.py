#!/usr/bin/env python3
"""Export a SQLite online backup to a private SQL file for an empty D1 database.

This tool never uploads data. The output contains the entire database and must be
protected like the original backup. Existing output files are never overwritten.
"""
import math
import os
from pathlib import Path
import sqlite3
import sys


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError('Non-finite numeric values cannot be exported safely')
        return repr(value)
    if isinstance(value, str):
        return "CAST(X'" + value.encode('utf-8').hex() + "' AS TEXT)"
    raise TypeError(f'Unsupported SQLite value type: {type(value).__name__}')


def main():
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python3 scripts/export-d1-import.py /path/to/online-backup.sqlite /path/to/new-private-output.sql')
    backup, output = map(Path, sys.argv[1:])
    if not backup.is_file():
        raise SystemExit('Backup does not exist')
    source = sqlite3.connect(backup.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        if source.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('Source backup failed integrity check')
        if source.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('Source backup has foreign-key violations')
        schema = list(source.execute("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid"))
        tables = {name: sql for kind, name, sql in schema if kind == 'table'}
        if any(sql.lstrip().upper().startswith('CREATE VIRTUAL TABLE') for sql in tables.values()):
            raise ValueError('Virtual tables require a separate migration strategy')
        dependencies = {name: {row[2] for row in source.execute('SELECT * FROM pragma_foreign_key_list(?)', (name,))} for name in tables}
        ordered = []
        while dependencies:
            ready = sorted(name for name, parents in dependencies.items() if not parents.intersection(dependencies))
            if not ready:
                raise ValueError('Cyclic foreign keys require a separate migration strategy')
            for name in ready:
                ordered.append(name)
                del dependencies[name]
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as target:
                for name in ordered:
                    target.write(tables[name] + ';\n')
                for name in ordered:
                    columns = [row[1] for row in source.execute('SELECT * FROM pragma_table_xinfo(?)', (name,)) if row[6] == 0]
                    names = ','.join(map(identifier, columns))
                    for row in source.execute('SELECT ' + names + ' FROM ' + identifier(name)):
                        target.write('INSERT INTO ' + identifier(name) + ' (' + names + ') VALUES (' + ','.join(map(literal, row)) + ');\n')
                if source.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'").fetchone():
                    target.write('DELETE FROM sqlite_sequence;\n')
                    for name, sequence in source.execute('SELECT name, seq FROM sqlite_sequence'):
                        target.write('INSERT INTO sqlite_sequence (name,seq) VALUES (' + literal(name) + ',' + literal(sequence) + ');\n')
                for kind, _, sql in schema:
                    if kind != 'table':
                        target.write(sql + ';\n')
        except BaseException:
            output.unlink(missing_ok=True)
            raise
        print(f'Private SQL export created for {len(ordered)} tables. No data was uploaded.')
    finally:
        source.close()


if __name__ == '__main__':
    main()
