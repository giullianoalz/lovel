# TutorBird Extractor (Playwright + Ollama, 100% local, $0 tokens)

Extrae estudiantes/familias de TutorBird a un CSV importable en la app.
La **navegación** la hace Playwright (determinista, confiable); la **extracción de campos**
la hace Ollama local (gratis). Resultado: `out/students.csv` con las columnas que
entiende el importador del Directorio.

## Requisitos
- Node 18+ (ya lo tienes).
- Ollama corriendo con un modelo. Recomendado: `qwen2.5:7b` (mejor que 3b para extraer campos).
  ```
  curl http://localhost:11434/api/pull -d "{\"name\":\"qwen2.5:7b\"}"
  ```

## Paso 1 — Explorar (capturar la estructura)
```
npm run explore
```
1. Se abre un navegador. **Inicia sesión** en TutorBird.
2. Ve a la **lista de estudiantes**.
3. Vuelve a la terminal y presiona **ENTER**.
4. Guarda la estructura en `out/structure.json`.

La sesión queda guardada en `tb-profile/`, así no vuelves a loguearte.
**Comparte `out/structure.json`** para afinar el patrón de enlaces y selectores.

## Paso 2 — Extraer
Edita `extract.mjs` (o usa variables de entorno) con lo que vimos en structure.json:
- `TB_LIST_URL` — la URL de la lista de estudiantes.
- `TB_LINK_PATTERN` — texto/regex que identifica los enlaces de perfil (ej. `Student`).
- `OLLAMA_MODEL` — ej. `qwen2.5:7b`.
- `TB_LIMIT` — pon `3` para una prueba antes de correr todo.

Prueba con 3 primero:
```
TB_LIMIT=3 npm run extract
```
Si se ve bien, corre todo:
```
npm run extract
```
Genera `out/students.csv`.

## Paso 3 — Revisar e importar
1. **Abre `out/students.csv` y revísalo** — sobre todo nombres y alergias (datos críticos).
2. En la app: **Directorio → Import CSV** → mapea columnas → preview → importar.

## Notas
- Es de **un solo uso** (migración). No afecta los costos de la app.
- Si TutorBird pagina la lista, puede que haya que cargar todas las páginas antes de extraer
  (lo ajustamos tras ver structure.json).
- `tb-profile/` contiene tu sesión — **no lo subas a git** (ya está en .gitignore del repo si aplica).
