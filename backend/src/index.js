import http from 'http';
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
import meRoutes from './routes/me.js';

dotenv.config();

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
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'parking-api', db: process.env.DB_NAME || 'parking' });
});

app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/bases', basesRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/alpr', alprRoutes);

io.on('connection', (socket) => {
  socket.emit('connected', { message: 'ParkAI live feed connected' });
});

const port = Number(process.env.PORT || 4000);
server.listen(port, '0.0.0.0', () => {
  console.log(`Parking API listening on http://0.0.0.0:${port}`);
});
