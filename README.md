# Mundo Curioso Analytics

Centro de inteligencia de contenido para **@mundo.curioso13**: almacena cada Reel, cada medición y cada experimento en PostgreSQL, y convierte el historial en patrones, rankings y recomendaciones respaldadas por datos.

La aplicación empieza vacía. No incluye datos de ejemplo: todo lo que muestra sale de lo que registras o importas.

## Stack

- **Frontend:** React 19 + Vite + TypeScript, Recharts, jsPDF.
- **API:** Node.js + Express 5 (TypeScript con `tsx`).
- **Base de datos:** PostgreSQL 14+ con migraciones SQL propias (`server/migrations`). Funciona igual con Supabase.

## Puesta en marcha (local)

Requisitos: Node 20+ y PostgreSQL.

```bash
npm install
cp .env.example .env          # ajusta DATABASE_URL
npm run dev                   # API en :3001 y web en http://localhost:5173
```

Las migraciones se aplican solas al arrancar la API.

Producción en un único proceso:

```bash
npm run build
npm start                     # sirve la API y la web en el puerto PORT
```

## Usar Supabase

1. Crea un proyecto en Supabase.
2. En **Project Settings → Database → Connection string**, copia la URI (modo *Session pooler*) y ponla en `DATABASE_URL` en el `.env` del servidor. Nunca la subas al repositorio.
3. Arranca la app: crea las tablas automáticamente.
4. (Recomendado) Ejecuta `supabase/policies.sql` en el editor SQL. Activa RLS en todas las tablas sin políticas públicas, así la API REST pública de Supabase no expone nada; solo el servidor de la app accede, con la cadena de conexión.

## Seguridad

- `APP_PASSWORD` activa el acceso con contraseña (cookie firmada, `httpOnly`). Defínelo siempre que la app esté publicada en internet.
- Las credenciales (base de datos, Claude, Meta) viven solo en variables de entorno del servidor.
- Copias de seguridad: **Configuración → Datos y copias** descarga un JSON completo o CSV por tabla. En Supabase también puedes usar `pg_dump`.

## Reglas de los datos

- Un dato que falta se muestra como **«No registrado»**: nunca se sustituye por 0 ni por estimaciones.
- Alcance, impresiones y reproducciones son campos distintos.
- Las tasas (engagement, share, save, profile visit, conversión) se calculan sobre el alcance y se marcan como *calculadas*.
- La **retención aproximada** = tiempo promedio ÷ duración × 100. No es la cifra oficial de Instagram y puede superar el 100 %.
- Cada medición se guarda con su fecha y hora. Así se puede comparar a «≈24 h», «≈7 días» o «≈30 días» de publicarse.
- **Patrones:** comparación de cada grupo con el resto (Mann-Whitney), muestra mínima de 5 videos por lado y corrección de Benjamini-Hochberg (q < 0,10). Se presentan como asociaciones, no como causas.
- **Ranking:** puntuación z robusta (mediana y MAD) frente al historial de la propia cuenta, sin umbrales fijos de viralidad.

## Pruebas

```bash
# Base de datos de pruebas separada (se borra al empezar)
export TEST_DATABASE_URL=postgres://usuario:clave@localhost:5432/mca_test
npm test
npm run typecheck
```

## Estructura

```
server/   API, migraciones, analítica, importación CSV
shared/   fórmulas y estadística comunes a servidor y cliente
client/   interfaz React
tests/    pruebas unitarias y de integración
```

## Hoja de ruta

- **Fase 1 (hecha):** persistencia, registro manual, importación CSV, analítica, ranking, patrones, laboratorio, memoria, informes.
- **Fase 2:** integración oficial con la Instagram Graph API (OAuth de Meta, sin scraping) y AI Advisor con Claude, usando solo los datos almacenados.
