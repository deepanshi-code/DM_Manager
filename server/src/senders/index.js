// "Sender" = whatever actually delivers a reply to the customer.
// Phase 1 uses a simulated sender; Phase 4 swaps in the Instagram Graph API.
// Keeping this behind one interface means nothing else in the app changes.
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

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

export const instagramSender = {
  name: 'instagram',
  async send() {
    // Phase 4: call the Instagram messaging Send API with the page/business access token.
    // Check Meta's current docs for the exact endpoint, API version and permissions
    // (e.g. instagram_business_manage_messages) before implementing this.
    throw new Error('Instagram sender not implemented yet (Phase 4)');
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
