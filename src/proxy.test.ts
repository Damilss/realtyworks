import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import { config } from "@/proxy";

describe("proxy matcher", () => {
  it.each([
    "/_next/static/chunks/app.js",
    "/_next/image?url=%2Flogo.png&w=640&q=75",
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
    "/fonts/geist.woff2",
    "/manifest.webmanifest",
    "/sw.js",
  ])("skips static asset %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });

  it.each(["/", "/login", "/work-orders", "/api/work-orders.xml"])(
    "refreshes sessions for application route %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    },
  );
});
