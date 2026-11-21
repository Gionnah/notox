import "dotenv/config";
import { z } from "zod";

// Une variable vide (ex: `APIFY_TOKEN=`) est traitée comme absente
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());

const envSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(["development", "production", "test"]).default("development"),
  ),
  PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(65535).default(3000),
  ),
  GEMINI_API_KEY: optionalString,
  APIFY_TOKEN: optionalString,
  APIFY_FACEBOOK_ACTOR_ID: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).default("apify/facebook-posts-scraper"),
  ),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("\n❌ Configuration invalide (.env) :");
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join(".") || "(racine)"} : ${issue.message}`);
    }
    console.error("");
    process.exit(1);
  }

  return Object.freeze(result.data);
}

export const env: Readonly<Env> = loadEnv();
export const isProduction = env.NODE_ENV === "production";