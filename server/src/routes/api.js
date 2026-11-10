import express from 'express';
import { config } from '../config.js';
import { INTENTS } from '../intents.js';
import { modelInfo } from '../classifier/index.js';
import {
  HttpError,
  assignConversation,
  correctIntent,
  exportLabelsCsv,
  getConversation,
  getStats,
  listConversations,
  markRead,
  sendReply,
  updateStatus,
} from '../services/conversations.js';

export const apiRouter = express.Router();

function conversationId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid conversation id');
  return id;
}

apiRouter.get('/meta', (req, res) => {
  res.json({
    agents: config.agents,
    slaSeconds: config.slaSeconds,
    replyWindowHours: config.replyWindowHours,
    sender: config.sender,
    intents: INTENTS,
    classifier: modelInfo(),
  });
});

apiRouter.get('/stats', async (req, res) => {
  res.json(await getStats());
});

apiRouter.get('/conversations', async (req, res) => {
  res.json(
    await listConversations({
      filter: req.query.filter || 'NEEDS_REPLY',
      search: req.query.q,
      assignee: req.query.assignee,
      intent: req.query.intent,
    }),
  );
});

apiRouter.patch('/messages/:id/intent', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid message id');
  res.json(await correctIntent(id, req.body?.intent, req.body?.agent));
});

apiRouter.get('/labels.csv', async (req, res) => {
  const csv = await exportLabelsCsv({ correctedOnly: req.query.corrected === '1' });
  res.set('content-type', 'text/csv; charset=utf-8');
  res.set('content-disposition', 'attachment; filename="dm-labels.csv"');
  res.send(csv);
});

apiRouter.get('/conversations/:id', async (req, res) => {
  res.json(await getConversation(conversationId(req)));
});

apiRouter.post('/conversations/:id/read', async (req, res) => {
  res.json(await markRead(conversationId(req), req.body?.agent));
});

apiRouter.post('/conversations/:id/reply', async (req, res) => {
  res.status(201).json(await sendReply(conversationId(req), req.body?.text, req.body?.agent));
});

apiRouter.patch('/conversations/:id/status', async (req, res) => {
  res.json(await updateStatus(conversationId(req), req.body?.status, req.body?.agent));
});

apiRouter.patch('/conversations/:id/assignee', async (req, res) => {
  res.json(await assignConversation(conversationId(req), req.body?.assignee ?? null));
});
