import { env } from './config/env.js';
import { queryCheckRouter } from './routes/queryCheck.routes.js';
import { provenanceRouter } from './routes/provenance.routes.js';
import cors from 'cors';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';

const app: Express = express();
const PORT = env.PORT;

app.use(helmet());
const allowedOrigins = env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false }));
app.use(express.json({ limit: '100kb' }));

app.get('/', (req: Request, res: Response) => { // health check
  res.json({message: 'Hello World!'});
});

app.use('/api', queryCheckRouter);
app.use('/api/provenance', provenanceRouter);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500
      ? error.status
      : 500;
  const message =
    status === 413
      ? 'Le contenu de la requête dépasse la taille maximale autorisée.'
      : status < 500 && error instanceof Error
        ? error.message
        : 'Une erreur interne est survenue.';
  if (status >= 500) console.error('Request failed:', error);
  return res.status(status).json({
    error: status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 500 ? 'INTERNAL_SERVER_ERROR' : 'INVALID_REQUEST',
    message,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("\n🚀 Server started successfully!");
  console.log(`📡 Local:   http://localhost:${PORT}`);
  console.log(`🌐 Network: http://<YOUR_LOCAL_IP>:${PORT}`);
  console.log(`📁 Mode:    ${process.env.NODE_ENV || "development"}\n`);
});