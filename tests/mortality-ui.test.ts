import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

test("patient death banner renders dates, causes and calendar ages while living records stay unmarked", async () => {
  const result = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
      contents: String.raw`
        import assert from "node:assert/strict";
        import React from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import { DeathStatus } from "./packages/ui/src/death-status.tsx";
        const patient = {
          id: "SIM-UI-MORTALITY", name: "Synthetic Example", birthDate: "1980-06-15",
          localIds: {}, conditions: [], needs: [], goals: [], synthetic: true,
          death: { date: "2025-06-14", cause: "Synthetic example: road traffic collision",
            synthetic: true, source: "authored-synthetic-mortality-v1" },
        };
        const render = (patient, compact = false) => renderToStaticMarkup(React.createElement(DeathStatus, { patient, compact }));
        const markup = render(patient);
        assert.match(markup, /<strong>Deceased<\/strong>/);
        assert.match(markup, /<time dateTime="2025-06-14">14 Jun 2025<\/time>/);
        assert.match(markup, /Age at death: 44/);
        assert.match(markup, /Recorded cause: Synthetic example: road traffic collision/);
        assert.match(render({ ...patient, death: { ...patient.death, date: "2025-06-15" } }), /Age at death: 45/);
        assert.match(render({ ...patient, birthDate: "2025-01-01", death: { ...patient.death, date: "2025-02-01" } }), /Age at death: 0/);
        const compact = render(patient, true);
        assert.match(compact, /Deceased/);
        assert.match(compact, /Age at death: 44/);
        assert.doesNotMatch(compact, /Recorded cause/);
        assert.equal(render({ ...patient, death: undefined }), "");
        assert.equal(render(undefined), "");
      `,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    loader: { ".css": "empty" },
  });
  const script = result.outputFiles[0];
  if (!script) throw new Error("Mortality UI test bundle was not produced");
  execFileSync(process.execPath, ["-"], { input: script.text, env: { ...process.env, TZ: "Pacific/Honolulu" } });
});
