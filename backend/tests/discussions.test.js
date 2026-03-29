'use strict';

/**
 * Integration Tests — Discussions Endpoints (/api/discussions)
 *
 * Requires a running server and database.
 * Run with: npm test
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  createTestRabbi,
  request,
  cleanup,
  checkServer,
  dbQuery,
} = require('./setup');

let rabbi1, token1;
let rabbi2, token2;

before(async () => {
  const alive = await checkServer();
  if (!alive) {
    console.error(
      '\n  Server is not reachable. Start the server first:\n' +
      '    cd backend && npm run dev\n'
    );
    process.exit(1);
  }

  const r1 = await createTestRabbi({ name: 'Disc Rabbi One' });
  rabbi1 = r1.rabbi;
  token1 = r1.accessToken;

  const r2 = await createTestRabbi({ name: 'Disc Rabbi Two' });
  rabbi2 = r2.rabbi;
  token2 = r2.accessToken;
});

after(async () => {
  await cleanup();
});

// ─── GET /api/discussions ────────────────────────────────────────────────────

describe('GET /api/discussions', () => {
  it('should return list of discussions for authenticated rabbi', async () => {
    const res = await request('GET', '/api/discussions', { token: token1 });

    assert.equal(res.status, 200);
    assert.ok(res.body.discussions, 'should return discussions property');
    assert.ok(Array.isArray(res.body.discussions), 'discussions should be an array');
  });

  it('should reject unauthenticated request', async () => {
    const res = await request('GET', '/api/discussions');

    assert.equal(res.status, 401);
  });
});

// ─── POST /api/discussions — create discussion ──────────────────────────────

describe('POST /api/discussions', () => {
  it('should create a discussion with title', async () => {
    const res = await request('POST', '/api/discussions', {
      token: token1,
      body: {
        title: 'Test Discussion for Integration',
        memberIds: [rabbi2.id],
      },
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.discussion, 'should return discussion object');
    assert.ok(res.body.discussion.id, 'discussion should have an id');
    assert.equal(res.body.discussion.title, 'Test Discussion for Integration');
  });

  it('should reject empty title', async () => {
    const res = await request('POST', '/api/discussions', {
      token: token1,
      body: { title: '' },
    });

    assert.ok(
      [400, 422].includes(res.status),
      `expected 400/422, got ${res.status}`
    );
  });

  it('should reject unauthenticated request', async () => {
    const res = await request('POST', '/api/discussions', {
      body: { title: 'Should Fail' },
    });

    assert.equal(res.status, 401);
  });

  it('should include creator as member automatically', async () => {
    const res = await request('POST', '/api/discussions', {
      token: token1,
      body: {
        title: 'Auto-Member Test',
        memberIds: [],
      },
    });

    assert.equal(res.status, 201);

    const discId = res.body.discussion.id;

    // Verify creator is a member in DB
    const { rows } = await dbQuery(
      `SELECT * FROM discussion_members WHERE discussion_id = $1 AND rabbi_id = $2`,
      [discId, rabbi1.id]
    );
    assert.ok(rows.length > 0, 'creator should be a member');
  });
});

// ─── GET /api/discussions/:id — discussion detail ───────────────────────────

describe('GET /api/discussions/:id', () => {
  it('should return discussion detail for a member', async () => {
    // Create a discussion first
    const createRes = await request('POST', '/api/discussions', {
      token: token1,
      body: { title: 'Detail Test Discussion', memberIds: [rabbi2.id] },
    });
    assert.equal(createRes.status, 201);
    const discId = createRes.body.discussion.id;

    const res = await request('GET', `/api/discussions/${discId}`, {
      token: token1,
    });

    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.discussion, 'should return discussion object');
  });

  it('should return 404 for non-existent discussion', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request('GET', `/api/discussions/${fakeId}`, {
      token: token1,
    });

    assert.ok(
      [403, 404].includes(res.status),
      `expected 403/404, got ${res.status}`
    );
  });
});

// ─── POST /:id/messages — send message ──────────────────────────────────────

describe('POST /api/discussions/:id/messages', () => {
  let discussionId;

  before(async () => {
    // Create a discussion for message tests
    const res = await request('POST', '/api/discussions', {
      token: token1,
      body: { title: 'Message Test Discussion', memberIds: [rabbi2.id] },
    });
    assert.equal(res.status, 201, 'Failed to create test discussion');
    discussionId = res.body.discussion.id;
  });

  it('should send a message in a discussion', async () => {
    const res = await request('POST', `/api/discussions/${discussionId}/messages`, {
      token: token1,
      body: { content: 'Hello, this is a test message!' },
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.message, 'should return message object');
    assert.ok(res.body.message.id, 'message should have an id');
  });

  it('should reject empty message content', async () => {
    const res = await request('POST', `/api/discussions/${discussionId}/messages`, {
      token: token1,
      body: { content: '' },
    });

    assert.ok(
      [400, 422].includes(res.status),
      `expected 400/422, got ${res.status}`
    );
  });

  it('should allow second member to send message', async () => {
    const res = await request('POST', `/api/discussions/${discussionId}/messages`, {
      token: token2,
      body: { content: 'Reply from Rabbi Two' },
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it('should reject unauthenticated message', async () => {
    const res = await request('POST', `/api/discussions/${discussionId}/messages`, {
      body: { content: 'Unauthorized message' },
    });

    assert.equal(res.status, 401);
  });
});

// ─── GET /:id/messages — list messages ──────────────────────────────────────

describe('GET /api/discussions/:id/messages', () => {
  let discussionId;

  before(async () => {
    // Create discussion with messages
    const createRes = await request('POST', '/api/discussions', {
      token: token1,
      body: { title: 'List Messages Test', memberIds: [rabbi2.id] },
    });
    discussionId = createRes.body.discussion.id;

    // Send a few messages
    await request('POST', `/api/discussions/${discussionId}/messages`, {
      token: token1,
      body: { content: 'First message' },
    });
    await request('POST', `/api/discussions/${discussionId}/messages`, {
      token: token2,
      body: { content: 'Second message' },
    });
  });

  it('should return paginated messages', async () => {
    const res = await request('GET', `/api/discussions/${discussionId}/messages`, {
      token: token1,
    });

    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(Array.isArray(res.body.messages), 'should return messages array');
    assert.ok(res.body.messages.length >= 2, 'should have at least 2 messages');
  });

  it('should reject non-member access', async () => {
    const r3 = await createTestRabbi({ name: 'Non-Member Rabbi' });

    const res = await request('GET', `/api/discussions/${discussionId}/messages`, {
      token: r3.accessToken,
    });

    assert.ok(
      [403, 404].includes(res.status),
      `expected 403/404, got ${res.status}`
    );
  });
});

// ─── GET /api/discussions/all ────────────────────────────────────────────────

describe('GET /api/discussions/all', () => {
  it('should return all accessible discussions', async () => {
    const res = await request('GET', '/api/discussions/all', { token: token1 });

    assert.equal(res.status, 200);
    assert.ok(res.body.discussions, 'should return discussions property');
    assert.ok(Array.isArray(res.body.discussions), 'should be an array');
  });
});
