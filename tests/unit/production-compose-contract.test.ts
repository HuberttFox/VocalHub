import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function productionCompose() {
  return readFileSync(new URL("../../compose.production.yaml", import.meta.url), "utf8");
}

function appEnvironmentTemplate() {
  return readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
}

function appServiceEnvironment(): Record<string, string> {
  // Extract the `services.app.environment` block from compose.production.yaml.
  // Environment entries are indented six spaces and formatted `KEY: value`.
  const appSection = productionCompose().split("\n  app:")[1] ?? "";
  const environmentSection = appSection.split("\n    environment:")[1] ?? "";
  const environment: Record<string, string> = {};
  for (const line of environmentSection.split("\n")) {
    if (line.trim() === "") continue;
    const match = line.match(/^ {6}([A-Z0-9_]+):\s*(.*)$/);
    if (!match) break;
    environment[match[1]] = match[2];
  }
  return environment;
}

describe("production Compose contract", () => {
  it("runs only the app and migration services from immutable images", () => {
    const compose = productionCompose();

    expect(compose).toContain("VOCALHUB_APP_IMAGE:?VOCALHUB_APP_IMAGE is required");
    expect(compose).toContain("VOCALHUB_MIGRATE_IMAGE:?VOCALHUB_MIGRATE_IMAGE is required");
    expect(compose).toContain("OPERATIONAL_STATUS_TOKEN:?OPERATIONAL_STATUS_TOKEN is required");
    expect(compose).toContain("DISCOVERY_SNAPSHOT_READS_ENABLED:-false");
    expect(compose).not.toContain("build:");
    expect(compose).not.toMatch(/^  (worker|session-cleanup|playlist-report-cleanup|playlist-moderation):/m);
  });

  it("passes DISCOVERY_SNAPSHOT_READS_ENABLED through on the app service with a false default", () => {
    const environment = appServiceEnvironment();

    expect(environment.DISCOVERY_SNAPSHOT_READS_ENABLED).toBe(
      "${DISCOVERY_SNAPSHOT_READS_ENABLED:-false}",
    );
  });

  it("keeps app traffic loopback-only and verifies database readiness", () => {
    const compose = productionCompose();

    expect(compose).toContain('"127.0.0.1:${VOCALHUB_PORT:-3000}:3000"');
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("fetch('http://127.0.0.1:3000/api/health')");
    expect(compose).toContain("response.ok ? 0 : 1");
  });

  it("documents app, migration, and operational status configuration", () => {
    const template = appEnvironmentTemplate();

    expect(template).toMatch(/^VOCALHUB_APP_IMAGE=.+@sha256:/m);
    expect(template).toMatch(/^VOCALHUB_MIGRATE_IMAGE=.+@sha256:/m);
    expect(template).toMatch(/^OPERATIONAL_STATUS_TOKEN=/m);
  });
});
