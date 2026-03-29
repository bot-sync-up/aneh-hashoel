'use strict';

/**
 * Unit tests for the answer service (src/services/answers.js)
 *
 * All database calls are mocked via jest.mock so no real DB is needed.
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock the DB pool — must be defined before requiring the service
jest.mock('../../src/db/pool', () => {
  const queryFn = jest.fn();
  const withTransactionFn = jest.fn();
  return {
    query: queryFn,
    withTransaction: withTransactionFn,
    pool: { query: queryFn },
  };
});

jest.mock('../../src/utils/sanitize', () => ({
  sanitizeRichText: jest.fn((html) => html), // pass-through by default
}));

jest.mock('../../src/middleware/auditLog', () => ({
  logAction: jest.fn(),
  ACTIONS: { QUESTION_ANSWERED: 'QUESTION_ANSWERED', ANSWER_EDITED: 'ANSWER_EDITED' },
}));

jest.mock('../../src/services/wordpress', () => ({
  syncAnswerToWP: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/services/askerNotification', () => ({
  notifyAskerNewAnswer: jest.fn(() => Promise.resolve()),
  notifyAskerPrivateAnswer: jest.fn(() => Promise.resolve()),
  notifyAskerFollowUp: jest.fn(() => Promise.resolve()),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

const { query: dbQuery, withTransaction } = require('../../src/db/pool');
const { sanitizeRichText } = require('../../src/utils/sanitize');
const { submitAnswer, editAnswer } = require('../../src/services/answers');

// ─── submitAnswer ────────────────────────────────────────────────────────────

describe('submitAnswer', () => {
  test('rejects when required fields are missing', async () => {
    await expect(submitAnswer(null, 'rabbi-1', '<p>Hello</p>'))
      .rejects.toThrow('חסרים שדות חובה');

    await expect(submitAnswer('q-1', null, '<p>Hello</p>'))
      .rejects.toThrow('חסרים שדות חובה');

    await expect(submitAnswer('q-1', 'rabbi-1', ''))
      .rejects.toThrow('חסרים שדות חובה');
  });

  test('rejects when question is not found', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [] }); // question lookup returns nothing

    await expect(submitAnswer('q-999', 'rabbi-1', '<p>Answer</p>'))
      .rejects.toMatchObject({ message: 'השאלה לא נמצאה', status: 404 });
  });

  test('rejects when question is already answered', async () => {
    dbQuery.mockResolvedValueOnce({
      rows: [{
        id: 'q-1',
        assigned_rabbi_id: 'rabbi-1',
        status: 'answered',
        wp_post_id: null,
        category_id: 'cat-1',
      }],
    });

    await expect(submitAnswer('q-1', 'rabbi-1', '<p>Answer</p>'))
      .rejects.toMatchObject({ message: 'השאלה כבר נענתה', status: 409 });
  });

  test('rejects when rabbi is not assigned to the question', async () => {
    dbQuery.mockResolvedValueOnce({
      rows: [{
        id: 'q-1',
        assigned_rabbi_id: 'rabbi-other',
        status: 'in_process',
        wp_post_id: null,
        category_id: 'cat-1',
      }],
    });

    await expect(submitAnswer('q-1', 'rabbi-1', '<p>Answer</p>'))
      .rejects.toMatchObject({ message: 'אינך משויך לשאלה זו', status: 403 });
  });

  test('successfully submits an answer when all conditions are met', async () => {
    // 1. Question lookup
    dbQuery.mockResolvedValueOnce({
      rows: [{
        id: 'q-1',
        assigned_rabbi_id: 'rabbi-1',
        status: 'in_process',
        wp_post_id: null,
        category_id: 'cat-1',
      }],
    });

    // 2. Rabbi lookup
    dbQuery.mockResolvedValueOnce({
      rows: [{ id: 'rabbi-1', name: 'Test Rabbi', signature: '' }],
    });

    // sanitizeRichText returns the content as-is (mocked)
    sanitizeRichText.mockReturnValue('<p>Sanitized answer</p>');

    const mockAnswer = {
      id: 'ans-1',
      question_id: 'q-1',
      rabbi_id: 'rabbi-1',
      content: '<p>Sanitized answer</p>',
    };

    // 3. Transaction mock
    withTransaction.mockImplementation(async (fn) => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [mockAnswer] })  // INSERT answer
          .mockResolvedValueOnce({ rows: [] }),            // UPDATE question
      };
      return fn(mockClient);
    });

    const result = await submitAnswer('q-1', 'rabbi-1', '<p>Answer</p>');
    expect(result).toEqual(mockAnswer);
    expect(sanitizeRichText).toHaveBeenCalledWith('<p>Answer</p>');
  });
});

// ─── editAnswer ──────────────────────────────────────────────────────────────

describe('editAnswer', () => {
  test('rejects when required fields are missing', async () => {
    await expect(editAnswer(null, 'rabbi-1', '<p>New</p>'))
      .rejects.toThrow('חסרים שדות חובה');

    await expect(editAnswer('ans-1', null, '<p>New</p>'))
      .rejects.toThrow('חסרים שדות חובה');

    await expect(editAnswer('ans-1', 'rabbi-1', ''))
      .rejects.toThrow('חסרים שדות חובה');
  });

  test('rejects when answer is not found', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [] });

    await expect(editAnswer('ans-999', 'rabbi-1', '<p>New</p>'))
      .rejects.toMatchObject({ message: 'התשובה לא נמצאה', status: 404 });
  });

  test('rejects when rabbi does not own the answer', async () => {
    dbQuery.mockResolvedValueOnce({
      rows: [{
        id: 'ans-1',
        rabbi_id: 'rabbi-other',
        content: '<p>Old content</p>',
        content_versions: [],
      }],
    });

    await expect(editAnswer('ans-1', 'rabbi-1', '<p>New</p>'))
      .rejects.toMatchObject({ message: 'אין הרשאה לערוך תשובה זו', status: 403 });
  });

  test('pushes old content to versions on successful edit', async () => {
    const oldContent = '<p>Old content</p>';
    const existingVersions = [];

    // 1. Answer lookup
    dbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'ans-1',
          rabbi_id: 'rabbi-1',
          content: oldContent,
          content_versions: existingVersions,
        }],
      })
      // 2. UPDATE answer
      .mockResolvedValueOnce({
        rows: [{
          id: 'ans-1',
          rabbi_id: 'rabbi-1',
          content: '<p>New content</p>',
          content_versions: [{ content: oldContent, version: 1 }],
        }],
      });

    sanitizeRichText.mockReturnValue('<p>New content</p>');

    const result = await editAnswer('ans-1', 'rabbi-1', '<p>New content</p>');

    expect(result.content).toBe('<p>New content</p>');

    // Verify that the UPDATE query included the old content in versions
    const updateCall = dbQuery.mock.calls[1];
    const versionsArg = JSON.parse(updateCall[1][1]);
    expect(versionsArg).toHaveLength(1);
    expect(versionsArg[0].content).toBe(oldContent);
  });
});
