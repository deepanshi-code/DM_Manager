// "Sender" = whatever actually delivers a reply to the customer.
// "simulated" for demos and tests; "instagram" calls Meta's messaging API (SENDER=instagram).
// Keeping this behind one interface means nothing else in the app changes.
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { createInstagramClient } from '../instagram/client.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const simulatedSender = {
  name: 'simulated',
  async send({ recipientId, text }) {
    await sleep(50 + Math.random() * 150); // pretend network latency
    if (Math.random() < config.simSendFailRate) {
      throw new Error('Simulated delivery failure (SIM_SEND_FAIL_RATE)');
    }
    return { mid: `sim_out_${randomUUID()}`, recipientId, length: text.length };
  },
};

// Real delivery through Meta's API. Created lazily so a missing token only matters when used.
let igClient = null;
export function instagramClient() {
  igClient ??= createInstagramClient(config.instagram);
  return igClient;
}

export const instagramSender = {
  name: 'instagram',
  async send({ recipientId, text }) {
    return instagramClient().sendText(recipientId, text);
  },
};

let override = null;
/** Tests can inject a fake sender. */
export function setSender(sender) {
  override = sender;
}

export function getSender() {
  if (override) return override;
  return config.sender === 'instagram' ? instagramSender : simulatedSender;
}
