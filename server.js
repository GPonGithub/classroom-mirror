/**
 * Classroom Mirror — server.js
 *
 * Modes:
 *  - LIVE:    Authenticated with Google, fetches real-time data from the Classroom API.
 *  - ARCHIVE: Serves entirely from a local JSON snapshot. No Google account required.
 *             This is how the app runs after the Google account is closed.
 *
 * To create the permanent archive, log in and click "Create Snapshot" in the UI.
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'classroom-snapshot.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Google OAuth2 ────────────────────────────────────────────────────────────

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`
);

const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'classroom-mirror-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });
  oauth2Client.setCredentials(req.session.tokens);
  next();
}

function classroom() {
  return google.classroom({ version: 'v1', auth: oauth2Client });
}

/** Fetch all pages of a Classroom API list call. */
async function paginate(listFn, dataKey) {
  let all = [];
  let pageToken;
  do {
    const res = await listFn(pageToken);
    all = all.concat(res.data[dataKey] || []);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return all;
}

/** In-memory snapshot cache (so we don't re-parse the JSON on every request). */
let _snapshotCache = null;
let _snapshotMtime = null;

function loadSnapshot() {
  if (!fs.existsSync(SNAPSHOT_FILE)) return null;
  const stat = fs.statSync(SNAPSHOT_FILE);
  if (_snapshotCache && _snapshotMtime === stat.mtimeMs) return _snapshotCache;
  _snapshotCache = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  _snapshotMtime = stat.mtimeMs;
  return _snapshotCache;
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.get('/auth/login', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    req.session.tokens = tokens;
    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/auth/status', async (req, res) => {
  const snapshot = loadSnapshot();
  const snapshotInfo = snapshot
    ? {
        exists: true,
        createdAt: snapshot.createdAt,
        courseCount: snapshot.courses?.length || 0,
      }
    : { exists: false };

  if (!req.session.tokens) {
    return res.json({ authenticated: false, snapshot: snapshotInfo });
  }
  try {
    oauth2Client.setCredentials(req.session.tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: user } = await oauth2.userinfo.get();
    res.json({ authenticated: true, user, snapshot: snapshotInfo });
  } catch {
    res.json({ authenticated: false, snapshot: snapshotInfo });
  }
});

// ─── Snapshot Routes ──────────────────────────────────────────────────────────

/**
 * POST /api/snapshot/create
 * Streams progress via Server-Sent Events while building the full snapshot.
 * This is the "archive everything before account closes" operation.
 */
app.post('/api/snapshot/create', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (msg, type = 'progress') => {
    res.write(`data: ${JSON.stringify({ type, msg })}\n\n`);
  };

  (async () => {
    try {
      const cl = classroom();

      send('Fetching list of all courses…');
      const courses = await paginate(
        (pt) => cl.courses.list({ pageSize: 100, pageToken: pt, courseStates: ['ACTIVE', 'ARCHIVED'] }),
        'courses'
      );
      send(`Found ${courses.length} courses. Starting deep fetch…`);

      const fullCourses = [];

      for (let i = 0; i < courses.length; i++) {
        const course = courses[i];
        send(`[${i + 1}/${courses.length}] ${course.name}`);

        // Announcements (stream)
        let announcements = [];
        try {
          announcements = await paginate(
            (pt) => cl.courses.announcements.list({ courseId: course.id, pageSize: 50, pageToken: pt }),
            'announcements'
          );
          send(`  → ${announcements.length} announcements`);
        } catch (e) {
          send(`  ⚠ Announcements error: ${e.message}`);
        }

        // Coursework (assignments)
        let coursework = [];
        try {
          coursework = await paginate(
            (pt) => cl.courses.courseWork.list({ courseId: course.id, pageSize: 50, pageToken: pt }),
            'courseWork'
          );
          send(`  → ${coursework.length} assignments`);
        } catch (e) {
          send(`  ⚠ Coursework error: ${e.message}`);
        }

        // Student submissions for each assignment
        let totalSubmissions = 0;
        for (const cw of coursework) {
          try {
            cw.submissions = await paginate(
              (pt) => cl.courses.courseWork.studentSubmissions.list({
                courseId: course.id,
                courseWorkId: cw.id,
                pageSize: 100,
                pageToken: pt,
              }),
              'studentSubmissions'
            );
            totalSubmissions += cw.submissions.length;
          } catch (e) {
            cw.submissions = [];
          }
        }
        if (coursework.length > 0) send(`  → ${totalSubmissions} student submissions total`);

        // Student roster
        let students = [];
        try {
          students = await paginate(
            (pt) => cl.courses.students.list({ courseId: course.id, pageSize: 100, pageToken: pt }),
            'students'
          );
          send(`  → ${students.length} students`);
        } catch (e) {
          send(`  ⚠ Students error: ${e.message}`);
        }

        // Teachers
        let teachers = [];
        try {
          teachers = await paginate(
            (pt) => cl.courses.teachers.list({ courseId: course.id, pageSize: 50, pageToken: pt }),
            'teachers'
          );
        } catch (e) { /* ignore */ }

        // Fetch profiles for submission userIds — Google uses a different ID system
        // for the student roster vs. submissions, so we cross-reference by name.
        const allSubUserIds = [...new Set(coursework.flatMap(cw => (cw.submissions||[]).map(s => s.userId)))];
        const submissionProfiles = {};
        for (const userId of allSubUserIds) {
          try {
            const { data: prof } = await cl.userProfiles.get({ userId });
            submissionProfiles[userId] = {
              id: prof.id,
              name: prof.name,
              emailAddress: prof.emailAddress,
              photoUrl: prof.photoUrl,
            };
          } catch (e) { /* profile inaccessible */ }
        }

        // Build name → submissionUserId map, then stamp each roster student
        // with _submissionUserId so the frontend can look up submissions directly.
        const subNameToId = {};
        Object.entries(submissionProfiles).forEach(([subUserId, prof]) => {
          const name = (prof.name?.fullName || '').toLowerCase().trim();
          if (name) subNameToId[name] = subUserId;
        });
        students.forEach(student => {
          const rosterName = (student.profile?.name?.fullName || '').toLowerCase().trim();
          if (subNameToId[rosterName]) student._submissionUserId = subNameToId[rosterName];
        });

        send(`  → ${Object.keys(submissionProfiles).length} submission profiles resolved`);

        // Fetch the course banner image via the Classroom API.
        // courses.get sometimes returns photo/image fields not in the list response.
        let _bannerDataUrl = null;
        try {
          const { token } = await oauth2Client.getAccessToken();
          // Get full course detail — may include undocumented image fields
          const { data: courseDetail } = await cl.courses.get({ id: course.id });
          // Look for any image/photo/banner field on the object
          const imageFields = Object.entries(courseDetail)
            .filter(([k]) => /photo|image|banner|thumb|background|avatar/i.test(k));
          if (imageFields.length > 0) {
            send(`  → Found image fields: ${imageFields.map(([k,v]) => `${k}=${typeof v === 'string' ? v.slice(0,80) : typeof v}`).join(', ')}`);
            // Try to download the first image URL found
            for (const [, val] of imageFields) {
              if (typeof val === 'string' && val.startsWith('http') && token) {
                const imgRes = await fetch(val, { headers: { Authorization: `Bearer ${token}` } });
                if (imgRes.ok) {
                  const buf = Buffer.from(await imgRes.arrayBuffer());
                  const mime = imgRes.headers.get('content-type') || 'image/jpeg';
                  _bannerDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
                  send(`  → Banner image captured`);
                  break;
                }
              }
            }
          } else {
            // Log ALL fields returned so we can see what's available
            send(`  ⚠ No image fields. Course keys: ${Object.keys(courseDetail).join(', ')}`);
          }
        } catch (e) {
          send(`  ⚠ Banner fetch error: ${e.message || String(e)}`);
        }

        fullCourses.push({ ...course, announcements, coursework, students, teachers, _submissionProfiles: submissionProfiles, _bannerDataUrl });
      }

      const snapshot = {
        createdAt: new Date().toISOString(),
        appVersion: '1.2.0',
        notes: 'Stream post comments are not accessible via the Google Classroom API v1 and are not included in this snapshot.',
        courses: fullCourses,
      };

      fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
      _snapshotCache = null; // invalidate cache

      send(`✅ Snapshot complete! ${courses.length} courses archived to data/classroom-snapshot.json`, 'done');
      res.end();
    } catch (err) {
      send(`❌ Fatal error: ${err.message}`, 'error');
      res.end();
    }
  })();
});

// ─── Archive (Snapshot) API Routes ───────────────────────────────────────────
// These work without any Google authentication — they serve saved snapshot data.

app.get('/api/archive/courses', (req, res) => {
  const snapshot = loadSnapshot();
  if (!snapshot) return res.status(404).json({ error: 'No snapshot found. Please create one first.' });
  res.json(snapshot.courses.map(c => ({
    id: c.id,
    name: c.name,
    section: c.section,
    descriptionHeading: c.descriptionHeading,
    description: c.description,
    room: c.room,
    courseState: c.courseState,
    alternateLink: c.alternateLink,
    creationTime: c.creationTime,
    updateTime: c.updateTime,
    ownerId: c.ownerId,
    _hasBanner: !!c._bannerDataUrl,
    _counts: {
      announcements: c.announcements?.length || 0,
      coursework: c.coursework?.length || 0,
      students: c.students?.length || 0,
    },
  })));
});

app.get('/api/archive/courses/:courseId', (req, res) => {
  const snapshot = loadSnapshot();
  if (!snapshot) return res.status(404).json({ error: 'No snapshot' });
  const course = snapshot.courses.find(c => c.id === req.params.courseId);
  if (!course) return res.status(404).json({ error: 'Course not found in snapshot' });
  res.json(course);
});

app.get('/api/archive/banner/:courseId', (req, res) => {
  const snapshot = loadSnapshot();
  if (!snapshot) return res.status(404).send('No snapshot');
  const course = snapshot.courses.find(c => c.id === req.params.courseId);
  if (!course?._bannerDataUrl) return res.status(404).send('No banner');
  // Parse the data URL: data:<mime>;base64,<data>
  const match = course._bannerDataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return res.status(500).send('Invalid banner data');
  const [, mime, b64] = match;
  const buf = Buffer.from(b64, 'base64');
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buf);
});

// ─── Live API Routes ──────────────────────────────────────────────────────────
// Require Google authentication.

app.get('/api/live/courses', requireAuth, async (req, res) => {
  try {
    const courses = await paginate(
      (pt) => classroom().courses.list({ pageSize: 100, pageToken: pt, courseStates: ['ACTIVE', 'ARCHIVED'] }),
      'courses'
    );
    res.json(courses);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/live/courses/:courseId/announcements', requireAuth, async (req, res) => {
  try {
    const data = await paginate(
      (pt) => classroom().courses.announcements.list({ courseId: req.params.courseId, pageSize: 50, pageToken: pt }),
      'announcements'
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/live/courses/:courseId/coursework', requireAuth, async (req, res) => {
  try {
    const data = await paginate(
      (pt) => classroom().courses.courseWork.list({ courseId: req.params.courseId, pageSize: 50, pageToken: pt }),
      'courseWork'
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/live/courses/:courseId/coursework/:cwId/submissions', requireAuth, async (req, res) => {
  try {
    const data = await paginate(
      (pt) => classroom().courses.courseWork.studentSubmissions.list({
        courseId: req.params.courseId,
        courseWorkId: req.params.cwId,
        pageSize: 100,
        pageToken: pt,
      }),
      'studentSubmissions'
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/live/courses/:courseId/students', requireAuth, async (req, res) => {
  try {
    const data = await paginate(
      (pt) => classroom().courses.students.list({ courseId: req.params.courseId, pageSize: 100, pageToken: pt }),
      'students'
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🎓 Classroom Mirror running at http://localhost:${PORT}`);
  const snap = loadSnapshot();
  if (snap) {
    console.log(`📦 Snapshot found: ${snap.courses?.length} courses (created ${new Date(snap.createdAt).toLocaleDateString()})`);
    console.log(`   → Archive mode is available — no Google login required.`);
  } else {
    console.log(`   → No snapshot yet. Log in and click "Create Snapshot" to archive your classrooms.`);
  }
  console.log('');
});
