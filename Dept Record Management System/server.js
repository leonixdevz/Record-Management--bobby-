const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3005;

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'record_management.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default schema for department collection (student records)
const DEPT_SCHEMA = [
  { name: 'student_id', label: 'Student ID', type: 'text' },
  { name: 'full_name', label: 'Full Name', type: 'text' },
  { name: 'level', label: 'Level', type: 'text' },
  { name: 'pin', label: 'PIN', type: 'text' }
];

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Create tables if they don't exist
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      fullName TEXT NOT NULL,
      salt TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schema TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      collectionId TEXT NOT NULL,
      data TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (collectionId) REFERENCES collections(id) ON DELETE CASCADE
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_records_collectionId ON records(collectionId)`);

    // The settings and corrections tables now have their final schema; relying on
    // CREATE TABLE IF NOT EXISTS below. (An earlier build dropped these tables on
    // every restart, which wiped persisted settings like dept_name and setup_done,
    // so the department name never showed in the student portal after a restart.)
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS corrections (
      id TEXT PRIMARY KEY,
      recordId TEXT NOT NULL,
      studentId TEXT,
      currentName TEXT,
      requestedName TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      note TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Check if we need to migrate from JSON
    migrateFromJsonIfNeeded();
  });
}

function migrateFromJsonIfNeeded() {
  const JSON_DB_PATH = path.join(DATA_DIR, 'db.json');
  const BACKUP_JSON_DB_PATH = path.join(DATA_DIR, 'db.json.backup');

  // Only auto-migrate the legacy JSON once; a cleared database must stay empty
  // so the first-run register page is shown instead of re-seeding an admin.
  getSetting('migrated', (migErr, migrated) => {
    if (migErr || migrated) return;
    migrateOnce(JSON_DB_PATH, BACKUP_JSON_DB_PATH);
  });
}

function migrateOnce(JSON_DB_PATH, BACKUP_JSON_DB_PATH) {
  // Check if JSON exists and we might need to migrate
  if (fs.existsSync(JSON_DB_PATH)) {
    // Check if database is empty by checking if any users exist
    db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
      if (err) {
        console.error('Error checking user count:', err);
        return;
      }

      if (row.count === 0) {
        console.log('Database appears empty, attempting migration from JSON...');
        migrateFromJson(JSON_DB_PATH, BACKUP_JSON_DB_PATH);
      } else {
        console.log('Database already has data, skipping JSON migration.');
        // Still backup JSON as precaution
        if (!fs.existsSync(BACKUP_JSON_DB_PATH)) {
          fs.copyFileSync(JSON_DB_PATH, BACKUP_JSON_DB_PATH);
          console.log('Backed up JSON database as precaution');
        }
      }
    });
  }
}

function migrateFromJson(jsonPath, backupPath) {
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    db.serialize(() => {
      // Migrate users
      if (data.users && data.users.length > 0) {
        const insertUser = db.prepare(`
          INSERT OR REPLACE INTO users (id, username, fullName, salt, passwordHash)
          VALUES (?, ?, ?, ?, ?)
        `);

        data.users.forEach(user => {
          insertUser.run(user.id, user.username, user.fullName, user.salt, user.passwordHash);
        });
        insertUser.finalize();
        console.log(`Migrated ${data.users.length} users`);
      }

      // Migrate collections and records
      if (data.collections) {
        const collectionIds = Object.keys(data.collections);
        console.log(`Migrating ${collectionIds.length} collections...`);

        const insertCollection = db.prepare(`
          INSERT OR REPLACE INTO collections (id, name, schema)
          VALUES (?, ?, ?)
        `);

        const insertRecord = db.prepare(`
          INSERT OR REPLACE INTO records (id, collectionId, data)
          VALUES (?, ?, ?)
        `);

        collectionIds.forEach(collectionId => {
          const collection = data.collections[collectionId];

          // Insert collection
          insertCollection.run(
            collectionId,
            collection.name,
            JSON.stringify(collection.schema)
          );

          // Insert records for this collection
          if (collection.data && collection.data.length > 0) {
            collection.data.forEach(record => {
              insertRecord.run(
                record.id,
                collectionId,
                JSON.stringify(record)
              );
            });
          }
        });

        insertCollection.finalize();
        insertRecord.finalize();
        console.log(`Migrated ${collectionIds.length} collections with their records`);
      }

      // Backup JSON file after successful migration
      fs.copyFileSync(jsonPath, backupPath);
      // Mark migration as done so it never auto-runs again (even if the DB is later cleared).
      setSetting('migrated', '1');
      console.log('Backup created at:', backupPath);
      console.log('Migration completed successfully!');
    });

  } catch (error) {
    console.error('Error during migration:', error);
  }
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

// ---------------------------------------------------------------------------
// 2.3 SETTINGS HELPERS
// ---------------------------------------------------------------------------
function getSetting(key, callback) {
  db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
    if (err) return callback(err, null);
    callback(null, row ? row.value : null);
  });
}

function setSetting(key, value, callback = () => {}) {
  db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
    callback
  );
}

// ---------------------------------------------------------------------------
// 2.4 PRIMARY COLLECTION HELPERS
// ---------------------------------------------------------------------------
// The app is departmental and "use once": there is a single primary collection
// created during onboarding. This helper returns it from the stored id, falling
// back to the oldest collection.
function getPrimaryCollection(callback) {
  getSetting('primary_collection', (err, primaryId) => {
    if (err) return callback(err, null);
    const sql = primaryId
      ? 'SELECT * FROM collections WHERE id = ?'
      : 'SELECT * FROM collections ORDER BY createdAt LIMIT 1';
    const params = primaryId ? [primaryId] : [];
    db.get(sql, params, (err2, col) => {
      if (err2) return callback(err2, null);
      if (!col) return callback(null, null);
      callback(null, { ...col, schema: JSON.parse(col.schema) });
    });
  });
}

// Get the department collection (same as primary collection for backward compatibility)
function getDepartmentCollection(callback) {
  getPrimaryCollection(callback);
}

// ---------------------------------------------------------------------------
// 2. AUTHENTICATION
// ---------------------------------------------------------------------------
const sessions = new Map();
const SESSION_HOURS = 8;

function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_HOURS * 60 * 60 * 1000 });
  return token;
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token ? sessions.get(token) : null;
  if (!session || Date.now() > session.expiresAt) return res.status(401).json({ error: 'Unauthorized' });
  req.user = session.username;
  next();
}

// ---------------------------------------------------------------------------
// 3. MIDDLEWARE & STATIC FILES
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(PUBLIC_DIR)); // Serve UI from /public
app.use('/student', express.static(path.join(__dirname, 'student-public'))); // Student portal at /student
app.use('/students-detail', express.static(path.join(__dirname, '..', 'Students Detail View'))); // Student detail view at /students-detail

// ---------------------------------------------------------------------------
// 4. AUTH ROUTES
// ---------------------------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!user || user.passwordHash !== hashPassword(password, user.salt)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = createSession(user.username);
    res.json({ token, username: user.username, fullName: user.fullName });
  });
});

app.post('/api/logout', authMiddleware, (req, res) => {
  const header = req.headers.authorization || '';
  sessions.delete(header.slice(7));
  res.json({ message: 'Logged out' });
});

// ---------------------------------------------------------------------------
// 4.5 SETUP / FIRST-RUN FLOW
// ---------------------------------------------------------------------------
// First-run is driven purely by whether any admin account exists:
// if there are no users, the register page is shown; once an account
// exists, registration is never shown again.
app.get('/api/setup/status', (req, res) => {
  db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    const setupDone = row.count > 0;
    res.json({ setupDone, deptName: null });
  });
});

app.post('/api/setup/register', (req, res) => {
  const { deptName, deptCode, institution, username, password, fullName } = req.body || {};
  if (!deptName || !username || !password) {
    return res.status(400).json({ error: 'deptName, username and password are required' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // Registration is only allowed when no account exists yet.
  db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (row.count > 0) return res.status(409).json({ error: 'Setup already completed' });

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);

    db.run(
      'INSERT INTO users (id, username, fullName, salt, passwordHash) VALUES (?, ?, ?, ?, ?)',
      [crypto.randomUUID(), username, fullName || 'Administrator', salt, passwordHash],
      function(err2) {
        if (err2) return res.status(500).json({ error: 'Database error' });

        setSetting('dept_name', deptName);
        setSetting('dept_code', deptCode || '');
        setSetting('institution', institution || '');

        const token = createSession(username);
        res.status(201).json({ token, username, fullName: fullName || 'Administrator', deptName });
      }
    );
  });
});

app.post('/api/setup/onboard', authMiddleware, (req, res) => {
  const { name, schema } = req.body || {};

  // If name and schema provided, use them; otherwise fall back to default behavior
  if (name && Array.isArray(schema)) {
    const id = crypto.randomUUID();
    db.run(
      'INSERT INTO collections (id, name, schema) VALUES (?, ?, ?)',
      [id, name, JSON.stringify(schema)],
      function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        setSetting('setup_done', '1');
        res.json({ collection: { id, name, schema }, message: 'Onboarding complete' });
      }
    );
  } else {
    // Fallback to original behavior for backward compatibility
    getDepartmentCollection((err, existingCol) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      const finish = (col) => {
        setSetting('setup_done', '1');
        res.json({ collection: col, message: 'Onboarding complete' });
      };

      if (existingCol) return finish(existingCol);

      const id = crypto.randomUUID();
      db.run(
        'INSERT INTO collections (id, name, schema) VALUES (?, ?, ?)',
        [id, 'dept-students-field', JSON.stringify(DEPT_SCHEMA)],
        function(err2) {
          if (err2) return res.status(500).json({ error: 'Database error' });
          finish({ id, name: 'dept-students-field', schema: DEPT_SCHEMA });
        }
      );
    });
  }
});

// The single department collection (dept dashboard).
app.get('/api/collection/primary', authMiddleware, (req, res) => {
  getPrimaryCollection((err, col) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!col) return res.status(404).json({ error: 'No department collection yet' });
    res.json(col);
  });
});

// ---------------------------------------------------------------------------
// 4.7 STUDENT PORTAL (PUBLIC)
// ---------------------------------------------------------------------------
app.post('/api/student/login', (req, res) => {
  const { studentId, pin } = req.body || {};
  if (!studentId || !pin) return res.status(400).json({ error: 'Student ID and PIN are required' });

  getPrimaryCollection((err, col) => {
    if (err || !col) return res.status(404).json({ error: 'No student collection found' });

    db.all('SELECT id, data FROM records WHERE collectionId = ?', [col.id], (err2, rows) => {
      if (err2) return res.status(500).json({ error: 'Database error' });

      // Pin the canonical DB row id over any id stored inside the record JSON so a
      // corrupt/imported id can never shadow the real row id (mirrors GET /api/records/:colId).
      const found = rows
        .map(r => ({ ...JSON.parse(r.data), id: r.id }))
        .find(r => String(r.student_id || '').trim().toLowerCase() === String(studentId).trim().toLowerCase()
                && String(r.pin || '').trim() === String(pin).trim());

      if (!found) return res.status(401).json({ error: 'Invalid Student ID or PIN' });

      getSetting('dept_name', (err3, deptName) => {
        res.json({ recordId: found.id, name: found.full_name, level: found.level, deptName });
      });
    });
  });
});

app.get('/api/student/data', (req, res) => {
  const recordId = req.query.recordId;
  if (!recordId) return res.status(400).json({ error: 'recordId is required' });

  db.get('SELECT id, data FROM records WHERE id = ?', [recordId], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Record not found' });

    const record = JSON.parse(row.data);
    delete record.pin;
    res.json(record);
  });
});

// Get courses for a student from the record's stored data.courses
app.get('/api/student/courses', (req, res) => {
  const recordId = req.query.recordId;
  if (!recordId) return res.status(400).json({ error: 'recordId is required' });

  db.get('SELECT data FROM records WHERE id = ?', [recordId], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Record not found' });

    const record = JSON.parse(row.data);
    res.json(Array.isArray(record.courses) ? record.courses : []);
  });
});

// Add a course to a student's record (admin only)
app.post('/api/courses/:recordId', authMiddleware, (req, res) => {
  const recordId = req.params.recordId;
  const course = req.body || {};
  const { session, level, semester, courseCode, courseTitle, creditUnits, score } = course;

  if (!recordId) return res.status(400).json({ error: 'recordId is required' });
  if (!courseCode || !creditUnits) {
    return res.status(400).json({ error: 'Course code and credit units are required' });
  }

  db.get('SELECT id, data FROM records WHERE id = ?', [recordId], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Record not found' });

    const record = JSON.parse(row.data);
    record.courses = record.courses || [];

    const newCourse = {
      id: recordId + '-' + Date.now(),
      session: session || '',
      level: level || '',
      semester: semester === undefined ? 1 : semester,
      courseCode,
      courseTitle: courseTitle || '',
      creditUnits,
      score: score === undefined ? 0 : score,
      gradePoint: scoreToGradePoint(score)
    };

    record.courses.push(newCourse);

    db.run('UPDATE records SET data = ? WHERE id = ?', [JSON.stringify(record), recordId], function(err2) {
      if (err2) return res.status(500).json({ error: 'Database error' });
      res.status(201).json(newCourse);
    });
  });
});

// Convert a numeric score to a grade point on the standard 5-point scale
function scoreToGradePoint(score) {
  const s = Number(score);
  if (isNaN(s)) return 0;
  if (s >= 70) return 5.0;
  if (s >= 60) return 4.0;
  if (s >= 50) return 3.0;
  if (s >= 45) return 2.0;
  if (s >= 40) return 1.0;
  return 0.0;
}

app.post('/api/student/correction', (req, res) => {
  const { recordId, requestedName, note } = req.body || {};
  if (!recordId || !requestedName) {
    return res.status(400).json({ error: 'recordId and requestedName are required' });
  }

  db.get('SELECT id, data FROM records WHERE id = ?', [recordId], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Record not found' });

    const record = JSON.parse(row.data);
    db.run(
      'INSERT INTO corrections (id, recordId, studentId, currentName, requestedName, status, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), recordId, record.student_id || '', record.full_name || '', requestedName, 'pending', note || ''],
      function(err2) {
        if (err2) return res.status(500).json({ error: 'Database error' });
        res.status(201).json({ message: 'Correction submitted for review', status: 'pending' });
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 4.8 CORRECTIONS REVIEW (ADMIN)
// ---------------------------------------------------------------------------
app.get('/api/corrections', authMiddleware, (req, res) => {
  db.all('SELECT * FROM corrections ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, createdAt DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.post('/api/corrections/:id/:action', authMiddleware, (req, res) => {
  const { id, action } = req.params;
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  db.get('SELECT * FROM corrections WHERE id = ?', [id], (err, corr) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!corr) return res.status(404).json({ error: 'Correction not found' });
    if (corr.status !== 'pending') return res.status(409).json({ error: 'Correction already decided' });

    const apply = () => {
      db.run('UPDATE corrections SET status = ? WHERE id = ?', [action, id], function(err3) {
        if (err3) return res.status(500).json({ error: 'Database error' });
        res.json({ message: `Correction ${action}d`, status: action });
      });
    };

    if (action === 'reject') return apply();

    // Approve: update the student's full_name in the record
    db.get('SELECT id, data FROM records WHERE id = ?', [corr.recordId], (err2, row) => {
      if (err2) return res.status(500).json({ error: 'Database error' });
      if (!row) {
        // Record may have been deleted; still mark the correction
        return apply();
      }
      const record = JSON.parse(row.data);
      record.full_name = corr.requestedName;
      const newCreatedAt = record.createdAt || row.createdAt;

      db.run(
        'UPDATE records SET data = ?, createdAt = ? WHERE id = ?',
        [JSON.stringify(record), newCreatedAt, corr.recordId],
        function(err3) {
          if (err3) return res.status(500).json({ error: 'Database error' });
          apply();
        }
      );
    });
  });
});

// Get the primary collection (the one created during onboarding)
// If none, returns the most recently created collection.
app.get('/api/collection/primary', authMiddleware, (req, res) => {
  db.all('SELECT id, name, schema, createdAt FROM collections ORDER BY createdAt DESC LIMIT 1', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!rows.length) return res.status(404).json({ error: 'No collections found' });
    const row = rows[0];
    res.json({
      id: row.id,
      name: row.name,
      schema: JSON.parse(row.schema),
      createdAt: row.createdAt,
      count: 0 // could compute count but not needed for now
    });
  });
});

// ---------------------------------------------------------------------------
// 5. COLLECTION & SCHEMA MANAGEMENT
// ---------------------------------------------------------------------------
app.get('/api/collections', authMiddleware, (req, res) => {
  db.all('SELECT id, name, schema, createdAt FROM collections ORDER BY createdAt', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    // Get per-collection record counts and merge into response
    db.all('SELECT collectionId, COUNT(*) as cnt FROM records GROUP BY collectionId', [], (err2, counts) => {
      if (err2) return res.status(500).json({ error: 'Database error' });
      const countsMap = new Map();
      (counts || []).forEach(c => countsMap.set(c.collectionId, c.cnt));

      const collections = rows.map(row => ({
        id: row.id,
        name: row.name,
        schema: JSON.parse(row.schema),
        createdAt: row.createdAt,
        count: countsMap.get(row.id) || 0
      }));

      res.json(collections);
    });
  });
});

app.post('/api/collections', authMiddleware, (req, res) => {
  const { name, schema } = req.body;
  if (!name || !Array.isArray(schema)) {
    return res.status(400).json({ error: 'Name and schema array are required' });
  }
  getPrimaryCollection((err, primary) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (primary) {
      return res.status(409).json({ error: 'A department collection already exists.' });
    }

    const id = crypto.randomUUID();
    const schemaJson = JSON.stringify(schema);

    db.run(
      'INSERT INTO collections (id, name, schema) VALUES (?, ?, ?)',
      [id, name, schemaJson],
      function(err2) {
        if (err2) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.status(201).json({ id, name, schema, createdAt: new Date().toISOString() });
      }
    );
  });
});

app.put('/api/collections/:id', authMiddleware, (req, res) => {
  const { name, schema } = req.body;
  const collectionId = req.params.id;

  let updateFields = [];
  let values = [];

  if (name !== undefined) {
    updateFields.push('name = ?');
    values.push(name);
  }

  if (schema !== undefined && Array.isArray(schema)) {
    updateFields.push('schema = ?');
    values.push(JSON.stringify(schema));
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values.push(collectionId);

  const query = `UPDATE collections SET ${updateFields.join(', ')} WHERE id = ?`;

  db.run(query, values, function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Fetch updated collection
    db.get('SELECT id, name, schema, createdAt FROM collections WHERE id = ?', [collectionId], (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!row) {
        return res.status(404).json({ error: 'Collection not found' });
      }
      res.json({
        id: row.id,
        name: row.name,
        schema: JSON.parse(row.schema),
        createdAt: row.createdAt
      });
    });
  });
});

app.delete('/api/collections/:id', authMiddleware, (req, res) => {
  const collectionId = req.params.id;

  getPrimaryCollection((err, primary) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (primary && primary.id === collectionId) {
      return res.status(403).json({ error: 'The department collection cannot be deleted.' });
    }

    // Delete associated records first (due to foreign key constraint)
    db.run('DELETE FROM records WHERE collectionId = ?', [collectionId], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Delete collection
      db.run('DELETE FROM collections WHERE id = ?', [collectionId], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Collection not found' });
        }
        res.json({ message: 'Deleted' });
      });
    });
  });
});

// ---------------------------------------------------------------------------
// 6. RECORD MANAGEMENT (CRUD + SEARCH + FILTER)
// ---------------------------------------------------------------------------
app.get('/api/records/:colId', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;
  const { search, filter } = req.query;

  // First verify collection exists
  db.get('SELECT id FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    let query = 'SELECT id, data, createdAt FROM records WHERE collectionId = ?';
    const params = [collectionId];

    if (search) {
      // For search, we need to fetch all records and filter in memory
      // since searching across JSON fields is complex in SQL
      query = 'SELECT id, data, createdAt FROM records WHERE collectionId = ?';
    }

    if (filter) {
      try {
        const { field, value } = JSON.parse(filter);
        // For filtering on JSON fields, we'll fetch and filter in memory
        // for simplicity. In a production app with lots of data,
        // we might want to use SQLite's JSON functions or denormalize
      } catch (e) {
        return res.status(400).json({ error: 'Invalid filter format' });
      }
    }

    db.all(query, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Parse JSON data and apply client-side filtering
      // Spread the record data first, then pin the canonical DB row id over it so
      // a corrupt/imported `id` inside the stored JSON can never shadow the real id.
      let records = rows.map(row => ({
        ...JSON.parse(row.data),
        id: row.id,
        createdAt: row.createdAt
      }));

      // Apply search filter (client-side)
      if (search) {
        const q = search.toLowerCase();
        records = records.filter(rec =>
          Object.values(rec).some(val =>
            val !== undefined && val !== null &&
            String(val).toLowerCase().includes(q)
          )
        );
      }

      // Apply filter (client-side)
      if (filter) {
        try {
          const { field, value } = JSON.parse(filter);
          records = records.filter(rec =>
            String(rec[field]) === String(value)
          );
        } catch (e) {
          // If filter parsing fails, ignore filter
        }
      }

      res.json(records);
    });
  });
});

app.post('/api/records/:colId', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;

  // Verify collection exists
  db.get('SELECT id FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const record = {
      id: crypto.randomUUID(),
      ...req.body,
      createdAt: new Date().toISOString()
    };

    db.run(
      'INSERT INTO records (id, collectionId, data) VALUES (?, ?, ?)',
      [record.id, collectionId, JSON.stringify(record)],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.status(201).json(record);
      }
    );
  });
});

app.put('/api/records/:colId/:recId', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;
  const recordId = req.params.recId;

  // Verify collection exists
  db.get('SELECT id FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Verify record exists and belongs to collection
    db.get('SELECT id FROM records WHERE id = ? AND collectionId = ?', [recordId, collectionId], (err, record) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!record) {
        return res.status(404).json({ error: 'Record not found' });
      }

      // Update record - merge existing data with new data
      db.get('SELECT data FROM records WHERE id = ? AND collectionId = ?', [recordId, collectionId], (err, row) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        if (!row) {
          return res.status(404).json({ error: 'Record not found' });
        }

        const existingData = JSON.parse(row.data);
        const updatedData = { ...existingData, ...req.body, id: recordId, collectionId };
        // Keep original createdAt, update only if provided
        if (!req.body.createdAt) {
          updatedData.createdAt = existingData.createdAt;
        } else {
          updatedData.createdAt = req.body.createdAt;
        }

        db.run(
          'UPDATE records SET data = ?, createdAt = ? WHERE id = ? AND collectionId = ?',
          [JSON.stringify(updatedData), updatedData.createdAt, recordId, collectionId],
          function(err) {
            if (err) {
              return res.status(500).json({ error: 'Database error' });
            }
            res.json(updatedData);
          }
        );
      });
    });
  });
});

app.delete('/api/records/:colId/:recId', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;
  const recordId = req.params.recId;

  // Verify collection exists
  db.get('SELECT id FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Delete record
    db.run(
      'DELETE FROM records WHERE id = ? AND collectionId = ?',
      [recordId, collectionId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Record not found' });
        }
        res.json({ message: 'Deleted' });
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 7. SMART TOOLS (EXPORT, IMPORT, DEDUPLICATE)
// ---------------------------------------------------------------------------
app.get('/api/records/:colId/export', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;

  // Verify collection exists
  db.get('SELECT name FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    db.all('SELECT data, createdAt FROM records WHERE collectionId = ? ORDER BY createdAt', [collectionId], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const records = rows.map(row => ({
        ...JSON.parse(row.data),
        createdAt: row.createdAt
      }));

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=${collection.name}.json`);
      res.send(JSON.stringify(records, null, 2));
    });
  });
});

app.post('/api/records/:colId/import', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;

  // Verify collection exists
  db.get('SELECT id FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const importedData = req.body;
    if (!Array.isArray(importedData)) {
      return res.status(400).json({ error: 'Import data must be an array' });
    }

    db.serialize(() => {
      importedData.forEach(newRec => {
        // Ensure record has an ID
        const recordId = newRec.id || crypto.randomUUID();
        const recordData = {
          ...newRec,
          id: recordId,
          collectionId,
          createdAt: newRec.createdAt || new Date().toISOString()
        };

        db.run(
          'INSERT OR REPLACE INTO records (id, collectionId, data) VALUES (?, ?, ?)',
          [recordId, collectionId, JSON.stringify(recordData)],
          function(err) {
            if (err) {
              console.error('Error importing record:', err);
            }
          }
        );
      });

      res.json({ message: `Imported ${importedData.length} records` });
    });
  });
});

app.post('/api/records/:colId/deduplicate', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;
  const { field } = req.body;

  if (!field) {
    return res.status(400).json({ error: 'Field to deduplicate is required' });
  }

  // Verify collection exists
  db.get('SELECT id FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Fetch all records for deduplication (client-side for simplicity)
    db.all('SELECT id, data FROM records WHERE collectionId = ?', [collectionId], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const records = rows.map(row => ({
        id: row.id,
        ...JSON.parse(row.data)
      }));

      const seen = new Set();
      const recordsToKeep = [];
      const recordsToRemove = [];

      records.forEach(record => {
        const val = String(record[field] || '').toLowerCase().trim();
        if (!seen.has(val)) {
          seen.add(val);
          recordsToKeep.push(record);
        } else {
          recordsToRemove.push(record);
        }
      });

      // Remove duplicates
      if (recordsToRemove.length > 0) {
        db.serialize(() => {
          recordsToRemove.forEach(record => {
            db.run('DELETE FROM records WHERE id = ? AND collectionId = ?', [record.id, collectionId]);
          });
        });
      }

      res.json({
        message: `Removed ${recordsToRemove.length} duplicates`,
        removedCount: recordsToRemove.length
      });
    });
  });
});

// ---------------------------------------------------------------------------
// 7.5 ADMIN SETTINGS: CLEAR DATABASE (RESET TO FIRST-RUN)
// ---------------------------------------------------------------------------
app.post('/api/admin/clear', authMiddleware, (req, res) => {
  db.serialize(() => {
    db.run('DELETE FROM courses');
    db.run('DELETE FROM corrections');
    db.run('DELETE FROM records');
    db.run('DELETE FROM collections');
    db.run('DELETE FROM users');
    db.run('DELETE FROM settings');
  });

  // Invalidate all sessions so any logged-in browser is forced to re-auth.
  sessions.clear();

  // Remove legacy JSON seed files so nothing gets re-imported on restart.
  try { fs.unlinkSync(path.join(DATA_DIR, 'db.json')); } catch (e) {}
  try { fs.unlinkSync(path.join(DATA_DIR, 'db.json.backup')); } catch (e) {}

  // Wait briefly for deletes to flush, then confirm.
  setTimeout(() => {
    res.json({ message: 'Database cleared. The app will return to first-run setup.' });
  }, 100);
});

// ---------------------------------------------------------------------------
// 8. START SERVER
// ---------------------------------------------------------------------------
db.on('close', () => {
  console.log('Database connection closed.');
});

process.on('SIGINT', () => {
  db.close(() => {
    console.log('Database connection closed due to SIGINT');
    process.exit(0);
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});