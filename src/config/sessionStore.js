const session = require('express-session');
const { db } = require('./database');

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    // Inisialisasi tabel sessions di database SQLite agar sesi persisten melintasi restart server
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired DATETIME NOT NULL
      )
    `).catch(err => {
      console.error('Inisialisasi tabel sessions error:', err);
    });
  }

  get(sid, fn) {
    db.get('SELECT sess, expired FROM sessions WHERE sid = ?', [sid])
      .then(row => {
        if (!row) return fn(null, null);
        if (new Date(row.expired).getTime() < Date.now()) {
          this.destroy(sid, () => {});
          return fn(null, null);
        }
        try {
          const data = JSON.parse(row.sess);
          fn(null, data);
        } catch (e) {
          fn(e);
        }
      })
      .catch(err => fn(err));
  }

  set(sid, sess, fn) {
    let maxAge = 14 * 24 * 60 * 60 * 1000;
    if (sess && sess.cookie && sess.cookie.maxAge) {
      maxAge = sess.cookie.maxAge;
    }
    const expired = new Date(Date.now() + maxAge).toISOString();
    const data = JSON.stringify(sess);

    db.run(
      'INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)',
      [sid, data, expired]
    )
      .then(() => fn && fn(null))
      .catch(err => fn && fn(err));
  }

  destroy(sid, fn) {
    db.run('DELETE FROM sessions WHERE sid = ?', [sid])
      .then(() => fn && fn(null))
      .catch(err => fn && fn(err));
  }

  touch(sid, sess, fn) {
    let maxAge = 14 * 24 * 60 * 60 * 1000;
    if (sess && sess.cookie && sess.cookie.maxAge) {
      maxAge = sess.cookie.maxAge;
    }
    const expired = new Date(Date.now() + maxAge).toISOString();
    db.run('UPDATE sessions SET expired = ? WHERE sid = ?', [expired, sid])
      .then(() => fn && fn(null))
      .catch(err => fn && fn(err));
  }
}

module.exports = SqliteSessionStore;
