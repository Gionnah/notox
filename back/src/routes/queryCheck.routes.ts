import { Router,type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { runQueryCheck, UnsupportedPlatformError } from "../services/queryCheck.service.js";
import { extractSourceContent } from "../services/contentExtractor.service.js";


export const queryCheckRouter = Router();

export const queryCheckSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(3, "La question doit contenir au moins 3 caractères")
      .max(500, "La question est trop longue")
      .optional(),
    source: z
      .string()
      .trim()
      .min(3, "La source doit contenir au moins 3 caractères")
      .max(15000, "La source est trop longue")
      .optional(),
  })
  .refine((data) => Boolean(data.question) || Boolean(data.source), {
    message: "Vous devez fournir au moins une question ou une source.",
    path: ["question"],
  });

export type QueryCheckInput = z.infer<typeof queryCheckSchema>;

queryCheckRouter.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedBody = queryCheckSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          details: parsedBody.error.flatten(),
        });
      }

      const checkedQuery = runQueryCheck(parsedBody.data);
      const extracted = await extractSourceContent(checkedQuery.source);

      return res.status(200).json({
        status: "extracted",
        query: checkedQuery,
        extracted,
      });
    } catch (err) {
      // ... à l'intérieur du catch de la route POST :
      if (err instanceof UnsupportedPlatformError) {
        return res.status(422).json({
          error: err.code,
          hostname: err.hostname,
          message: err.message,
        });
      }
      return next(err);
    }
  }
);