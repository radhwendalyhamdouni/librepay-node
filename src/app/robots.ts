import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // the operator's node is nobody's search-engine business
        disallow: ["/", "/pay/", "/api/"],
      },
    ],
  };
}
