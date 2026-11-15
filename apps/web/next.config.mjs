/** @type {import('next').NextConfig} */
// Static rendering embeds inline bootstrap scripts, so script-src keeps
// 'unsafe-inline' (no third-party origins are allowed). A nonce-based policy
// is a documented follow-up that would make every page dynamic.
const csp = [
 "default-src 'self'", `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`, "style-src 'self' 'unsafe-inline'",
 "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "media-src 'self'", "object-src 'none'",
 "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "manifest-src 'self'", "worker-src 'self'",
 ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : [])
].join("; ");
const securityHeaders = [
 { key: "Content-Security-Policy", value: csp },
 { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
 { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
 ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
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
  { source: "/account/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
  { source: "/subscriptions/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] }
 ];}
};
export default nextConfig;
