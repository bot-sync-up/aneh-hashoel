'use strict';

module.exports = {
  generateSecret: jest.fn(() => ({
    base32: 'MOCK_SECRET_BASE32',
    otpauth_url: 'otpauth://totp/mock',
  })),
  totp: {
    verify: jest.fn(() => true),
  },
};
