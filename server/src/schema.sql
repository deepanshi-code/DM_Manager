-- DM Manager schema (PostgreSQL). Safe to run on every start.

-- One row per Instagram user who has messaged the business.
CREATE TABLE IF NOT EXISTS contacts (
  id          SERIAL PRIMARY KEY,
  ig_user_id  TEXT NOT NULL UNIQUE,          -- Instagram-scoped user ID from the webhook
  username    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One conversation (thread) per contact, like the Instagram inbox itself.
-- UNIQUE(contact_id) prevents two threads being created when two messages
-- from a new customer arrive at the same moment.
CREATE TABLE IF NOT EXISTS conversations (
  id                        SERIAL PRIMARY KEY,
  contact_id                INTEGER NOT NULL UNIQUE REFERENCES contacts(id),
  status                    TEXT NOT NULL DEFAULT 'NEW'
                            CHECK (status IN ('NEW','OPEN','WAITING_ON_CUSTOMER','RESOLVED')),
  assignee                  TEXT,
  -- When the oldest *unanswered* customer message arrived. NULL = nothing to reply to.
  -- This single column is what makes "forgotten" chats impossible to hide.
  needs_reply_since         TIMESTAMPTZ,
  is_overdue                BOOLEAN NOT NULL DEFAULT false,
  overdue_at                TIMESTAMPTZ,
  first_inbound_at          TIMESTAMPTZ,
  first_response_at         TIMESTAMPTZ,
  last_customer_message_at  TIMESTAMPTZ,     -- drives the 24-hour reply window
  last_message_at           TIMESTAMPTZ,
  last_message_preview      TEXT,
  unread_count              INTEGER NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_needs_reply
  ON conversations(needs_reply_since) WHERE needs_reply_since IS NOT NULL;

CREATE TABLE IF NOT EXISTS messages (
  id                   SERIAL PRIMARY KEY,
  conversation_id      INTEGER NOT NULL REFERENCES conversations(id),
  -- Meta's message ID ("mid"). UNIQUE makes webhook retries harmless (idempotency).
  platform_message_id  TEXT UNIQUE,
  direction            TEXT NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  body                 TEXT NOT NULL,
  sent_at              TIMESTAMPTZ NOT NULL,
  delivery_status      TEXT NOT NULL DEFAULT 'RECEIVED'
                       CHECK (delivery_status IN ('RECEIVED','PENDING','SENT','FAILED')),
  sent_by              TEXT,                  -- agent name for outbound messages
  response_seconds     INTEGER,               -- outbound only: how long the customer waited
  error                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, sent_at);

-- Audit log of every status change: useful for debugging and for the
-- capstone evaluation (e.g. "how long do chats stay OPEN?").
CREATE TABLE IF NOT EXISTS status_events (
  id               SERIAL PRIMARY KEY,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id),
  from_status      TEXT,
  to_status        TEXT NOT NULL,
  actor            TEXT NOT NULL,
  reason           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Phase 2: intent classification ----------
-- ADD COLUMN IF NOT EXISTS upgrades databases created in Phase 1 without data loss.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS intent TEXT;                 -- model/rule prediction
ALTER TABLE messages ADD COLUMN IF NOT EXISTS intent_confidence REAL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS intent_source TEXT;          -- model | rules | none
ALTER TABLE messages ADD COLUMN IF NOT EXISTS intent_low_confidence BOOLEAN;
-- Human corrections: never overwrite the prediction, so model errors stay measurable
-- and corrected rows become real training data.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS intent_corrected TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS intent_corrected_by TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS intent_corrected_at TIMESTAMPTZ;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS intent TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'NORMAL';  -- URGENT | NORMAL | LOW
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_chasing BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_conversations_intent ON conversations(intent);

-- ---------- Phase 4: agent accounts ----------
CREATE TABLE IF NOT EXISTS agents (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,              -- scrypt$N$r$p$salt$hash, never the password itself
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_name_lower ON agents (lower(name));

-- Only the SHA-256 of the session token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  agent_id    INTEGER NOT NULL REFERENCES agents(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);

-- ---------- Phase 3: saved replies ----------
-- Reusable answers for the questions every seller gets 100 times a day.
-- {name} is replaced with the customer's username when inserted.
CREATE TABLE IF NOT EXISTS saved_replies (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  intent      TEXT,                          -- suggest for this message type; NULL = general
  use_count   INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,  -- deleting hides it but keeps history readable
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Which saved reply a sent message started from, and whether the agent changed it:
-- lets the evaluation compare reply times with and without templates.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS saved_reply_id INTEGER REFERENCES saved_replies(id);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS saved_reply_edited BOOLEAN;

-- ---------- Team workspace: notes and follow-up reminders ----------
-- Private notes between agents; never sent to the customer.
CREATE TABLE IF NOT EXISTS conversation_notes (
  id               SERIAL PRIMARY KEY,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id),
  author           TEXT,
  body             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notes_conversation ON conversation_notes(conversation_id, created_at);

-- "Follow up if the customer hasn't replied by …". Cleared automatically when the customer
-- writes, when we reply, or when the chat is resolved; due reminders show in "Follow-ups".
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS remind_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS remind_set_by TEXT;
CREATE INDEX IF NOT EXISTS idx_conversations_remind ON conversations(remind_at) WHERE remind_at IS NOT NULL;

-- ---------- App metadata (e.g. when the hosted demo inbox was last loaded) ----------
CREATE TABLE IF NOT EXISTS app_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
