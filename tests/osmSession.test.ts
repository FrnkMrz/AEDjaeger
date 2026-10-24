import { describe, expect, it } from "vitest";
import { loadOSMSession } from "../src/auth/osmSession";

describe("OSM session status", () => {
  it("accepts the explicit production and development login availability flags", async () => {
    const status = await loadOSMSession(async () => Response.json({
      authenticated: false,
      loginAvailable: true,
      developmentLoginAvailable: false,\n      developmentSession: true,
    }));

    expect(status).toEqual({
      authenticated: false,
      loginAvailable: true,
      developmentLoginAvailable: false,
    });
  });

  it("fails closed when the Worker omits development login availability", async () => {
    await expect(loadOSMSession(async () => Response.json({
      authenticated: false,
      loginAvailable: true,
    }))).rejects.toThrow("invalid");
  });
});
