const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const { initSchema } = require('./config/database');
const SqliteSessionStore = require('./config/sessionStore');
const { loadGlobalData } = require('./middleware/auth');
const webRoutes = require('./routes/web');

const app = express();
app.set('trust proxy', 1);

// View Engine EJS & Layouts
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Body Parser
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sesi Express Persisten SQLite (Tetap login meskipun server direstart / npm start dimatikan)
app.use(
  session({
    store: new SqliteSessionStore(),
    secret: 'kasproyek-super-secret-key-2026-wib',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 14 * 24 * 60 * 60 * 1000 // 14 hari
    }
  })
);

// File Statis Publik (Tailwind, JS Klien, Ikon)
app.use(express.static(path.join(__dirname, '../public')));

// Global Middleware
app.use(loadGlobalData);

// Routes
app.use('/', webRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).render('404', { url: req.url });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err);
  res.status(500).send(`Terjadi kesalahan server: ${err.message}`);
});

module.exports = app;
