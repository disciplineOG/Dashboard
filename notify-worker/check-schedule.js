// Runs on a GitHub Actions schedule. Reads the dashboard's Firebase Realtime Database,
// works out which schedule items are due right now (per subscriber's own timezone),
// and sends a Web Push notification for each one that hasn't been sent yet.
const webpush = require('web-push');

// .trim() guards against stray leading/trailing whitespace pasted into GitHub secrets,
// which GitHub stores verbatim and would otherwise break URLs/keys silently.
const FB_DB_URL = (process.env.FB_DB_URL || '').trim();
const FB_API_KEY = (process.env.FB_API_KEY || '').trim();
const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();

// How far back to look for a "due" item, to tolerate GitHub Actions schedule drift/delay.
const LOOKBACK_MINUTES = 20;

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Mirrors timeToMins() in index.html — must stay in sync with it.
function timeToMins(t) {
  if (!t) return 9999;
  var m = String(t).match(/(\d+)(?::(\d+))?\s*(AM|PM)?/i);
  if (!m) return 9999;
  var h = parseInt(m[1], 10), min = parseInt(m[2] || 0, 10), ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function nowPartsInTz(tz) {
  var fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
  });
  var parts = {};
  fmt.formatToParts(new Date()).forEach(function(p) { parts[p.type] = p.value; });
  var dateStr = parts.year + '-' + parts.month + '-' + parts.day;
  var hour = parseInt(parts.hour, 10) % 24;
  var minute = parseInt(parts.minute, 10);
  var weekday = parts.weekday.toLowerCase().slice(0, 3);
  return { dateStr: dateStr, mins: hour * 60 + minute, weekday: weekday };
}

async function signInAnon() {
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + FB_API_KEY, {
    method: 'POST',
    body: JSON.stringify({ returnSecureToken: true })
  });
  const json = await res.json();
  if (!json.idToken) throw new Error('Firebase anonymous sign-in failed: ' + JSON.stringify(json));
  return json.idToken;
}

async function main() {
  if (!FB_DB_URL || !FB_API_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error('Missing one of FB_DB_URL / FB_API_KEY / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.');
    process.exit(1);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const token = await signInAnon();
  const base = FB_DB_URL.replace(/\/$/, '');

  const dataRes = await fetch(base + '/dashboard/data.json?auth=' + token);
  const data = (await dataRes.json()) || {};

  const subs = data.push_subscriptions || {};
  const dayTypeDefs = data.day_type_defs || {};
  const dayTypeLog = data.day_type_log || {};
  const weekMap = data.day_type_week_map || {};
  const sched = data.sched || {};
  const sentLog = data.notif_sent_log || {};

  const sentUpdates = {};
  const subRemovals = [];
  let sentCount = 0;

  for (const [subId, sub] of Object.entries(subs)) {
    if (!sub || !sub.endpoint || !sub.keys) continue;
    const tz = sub.tz || 'UTC';
    const { dateStr, mins: nowMins, weekday } = nowPartsInTz(tz);

    const type = dayTypeLog[dateStr] || weekMap[weekday] || Object.keys(dayTypeDefs)[0];
    if (!type || !dayTypeDefs[type]) continue;
    const rows = dayTypeDefs[type].schedule || [];
    const dayLabel = dayTypeDefs[type].label || type;

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri] || {};
      const rowMins = timeToMins(row.time);
      if (rowMins > nowMins || rowMins < nowMins - LOOKBACK_MINUTES) continue;

      const schedKey = 'sched_' + type + '_' + ri + '_' + dateStr;
      const sentKey = schedKey + '__' + subId;
      if (sentLog[sentKey]) continue;

      const state = sched[schedKey] || 0;
      if (state !== 0) { sentUpdates[sentKey] = true; continue; } // already marked done/skipped

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify({
            title: 'Did you do: ' + (row.task || 'this') + '?',
            body: 'Due ' + (row.time || 'now') + (dayLabel ? ' · ' + dayLabel : '') + ' — tap to mark',
            tag: schedKey,
            data: { key: schedKey, dbUrl: FB_DB_URL, apiKey: FB_API_KEY, task: row.task || 'Scheduled item' }
          })
        );
        sentUpdates[sentKey] = true;
        sentCount++;
        console.log('Sent: ' + schedKey + ' -> ' + subId);
      } catch (err) {
        console.error('Push failed for ' + subId + ':', err.statusCode || err.message);
        if (err.statusCode === 404 || err.statusCode === 410) subRemovals.push(subId);
      }
    }
  }

  if (Object.keys(sentUpdates).length > 0) {
    await fetch(base + '/dashboard/data/notif_sent_log.json?auth=' + token, {
      method: 'PATCH',
      body: JSON.stringify(sentUpdates)
    });
  }
  for (const subId of subRemovals) {
    await fetch(base + '/dashboard/data/push_subscriptions/' + subId + '.json?auth=' + token, { method: 'DELETE' });
  }

  console.log(`Checked ${Object.keys(subs).length} subscription(s), sent ${sentCount} notification(s).`);
}

main().catch(function(err) { console.error(err); process.exit(1); });
