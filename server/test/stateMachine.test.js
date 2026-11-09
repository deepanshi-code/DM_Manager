import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS,
  canTransition,
  statusAfterInbound,
  isOverdue,
  replyWindow,
} from '../src/stateMachine.js';

test('a customer message reopens resolved and waiting chats', () => {
  assert.equal(statusAfterInbound(null), STATUS.NEW);
  assert.equal(statusAfterInbound(STATUS.NEW), STATUS.NEW);
  assert.equal(statusAfterInbound(STATUS.WAITING), STATUS.OPEN);
  assert.equal(statusAfterInbound(STATUS.RESOLVED), STATUS.OPEN);
});

test('manual transitions follow the lifecycle', () => {
  assert.ok(canTransition(STATUS.NEW, STATUS.OPEN));
  assert.ok(canTransition(STATUS.OPEN, STATUS.RESOLVED));
  assert.ok(canTransition(STATUS.RESOLVED, STATUS.OPEN));
  assert.ok(!canTransition(STATUS.RESOLVED, STATUS.WAITING));
  assert.ok(!canTransition(STATUS.NEW, STATUS.WAITING));
});

test('overdue is a timer, not a status', () => {
  const since = new Date('2026-01-01T10:00:00Z');
  assert.equal(isOverdue(since, new Date('2026-01-01T10:59:59Z'), 3600), false);
  assert.equal(isOverdue(since, new Date('2026-01-01T11:00:00Z'), 3600), true);
  assert.equal(isOverdue(null, new Date(), 3600), false);
});

test('reply window closes 24h after the last customer message', () => {
  const last = new Date('2026-01-01T10:00:00Z');
  assert.equal(replyWindow(last, new Date('2026-01-02T09:59:00Z'), 24).open, true);
  assert.equal(replyWindow(last, new Date('2026-01-02T10:00:01Z'), 24).open, false);
  assert.equal(replyWindow(null, new Date(), 24).open, false);
});
