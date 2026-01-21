const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'criadero.sqlite');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS perros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    sexo TEXT CHECK(sexo IN ('M','F')) NOT NULL,
    padre_id INTEGER,
    madre_id INTEGER,
    fecha_nacimiento DATE,
    FOREIGN KEY (padre_id) REFERENCES perros(id),
    FOREIGN KEY (madre_id) REFERENCES perros(id)
  );
`);

module.exports = db;
