import { config } from './config.js';

// One job: send a text message. Swap the provider with SMS_PROVIDER.
//   mock   -> prints to the console, sends nothing (login code is 000000)
//   twilio -> real SMS through Twilio's REST API
// Before launch: test delivery to real Digicel and Natcom numbers. Some SMS providers
// deliver poorly to Haiti. If so, add a local provider here (same function shape).
let override = null;
export const setSender = (fn) => { override = fn; }; // for tests

const providers = {
  async mock(phone, text) { console.log(`[sms:mock] to ${phone}: ${text}`); },

  async twilio(phone, text) {
    if (!config.twilioSid || !config.twilioToken || !(config.twilioFrom || config.twilioMessagingService))
      throw new Error('Twilio is not set up. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID).');
    const body = new URLSearchParams({ To: phone, Body: text });
    if (config.twilioMessagingService) body.set('MessagingServiceSid', config.twilioMessagingService);
    else body.set('From', config.twilioFrom);
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!r.ok) throw new Error('SMS provider refused the message (' + r.status + ')');
  },
};

export async function sendSms(phone, text) {
  if (override) return override(phone, text);
  const p = providers[config.smsProvider];
  if (!p) throw new Error('Unknown SMS_PROVIDER: ' + config.smsProvider);
  return p(phone, text);
}
