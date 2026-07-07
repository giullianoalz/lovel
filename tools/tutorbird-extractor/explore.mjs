/*
 * explore.mjs — Paso 1: capturar la estructura de TutorBird.
 *
 * Abre un navegador, te deja iniciar sesión a mano, y cuando estés en la
 * LISTA DE ESTUDIANTES guarda la estructura de la página (URL, enlaces, texto)
 * en ./out/structure.json para poder afinar la extracción.
 *
 * Uso:  npm run explore
 * La sesión se guarda en ./tb-profile, así no tienes que volver a loguearte.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const PROFILE_DIR = path.resolve('./tb-profile');
const OUT_DIR = path.resolve('./out');
const START_URL = process.env.TB_URL || 'https://app.tutorbird.com';

const waitForEnter = (msg) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(msg, () => { rl.close(); resolve(); });
});

const run = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('\n================= TutorBird Explorer =================');
  console.log('1) Inicia sesión en TutorBird en la ventana que se abrió.');
  console.log('2) Navega a la LISTA DE ESTUDIANTES (Students).');
  console.log('3) Vuelve a esta terminal y presiona ENTER.\n');
  await waitForEnter('Cuando estés en la lista de estudiantes, presiona ENTER aquí... ');

  // Capture structure of the current page, focused on the student table.
  const data = await page.evaluate(() => {
    // Find the largest table (the student grid).
    const tables = [...document.querySelectorAll('table')];
    let table = tables.sort((a, b) => b.querySelectorAll('tr').length - a.querySelectorAll('tr').length)[0] || null;

    // Header cells
    const headers = table ? [...table.querySelectorAll('thead th, thead td')].map(h => (h.innerText || '').trim()) : [];

    // Sample the first 3 data rows: outerHTML (truncated) + cell texts
    const bodyRows = table ? [...table.querySelectorAll('tbody tr')] : [];
    const sampleRows = bodyRows.slice(0, 3).map(tr => ({
      cells: [...tr.querySelectorAll('td')].map(td => (td.innerText || '').replace(/\s+/g, ' ').trim()),
      html: tr.outerHTML.slice(0, 1500),
    }));

    // Pagination / row-count hints
    const pagerText = (document.body.innerText.match(/\b\d+\s*[-–]\s*\d+\s*of\s*\d+\b/i) || [])[0] || '';

    return {
      url: location.href,
      title: document.title,
      tableCount: tables.length,
      headers,
      totalBodyRows: bodyRows.length,
      sampleRows,
      pagerText,
      bodyTextSample: (document.body.innerText || '').slice(0, 1500),
    };
  });

  const outFile = path.join(OUT_DIR, 'structure.json');
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
  console.log(`\n✅ Estructura guardada en: ${outFile}`);
  console.log(`   URL: ${data.url}`);
  console.log(`   Enlaces capturados: ${data.links.length} | tablas: ${data.tableCount} | filas: ${data.rowCount}`);
  console.log('\nComparte ese archivo (o su contenido) para afinar la extracción.');
  console.log('Puedes cerrar el navegador cuando quieras.\n');

  await waitForEnter('Presiona ENTER para cerrar el navegador... ');
  await ctx.close();
};

run().catch((e) => { console.error('Error:', e.message); process.exit(1); });
