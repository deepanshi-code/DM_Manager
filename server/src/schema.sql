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
