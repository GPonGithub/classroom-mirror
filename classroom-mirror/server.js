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

        fullCourses.push({ ...course, announcements, coursework, students, teachers });
      }

      const snapshot = {
        createdAt: new Date().toISOString(),
        appVersion: '1.0.0',
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
