// Railway infrastructure as code (Nov 10; replaces railway.json, which Railway stops reading Dec 1, 2026).
// Pulled from the live project with `railway config pull`, then the build command added. Check with `railway config plan`
// before `railway config apply`: the plan should only ever show what you meant to change.
import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const webVolume = volume("web-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 5000 });
  const web = service("web", {
    source: github("tommyclaffey/baldwin-training", { checkSuites: false }),
    // Nov 10: tests run in the build, so a failing test stops the deploy (was railway.json).
    build: "npm run build && npm test",
    replicas: { "sfo": 1 },
    domains: ["app.miseacademy.app", "www.miseacademy.app"],
    volumeMounts: { "/data": webVolume },
    env: { ANTHROPIC_API_KEY: preserve(), BACKUP_KEY: preserve(), DATA_DIR: preserve(), OPS_TOKEN: preserve(), OWNER_EMAIL: preserve(), SUPERADMIN_EMAIL: preserve(),
      // Nov 23: bottle scanner v2, 4 threads per model run (plan: 8 vCPU, 8 GB). SCANNER_ENGINE=v1 = the old engine.
      SCANNER_THREADS: preserve() },
  });

  return project("baldwin-training", {
    resources: [web, webVolume],
  });
});
