import { config } from './config.js';

// One job: send a text message. Swap the provider with SMS_PROVIDER.
//   mock   -> prints to the console, sends nothing (login code is 000000)
//   twilio -> real SMS through Twilio's REST API
// Before launch: test delivery to real Digicel and Natcom numbers. Some SMS providers
// deliver poorly to Haiti. If so, add a local provider here (same function shape).
let override = null;
let mailOverride = null;
export const setMailer = (fn) => { mailOverride = fn; }; // for tests

// Send one email through Brevo's API. Used for login codes when SMS_PROVIDER=email.
export async function sendEmail(to, subject, text) {
  if (mailOverride) return mailOverride(to, subject, text);
  if (!config.brevoKey || !config.mailFrom) throw new Error('Email is not set up. Set BREVO_API_KEY and MAIL_FROM.');
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': config.brevoKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: config.mailFromName, email: config.mailFrom }, to: [{ email: to }], subject, textContent: text,
      htmlContent: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#14211c">${esc(text).replace(/\n/g, '<br>')}</div>`,
    }),
  });
  if (!r.ok) throw new Error('Email provider refused the message (' + r.status + '): ' + (await r.text().catch(() => '')).slice(0, 300));
}
export const setSender = (fn) => { override = fn; }; // for tests

const providers = {
  async mock(phone, text) { console.log(`[sms:mock] to ${phone}: ${text}`); },

  // No SMS: the message goes to the email on the account with this phone (or the email given for a new sign-up).
  async email(phone, text, email) {
    let to = email;
    if (!to) {
      const { q } = await import('./db.js');
      to = (await q('SELECT email FROM users WHERE phone=$1', [phone])).rows[0]?.email;
    }
    if (!to) throw new Error('No email for this phone.');
    await sendEmail(to, 'Ayiti P2P', text);
  },

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

export async function sendSms(phone, text, email) {
  if (override && config.smsProvider !== 'email') return override(phone, text);
  const p = providers[config.smsProvider];
  if (!p) throw new Error('Unknown SMS_PROVIDER: ' + config.smsProvider);
  return p(phone, text, email);
}
