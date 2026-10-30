#!/usr/bin/env python3
"""Compare an online SQLite backup with a locally imported D1 SQLite file.

Only table names and check results are printed; row contents are never printed.
The target must be an isolated, quiescent local D1 database, not a live file.
"""
import collections
import sqlite3
import sys
from pathlib import Path


def connect(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)


def tables(db):
    return {row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
    )}


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def main():
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python3 scripts/verify-sqlite-copy.py BACKUP LOCAL_D1_SQLITE')
    with connect(sys.argv[1]) as source, connect(sys.argv[2]) as target:
        source_tables, target_tables = tables(source), tables(target)
        errors = []
        if source_tables != target_tables:
            errors.append('table sets differ')
        for table in sorted(source_tables & target_tables):
            sql = 'SELECT * FROM ' + quote(table)
            if collections.Counter(source.execute(sql)) != collections.Counter(target.execute(sql)):
                errors.append('rows differ: ' + table)
        for label, db in [('source', source), ('target', target)]:
            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                errors.append(label + ' integrity check failed')
            if db.execute('PRAGMA foreign_key_check').fetchone() is not None:
                errors.append(label + ' foreign key check failed')
        def sequences(db):
            exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").fetchone()
            return list(db.execute('SELECT name, seq FROM sqlite_sequence ORDER BY name')) if exists else []
        if sequences(source) != sequences(target):
            errors.append('autoincrement sequences differ')
        print(f'Compared {len(source_tables)} source tables; {len(errors)} issue(s).')
        for error in errors:
            print(error)
        if errors:
            raise SystemExit(1)


if __name__ == '__main__':
    main()
