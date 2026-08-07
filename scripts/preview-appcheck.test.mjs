import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPreviewAppCheckApproval,
  PREVIEW_APPROVAL,
} from "./configure-preview-appcheck.mjs";

test("preview App Check setup is isolated and apply-gated", () => {
  assert.doesNotThrow(() => assertPreviewAppCheckApproval({
    project: "marketready-tours-dev",
    apply: false,
    approval: "",
  }));
  assert.throws(
    () => assertPreviewAppCheckApproval({
      project: "marketready-tours-dev",
      apply: true,
      approval: "",
    }),
    /to change preview App Check/,
  );
  assert.doesNotThrow(() => assertPreviewAppCheckApproval({
    project: "marketready-tours-dev",
    apply: true,
    approval: PREVIEW_APPROVAL,
  }));
  assert.throws(
    () => assertPreviewAppCheckApproval({
      project: "marketready-tours",
      apply: false,
      approval: "",
    }),
    /all other projects are refused/,
  );
});
