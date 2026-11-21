import { ApifyClient } from "apify-client";
import { env } from "../config/env.js";

export interface ApifyFacebookExtraction {
  title: string | null;
  text: string;
}

function readFirstNonEmptyString(
  record: Record<string, unknown>,
  keys: string[]
): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

export async function fetchFacebookPostViaApify(
  url: string,
  waitSecs = 25
): Promise<ApifyFacebookExtraction | null> {
  const token = env.APIFY_TOKEN;
  const actorId = env.APIFY_FACEBOOK_ACTOR_ID;

  if (!token) {
    return null;
  }

  const client = new ApifyClient({ token });

  const run = await client.actor(actorId).call(
    {
      startUrls: [{ url }],
      resultsLimit: 1,
    },
    { waitSecs }
  );

  if (!run?.defaultDatasetId) {
    return null;
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems({
    limit: 1,
  });

  const item = items[0] as Record<string, unknown> | undefined;
  if (!item) {
    return null;
  }

  const text = readFirstNonEmptyString(item, [
    "text",
    "message",
    "postText",
    "fullText",
    "caption",
  ]);

  const title =
    readFirstNonEmptyString(item, [
      "pageName",
      "userName",
      "authorName",
      "title",
    ]) || null;

  if (!text) {
    return null;
  }

  return { title, text };
}