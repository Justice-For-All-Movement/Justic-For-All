import { getSharedPool, getStepUp, hasMfa, staffPermissions, type DbClient, type SessionView } from "@jfa/db";
import { STEP_UP_WINDOW_MS, type Action } from "@jfa/core";
import { currentSession } from "./auth";

export type StaffContext = Readonly<{ session: SessionView; permissions: readonly Action[]; mfa: boolean; steppedUp: boolean }>;

/** null = not signed in or not staff (admin pages then 404 instead of revealing themselves). */
export async function staffContext(): Promise<StaffContext | null> {
  const session = await currentSession();
  const pool = getSharedPool();
  if (!session || !pool) return null;
  const c = await pool.connect();
  try {
    const permissions = await staffPermissions(c, session.identityId);
    if (!permissions.length) return null;
    const stepUpAt = await getStepUp(c, session.sessionId);
    return { session, permissions, mfa: await hasMfa(c, session.identityId), steppedUp: !!stepUpAt && Date.now() - stepUpAt.getTime() <= STEP_UP_WINDOW_MS };
  } finally { c.release(); }
}

export async function withStaffClient<T>(fn: (c: DbClient) => Promise<T>): Promise<T | null> {
  const pool = getSharedPool();
  if (!pool) return null;
  const c = await pool.connect();
  try { return await fn(c); } catch { return null; } finally { c.release(); }
}
