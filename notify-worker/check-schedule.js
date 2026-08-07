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

// With an external pinger (e.g. cron-job.org) driving workflow_dispatch every ~5 minutes
// instead of relying on GitHub's own unreliable `schedule:` trigger, runs happen close to
// on-time. This only needs to cover occasional pinger/runner-queue delays, not GitHub's
// observed ~90 minute scheduling gaps. Overlap with the previous run's window is fine —
// notif_sent_log dedupes by schedKey+subId, so re-checking an already-sent item is a no-op.
const LOOKBACK_MINUTES = 15;

// Task due-date reminders fire once daily at this local time (per subscriber's own
// timezone), not continuously — tasks only carry a due DATE, not a time of day.
const TASK_NOTIFY_HOUR = 9;
const TASK_NOTIFY_MINUTE = 0;

// Consecutive Web Push failures (any non-404/410 error) before we drop a subscription.
// 404/410 mean "gone" and are removed immediately; other errors could be transient
// (rate limits, brief outages), so we give them a few tries before giving up.
const MAX_CONSECUTIVE_FAILURES = 5;

// Prune notif_sent_log entries older than this — the log only needs to dedup recent
// sends, and otherwise grows forever since every scheduled item writes one entry per subscriber.
const SENT_LOG_RETENTION_DAYS = 14;

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

// Day-only diff, immune to DST/timezone-offset drift since both sides are parsed as UTC.
function ymdToUTC(ymd) {
  var p = String(ymd).split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
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

// Fetches only the subtrees this worker actually needs instead of the whole
// dashboard/data tree (which also holds expenses/notes/fitness history —
// unrelated data that only adds bandwidth and latency to every run).
async function fetchNeededData(base, token) {
  const keys = ['push_subscriptions', 'day_type_defs', 'day_type_log', 'day_type_week_map', 'sched', 'notif_sent_log', 'push_failure_counts', 'tasks_active_list'];
  const results = await Promise.all(keys.map(function(k) {
    return fetch(base + '/dashboard/data/' + k + '.json?auth=' + token).then(function(r) { return r.json(); });
  }));
  const data = {};
  keys.forEach(function(k, i) { data[k] = results[i] || {}; });
  return data;
}

function pruneSentLog(sentLog) {
  const cutoff = Date.now() - SENT_LOG_RETENTION_DAYS * 86400000;
  const pruned = {};
  let removed = 0;
  Object.keys(sentLog).forEach(function(key) {
    const m = key.match(/(\d{4}-\d{2}-\d{2})/);
    const ts = m ? new Date(m[1] + 'T00:00:00Z').getTime() : NaN;
    if (!isNaN(ts) && ts < cutoff) { removed++; return; }
    pruned[key] = sentLog[key];
  });
  return { pruned: pruned, removed: removed };
}

async function writeHeartbeat(base, token, payload) {
  try {
    await fetch(base + '/dashboard/data/notif_worker_heartbeat.json?auth=' + token, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error('Heartbeat write failed:', e.message);
  }
}

async function main() {
  if (!FB_DB_URL || !FB_API_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error('Missing one of FB_DB_URL / FB_API_KEY / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.');
    process.exit(1);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const base = FB_DB_URL.replace(/\/$/, '');
  const token = await signInAnon();

  const data = await fetchNeededData(base, token);
  const subs = data.push_subscriptions;
  const dayTypeDefs = data.day_type_defs;
  const dayTypeLog = data.day_type_log;
  const weekMap = data.day_type_week_map;
  const sched = data.sched;
  const sentLog = data.notif_sent_log;
  const failureCounts = data.push_failure_counts;
  const tasks = data.tasks_active_list;

  const sentUpdates = {};
  const subRemovals = [];
  const failureUpdates = {};
  let sentCount = 0;

  // Shared send/failure-tracking path for both the schedule loop and the task loop below —
  // a subscription that's gone (404/410) or repeatedly failing should be dropped regardless
  // of which kind of notification triggered the failure.
  async function sendAndTrack(subId, sub, payload) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload));
      sentCount++;
      failureUpdates[subId] = 0; // reset on any successful send
      return true;
    } catch (err) {
      console.error('Push failed for ' + subId + ':', err.statusCode || err.message);
      if (err.statusCode === 404 || err.statusCode === 410) {
        subRemovals.push(subId);
      } else {
        const prevFails = failureUpdates[subId] != null ? failureUpdates[subId] : (failureCounts[subId] || 0);
        const nextFails = prevFails + 1;
        failureUpdates[subId] = nextFails;
        if (nextFails >= MAX_CONSECUTIVE_FAILURES) {
          console.error('Dropping ' + subId + ' after ' + nextFails + ' consecutive failures.');
          subRemovals.push(subId);
        }
      }
      return false;
    }
  }

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

      const ok = await sendAndTrack(subId, sub, {
        title: '⏰ ' + (row.task || 'Reminder'),
        body: (row.time || 'now') + (dayLabel ? ' · ' + dayLabel : '') + ' — mark it done below',
        tag: schedKey,
        renotify: true,
        data: { type: 'sched', key: schedKey, dbUrl: FB_DB_URL, apiKey: FB_API_KEY, task: row.task || 'Scheduled item' }
      });
      if (ok) {
        sentUpdates[sentKey] = true;
        console.log('Sent: ' + schedKey + ' -> ' + subId);
      }
    }
  }

  // Task due-date reminders — fire once per subscriber per day, at TASK_NOTIFY_HOUR local
  // time: 5 days out, 2 days out, on the due day, then daily for every day it's overdue
  // until the task is marked complete (which removes it from tasks_active_list entirely).
  const taskTargetMins = TASK_NOTIFY_HOUR * 60 + TASK_NOTIFY_MINUTE;
  for (const [subId, sub] of Object.entries(subs)) {
    if (!sub || !sub.endpoint || !sub.keys) continue;
    const tz = sub.tz || 'UTC';
    const { dateStr, mins: nowMins } = nowPartsInTz(tz);
    if (nowMins < taskTargetMins || nowMins >= taskTargetMins + LOOKBACK_MINUTES) continue;

    for (const [taskId, task] of Object.entries(tasks)) {
      if (!task || !task.name || !task.date) continue;
      const daysLeft = Math.round((ymdToUTC(task.date) - ymdToUTC(dateStr)) / 86400000);

      let title, body;
      if (daysLeft === 5) { title = '📅 ' + task.name; body = 'Due in 5 days (' + task.date + ')'; }
      else if (daysLeft === 2) { title = '📅 ' + task.name; body = 'Due in 2 days (' + task.date + ')'; }
      else if (daysLeft === 0) { title = '📅 ' + task.name; body = 'Due today'; }
      else if (daysLeft < 0) { title = '⚠️ ' + task.name; body = 'Overdue by ' + Math.abs(daysLeft) + ' day' + (Math.abs(daysLeft) === 1 ? '' : 's'); }
      else continue; // no milestone for other day counts (e.g. 4, 3, 1 days out)

      const sentKey = 'task_' + taskId + '_' + dateStr + '__' + subId;
      if (sentLog[sentKey]) continue;

      const ok = await sendAndTrack(subId, sub, {
        title: title,
        body: body,
        tag: 'task-' + taskId,
        renotify: true,
        data: { type: 'task', dbUrl: FB_DB_URL, apiKey: FB_API_KEY, task: task.name }
      });
      if (ok) {
        sentUpdates[sentKey] = true;
        console.log('Sent: ' + sentKey);
      }
    }
  }

  const { pruned: prunedSentLog, removed: prunedCount } = pruneSentLog(Object.assign({}, sentLog, sentUpdates));

  await fetch(base + '/dashboard/data/notif_sent_log.json?auth=' + token, {
    method: 'PUT',
    body: JSON.stringify(prunedSentLog)
  });

  for (const subId of subRemovals) {
    await fetch(base + '/dashboard/data/push_subscriptions/' + subId + '.json?auth=' + token, { method: 'DELETE' });
    await fetch(base + '/dashboard/data/push_failure_counts/' + subId + '.json?auth=' + token, { method: 'DELETE' });
    delete failureUpdates[subId];
  }
  if (Object.keys(failureUpdates).length > 0) {
    await fetch(base + '/dashboard/data/push_failure_counts.json?auth=' + token, {
      method: 'PATCH',
      body: JSON.stringify(failureUpdates)
    });
  }

  console.log(`Checked ${Object.keys(subs).length} subscription(s), sent ${sentCount} notification(s), pruned ${prunedCount} old log entries.`);

  await writeHeartbeat(base, token, {
    at: new Date().toISOString(),
    ok: true,
    subsChecked: Object.keys(subs).length,
    sentCount: sentCount,
    prunedCount: prunedCount
  });
}

main().catch(async function(err) {
  console.error(err);
  try {
    const base = FB_DB_URL.replace(/\/$/, '');
    const token = await signInAnon();
    await writeHeartbeat(base, token, { at: new Date().toISOString(), ok: false, error: String(err && err.message || err) });
  } catch (e) {
    console.error('Failed to write failure heartbeat:', e.message);
  }
  process.exit(1);
});
