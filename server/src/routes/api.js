import express from 'express';
import { config } from '../config.js';
import { INTENTS } from '../intents.js';
import { modelInfo } from '../classifier/index.js';
import { agentNames, login, logout, readCookie, sessionAgent, sessionCookie } from '../auth.js';
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
import {
  createSavedReply,
  deleteSavedReply,
  listSavedReplies,
  updateSavedReply,
} from '../services/savedReplies.js';
import {
  addNote,
  bulkAction,
  conversationDetails,
  deleteNote,
  exportReportCsv,
  markViewing,
  setReminder,
  viewersOf,
} from '../services/workspace.js';

export const apiRouter = express.Router();

function conversationId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid conversation id');
  return id;
}

// Changes must be JSON. A cross-site HTML form can't send that without a CORS preflight,
// which (with the SameSite cookie) blocks cross-site request forgery.
apiRouter.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Send requests as application/json' });
  }
  return next();
});

// ---------- Login (always reachable) ----------
apiRouter.get('/auth/me', async (req, res) => {
  const agent = config.auth ? await sessionAgent(readCookie(req)) : null;
  res.json({ required: config.auth, agent });
});

apiRouter.post('/auth/login', async (req, res) => {
  if (!config.auth) throw new HttpError(400, 'Login is turned off (AUTH=off)');
  const { token, agent, expiresAt } = await login(req.body?.name, req.body?.password, req.ip);
  res.set('set-cookie', sessionCookie(req, token, expiresAt));
  res.json({ agent });
});

apiRouter.post('/auth/logout', async (req, res) => {
  await logout(readCookie(req));
  res.set('set-cookie', sessionCookie(req, '', null));
  res.json({ ok: true });
});

// ---------- Everything below needs a signed-in agent (when AUTH=on) ----------
apiRouter.use(async (req, res, next) => {
  if (!config.auth) {
    // Demo mode: the dashboard says who is acting (in the body, or ?agent= for GET requests).
    const claimed = req.body?.agent ?? req.query.agent;
    req.agent = typeof claimed === 'string' && claimed ? claimed : null;
    return next();
  }
  req.agent = await sessionAgent(readCookie(req));
  if (!req.agent) return res.status(401).json({ error: 'Please sign in' });
  return next();
});

apiRouter.get('/meta', async (req, res) => {
  res.json({
    agents: await agentNames(),
    slaSeconds: config.slaSeconds,
    replyWindowHours: config.replyWindowHours,
    sender: config.sender,
    intents: INTENTS,
    classifier: modelInfo(),
    auth: { required: config.auth, agent: config.auth ? req.agent : null },
  });
});

apiRouter.get('/stats', async (req, res) => {
  res.json(await getStats({ agent: req.agent }));
});

apiRouter.get('/conversations', async (req, res) => {
  res.json(
    await listConversations({
      filter: req.query.filter || 'NEEDS_REPLY',
      search: req.query.q,
      assignee: req.query.assignee,
      intent: req.query.intent,
      agent: req.agent,
    }).then((rows) => rows.map((r) => ({ ...r, viewers: viewersOf(r.id) }))),
  );
});

apiRouter.patch('/messages/:id/intent', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid message id');
  res.json(await correctIntent(id, req.body?.intent, req.agent));
});

apiRouter.get('/labels.csv', async (req, res) => {
  const csv = await exportLabelsCsv({ correctedOnly: req.query.corrected === '1' });
  res.set('content-type', 'text/csv; charset=utf-8');
  res.set('content-disposition', 'attachment; filename="dm-labels.csv"');
  res.send(csv);
});

apiRouter.get('/conversations/:id', async (req, res) => {
  const id = conversationId(req);
  const conv = await getConversation(id);
  markViewing(id, req.agent); // opening or polling a chat = "viewing" it
  res.json({
    ...conv,
    details: await conversationDetails(id),
    viewers: viewersOf(id).filter((a) => a !== req.agent), // other agents who have it open
  });
});

apiRouter.post('/conversations/:id/notes', async (req, res) => {
  res.status(201).json(await addNote(conversationId(req), req.body?.body, req.agent));
});

apiRouter.delete('/notes/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid note id');
  res.json(await deleteNote(id, req.agent));
});

apiRouter.put('/conversations/:id/reminder', async (req, res) => {
  res.json(await setReminder(conversationId(req), req.body?.remindAt ?? null, req.agent));
});

apiRouter.post('/conversations/bulk', async (req, res) => {
  res.json(await bulkAction(req.body ?? {}, req.agent, await agentNames()));
});

apiRouter.get('/report.csv', async (req, res) => {
  res.set('content-type', 'text/csv; charset=utf-8');
  res.set('content-disposition', 'attachment; filename="dm-report.csv"');
  res.send(await exportReportCsv());
});

apiRouter.post('/conversations/:id/read', async (req, res) => {
  res.json(await markRead(conversationId(req), req.agent));
});

apiRouter.post('/conversations/:id/reply', async (req, res) => {
  const savedReplyId = req.body?.savedReplyId == null ? undefined : Number(req.body.savedReplyId);
  res.status(201).json(await sendReply(conversationId(req), req.body?.text, req.agent, { savedReplyId }));
});

apiRouter.patch('/conversations/:id/status', async (req, res) => {
  res.json(await updateStatus(conversationId(req), req.body?.status, req.agent));
});

apiRouter.patch('/conversations/:id/assignee', async (req, res) => {
  res.json(await assignConversation(conversationId(req), req.body?.assignee ?? null, await agentNames()));
});

// ---------- Saved replies ----------
function savedReplyId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid saved reply id');
  return id;
}

apiRouter.get('/saved-replies', async (req, res) => {
  res.json(await listSavedReplies());
});

apiRouter.post('/saved-replies', async (req, res) => {
  res.status(201).json(await createSavedReply(req.body ?? {}, req.agent));
});

apiRouter.put('/saved-replies/:id', async (req, res) => {
  res.json(await updateSavedReply(savedReplyId(req), req.body ?? {}));
});

apiRouter.delete('/saved-replies/:id', async (req, res) => {
  res.json(await deleteSavedReply(savedReplyId(req)));
});
