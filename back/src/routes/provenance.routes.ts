import { createHash, randomUUID } from "node:crypto";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import express, { Router, type Request, type Response } from "express";
import * as cheerio from "cheerio";
import rateLimit from "express-rate-limit";
import ipaddr from "ipaddr.js";
import { z } from "zod";
import * as ed25519 from "@noble/ed25519";

import { env } from "../config/env.js";
import { embedImage } from "../services/imageEmbedding.service.js";
import {
  consumeRequestNonce,
  findMedia,
  getMedia,
  saveMedia,
  saveReport,
  type StoredMedia,
} from "../services/provenanceStore.service.js";

const router = Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_IMAGES = 8;
const PUBLIC_KEY_PATTERN = /^[0-9a-f]{64}$/i;
const SIGNATURE_PATTERN = /^[0-9a-f]{128}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

type RemoteResource = {
  headers: IncomingMessage["headers"];
  bytes: Buffer;
  url: URL;
};

ed25519.hashes.sha512Async = async (message) =>
  new Uint8Array(createHash("sha512").update(message).digest());

const imageRecordSchema = z.object({
  id: z.string().uuid(),
  sha256: z.string().regex(SHA256_PATTERN),
  createdAt: z.number().int().positive(),
  publicKey: z.string().regex(PUBLIC_KEY_PATTERN),
  signature: z.string().regex(SIGNATURE_PATTERN),
});

const urlAnalysisSchema = z.object({
  url: z.string().url().max(2048),
  publicKey: z.string().regex(PUBLIC_KEY_PATTERN),
  timestamp: z.number().int().positive(),
  nonce: z.string().uuid(),
  signature: z.string().regex(SIGNATURE_PATTERN),
});

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function manifestBytes(record: z.infer<typeof imageRecordSchema>): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      JSON.stringify({
        version: 1,
        id: record.id,
        sha256: record.sha256,
        createdAt: record.createdAt,
      }),
    ),
  );
}

function urlRequestBytes(request: z.infer<typeof urlAnalysisSchema>): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      JSON.stringify({
        domain: "notox-url-analysis-v1",
        url: encodeURIComponent(request.url),
        timestamp: request.timestamp,
        nonce: request.nonce,
      }),
    ),
  );
}

function isPrivateAddress(address: string): boolean {
  const parsed = ipaddr.parse(address);
  const normalized =
    parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()
      ? parsed.toIPv4Address()
      : parsed;
  return normalized.range() !== "unicast";
}

async function assertPublicUrl(value: string): Promise<{ url: URL; addresses: LookupAddress[] }> {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hostname.length === 0
  ) {
    throw new Error("Seules les URL HTTP(S) publiques sont acceptées.");
  }
  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expectedPort) {
    throw new Error("Seuls les ports HTTP et HTTPS standards sont acceptés.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Cette URL pointe vers une adresse réseau privée ou non autorisée.");
  }
  return { url, addresses };
}

async function readLimitedBody(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(response.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    response.destroy();
    throw new Error("La ressource distante dépasse la taille maximale autorisée.");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response) {
    const bytes = Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maxBytes) {
      response.destroy();
      throw new Error("La ressource distante dépasse la taille maximale autorisée.");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function requestPinned(url: URL, address: LookupAddress): Promise<IncomingMessage> {
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
    } else {
      callback(null, address.address, address.family);
    }
  };
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      {
        lookup: pinnedLookup,
        headers: { "User-Agent": "NOTOX-Provenance/1.0", Accept: "text/html,image/*" },
      },
      resolve,
    );
    outgoing.setTimeout(8000, () => outgoing.destroy(new Error("Le site distant ne répond pas.")));
    outgoing.on("error", reject);
    outgoing.end();
  });
}

async function fetchPublicResource(urlValue: string, maxBytes: number): Promise<RemoteResource> {
  let { url, addresses } = await assertPublicUrl(urlValue);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const address = addresses[0];
    if (!address) throw new Error("Le nom de domaine ne possède aucune adresse publique.");
    const response = await requestPinned(url, address);

    if (
      response.statusCode !== undefined &&
      response.statusCode >= 300 &&
      response.statusCode < 400
    ) {
      const location = response.headers.location;
      response.destroy();
      if (!location || redirects === 3) throw new Error("Redirection distante invalide ou trop longue.");
      const locationValue = Array.isArray(location) ? location[0] : location;
      if (!locationValue) throw new Error("Redirection distante invalide ou trop longue.");
      const validated = await assertPublicUrl(new URL(locationValue, url).toString());
      url = validated.url;
      addresses = validated.addresses;
      continue;
    }
    if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Le site distant a répondu HTTP ${response.statusCode ?? "inconnu"}.`);
    }
    const bytes = await readLimitedBody(response, maxBytes);
    return { headers: response.headers, bytes, url };
  }
  throw new Error("Impossible de suivre la redirection distante.");
}

function imageMimeType(response: RemoteResource, bytes: Buffer): string | null {
  const contentType = response.headers["content-type"];
  const header = (Array.isArray(contentType) ? contentType[0] : contentType)
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (header === "image/jpeg" && bytes[0] === 0xff && bytes.at(1) === 0xd8) return header;
  if (
    header === "image/png" &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return header;
  }
  if (
    header === "image/webp" &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return header;
  }
  const heifBrand = bytes.toString("ascii", 8, 12);
  if (
    (header === "image/heic" || header === "image/heif") &&
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(heifBrand)
  ) {
    return header;
  }
  return null;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

router.post(
  "/media",
  (req: Request, res: Response, next) => {
    const contentType = req.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (
      contentType !== "image/jpeg" &&
      contentType !== "image/png" &&
      contentType !== "image/webp" &&
      contentType !== "image/heic" &&
      contentType !== "image/heif"
    ) {
      return res.status(415).json({ error: "Seules les images JPEG, PNG, WebP et HEIC/HEIF sont acceptées." });
    }
    return next();
  },
  express.raw({ type: "image/*", limit: MAX_IMAGE_BYTES }),
  async (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Le contenu de l'image est vide ou invalide." });
    }
    if (req.body.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: "L'image dépasse la limite de 25 Mo." });
    }

    let rawRecord: unknown;
    try {
      rawRecord = JSON.parse(decodeURIComponent(req.get("x-notox-record") ?? ""));
    } catch {
      return res.status(400).json({ error: "Les métadonnées signées sont invalides." });
    }
    const parsed = imageRecordSchema.safeParse(rawRecord);
    if (!parsed.success) {
      return res.status(400).json({ error: "Les métadonnées signées sont incomplètes." });
    }
    const record = parsed.data;
    const digest = createHash("sha256").update(req.body).digest("hex");
    if (digest !== record.sha256.toLowerCase()) {
      return res.status(422).json({ error: "L'empreinte du fichier ne correspond pas aux métadonnées." });
    }

    const signatureIsValid = await ed25519.verifyAsync(
      hexBytes(record.signature),
      manifestBytes(record),
      hexBytes(record.publicKey),
    );
    if (!signatureIsValid) {
      return res.status(422).json({ error: "La signature de provenance n'est pas valide." });
    }

    const existing = findMedia(record.publicKey, record.id);
    if (existing) {
      if (existing.sha256 !== record.sha256.toLowerCase()) {
        return res.status(409).json({ error: "Cet identifiant est déjà associé à une autre image." });
      }
      return res.status(200).json({ id: existing.id, status: "already_registered" });
    }

    try {
      const mimeType = req.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      const embedding = await embedImage(req.body, mimeType);
      saveMedia({
        id: record.id,
        ownerKey: record.publicKey.toLowerCase(),
        sha256: record.sha256.toLowerCase(),
        signature: record.signature.toLowerCase(),
        createdAt: record.createdAt,
        embedding,
      });
      return res.status(201).json({ id: record.id, status: "registered" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analyse visuelle indisponible.";
      return res.status(503).json({ error: message });
    }
  },
);

router.get("/profile/:publicKey", (req: Request, res: Response) => {
  const parsedKey = z.string().regex(PUBLIC_KEY_PATTERN).safeParse(req.params.publicKey);
  if (!parsedKey.success) return res.status(400).json({ error: "Clé publique invalide." });
  const ownerKey = parsedKey.data.toLowerCase();
  const media = getMedia(ownerKey).map(({ id, sha256, signature, createdAt }) => ({
    id,
    sha256,
    signature,
    createdAt,
  }));
  return res.json({ publicKey: ownerKey, media });
});

router.post("/analyze-url", async (req: Request, res: Response) => {
  const parsed = urlAnalysisSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "La requête d'analyse est invalide." });
  }
  const request = parsed.data;
  if (Math.abs(Date.now() - request.timestamp) > 5 * 60 * 1000) {
    return res.status(401).json({ error: "La demande de vérification a expiré." });
  }
  const signatureIsValid = await ed25519.verifyAsync(
    hexBytes(request.signature),
    urlRequestBytes(request),
    hexBytes(request.publicKey),
  );
  if (!signatureIsValid) return res.status(401).json({ error: "La signature du profil est invalide." });
  if (!consumeRequestNonce(request.publicKey.toLowerCase(), request.nonce, request.timestamp)) {
    return res.status(409).json({ error: "Cette demande a déjà été utilisée." });
  }

  const registeredMedia = getMedia(request.publicKey.toLowerCase());
  if (registeredMedia.length === 0) {
    return res.status(404).json({ error: "Ce profil ne contient pas encore d'image protégée." });
  }

  try {
    const page = await fetchPublicResource(request.url, MAX_PAGE_BYTES);
    const contentType = page.headers["content-type"];
    const pageMime = (Array.isArray(contentType) ? contentType[0] : contentType)
      ?.split(";")[0]
      ?.toLowerCase();
    if (pageMime !== "text/html" && pageMime !== "application/xhtml+xml") {
      return res.status(415).json({ error: "L'URL fournie ne renvoie pas une page HTML." });
    }
    const $ = cheerio.load(page.bytes.toString("utf8"));
    const candidates = new Set<string>();
    const addCandidate = (value: string): void => {
      try {
        const candidate = new URL(value, page.url);
        if (
          (candidate.protocol === "http:" || candidate.protocol === "https:") &&
          !candidate.username &&
          !candidate.password &&
          (!candidate.port ||
            candidate.port === (candidate.protocol === "https:" ? "443" : "80"))
        ) {
          candidates.add(candidate.toString());
        }
      } catch {
        // Ignore malformed image references in otherwise usable pages.
      }
    };
    $('meta[property="og:image"], meta[name="twitter:image"]').each((_index, element) => {
      const content = $(element).attr("content");
      if (content) addCandidate(content);
    });
    $("img").each((_index, element) => {
      const source = $(element).attr("src") ?? $(element).attr("data-src");
      if (source) addCandidate(source);
    });

    const matches: Array<{
      imageUrl: string;
      imageHash: string;
      candidates: Array<{ mediaId: string; similarity: number }>;
    }> = [];
    const selectedCandidates = [...candidates].slice(0, MAX_PAGE_IMAGES);
    let skippedImageCount = candidates.size - selectedCandidates.length;
    for (const candidate of selectedCandidates) {
      let image: RemoteResource;
      try {
        image = await fetchPublicResource(candidate, MAX_REMOTE_IMAGE_BYTES);
      } catch {
        skippedImageCount++;
        continue;
      }
      const mimeType = imageMimeType(image, image.bytes);
      if (!mimeType) {
        skippedImageCount++;
        continue;
      }

      const imageHash = createHash("sha256").update(image.bytes).digest("hex");
      const embedding = await embedImage(image.bytes, mimeType);
      const ranked = registeredMedia
        .map((registered) => ({
          mediaId: registered.id,
          similarity: cosineSimilarity(embedding, registered.embedding),
        }))
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, 3);

      matches.push({ imageUrl: image.url.toString(), imageHash, candidates: ranked });
    }

    const reportId = randomUUID();
    const report = {
      id: reportId,
      sourceUrl: page.url.toString(),
      checkedAt: Date.now(),
      registeredContentCount: registeredMedia.length,
      comparedImageCount: matches.length,
      skippedImageCount,
      matches,
      disclaimer:
        "Les scores signalent des ressemblances visuelles à examiner. Ils ne prouvent ni propriété, ni réutilisation non autorisée, ni violation juridique.",
    };
    saveReport(request.publicKey.toLowerCase(), request.url, report, reportId);
    return res.json({ report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "L'analyse de cette URL a échoué.";
    return res.status(422).json({ error: message });
  }
});

export { router as provenanceRouter };
