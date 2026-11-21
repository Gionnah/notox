import { env } from './config/env.js';
import { queryCheckRouter } from './routes/queryCheck.routes.js';
import express, { type Express, type Request, type Response } from 'express';

const app: Express = express();
const PORT = env.PORT;

app.use(express.json());

app.get('/', (req: Request, res: Response) => { // health check
  res.json({message: 'Hello World!'});
});

app.use('/api', queryCheckRouter);

app.listen(PORT, "0.0.0.0", () => {
  console.log("\n🚀 Server started successfully!");
  console.log(`📡 Local:   http://localhost:${PORT}`);
  console.log(`🌐 Network: http://<YOUR_LOCAL_IP>:${PORT}`);
  console.log(`📁 Mode:    ${process.env.NODE_ENV || "development"}\n`);
});