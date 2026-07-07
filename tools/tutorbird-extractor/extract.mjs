/*
 * extract.mjs — Extrae TODOS los estudiantes de la tabla de TutorBird a CSV.
 *
 * Lectura DETERMINISTA de la tabla (sin IA → cero riesgo de confundir datos).
 * Maneja paginación (carga de a 25) y los 3 filtros (Active/Trial/Waiting),
 * deduplicando por id de fila. Genera out/students.csv en el formato del importador.
 *
 * Uso:
 *   npm run extract                 (todos)
 *   (PowerShell)  $env:TB_LIMIT=10; npm run extract   (prueba con 10)
 *
 * Requiere haber corrido `npm run explore` antes (sesión guardada en tb-profile/).
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const PROFILE_DIR = path.resolve('./tb-profile');
const OUT_DIR = path.resolve('./out');
const LIST_URL = process.env.TB_LIST_URL || 'https://app.tutorbird.com/Teacher/v2/en/students#Students';
const LIMIT = parseInt(process.env.TB_LIMIT || '0');
const FIELDS = ['studentName', 'studentEmail', 'age', 'allergies', 'status', 'parentName', 'parentEmail', 'parentPhone', 'familyName', 'tags'];

const csvEscape = (v) => {
  const s = (v == null ? '' : String(v)).trim();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Parse one row's raw fields into our schema.
const parseRow = (raw) => {
  // name: "Last, First" → "First Last"
  let studentName = (raw.nameAttr || '').trim();
  if (studentName.includes(',')) {
    const [last, first] = studentName.split(',').map(s => s.trim());
    studentName = `${first} ${last}`.trim();
  }

  // status: Active/Trial/Waiting from the student cell
  const status = (raw.studentCell.match(/\b(Active|Trial|Waiting|Inactive|Lead)\b/i) || [])[1] || 'Active';

  // family cell lines: [parent+family, email, phone]
  const famLines = (raw.familyCell || '').split('\n').map(s => s.trim()).filter(Boolean);
  let parentName = '', parentEmail = '', parentPhone = '', familyName = '';
  for (const line of famLines) {
    if (/@/.test(line) && !parentEmail) { parentEmail = line; continue; }
    if (/[\d][\d().\-\s]{6,}/.test(line) && !parentPhone && !/@/.test(line)) { parentPhone = line.replace(/[‪‬]/g, '').trim(); continue; }
    if (!familyName) {
      // "Adaline EMA, Dana" → familyLast="Adaline", parentFirst="Dana"
      const noEma = line.replace(/\bEMA\b/g, '').replace(/\s{2,}/g, ' ').trim();
      if (noEma.includes(',')) {
        const [famLast, parentFirst] = noEma.split(',').map(s => s.trim());
        familyName = famLast;
        parentName = `${parentFirst} ${famLast}`.trim();
      } else {
        familyName = noEma;
        parentName = noEma;
      }
    }
  }

  // tags: each on its own line
  const tags = (raw.tagsCell || '').split('\n').map(s => s.trim()).filter(t => t && t !== '-').join(', ');

  // age: number
  const age = (raw.ageCell || '').match(/\d+/)?.[0] || '';

  // notes: keep ONLY a FES-ID if present (notes can contain long form-submission
  // blobs we don't want polluting the tags).
  const note = (raw.notesCell || '').trim();
  const fes = note.match(/FES[-\s]?(?:UA\s)?ID:?\s*(\d+)/i);
  const fesTag = fes ? `FES-ID: ${fes[1]}` : '';
  const tagsWithNote = fesTag ? (tags ? `${tags}, ${fesTag}` : fesTag) : tags;

  return {
    studentName,
    studentEmail: (raw.contactCell || '').trim(),
    age,
    allergies: '',
    status: /trial/i.test(status) ? 'Active' : /wait/i.test(status) ? 'Active' : (/inactive/i.test(status) ? 'Inactive' : 'Active'),
    parentName,
    parentEmail,
    parentPhone,
    familyName,
    tags: tagsWithNote,
  };
};

const extractVisibleRows = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('tr.mat-mdc-row, tr[mat-row]')];
  return rows.map(tr => {
    const cells = [...tr.querySelectorAll('td')];
    const t = (i) => (cells[i] ? cells[i].innerText.trim() : '');
    return {
      id: tr.id || tr.getAttribute('data-sb-qa') || '',
      nameAttr: tr.getAttribute('data-sb-qa') || '',
      studentCell: t(1),
      contactCell: t(2),
      familyCell: t(3),
      notesCell: t(4),
      tagsCell: t(5),
      ageCell: t(9),
    };
  });
});

const run = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: { width: 1500, height: 950 } });
  const page = ctx.pages()[0] || (await ctx.newPage());

  console.log('→ Abriendo lista de estudiantes...');
  await page.goto(LIST_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Try to maximize page size (mat-paginator "Items per page").
  try {
    const sizeSel = page.locator('.mat-mdc-paginator-page-size-select, mat-paginator mat-select').first();
    if (await sizeSel.count()) {
      await sizeSel.click();
      await page.waitForTimeout(500);
      const opts = page.locator('mat-option');
      const n = await opts.count();
      if (n) { await opts.nth(n - 1).click(); await page.waitForTimeout(2000); console.log(`→ Tamaño de página maximizado (${n} opciones).`); }
    }
  } catch (e) { console.log('   (no se pudo cambiar el tamaño de página, sigo con paginación normal)'); }

  // Save paginator + filter HTML so we can debug if the count is off.
  const debug = await page.evaluate(() => ({
    paginator: document.querySelector('mat-paginator')?.outerHTML?.slice(0, 1200) || '(no paginator)',
    filterArea: (document.body.innerText.match(/\d+\s+Active[\s\S]{0,60}Waiting/) || [''])[0],
  }));
  fs.writeFileSync(path.join(OUT_DIR, 'debug-paginator.json'), JSON.stringify(debug, null, 2));

  const byId = new Map();
  const collectAllPages = async (label) => {
    let pageNum = 1;
    let emptyStreak = 0;
    while (true) {
      await page.waitForTimeout(1200);
      const rows = await extractVisibleRows(page);
      let added = 0;
      for (const r of rows) { if (r.id && !byId.has(r.id)) { byId.set(r.id, r); added++; } }
      console.log(`   [${label}] página ${pageNum}: ${rows.length} filas (nuevas: ${added}) — total único: ${byId.size}`);
      if (LIMIT && byId.size >= LIMIT) return;

      // Stop if two pages in a row add nothing new (reached the end / loop guard).
      emptyStreak = added === 0 ? emptyStreak + 1 : 0;
      if (emptyStreak >= 2) return;

      // Next page — handle "not visible" via scroll + force click.
      const next = page.locator('.mat-mdc-paginator-navigation-next, button[aria-label="Next page"]').first();
      if ((await next.count()) === 0) return;
      if (await next.isDisabled().catch(() => true)) return;
      try {
        await next.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await next.click({ force: true, timeout: 8000 });
      } catch (e) {
        console.log(`   (fin de "${label}" — no pude avanzar: ${e.message.split('\n')[0]})`);
        return;
      }
      pageNum++;
    }
  };

  // Pass over each status filter so we cover Active + Trial + Waiting.
  const statuses = ['Active', 'Trial', 'Waiting'];
  for (const st of statuses) {
    try {
      const filter = page.getByText(new RegExp(`^\\s*\\d+\\s+${st}\\s*$`)).first();
      if (await filter.count()) {
        await filter.click();
        await page.waitForTimeout(2000);
        console.log(`→ Filtro: ${st}`);
      } else {
        console.log(`→ (no encontré el filtro "${st}", uso la vista actual)`);
      }
    } catch { /* ignore */ }
    try { await collectAllPages(st); } catch (e) { console.log(`   (error en filtro ${st}: ${e.message.split('\n')[0]})`); }
    if (LIMIT && byId.size >= LIMIT) break;
  }

  let raws = [...byId.values()];
  if (LIMIT) raws = raws.slice(0, LIMIT);
  const rows = raws.map(parseRow).filter(r => r.studentName);

  const csv = [FIELDS.join(','), ...rows.map(r => FIELDS.map(f => csvEscape(r[f])).join(','))].join('\n');
  const outFile = path.join(OUT_DIR, 'students.csv');
  fs.writeFileSync(outFile, csv);

  console.log(`\n✅ ${rows.length} estudiantes únicos → ${outFile}`);
  console.log('   ⚠️ REVISA el CSV (nombres, padres, teléfonos) antes de importarlo.');
  console.log('   Si el total no es ~453, mándame out/debug-paginator.json y ajusto la paginación.');
  await ctx.close();
};

run().catch((e) => { console.error('Error:', e.message); process.exit(1); });
