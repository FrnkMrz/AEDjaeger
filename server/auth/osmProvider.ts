import { OSM_DEVELOPMENT_SERVER_ORIGIN } from "../osm/developmentApi";

export type OSMEnvironment = "production" | "development";

type OSMProviderEndpoints = {
  issuer: string;
  authorization: string;
  discovery: string;
  token: string;
  jwks: string;
};

/** The dev login is pinned to OSM's official test server; no URL comes from the browser. */
export function getOSMProviderEndpoints(environment: OSMEnvironment): OSMProviderEndpoints {
  if (environment === "production") {
    const origin = "https://www.openstreetmap.org";
    return {
      issuer: origin,
      authorization: `${origin}/oauth2/authorize`,
      discovery: `${origin}/.well-known/openid-configuration`,
      token: `${origin}/oauth2/token`,
      jwks: `${origin}/oauth2/discovery/keys`,
    };
  }
  if (environment === "development") {
    const origin = OSM_DEVELOPMENT_SERVER_ORIGIN;
    return {
      issuer: origin,
      authorization: `${origin}/oauth2/authorize`,
      discovery: `${origin}/.well-known/openid-configuration`,
      token: `${origin}/oauth2/token`,
      jwks: `${origin}/oauth2/discovery/keys`,
    };
  }
  throw new Error("Ungültige OSM-Umgebung.");
}
