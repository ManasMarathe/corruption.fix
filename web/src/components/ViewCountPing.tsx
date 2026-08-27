"use client";

import { useEffect } from "react";

/**
 * Fires a fire-and-forget view-count beacon for `officeId`. Renders nothing
 * — mount this alongside the office page's server-rendered content so the
 * beacon never sits in the RSC render path or blocks the page response.
 */
export function ViewCountPing({ officeId }: { officeId: string }) {
  useEffect(() => {
    fetch(`/api/offices/${officeId}/view`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {
      // Best-effort only — a dropped view count is not worth surfacing.
    });
  }, [officeId]);

  return null;
}
