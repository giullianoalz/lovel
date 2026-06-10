# Contexto del Proyecto: "Academy Management System" (Lovelearning)

Actúa como un desarrollador Full-Stack experto. Estoy construyendo un sistema de gestión para una academia ("Lovelearning"). Debes continuar el desarrollo a partir del estado actual. A continuación te detallo toda la arquitectura, tecnologías y el estado del proyecto.

## 1. Stack Tecnológico
*   **Frontend:** React (Vite), React Router v6, CSS puro (sin Tailwind, usando variables CSS globales en `index.css`), Lucide React para íconos.
*   **Backend:** Node.js, Express.js.
*   **Base de Datos:** PostgreSQL (alojada en Neon DB) usando **Prisma ORM**.
*   **Autenticación:** Firebase Auth en el cliente, pero los roles y perfiles se manejan en la tabla `User` de Prisma. Hay un interceptor en Axios (`api.js`) que envía el token JWT o un header de bypass para desarrollo (`x-dev-user-email`).
*   **Diseño (UI/UX):** Estética premium, "Glassmorphism" (fondos semitransparentes con `backdrop-filter: blur()`), paleta de colores vibrante (verde principal, azules, rosas), bordes redondeados, sombras suaves y micro-animaciones en hover. 

## 2. Estructura del Código
El proyecto es un monorepo (Frontend en la raíz, Backend en la carpeta `/server`).
*   `src/components/`: Contiene los módulos (Auth, Dashboard, Portal, Layout, etc.).
*   `src/context/AuthContext.jsx`: Maneja el login y el "Bypass de Desarrollador".
*   `server/src/`: Contiene `index.js`, `routes/`, `controllers/` y `middleware/` (autenticación y roles).
*   `server/prisma/schema.prisma`: El esquema de la base de datos (ya migrado y activo).

## 3. Estado Actual del Proyecto (Qué está hecho)
1.  **Base de Datos & Backend:** El modelo de Prisma está completo y la base de datos Neon está activa (`npx prisma db push` realizado exitosamente). TODAS las rutas del backend para las funciones principales están creadas (Asistencia, Comportamiento, Médico, Calendario, Anuncios, Alertas de Emergencia).
2.  **Autenticación & Routing:** Funciona correctamente, limitando rutas según el rol (ADMIN, TEACHER, PARENT, STUDENT).
3.  **Teacher Portal (`TeacherPortal.jsx`):** ¡Completado exitosamente! Incluye la "Emergency Strip" (Lock down, Medic, etc.), widget de Anuncios, tabla de Roster (con símbolos de alergias, control de asistencia rápido y puntos/seashells), y formularios de reporte Médico y de Conducta (Behavior).
4.  **Sistema de Chat:** Rutas del backend listas para soportar mensajes grupales (ej. Management, Ocean Navigators).
5.  **Dashboard Principal:** Los Dashboards base de Admin están implementados con la estética Glassmorphism.

## 4. Tarea Inmediata (Lo que debes programar AHORA)
Antes de detenernos, la siguiente tarea era construir el **Parent Portal con sistema QR (Autorización de recogida)**. 

### Requisitos para el Parent Portal:
El archivo actual está en `src/components/Portal/ParentPortal.jsx`. Debes actualizarlo/mejorarlo para incluir lo siguiente:
1.  **Dashboard Familiar:** Ya existe una base que muestra a los hijos asociados al padre. Mantén el diseño estético de tarjetas glassmorphism.
2.  **Autorización de Recogida Temporal (TempPickupAuth):**
    *   **Frontend:** Crea un botón/modal en el Portal de Padres que permita agregar el nombre de una persona autorizada, su parentesco/relación, y la fecha para recoger al alumno de la academia.
    *   **Sistema QR:** El frontend debe generar visualmente un Código QR en la pantalla (puedes usar una librería como `qrcode.react` o un SVG temporal simulado) que el padre le enviará a esa persona.
    *   **Backend:** Asegúrate de que el backend (revisa o crea si es necesario en `portal.controller.js` o crea un `pickup.controller.js`) maneje la creación del modelo `TempPickupAuth` que ya existe en el esquema de Prisma.

### Instrucciones Críticas de Desarrollo:
*   **Reglas de CSS:** No uses Tailwind. Todo el CSS debe escribirse en un archivo asociado (ej. `ParentPortal.css`) usando las variables de `index.css` (ej. `var(--primary)`, `var(--bg-card)`). Las animaciones de entrada (`@keyframes`) son obligatorias.
*   **Flujo de Trabajo:** Lee el archivo `ParentPortal.jsx`, luego revisa `server/prisma/schema.prisma` buscando `TempPickupAuth` para entender cómo estructurar el POST request, y luego implementa la función visual del código QR y el formulario de autorización.
