import { describe, expect, it } from "vitest";
import * as shared from "./index";

// Scaffold-sanity test proving test tooling is wired for this package.
describe("shared scaffold", () => {
  it("loads as a module", () => {
    expect(shared).toBeTypeOf("object");
  });
});
