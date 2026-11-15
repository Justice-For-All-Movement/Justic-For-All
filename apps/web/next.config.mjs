/** @type {import('next').NextConfig} */
const securityHeaders = [
 { key: "X-Content-Type-Options", value: "nosniff" },
 { key: "X-Frame-Options", value: "DENY" },
 { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
 { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" }
];
const nextConfig = {
 poweredByHeader: false,
 transpilePackages: ["@jfa/core","@jfa/contracts","@jfa/ui","@jfa/adapters","@jfa/security","@jfa/db"],
 async rewrites(){return [{source:"/articles/:slug",destination:"/articles?slug=:slug"}];},
 async headers(){return [
  { source: "/:path*", headers: securityHeaders },
  // Sign-in tokens appear in /auth/verify URLs: never leak them via Referer.
  { source: "/auth/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] },
  { source: "/account/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] }
 ];}
};
export default nextConfig;
