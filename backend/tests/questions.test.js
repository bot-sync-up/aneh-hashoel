'use strict';

/**
 * Integration Tests — Questions Endpoints (/api/questions)
 *
 * Requires a running server and database.
 * Run with: npm test
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  createTestRabbi,
  createTestQuestion,
  request,
  cleanup,
  checkServer,
  dbQuery,
} = require('./setup');

let rabbi1, token1;
let rabbi2, token2;
let adminRabbi, adminToken;

before(async () => {
  const alive = await checkServer();
  if (!alive) {
    console.error(
      '\n  Server is not reachable. Start the server first:\n' +
      '    cd backend && npm run dev\n'
    );
    process.exit(1);
  }

  // Create two test rabbis and one admin
  const r1 = await createTestRabbi({ name: 'Rabbi One' });
  rabbi1 = r1.rabbi;
  token1 = r1.accessToken;

  const r2 = await createTestRabbi({ name: 'Rabbi Two' });
  rabbi2 = r2.rabbi;
  token2 = r2.accessToken;

  const adm = await createTestRabbi({ name: 'Admin Rabbi', role: 'admin' });
  adminRabbi = adm.rabbi;
  adminToken = adm.accessToken;
});

after(async () => {
  await cleanup();
});

// ─── GET /api/questions ──────────────────────────────────────────────────────

describe('GET /api/questions', () => {
  it('should return paginated list with valid token', async () => {
    const res = await request('GET', '/api/questions', { token: token1 });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.questions), 'should return questions array');
    assert.ok(typeof res.body.total === 'number', 'should return total count');
  });

  it('should reject request without token', async () => {
    const res = await request('GET', '/api/questions');

    assert.equal(res.status, 401);
  });

  it('should filter by status', async () => {
    const res = await request('GET', '/api/questions?status=pending', {
      token: token1,
    });

    assert.equal(res.status, 200);
    // All returned questions should be pending
    if (res.body.questions && res.body.questions.length > 0) {
      for (const q of res.body.questions) {
        assert.equal(q.status, 'pending');
      }
    }
  });
});

// ─── GET /api/questions/:id ──────────────────────────────────────────────────

describe('GET /api/questions/:id', () => {
  it('should return a single question by ID', async () => {
    const question = await createTestQuestion({
      title: 'Question for get by ID test',
    });

    const res = await request('GET', `/api/questions/${question.id}`, {
      token: token1,
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.question, 'should return question object');
    assert.equal(res.body.question.id, question.id);
  });

  it('should return 404 for non-existent question', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request('GET', `/api/questions/${fakeId}`, {
      token: token1,
    });

    assert.equal(res.status, 404);
  });

  it('should reject without auth', async () => {
    const question = await createTestQuestion();
    const res = await request('GET', `/api/questions/${question.id}`);

    assert.equal(res.status, 401);
  });
});

// ─── POST /api/questions/claim/:id ──────────────────────────────────────────

describe('POST /api/questions/claim/:id', () => {
  it('should claim a pending question', async () => {
    const question = await createTestQuestion({ status: 'pending' });

    const res = await request('POST', `/api/questions/claim/${question.id}`, {
      token: token1,
    });

    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.message, 'should return success message');

    // Verify in DB
    const { rows } = await dbQuery(
      'SELECT status, assigned_rabbi_id FROM questions WHERE id = $1',
      [question.id]
    );
    assert.equal(rows[0].status, 'in_process');
    assert.equal(String(rows[0].assigned_rabbi_id), String(rabbi1.id));
  });

  it('should fail to claim an already claimed question', async () => {
    const question = await createTestQuestion({
      status: 'in_process',
      assignedRabbiId: rabbi1.id,
    });

    const res = await request('POST', `/api/questions/claim/${question.id}`, {
      token: token2,
    });

    assert.ok(
      [400, 409, 422].includes(res.status),
      `expected conflict status, got ${res.status}`
    );
  });

  it('should reject without auth', async () => {
    const question = await createTestQuestion({ status: 'pending' });
    const res = await request('POST', `/api/questions/claim/${question.id}`);

    assert.equal(res.status, 401);
  });
});

// ─── POST /api/questions/release/:id ─────────────────────────────────────────

describe('POST /api/questions/release/:id', () => {
  it('should release a claimed question (by assigned rabbi)', async () => {
    // Create and claim
    const question = await createTestQuestion({
      status: 'in_process',
      assignedRabbiId: rabbi1.id,
    });

    const res = await request('POST', `/api/questions/release/${question.id}`, {
      token: token1,
    });

    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

    // Verify in DB
    const { rows } = await dbQuery(
      'SELECT status, assigned_rabbi_id FROM questions WHERE id = $1',
      [question.id]
    );
    assert.equal(rows[0].status, 'pending');
    assert.equal(rows[0].assigned_rabbi_id, null);
  });

  it('should fail to release a question claimed by another rabbi (non-admin)', async () => {
    const question = await createTestQuestion({
      status: 'in_process',
      assignedRabbiId: rabbi1.id,
    });

    const res = await request('POST', `/api/questions/release/${question.id}`, {
      token: token2,
    });

    assert.ok(
      [400, 403, 409].includes(res.status),
      `expected error status, got ${res.status}`
    );
  });

  it('should allow admin to release any question', async () => {
    const question = await createTestQuestion({
      status: 'in_process',
      assignedRabbiId: rabbi1.id,
    });

    const res = await request('POST', `/api/questions/release/${question.id}`, {
      token: adminToken,
    });

    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  });
});

// ─── GET /api/questions/my ───────────────────────────────────────────────────

describe('GET /api/questions/my', () => {
  it('should return the rabbi own claimed questions', async () => {
    // Create a question assigned to rabbi1
    await createTestQuestion({
      status: 'in_process',
      assignedRabbiId: rabbi1.id,
    });

    const res = await request('GET', '/api/questions/my', { token: token1 });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.questions), 'should return questions array');
  });
});

// ─── GET /api/questions/pending ──────────────────────────────────────────────

describe('GET /api/questions/pending', () => {
  it('should return pending questions', async () => {
    await createTestQuestion({ status: 'pending' });

    const res = await request('GET', '/api/questions/pending', { token: token1 });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.questions), 'should return questions array');

    for (const q of res.body.questions) {
      assert.equal(q.status, 'pending');
    }
  });
});
