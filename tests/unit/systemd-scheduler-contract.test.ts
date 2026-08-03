import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function unit(name: string) {
  return readFileSync(new URL(`../../deploy/systemd/${name}`, import.meta.url), "utf8");
}

function jobsCompose() {
  return readFileSync(new URL("../../compose.production.jobs.yaml", import.meta.url), "utf8");
}
describe("systemd scheduler contract", () => {
  it("schedules worker modes without catch-up burst for incremental", () => {
    expect(unit("vocalhub-worker-incremental.timer")).toMatch(/OnCalendar=\*:0\/15/);
    expect(unit("vocalhub-worker-incremental.timer")).toContain("Persistent=false");
    expect(unit("vocalhub-worker@.service")).toContain("compose.production.jobs.yaml");
    expect(unit("vocalhub-worker@.service")).toContain("worker auto %i");
    expect(unit("vocalhub-worker-reconcile.timer")).toContain("Persistent=true");
    expect(unit("vocalhub-worker-artists-refresh.timer")).toContain("Unit=vocalhub-worker-artists-refresh.service");
    expect(unit("vocalhub-session-cleanup.timer")).toContain("Unit=vocalhub-maintenance@session-cleanup.service");
    expect(unit("vocalhub-playlist-report-cleanup.timer")).toContain("Unit=vocalhub-maintenance@playlist-report-cleanup.service");

  });

  it("keeps maintenance jobs separate and secrets minimal", () => {
    expect(unit("vocalhub-session-cleanup.timer")).toContain("vocalhub-maintenance@session-cleanup.service");
    expect(unit("vocalhub-playlist-report-cleanup.timer")).toContain("vocalhub-maintenance@playlist-report-cleanup.service");
    expect(unit("vocalhub-maintenance@.service")).toContain("compose.production.jobs.yaml");
    expect(unit("vocalhub-maintenance@.service")).toContain("--profile maintenance");
    expect(unit("vocalhub-worker@.service")).not.toMatch(/AUTH_/);
    expect(unit("vocalhub-maintenance@.service")).not.toMatch(/AUTH_/);
    expect(unit("vocalhub.env.example")).not.toMatch(/^AUTH_/m);
    expect(jobsCompose()).not.toMatch(/AUTH_/);
    expect(jobsCompose()).toContain("VOCALHUB_WORKER_IMAGE");
    expect(jobsCompose()).toContain("VOCALHUB_MAINTENANCE_IMAGE");
  });

  it("makes failures observable and documents release paths", () => {
    for (const name of ["vocalhub-worker@.service", "vocalhub-worker-artists-refresh.service", "vocalhub-maintenance@.service"]) {
      expect(unit(name)).toContain("StandardOutput=journal");
      expect(unit(name)).toContain("StandardError=journal");
      expect(unit(name)).toContain("Type=oneshot");
    }
    expect(unit("vocalhub.env.example")).toContain("VOCADB_BASE_URL=");
  });
});
