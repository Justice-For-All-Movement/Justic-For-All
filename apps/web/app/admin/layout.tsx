import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { staffContext } from "../../lib/staff";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Staff workspace — Justice For All", robots: { index: false, follow: false } };

const sections = [
  { href: "/admin/editorial", label: "Editorial queue", needs: "cms.read_draft" },
  { href: "/admin/reports", label: "Reports", needs: "moderation.review" },
  { href: "/admin/privacy", label: "Privacy requests", needs: "privacy.process" },
  { href: "/admin/roles", label: "Roles", needs: "roles.manage" },
  { href: "/admin/audit", label: "Audit", needs: "audit.read" },
  { href: "/admin/integrations", label: "Integrations", needs: "integrations.manage" }
] as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await staffContext();
  if (!ctx) notFound();
  return <div className="wrap public-article">
    <p className="eyebrow">Staff workspace</p>
    <nav aria-label="Staff sections"><ul>{sections.filter(s => ctx.permissions.includes(s.needs)).map(s => <li key={s.href}><Link href={s.href}>{s.label}</Link></li>)}</ul></nav>
    {!ctx.mfa ? <p role="alert" className="ui-note ui-note--caution">Add a passkey or authenticator app in <Link href="/account/security">sign-in security</Link> before using staff tools.</p>
      : !ctx.steppedUp ? <p className="ui-note">Publishing, withdrawing, roles, privacy and audit actions need you to <Link href="/account/security">confirm it is you</Link> (valid 10 minutes).</p> : null}
    {ctx.mfa ? children : null}
  </div>;
}
