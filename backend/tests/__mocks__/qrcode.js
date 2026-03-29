'use strict';

module.exports = {
  toDataURL: jest.fn(() => Promise.resolve('data:image/png;base64,mock')),
  toString: jest.fn(() => Promise.resolve('mock-qr')),
};
