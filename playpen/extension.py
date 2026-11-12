"""Links the Bramble Chrome extension to one farm with a private token."""

import secrets
from time import time

from .game import database

SCHEMA = """
CREATE TABLE IF NOT EXISTS extension_links (
    token TEXT PRIMARY KEY,
    farm_id TEXT NOT NULL UNIQUE REFERENCES farms(id),
    created_at REAL NOT NULL
);
"""


def init_db(filename):
    with database(filename) as db:
        db.executescript(SCHEMA)


def link_token(filename, farm_id):
    """This farm's extension token, created on first use."""
    with database(filename) as db:
        db.execute(
            "INSERT INTO extension_links (token, farm_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
            (secrets.token_urlsafe(24), farm_id, time()),
        )
        return db.execute("SELECT token FROM extension_links WHERE farm_id = ?", (farm_id,)).fetchone()[0]


def farm_for(filename, token):
    if not token:
        return None
    with database(filename) as db:
        row = db.execute("SELECT farm_id FROM extension_links WHERE token = ?", (token,)).fetchone()
    return row[0] if row else None
