'use strict';

module.exports = {
  createTransport: jest.fn(() => ({
    sendMail: jest.fn(() => Promise.resolve({ messageId: 'mock-message-id' })),
    verify: jest.fn(() => Promise.resolve(true)),
  })),
};
