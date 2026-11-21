import 'dotenv/config';
import { queryCheckRouter } from './routes/queryCheck.routes.js';
import express, { type Express, type Request, type Response, Router, type NextFunction } from 'express';

const app: Express = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// interface AnalyzeInfoReq {
//   url_to_check?: string;
//   text_to_check?: string;
// }

// interface AnalyzeInfoRes {

// }

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