# 🏛️ Academy Management System - The Full Technical Bible

---

## 🗓️ Project Roadmap & Timeline

**Fecha de Inicio del Proyecto:** 16/04/2026
**Fecha Actual:** 07/05/2026 (Semana 3)

### ✅ Fase 1: Frontend & UI Design (Semanas 1-2)
- **Periodo:** 16/04/2026 – 30/04/2026
- **Alcance:** Creación de toda la interfaz visual, navegación, Dashboards de Admin/Parent, Calendario estilo TutorBird y lógica inicial de componentes.
- **Resultado:** Aplicación visualmente completa con Mock Data.

### ✅ Fase 2: Backend & Smart Registration (Semana 3)
- **Periodo:** 01/05/2026 – 07/05/2026 (¡En curso!)
- **Alcance:** Migración a PostgreSQL, Auth con Firebase, Motor de Registro "Love Learning" (1ra/2da opción), Gestión de Clases y Sesiones.
- **Resultado:** El "cerebro" administrativo está operativo en Node.js.

### ✅ Fase 3: Motor Financiero & Pagos (Semana 4-5)
- **Periodo Est.:** 08/05/2026 – 18/05/2026
- **Estado:** Backend integrado con PostgreSQL para Transacciones e Invoices.
- **Alcance:** Integración con Stripe (Pendiente), generación de facturas automáticas, registro de cargos/pagos manuales y Custom Student Dropdown.

### 📋 Fase 4: Notificaciones & Comunicación (Semana 6)
- **Periodo Est.:** 19/05/2026 – 25/05/2026
- **Alcance:** Triggers automáticos por inasistencias, alertas de snack card baja, recordatorios de pago y anuncios masivos por email/push.

### 📋 Fase 5: AI Assistant Integration (Semana 7-8)
- **Periodo Est.:** 26/05/2026 – 05/06/2026
- **Alcance:** Conexión con LLM Local (Ollama), entrenamiento en "Tool Calling" para que la IA realice acciones administrativas por chat.

### 🚀 Fase 6: PWA, Testing & Go-Live (Semana 9)
- **Periodo Est.:** 06/06/2026 – 15/06/2026
- **Alcance:** Conversión final a PWA, testing con usuarios reales, corrección de bugs y despliegue final en producción (Railway/Vercel).

---

## 📂 1. Directory Structure (Backend)

```
server/
├── prisma/
│   ├── schema.prisma           # Database Schema (Single Source of Truth)
│   └── seed.js                 # Initial data & mock migration script
├── src/
│   ├── index.js                # Express Server & Socket.io Entry Point
│   ├── config/
│   │   ├── database.js         # Prisma Client configuration
│   │   └── firebase-admin.js   # Firebase Admin SDK setup
│   ├── middleware/
│   │   ├── auth.js             # Firebase Token Verification
│   │   ├── roles.js            # Role-Based Access Control (RBAC)
│   │   ├── errorHandler.js     # Unified Error Management
│   │   └── rateLimit.js        # API Protection (3 tiers)
│   ├── controllers/
│   │   ├── auth.controller.js  # Firebase Sync & Admin registration
│   │   ├── users.controller.js # Profile & User management
│   │   ├── families.controller.js # Family & Membership logic
│   │   ├── students.controller.js # Health, Attendance, & Punches
│   │   ├── classes.controller.js  # Academic Classes & Enrollment
│   │   ├── sessions.controller.js # Calendar & Attendance logic
│   │   └── registration.controller.js # THE BRAIN: Smart Registration resolver
│   ├── routes/
│   │   ├── auth.routes.js      # /api/auth
│   │   ├── users.routes.js     # /api/users
│   │   ├── families.routes.js  # /api/families
│   │   ├── students.routes.js  # /api/students
│   │   ├── classes.routes.js   # /api/classes
│   │   ├── sessions.routes.js  # /api/sessions
│   │   └── registration.routes.js # /api/registration
│   └── utils/
│       ├── validators.js       # Zod schemas for request validation
│       └── helpers.js          # Currency, CC Fees, and Date helpers
├── .env                        # Private config
└── package.json                # Dependencies: Express 5, Prisma, Stripe, Socket.io
```

---

## 🗄️ 2. Database Schema (PostgreSQL)

Hemos definido **22 modelos** interconectados:

### USERS & FAMILIES
- **User:** Perfiles de Admin, Teacher, Student y Parent. Incluye campos específicos como `snackPunches`, `prizePoints` y `allergies`.
- **Family:** La unidad principal de facturación.
- **FamilyMember:** Tabla relacional que une padres con hijos y define quién recibe la factura.

### ACADEMIC ENGINE
- **Class:** Materias o "Pods". Tienen capacidad máxima (`maxStudents`) y están ligadas a un profesor.
- **ClassEnrollment:** Rastreo de quién está en cada clase (activo/inactivo).
- **Session:** Cada "instancia" de una clase en el calendario.
- **Attendance:** El registro diario: Presente, Ausente, Tarde, Excusado.
- **SessionNote:** Notas del profesor (visibilidad configurable: Público o Admin-only).
- **SessionMaterial:** Archivos adjuntos a la clase del día.
- **Material:** Repositorio personal de materiales para el estudiante.

### SMART REGISTRATION (Love Learning Spec)
- **RegistrationTerm:** Define los semestres (ej. "Fall 2026") y sus ventanas de tiempo.
- **PriorityHold:** Las reservas de cupo garantizadas para alumnos actuales.
- **RegistrationRequest:** Captura la 1ra y 2da opción de cada familia.
- **WaitlistEntry:** Lista de espera automatizada por orden de llegada.

### FINANCIAL & OTHER (Próximo)
- **Transaction, Invoice, InvoiceLine, Payment:** Motor de cobros (Stripe/Manual).
- **ScholarshipDisbursement:** Control de becas FES/EMA.
- **Notification & Announcement:** Motor de comunicación.
- **ChatThread, ChatMessage:** Chat con soporte para IA.

---

## 🧠 3. The "Love Learning" Registration Logic

Este es el módulo más avanzado. Funciona así:

1.  **Seed Window:** El Admin genera una nueva Term. El sistema escanea las listas actuales y crea `PriorityHolds` (reservas) para todos los alumnos en sus mismos días.
2.  **Window 1 (Early Same Day):** Solo los que tienen una reserva pueden inscribirse. Su cupo está 100% garantizado.
3.  **Window 2 (Early Switching):** Se abren los cupos sobrantes para alumnos actuales que quieran cambiar de día.
4.  **Window 3 (Public):** Abierto a todo el mundo.
5.  **The Resolver (1st/2nd Choice):** 
    - El sistema intenta la **1ra opción**.
    - Si falla, mete al alumno en la **Waitlist** de la 1ra y trata de inscribirlo en la **2da opción**.
    - Si el alumno está en su 2da opción y se libera un hueco en la 1ra, el sistema lo **mueve automáticamente** y libera su lugar en la 2da opción para el siguiente en la lista.

---

## 📡 4. Master API Endpoint List

| Módulo | Endpoint | Método | Función |
|---|---|---|---|
| **Auth** | `/api/auth/sync` | POST | Sincroniza login de Firebase con PostgreSQL |
| | `/api/auth/register` | POST | Admin crea cuenta de profesor/padre |
| **Users** | `/api/users` | GET | Lista paginada y filtrable de usuarios |
| | `/api/users/:id/status`| PUT | Suspender o activar cuenta |
| **Students**| `/api/students/:id` | GET | Perfil full (salud, snacks, premios) |
| | `/api/students/:id/snack-punches` | PUT | Sumar/Restar punches de snacks |
| **Families**| `/api/families/:id/members`| POST | Agregar parientes a una familia |
| **Classes** | `/api/classes` | POST | Crear nuevo Pod/Electiva |
| | `/api/classes/:id/enrollments`| POST | Inscribir con chequeo de cupo máximo |
| **Sessions**| `/api/sessions` | GET | Datos para el calendario |
| | `/api/sessions/:id/attendance`| PUT | Pase de lista masivo (Transacción segura) |
| **Dashboard**| `/api/dashboard` | GET | Panel consolidado (Sesiones, Materiales, Billing) |
| **Billing** | `/api/billing/transactions` | GET/POST | Listar y crear cargos/pagos |
| **Billing** | `/api/billing/invoices` | GET/POST | Listar y generar facturas automáticamente |
| **Reg** | `/api/registration/terms` | POST | Abrir nuevo ciclo escolar |
| **Reg** | `/api/registration/request` | POST | Enviar solicitud de 1ra y 2da opción |

---

## 🛠️ 5. Next Phase: Phase 3 - Financial Engine

El siguiente paso es construir el motor de dinero:
- **Stripe Integration:** Generación de `PaymentIntents` y `Checkout Sessions`.
- **Fee Pass-through:** Lógica para cobrar el 2.9% + $0.30 al padre si tú lo decides.
- **Invoicing:** Generación automática de facturas PDF en base a las inscripciones.
- **Scholarship Applied:** Aplicar dinero de FES/EMA como crédito a la factura.

---

## 💻 6. Frontend Architecture (React & Vite)

La aplicación cliente está construida para ser rápida, visualmente impresionante y **Premium**.

### Tech Stack
- **Framework:** React 19 (última versión) con **Vite** para compilación ultrarrápida.
- **Iconografía:** Lucide React (limpio y moderno).
- **Animaciones:** Framer Motion (para transiciones suaves).
- **Gráficos:** Recharts (visualización de finanzas y asistencia).
- **Estilo:** Vanilla CSS con variables CSS dinámicas para un look moderno (Glassmorphism).

### Estructura de Módulos (UI)
- **`src/components/Dashboard`**: Vista general de métricas clave.
- **`src/components/Students`**: Perfiles de alumnos, Snack Cabinet (Modal), y seguimiento de Prize Points.
- **`src/components/Billing`**: Interfaz de facturas, balance de familias y pagos.
- **`src/components/Registration`**: Flujo de inscripción (donde conectaremos la lógica de 1ra/2da opción).
- **`src/components/Calendar`**: Vista de clases y sesiones (basado en el estilo TutorBird).

### Roadmap de Conexión
1. **Migración de Datos:** Actualmente el front usa un archivo `database.js` (Mock Data). El siguiente paso es crear un `apiService.js` que use **Axios** o **Fetch** para llamar a nuestro nuevo Backend de Node.js.
2. **Estado Global:** Usaremos Context API o un sistema ligero de estado para manejar la sesión del usuario (Firebase Auth) en toda la app.

---

## 📱 7. PWA Status (App Descargable)

La app está diseñada para ser una **Progressive Web App**:
- **Instalable:** Ya tiene el diseño "App-like" con Sidebar colapsable y navegación móvil.
- **PWA Plugin:** Próximamente activaremos `vite-plugin-pwa` para generar el `manifest.json`.
- **Notificaciones Push:** Conectaremos el backend de Firebase Messaging para que las alertas lleguen directamente al celular del usuario sin necesidad de descargarla de la App Store.

---
*Fin del reporte técnico detallado.*
