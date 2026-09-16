import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { mediaAssets } from "@/db/schema";
import { requireSession, getImagePolicy } from "@/lib/core-runtime";
import {
  validateUpload,
  checkImagePolicy,
  readImageFacts,
  processImage,
  type ProcessedUpload,
} from "@cms-core/core/media";
import { mediaStorage } from "@/lib/media-storage";
import { writeAudit } from "@/lib/audit/log";
import { jsonOk, jsonError, jsonValidationError, handleError } from "@/lib/http";
import { slugify } from "@cms-core/core/engine";

export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const sp = new URL(req.url).searchParams;
    const limit = Math.min(100, Number(sp.get("limit") ?? 50));
    const offset = Number(sp.get("offset") ?? 0);
    const items = await db
      .select()
      .from(mediaAssets)
      .orderBy(desc(mediaAssets.createdAt))
      .limit(limit)
      .offset(offset);
    return jsonOk({ items });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError(422, "No file provided");
    }

    const check = validateUpload(file.type, file.size);
    if (!check.ok) return jsonValidationError({ file: check.error });

    const altText = (form.get("altText") as string | null) ?? null;
    // Optional per-field policy (e.g. field=logo → transparent PNG). When absent,
    // behaviour is unchanged: baseline validation + WebP re-encode.
    const policy = getImagePolicy(form.get("field") as string | null);
    const originalExt = file.name.includes(".")
      ? file.name.split(".").pop()!
      : "bin";
    const base = slugify(file.name.replace(/\.[^.]+$/, "")) || "file";

    const rawBytes = new Uint8Array(await file.arrayBuffer());

    let processed: ProcessedUpload;
    if (policy) {
      const facts = await readImageFacts(rawBytes, file.type);
      const pc = checkImagePolicy(facts, policy);
      if (!pc.ok) return jsonValidationError({ file: pc.error });
      // preserveFormat keeps a transparent PNG as-is; otherwise re-encode to WebP.
      processed = policy.preserveFormat
        ? {
            bytes: rawBytes,
            mimeType: file.type,
            ext: originalExt,
            width: facts.width ?? null,
            height: facts.height ?? null,
          }
        : await processImage(rawBytes, file.type, originalExt);
    } else {
      // Images are recompressed to WebP; other files pass through untouched.
      processed = await processImage(rawBytes, file.type, originalExt);
    }

    const path = `uploads/${randomUUID()}-${base}.${processed.ext}`;
    // Provedor resolvido do client.config.ts (bunny | vercel-blob).
    const storage = await mediaStorage();
    const { deliveryUrl, storagePath } = await storage.upload(
      path,
      processed.bytes,
      processed.mimeType,
    );

    const [asset] = await db
      .insert(mediaAssets)
      .values({
        filename: file.name,
        mimeType: processed.mimeType,
        sizeBytes: processed.bytes.byteLength,
        width: processed.width,
        height: processed.height,
        storagePath,
        deliveryUrl,
        altText,
        uploadedBy: session.sub,
      })
      .returning();

    await writeAudit({
      actorId: session.sub,
      action: "media.upload",
      targetType: "media",
      targetId: asset.id,
      metadata: { filename: file.name, mimeType: file.type },
    });

    return jsonOk(
      {
        id: asset.id,
        deliveryUrl: asset.deliveryUrl,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
      },
      201,
    );
  } catch (e) {
    return handleError(e);
  }
}
