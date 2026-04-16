'use strict';

/**
 * Auth Router — "ענה את השואל"
 *
 * Mounted at: /api/auth
 *
 * Routes:
 *   POST   /login               – email + password → { accessToken, refreshToken cookie, rabbi }
 *   POST   /refresh             – use refreshToken cookie → new accessToken
 *   POST   /logout              – revoke current session
 *   POST   /logout-all          – revoke all sessions for authenticated rabbi
 *   GET    /google              – redirect to Google OAuth (server-side flow)
 *   GET    /google/callback     – handle Google OAuth callback
 *   POST   /forgot-password     – send password-reset email
 *   POST   /reset-password      – { token, newPassword } – validate Redis token, update password
 *   POST   /change-password     – authenticated rabbi changes own password
 *   GET    /sessions            – list rabbi's active sessions
 *   DELETE /sessions/:sessionId – revoke a specific session
 *   POST   /setup-password      – set password for rabbi with must_change_password=true
 *   GET    /me                  – return current rabbi profile
 *   POST   /2fa/setup           – generate TOTP secret + QR code
 *   POST   /2fa/verify          – enable 2FA after confirming code
 *   POST   /2fa/enable          – alias of /2fa/verify
 *   POST   /2fa/login           – complete 2FA login step with temp token
 *   POST   /2fa/disable         – disable 2FA (self or admin)
 *   GET    /action              – magic-link action handler (no auth required)
 */

const express          = require('express');
const jwt              = require('jsonwebtoken');
const bcrypt           = require('bcryptjs');
const crypto           = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const passport         = require('passport');
const GoogleStrategy   = require('passport-google-oauth20').Strategy;

// DB
const { query: db }   = require('../db/pool');

// Auth service (primary)
const {
  loginRabbi,
  createTokens,
  refreshTokens,
  handleGoogleOAuth,
  sendPasswordReset,
  resetPassword,
  validatePasswordPolicy,
  detectNewDevice,
  revokeSession,
  revokeSessionByTokenHash,
  revokeAllSessions,
  listActiveSessions,
  getSessionById,
  updateLastLogin,
  hashToken,
  BCRYPT_ROUNDS,
} = require('../services/authService');

// Legacy auth service (2FA, loginWithEmail for backwards-compat)
const legacyAuth = require('../services/auth');

// Audit log — record login/logout/password events against the acting rabbi
const { logAction, ACTIONS } = require('../middleware/auditLog');

function _auditIp(req) {
  return (
    (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.ip ||
    null
  );
}

// Utilities
const { verifyActionToken } = require('../utils/actionTokens');

// Middleware
const { authenticate, authenticateToken } = require('../middleware/auth');

const {
  loginLimiter,
  forgotPasswordLimiter,
  authLimiter,
  emailLimiter,
} = require('../middleware/rateLimiter');

const router = express.Router();

// ─── Google OAuth2 client (client-side id_token verification) ────────────────

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ─── Passport — server-side OAuth redirect flow ───────────────────────────────

passport.use(
  new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  process.env.GOOGLE_CALLBACK_URL,
      scope:        ['profile', 'email'],
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || null;
        const photo = profile.photos?.[0]?.value || null;
        done(null, { id: profile.id, email, displayName: profile.displayName, photo });
      } catch (err) {
        done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done)   => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _frontendUrl() {
  return (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/$/, '');
}

/**
 * Extract device information from an Express request.
 * @param {import('express').Request} req
 * @returns {{ ip: string, userAgent: string }}
 */
function _deviceInfo(req) {
  const ip = (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'
  );
  const userAgent = req.headers['user-agent'] || 'unknown';
  return { ip, userAgent };
}

/**
 * Build the safe rabbi profile sent to clients.
 * @param {object} rabbi  DB row
 * @returns {object}
 */
function _safeProfile(rabbi) {
  return {
    id:                 rabbi.id,
    email:              rabbi.email,
    name:               rabbi.name,
    role:               rabbi.role,
    signature:          rabbi.signature           || null,
    photoUrl:           rabbi.photo_url           || null,
    isVacation:         rabbi.is_vacation         ?? false,
    mustChangePassword: rabbi.must_change_password ?? false,
    notificationPref:   rabbi.notification_pref   || null,
    whatsappNumber:     rabbi.whatsapp_number     || null,
    twoFaEnabled:       rabbi.two_fa_enabled      || false,
    lastLogin:          rabbi.last_login          || rabbi.last_login_at || null,
    status:             rabbi.status              || 'active',
  };
}

/**
 * Set the refresh token as an httpOnly Secure cookie.
 * @param {import('express').Response} res
 * @param {string} token
 */
function _setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days in ms
    path:     '/api/auth',
  });
}

/**
 * Clear the refresh token cookie on logout.
 * @param {import('express').Response} res
 */
function _clearRefreshCookie(res) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/api/auth',
  });
}

/**
 * Generate a short-lived 2FA temp token (5 min).
 * @param {string|number} rabbiId
 * @returns {string}
 */
function _generateTempToken(rabbiId) {
  return jwt.sign(
    { sub: String(rabbiId), purpose: '2fa_pending' },
    process.env.JWT_SECRET,
    { expiresIn: '5m', issuer: 'aneh-hashoel' }
  );
}

/**
 * Verify a 2FA temp token. Throws with status 401 on failure.
 * @param {string} token
 * @returns {{ sub: string }}
 */
function _verifyTempToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'aneh-hashoel',
    });
    if (payload.purpose !== '2fa_pending') {
      throw new Error('purpose שגוי');
    }
    return payload;
  } catch {
    const e = new Error('טוקן זמני אינו תקין או שפג תוקפו');
    e.status = 401;
    throw e;
  }
}

/**
 * Fire-and-forget new-device alert via socket + email.
 * @param {import('express').Request} req
 * @param {object} rabbi
 * @param {object} device
 */
function _newDeviceAlert(req, rabbi, device) {
  setImmediate(async () => {
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`rabbi:${rabbi.id}`).emit('notification:newDeviceAlert', {
          rabbiId:   rabbi.id,
          ip:        device.ip,
          userAgent: device.userAgent,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (socketErr) {
      console.error('[auth] newDeviceAlert socket error:', socketErr.message);
    }
  });
}

// ─── POST /login ──────────────────────────────────────────────────────────────

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'אימייל וסיסמה נדרשים' });
    }

    const device = _deviceInfo(req);

    // Credential validation via legacy service (includes 2FA flag check)
    const rawRabbi = await legacyAuth.loginWithEmail(email, password);

    // If 2FA is enabled, issue a short-lived temp token instead of a full session
    if (rawRabbi.two_fa_enabled) {
      const isNewDevice = await detectNewDevice(rawRabbi.id, device).catch(() => false);
      if (isNewDevice) _newDeviceAlert(req, rawRabbi, device);

      const tempToken = _generateTempToken(rawRabbi.id);
      return res.json({ requiresTwoFactor: true, tempToken, isNewDevice });
    }

    const {
      accessToken, refreshToken, sessionId, rabbi, isNewDevice,
    } = await loginRabbi(email, password, device, req.app);

    _setRefreshCookie(res, refreshToken);
    updateLastLogin(rawRabbi.id).catch(() => {});

    if (isNewDevice) _newDeviceAlert(req, rawRabbi, device);

    // Fetch full DB profile for response
    const { rows } = await db(
      `SELECT id, email, name, role, signature, photo_url,
              vacation_mode AS is_vacation,
              false AS must_change_password,
              notification_pref,
              NULL AS whatsapp_number,
              two_fa_enabled,
              updated_at AS last_login,
              CASE WHEN is_active THEN 'active' ELSE 'inactive' END AS status
       FROM   rabbis WHERE id = $1`,
      [rawRabbi.id]
    );

    // Audit log — rabbi logged in (fire-and-forget)
    setImmediate(() => {
      logAction(
        rawRabbi.id,
        ACTIONS.AUTH_LOGIN,
        'rabbi',
        rawRabbi.id,
        null,
        { device: device?.userAgent || null, is_new_device: isNewDevice },
        _auditIp(req),
        req.headers?.['user-agent'] || null
      ).catch(() => {});
    });

    return res.json({
      accessToken,
      refreshToken,  // also returned in body for clients that cannot read cookies
      sessionId,
      rabbi:              _safeProfile(rows[0] || rabbi),
      isNewDevice,
      mustChangePassword: rawRabbi.must_change_password || false,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /refresh ────────────────────────────────────────────────────────────
// Accepts refresh token from httpOnly cookie (preferred) or from request body.

router.post('/refresh', async (req, res, next) => {
  try {
    // Cookie takes precedence; fall back to body for non-browser clients
    const rawToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!rawToken) {
      return res.status(400).json({ error: 'טוקן רענון נדרש' });
    }

    const device = _deviceInfo(req);
    const { accessToken, refreshToken: newRefresh, sessionId } = await refreshTokens(rawToken, device);

    _setRefreshCookie(res, newRefresh);

    return res.json({ accessToken, refreshToken: newRefresh, sessionId });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /logout ─────────────────────────────────────────────────────────────

router.post('/logout', async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      const revoked = await revokeSessionByTokenHash(tokenHash);

      // Best-effort audit log — revokeSessionByTokenHash may return session info
      const actorId = revoked?.rabbi_id || revoked?.rabbiId || req.rabbi?.id || null;
      if (actorId) {
        setImmediate(() => {
          logAction(
            actorId,
            ACTIONS.AUTH_LOGOUT,
            'rabbi',
            actorId,
            null,
            null,
            _auditIp(req),
            req.headers?.['user-agent'] || null
          ).catch(() => {});
        });
      }
    }

    _clearRefreshCookie(res);

    return res.json({ message: 'התנתקת בהצלחה' });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /logout-all ─────────────────────────────────────────────────────────

router.post('/logout-all', authenticate, async (req, res, next) => {
  try {
    const revoked = await revokeAllSessions(req.rabbi.id);

    _clearRefreshCookie(res);

    setImmediate(() => {
      logAction(
        req.rabbi.id,
        ACTIONS.AUTH_LOGOUT,
        'rabbi',
        req.rabbi.id,
        null,
        { all_sessions: true, revoked },
        _auditIp(req),
        req.headers?.['user-agent'] || null
      ).catch(() => {});
    });

    return res.json({ message: 'כל ההתחברויות בוטלו בהצלחה', revoked });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /google — redirect to Google OAuth ───────────────────────────────────

router.get(
  '/google',
  passport.authenticate('google', { session: false, scope: ['profile', 'email'] })
);

// ─── GET /google/callback ─────────────────────────────────────────────────────

router.get(
  '/google/callback',
  (req, res, next) => {
    passport.authenticate('google', {
      session: false,
      failureRedirect: `${_frontendUrl()}/login`,
    })(req, res, next);
  },
  async (req, res, next) => {
    try {
      const googleProfile = req.user;

      if (!googleProfile) {
        return res.redirect(
          `${_frontendUrl()}/login?error=${encodeURIComponent('כניסה עם Google נכשלה')}`
        );
      }

      const device = _deviceInfo(req);

      const {
        accessToken, refreshToken, sessionId, rabbi, isNewDevice,
      } = await handleGoogleOAuth(googleProfile, device, req.app);

      _setRefreshCookie(res, refreshToken);

      if (isNewDevice) _newDeviceAlert(req, rabbi, device);

      const params = new URLSearchParams({ accessToken, refreshToken, sessionId });
      return res.redirect(`${_frontendUrl()}/auth/callback?${params}`);
    } catch (err) {
      return res.redirect(
        `${_frontendUrl()}/login?error=${encodeURIComponent(err.message || 'שגיאת Google OAuth')}`
      );
    }
  }
);

// ─── POST /google (client-side id_token flow) ─────────────────────────────────

router.post('/google', authLimiter, async (req, res, next) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'Google ID token נדרש' });
    }

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch {
      return res.status(401).json({ error: 'Google token אינו תקין' });
    }

    const payload = ticket.getPayload();
    const googleProfile = {
      id:          payload.sub,
      email:       payload.email,
      displayName: payload.name,
      photo:       payload.picture || null,
    };

    const device = _deviceInfo(req);
    const {
      accessToken, refreshToken, sessionId, rabbi, isNewDevice,
    } = await handleGoogleOAuth(googleProfile, device, req.app);

    _setRefreshCookie(res, refreshToken);

    if (isNewDevice) _newDeviceAlert(req, rabbi, device);

    return res.json({ accessToken, refreshToken, sessionId, rabbi, isNewDevice });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /forgot-password ────────────────────────────────────────────────────

router.post('/forgot-password', forgotPasswordLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;

    // Always return the same generic response to prevent email enumeration
    const GENERIC = { message: 'אם האימייל קיים במערכת, נשלחה אליו הוראת איפוס סיסמה' };

    if (!email) {
      return res.json(GENERIC);
    }

    // Non-blocking: sendPasswordReset never throws to caller
    sendPasswordReset(email).catch((err) =>
      console.error('[auth] forgot-password error:', err.message)
    );

    return res.json(GENERIC);
  } catch (err) {
    return next(err);
  }
});

// ─── POST /reset-password ─────────────────────────────────────────────────────

router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'טוקן וסיסמה חדשה נדרשים' });
    }

    await resetPassword(token, newPassword);

    return res.json({ message: 'הסיסמה שונתה בהצלחה. ניתן להתחבר עם הסיסמה החדשה' });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
});

// ─── POST /change-password ────────────────────────────────────────────────────
// Authenticated rabbi changes their own password.

router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'סיסמה נוכחית וסיסמה חדשה נדרשות' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'הסיסמה החדשה חייבת להיות שונה מהסיסמה הנוכחית' });
    }

    // Enforce password policy
    const policyCheck = validatePasswordPolicy(newPassword);
    if (!policyCheck.valid) {
      return res.status(400).json({ error: policyCheck.error });
    }

    const { rows } = await db(
      `SELECT id, password_hash FROM rabbis WHERE id = $1`,
      [req.rabbi.id]
    );

    const rabbi = rows[0];
    if (!rabbi) {
      return res.status(404).json({ error: 'רב לא נמצא' });
    }

    if (!rabbi.password_hash) {
      return res.status(400).json({
        error: 'חשבון זה מחייב כניסה עם Google — אין סיסמה מוגדרת',
      });
    }

    const match = await bcrypt.compare(currentPassword, rabbi.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'הסיסמה הנוכחית שגויה' });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await db(
      `UPDATE rabbis
       SET    password_hash        = $1,
              must_change_password = false,
              updated_at           = NOW()
       WHERE  id = $2`,
      [newHash, req.rabbi.id]
    );

    // Audit log — rabbi changed own password (never log the hash/plaintext)
    setImmediate(() => {
      logAction(
        req.rabbi.id,
        ACTIONS.AUTH_PASSWORD_CHANGED,
        'rabbi',
        req.rabbi.id,
        null,
        null,
        _auditIp(req),
        req.headers?.['user-agent'] || null
      ).catch(() => {});
    });

    // Confirmation email — never contains the password, only a
    // security notice. Uses the admin-editable template.
    setImmediate(async () => {
      try {
        const { sendTemplated } = require('../services/emailTemplates');
        const { rows: r2 } = await db(
          'SELECT name, email FROM rabbis WHERE id = $1',
          [req.rabbi.id]
        );
        if (!r2[0]?.email) return;
        await sendTemplated('password_changed', {
          to: r2[0].email,
          audience: 'rabbi',
          vars: {
            name: r2[0].name,
            email: r2[0].email,
            ip: _auditIp(req) || '—',
            time: new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }),
            device: req.headers?.['user-agent']?.slice(0, 80) || '—',
          },
        });
      } catch (e) {
        console.error('[auth] password_changed email failed:', e.message);
      }
    });

    return res.json({ message: 'הסיסמה שונתה בהצלחה' });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /setup-password ─────────────────────────────────────────────────────
// For a new rabbi with must_change_password=true who sets a password for the
// first time (may or may not have a current password).

router.post('/setup-password', authenticate, async (req, res, next) => {
  try {
    const { newPassword, currentPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ error: 'סיסמה חדשה נדרשת' });
    }

    // Fetch rabbi row
    const { rows } = await db(
      `SELECT id, password_hash, must_change_password FROM rabbis WHERE id = $1`,
      [req.rabbi.id]
    );

    const rabbi = rows[0];
    if (!rabbi) {
      return res.status(404).json({ error: 'רב לא נמצא' });
    }

    // If rabbi already has a password, verify current before replacing
    if (rabbi.password_hash && currentPassword) {
      const match = await bcrypt.compare(currentPassword, rabbi.password_hash);
      if (!match) {
        return res.status(401).json({ error: 'הסיסמה הנוכחית שגויה' });
      }
    }

    // Enforce password policy
    const policyCheck = validatePasswordPolicy(newPassword);
    if (!policyCheck.valid) {
      return res.status(400).json({ error: policyCheck.error });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await db(
      `UPDATE rabbis
       SET    password_hash        = $1,
              must_change_password = false,
              updated_at           = NOW()
       WHERE  id = $2`,
      [newHash, req.rabbi.id]
    );

    return res.json({ message: 'הסיסמה הוגדרה בהצלחה' });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /sessions ────────────────────────────────────────────────────────────

router.get('/sessions', authenticate, async (req, res, next) => {
  try {
    const sessions = await listActiveSessions(req.rabbi.id);
    return res.json({ sessions });
  } catch (err) {
    return next(err);
  }
});

// ─── DELETE /sessions/:sessionId ─────────────────────────────────────────────

router.delete('/sessions/:sessionId', authenticate, async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const session = await getSessionById(sessionId, req.rabbi.id);

    if (!session) {
      return res.status(404).json({ error: 'הסשן לא נמצא' });
    }

    if (session.is_revoked) {
      return res.status(400).json({ error: 'הסשן כבר בוטל' });
    }

    await revokeSession(sessionId, req.rabbi.id);

    return res.json({ message: 'הסשן בוטל בהצלחה' });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /me ──────────────────────────────────────────────────────────────────

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db(
      `SELECT id, email, name, role, signature, photo_url,
              vacation_mode AS is_vacation,
              false AS must_change_password,
              notification_pref,
              NULL AS whatsapp_number,
              two_fa_enabled,
              updated_at AS last_login,
              CASE WHEN is_active THEN 'active' ELSE 'inactive' END AS status,
              created_at
       FROM   rabbis WHERE id = $1`,
      [req.rabbi.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'רב לא נמצא' });
    }

    return res.json({ rabbi: _safeProfile(rows[0]) });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /2fa/setup ──────────────────────────────────────────────────────────

router.post('/2fa/setup', authenticate, async (req, res, next) => {
  try {
    const result = await legacyAuth.setup2FA(req.rabbi.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// ─── POST /2fa/verify (enable 2FA) ───────────────────────────────────────────

router.post('/2fa/verify', authenticate, async (req, res, next) => {
  try {
    const { token, secret } = req.body;

    if (!token || !secret) {
      return res.status(400).json({ error: 'קוד אימות וסוד נדרשים' });
    }

    await legacyAuth.verify2FA(req.rabbi.id, token, secret);
    return res.json({ message: 'אימות דו-שלבי הופעל בהצלחה' });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /2fa/enable — alias ─────────────────────────────────────────────────

router.post('/2fa/enable', authenticate, async (req, res, next) => {
  try {
    const { token, secret } = req.body;

    if (!token || !secret) {
      return res.status(400).json({ error: 'קוד אימות וסוד נדרשים' });
    }

    await legacyAuth.verify2FA(req.rabbi.id, token, secret);
    return res.json({ message: 'אימות דו-שלבי הופעל בהצלחה' });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /2fa/login ──────────────────────────────────────────────────────────

router.post('/2fa/login', authLimiter, async (req, res, next) => {
  try {
    const { tempToken, totpToken } = req.body;

    if (!tempToken || !totpToken) {
      return res.status(400).json({ error: 'טוקן זמני וקוד אימות נדרשים' });
    }

    let payload;
    try {
      payload = _verifyTempToken(tempToken);
    } catch (err) {
      return res.status(err.status || 401).json({ error: err.message });
    }

    const rabbiId = payload.sub;

    await legacyAuth.check2FA(rabbiId, totpToken);

    const { rows } = await db(
      `SELECT id, email, name, role, signature, photo_url,
              vacation_mode AS is_vacation,
              false AS must_change_password,
              notification_pref,
              NULL AS whatsapp_number,
              two_fa_enabled,
              updated_at AS last_login,
              CASE WHEN is_active THEN 'active' ELSE 'inactive' END AS status
       FROM   rabbis WHERE id = $1`,
      [rabbiId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'רב לא נמצא' });
    }

    const rabbi  = rows[0];
    const device = _deviceInfo(req);
    const isNewDevice = await detectNewDevice(rabbiId, device).catch(() => false);

    const { accessToken, refreshToken, sessionId } = await createTokens(
      rabbi.id,
      rabbi.role,
      device
    );

    _setRefreshCookie(res, refreshToken);
    updateLastLogin(rabbi.id).catch(() => {});

    if (isNewDevice) _newDeviceAlert(req, rabbi, device);

    return res.json({
      accessToken,
      refreshToken,
      sessionId,
      rabbi: _safeProfile(rabbi),
      isNewDevice,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /2fa/disable ────────────────────────────────────────────────────────

router.post('/2fa/disable', authenticate, async (req, res, next) => {
  try {
    // Non-admins can only disable their own 2FA — ignore any rabbiId in body.
    // Admins may pass rabbiId to disable for another rabbi.
    const isAdmin  = req.rabbi.role === 'admin';
    const targetId = isAdmin ? (req.body.rabbiId || req.rabbi.id) : req.rabbi.id;
    await legacyAuth.disable2FA(targetId, req.rabbi.id, req.rabbi.role);
    return res.json({ message: 'אימות דו-שלבי בוטל בהצלחה' });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /action — magic-link handler (no auth required) ──────────────────────

router.get('/action', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.redirect(`${_frontendUrl()}/link-expired`);
  }

  let actionPayload;
  try {
    actionPayload = verifyActionToken(token);
  } catch {
    return res.redirect(`${_frontendUrl()}/link-expired`);
  }

  const { action, questionId, rabbiId } = actionPayload;

  if (!action || !questionId) {
    return res.redirect(`${_frontendUrl()}/link-expired`);
  }

  try {
    if (action === 'release' && rabbiId) {
      const { rows } = await db(
        `SELECT id FROM questions
         WHERE  id = $1 AND assigned_rabbi_id = $2 AND status = 'in_process'
         LIMIT  1`,
        [questionId, rabbiId]
      );

      if (rows.length > 0) {
        await db(
          `UPDATE questions
           SET    status            = 'pending',
                  assigned_rabbi_id = NULL,
                  lock_timestamp    = NULL,
                  updated_at        = NOW()
           WHERE  id = $1 AND assigned_rabbi_id = $2`,
          [questionId, rabbiId]
        );

        const io = res.app.get('io');
        if (io) {
          io.emit('question:released', { id: questionId, status: 'pending' });
        }
      }
    }
  } catch (err) {
    console.error('[auth] /action mutation error:', err.message);
  }

  const base   = `${_frontendUrl()}/questions/${encodeURIComponent(questionId)}`;
  const params = new URLSearchParams({ action, token });
  return res.redirect(`${base}?${params.toString()}`);
});

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
