/**
 * Per-field image upload rules (FR-807/808).
 *
 * The generic upload check (`validateUpload`) enforces the baseline every file
 * must meet. When an upload names a `field`, the matching policy here adds the
 * stricter, field-specific constraints — allowed format, max dimensions, max
 * size, required transparency, and required aspect ratio. New rules are added
 * declaratively without touching the upload route.
 */
export interface ImagePolicy {
  label: string;
  /** Allowed MIME types. Omit to accept any image the baseline allows. */
  formats?: string[];
  maxBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Require an alpha channel (transparent PNG for logos). */
  requireAlpha?: boolean;
  /** Enforce an aspect ratio within `tolerance` (fractional, default 0.02). */
  aspectRatio?: { w: number; h: number; tolerance?: number };
  /**
   * Keep the original bytes/format instead of re-encoding to WebP. Used for
   * transparent-PNG logos so the delivered asset stays a transparent PNG.
   */
  preserveFormat?: boolean;
}

export const IMAGE_POLICIES: Record<string, ImagePolicy> = {
  // Case brand logo (FR-805): transparent PNG, kept as PNG, kept small.
  logo: {
    label: "Logo",
    formats: ["image/png"],
    requireAlpha: true,
    preserveFormat: true,
    maxBytes: 2 * 1024 * 1024,
    maxWidth: 1024,
    maxHeight: 1024,
  },
  // 16:9 banners (e.g. solution banner / video posters).
  banner: {
    label: "Banner",
    aspectRatio: { w: 16, h: 9, tolerance: 0.05 },
    maxBytes: 8 * 1024 * 1024,
  },
};

export function getImagePolicy(
  field: string | null | undefined,
): ImagePolicy | null {
  if (!field) return null;
  return IMAGE_POLICIES[field] ?? null;
}

export interface ImageFacts {
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
}

/**
 * Check image facts against a policy. Pure and synchronous (facts are gathered
 * separately) so it is trivially unit-testable. Returns the first violation.
 */
export function checkImagePolicy(
  facts: ImageFacts,
  policy: ImagePolicy,
): { ok: true } | { ok: false; error: string } {
  const { label } = policy;

  if (policy.formats && !policy.formats.includes(facts.mimeType)) {
    return {
      ok: false,
      error: `${label} must be one of: ${policy.formats.join(", ")}`,
    };
  }
  if (policy.maxBytes && facts.sizeBytes > policy.maxBytes) {
    const mb = Math.round(policy.maxBytes / 1024 / 1024);
    return { ok: false, error: `${label} exceeds the ${mb} MB size limit` };
  }
  if (policy.requireAlpha && !facts.hasAlpha) {
    return {
      ok: false,
      error: `${label} must be a transparent PNG (alpha channel required)`,
    };
  }
  if (policy.maxWidth && facts.width && facts.width > policy.maxWidth) {
    return {
      ok: false,
      error: `${label} is too wide (max ${policy.maxWidth}px)`,
    };
  }
  if (policy.maxHeight && facts.height && facts.height > policy.maxHeight) {
    return {
      ok: false,
      error: `${label} is too tall (max ${policy.maxHeight}px)`,
    };
  }
  if (policy.aspectRatio && facts.width && facts.height) {
    const target = policy.aspectRatio.w / policy.aspectRatio.h;
    const actual = facts.width / facts.height;
    const tolerance = policy.aspectRatio.tolerance ?? 0.02;
    if (Math.abs(actual - target) / target > tolerance) {
      return {
        ok: false,
        error: `${label} must have a ${policy.aspectRatio.w}:${policy.aspectRatio.h} aspect ratio`,
      };
    }
  }
  return { ok: true };
}
