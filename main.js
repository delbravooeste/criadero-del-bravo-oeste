const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

let db;

/* =========================
   WINDOW
   ========================= */
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile(path.join(__dirname, 'ui/index.html'));
}

/* =========================
   MIGRACIONES
   (NO SE TOCAN)
   ========================= */
function migrarDB() {
  const cols = db.prepare(`PRAGMA table_info(perros)`).all().map(c => c.name);
  console.log(JSON.stringify(cols));
}

/* =========================
   APP INIT
   ========================= */
app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'criadero.db');
  console.log('DB en:', dbPath);

  db = new Database(dbPath);

  db.prepare(`
    CREATE TABLE IF NOT EXISTS perros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      sexo TEXT NOT NULL CHECK (sexo IN ('M','F')),
      padre_id INTEGER,
      madre_id INTEGER,
      fca TEXT UNIQUE,
      fecha_nacimiento TEXT
    )
  `).run();

  migrarDB();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* =========================
   CRUD
   ========================= */
ipcMain.handle('listar-perros', () =>
  db.prepare(`
    SELECT id, nombre, sexo, fca
    FROM perros
    ORDER BY nombre
  `).all()
);

ipcMain.handle('crear-perro', (e, p) => {
  try {
    db.prepare(`
      INSERT INTO perros
      (nombre, sexo, padre_id, madre_id, fca, fecha_nacimiento)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      p.nombre,
      p.sexo,
      p.padre_id,
      p.madre_id,
      p.fca || null,
      p.fecha_nacimiento || null
    );
    return { ok: true };
  } catch {
    return { error: 'FCA duplicado o inválido' };
  }
});

ipcMain.handle('obtener-perro', (e, id) =>
  db.prepare(`SELECT * FROM perros WHERE id=?`).get(id)
);

ipcMain.handle('editar-perro', (e, p) => {
  try {
    db.prepare(`
      UPDATE perros
      SET nombre=?, sexo=?, padre_id=?, madre_id=?, fca=?, fecha_nacimiento=?
      WHERE id=?
    `).run(
      p.nombre,
      p.sexo,
      p.padre_id,
      p.madre_id,
      p.fca || null,
      p.fecha_nacimiento || null,
      p.id
    );
    return { ok: true };
  } catch {
    return { error: 'FCA duplicado' };
  }
});

/* =========================
   PEDIGREE / COI BASE
   ========================= */
function obtenerAncestros(id, nivel, max, linea, out) {
  if (!id || nivel > max) return;
  const p = db.prepare(`SELECT * FROM perros WHERE id=?`).get(id);
  if (!p) return;

  out.push({ id: p.id, nombre: p.nombre, nivel, linea });

  obtenerAncestros(p.padre_id, nivel + 1, max, 'P', out);
  obtenerAncestros(p.madre_id, nivel + 1, max, 'M', out);
}

function calcularCOI(aP, aM) {
  let coi = 0;
  for (const id in aP) {
    if (aM[id]) {
      coi += Math.pow(0.5, aP[id].nivel + aM[id].nivel + 1);
    }
  }
  return coi;
}

/* =========================
   PEDIGREE 5G
   ========================= */
ipcMain.handle('pedigree-5g', (e, id) => {
  const perro = db.prepare(`SELECT * FROM perros WHERE id=?`).get(id);
  if (!perro) return null;

  const ancestros = [];
  obtenerAncestros(id, 0, 5, 'P', ancestros);

  return { perro, ancestros };
});

/* =========================
   COI DEL PERRO
   ========================= */
ipcMain.handle('calcular-coi', (e, id) => {
  const perro = db.prepare(`SELECT * FROM perros WHERE id=?`).get(id);
  if (!perro || !perro.padre_id || !perro.madre_id)
    return { porcentaje: '0.00' };

  const pA = [], mA = [];
  obtenerAncestros(perro.padre_id, 1, 5, 'P', pA);
  obtenerAncestros(perro.madre_id, 1, 5, 'M', mA);

  const mapP = {}, mapM = {};
  pA.forEach(a => mapP[a.id] = a);
  mA.forEach(a => mapM[a.id] = a);

  return { porcentaje: (calcularCOI(mapP, mapM) * 100).toFixed(2) };
});

/* =========================
   DETECCIÓN DE PARENTESCO
   ========================= */
function detectarParentesco(padreId, madreId) {
  if (padreId === madreId) return 'MISMO PERRO (PROHIBIDO)';

  const p = db.prepare(`SELECT * FROM perros WHERE id=?`).get(padreId);
  const m = db.prepare(`SELECT * FROM perros WHERE id=?`).get(madreId);
  if (!p || !m) return 'DESCONOCIDO';

  if (m.padre_id === p.id) return 'PADRE – HIJA (PROHIBIDO)';
  if (p.padre_id === m.id) return 'HIJO – MADRE (PROHIBIDO)';

  if (
    p.padre_id && p.madre_id &&
    p.padre_id === m.padre_id &&
    p.madre_id === m.madre_id
  ) return 'HERMANOS COMPLETOS (PROHIBIDO)';

  return 'SIN PARENTESCO DIRECTO';
}

/* =========================
   COI DE CRUCE (CORREGIDO)
   ========================= */
ipcMain.handle('calcular-coi-cruce', (e, padreId, madreId) => {
  if (!padreId || !madreId) return { error: 'Selección inválida' };

  const parentesco = detectarParentesco(padreId, madreId);

  const pA=[], mA=[];
  obtenerAncestros(padreId,1,5,'P',pA);
  obtenerAncestros(madreId,1,5,'M',mA);

  const mapP={}, mapM={};
  pA.forEach(a=>mapP[a.id]=a);
  mA.forEach(a=>mapM[a.id]=a);

  const padre = db.prepare(`SELECT nombre FROM perros WHERE id=?`).get(padreId);
  const madre = db.prepare(`SELECT nombre FROM perros WHERE id=?`).get(madreId);

  return {
    padre: padre.nombre,
    madre: madre.nombre,
    parentesco,
    porcentaje: (calcularCOI(mapP,mapM)*100).toFixed(2)
  };
});
