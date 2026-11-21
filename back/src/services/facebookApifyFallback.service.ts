import { ApifyClient } from "apify-client";

export interface ApifyFacebookExtraction {
  title: string | null;
  text: string;
  pageName: string | null;
  userUsername: string | null;
  authorName: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function readFirstNonEmptyString(
  record: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const found = readNonEmptyString(record[key]);
    if (found) return found;
  }
  return null;
}

function extractUsernameFromProfileUrl(profileUrl: string | null): string | null {
  if (!profileUrl) return null;
  try {
    const parsed = new URL(profileUrl);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const first = segments[0];
    if (!first || first === "profile.php") return null;
    return first;
  } catch {
    return null;
  }
}

export async function fetchFacebookPostViaApify(
  url: string,
  waitSecs = 25
): Promise<ApifyFacebookExtraction | null> {
  const token = process.env.APIFY_TOKEN?.trim();
  const actorId =
    process.env.APIFY_FACEBOOK_ACTOR_ID?.trim() || "apify/facebook-posts-scraper";

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

  const item = asRecord(items[0]);
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

  if (!text) {
    return null;
  }

  const userObj = asRecord(item.user);
  const pageName = readFirstNonEmptyString(item, [
    "pageName",
    "page_name",
    "profileName",
  ]);

  const userUsername =
    (userObj ? readFirstNonEmptyString(userObj, ["username", "userName"]) : null) ??
    readFirstNonEmptyString(item, ["userUsername", "user_username"]) ??
    extractUsernameFromProfileUrl(
      userObj ? readFirstNonEmptyString(userObj, ["profileUrl", "url"]) : null
    );

  const authorName =
    (userObj ? readFirstNonEmptyString(userObj, ["name", "fullName"]) : null) ??
    readFirstNonEmptyString(item, ["userName", "authorName"]) ??
    pageName;

  const title = pageName || authorName || userUsername || null;

  return {
    title,
    text,
    pageName,
    userUsername,
    authorName,
  };
}