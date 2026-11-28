import { defineConfig } from "@playwright/test";
import functional from "./playwright.config";
import { readFileSync } from "node:fs";
const chromiumOnlySpecs = JSON.parse(readFileSync(new URL("./tests/e2e/pr-coverage.json", import.meta.url), "utf8"));
// Chromium runs every functional case. Other engines omit only reviewed
// application-state/API specs; unknown specs remain browser contracts.
export default defineConfig({
    ...functional,
    projects: functional.projects.map((project) => ({
        ...project,
        ...(project.name === "chromium"
            ? {}
            : {
                testIgnore: [
                    ...functional.testIgnore,
                    ...Object.keys(chromiumOnlySpecs).map((path) => `**/${path}`),
                ],
            }),
    })),
});
