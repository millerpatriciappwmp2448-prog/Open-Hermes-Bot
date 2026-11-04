const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class JsonStore {
  constructor(directory) { this.directory = directory; this.file = path.join(directory, 'watch.json'); }
  load() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (value?.version !== 1 || !Array.isArray(value.events)) throw new Error('Unsupported supervisor state.');
      return value;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  save(value) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, `watch-${randomUUID()}.tmp`);
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, this.file);
  }
}

module.exports = { JsonStore };
