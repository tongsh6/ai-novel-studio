import { describe, expect, it } from "vitest";

import { WORKBENCH } from "../copy";
import { normalizeSidecarStatus, sidecarFailureGuidance } from "../desktopSidecar";

describe("desktop sidecar startup guidance (SU04)", () => {
  it("classifies known startup states and rejects drift", () => {
    expect(normalizeSidecarStatus("starting")).toBe("starting");
    expect(normalizeSidecarStatus("ready")).toBe("ready");
    expect(normalizeSidecarStatus("failed")).toBe("failed");
    expect(normalizeSidecarStatus("boom")).toBe("unknown");
    expect(normalizeSidecarStatus(undefined)).toBe("unknown");
  });

  it("only surfaces recovery guidance for starting/failed states", () => {
    expect(sidecarFailureGuidance("starting")).toBe(WORKBENCH.desktopSidecarStarting);
    expect(sidecarFailureGuidance("failed")).toBe(WORKBENCH.desktopSidecarFailed);
    expect(sidecarFailureGuidance("ready")).toBeNull();
    expect(sidecarFailureGuidance("unknown")).toBeNull();
  });
});
