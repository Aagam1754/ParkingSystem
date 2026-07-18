import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.js';
import basesRoutes from './routes/bases.js';
import sessionsRoutes from './routes/sessions.js';
import vehiclesRoutes from './routes/vehicles.js';
import dashboardRoutes from './routes/dashboard.js';
import alprRoutes from './routes/alpr.js';
import assistantRoutes from './routes/assistant.js';
import { emitAssistantTips } from './services/assistantTips.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const allowOrigin =
  !process.env.CLIENT_ORIGIN || process.env.CLIENT_ORIGIN === '*'
    ? true
    : process.env.CLIENT_ORIGIN;

const io = new Server(server, {
  cors: {
    origin: allowOrigin,
    methods: ['GET', 'POST', 'PATCH'],
    credentials: true,
  },
});

app.set('io', io);

app.use(
  cors({
    origin: allowOrigin,
    credentials: true,
  })
);
// Webcam frames are base64 JPEG/PNG — default 100kb limit is too small
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'parking-api', db: process.env.DB_NAME || 'parking' });
});

app.use('/api/auth', authRoutes);
app.use('/api/bases', basesRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/alpr', alprRoutes);
app.use('/api/assistant', assistantRoutes);

io.on('connection', (socket) => {
  socket.emit('connected', { message: 'ParkAI live feed connected' });
  emitAssistantTips(io).then((payload) => {
    if (payload) socket.emit('assistant.tip', payload);
  });
});

// Production / Render: serve built React admin from the same origin
const serveAdmin =
  String(process.env.SERVE_ADMIN || '').toLowerCase() === 'true' ||
  String(process.env.SERVE_ADMIN || '') === '1';
if (serveAdmin) {
  const adminDist = path.resolve(__dirname, '../../admin/dist');
  app.use(express.static(adminDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    return res.sendFile(path.join(adminDist, 'index.html'), (err) => {
      if (err) next();
    });
  });
}

const port = Number(process.env.PORT || 4000);
server.listen(port, '0.0.0.0', () => {
  console.log(`Parking API listening on http://0.0.0.0:${port}`);
  if (serveAdmin) console.log(`Serving admin UI from admin/dist (SERVE_ADMIN=true)`);
});
