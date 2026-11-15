/** Public pages available even when downstream services are offline. */
export const publicRoutes = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/stories", label: "Stories (information)" },
  { href: "/records", label: "Public records (information)" },
  { href: "/principles", label: "Principles" },
  { href: "/initiatives", label: "Initiatives" },
  { href: "/get-involved", label: "Get involved" },
  { href: "/resources", label: "Resources" },
  { href: "/safety", label: "Safety guidance" },
  { href: "/contact", label: "Contact" },
  { href: "/search", label: "Search" },
  { href: "/accessibility", label: "Accessibility" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" }
] as const;

export function findPublicRoute(pathname: string) {
  return publicRoutes.find((route) => route.href === pathname);
}
