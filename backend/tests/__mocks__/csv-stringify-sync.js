'use strict';

module.exports = {
  stringify: jest.fn((data) => {
    if (!Array.isArray(data)) return '';
    return data.map((row) => (Array.isArray(row) ? row.join(',') : String(row))).join('\n');
  }),
};
