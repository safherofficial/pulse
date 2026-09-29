/**
 * XPulse AI Gateway.
 * One logical AI action is charged once; provider retries are internal.
 */
import { getSql } from "../db";
import { getSessionUser } from "../auth/verify.server";

export const AI_DAILY_ACTION_LIMIT = 20;
export const AI_MONTHLY_ACTION_LIMIT = 500;

export type AiQuota = {
  allowed: boolean;
  dailyUsed: number;
  dailyLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
  remainingDaily: number;
  remainingMonthly: number;
};

function quotaError(quota: AiQuota): Error {
  const error = new Error(
    quota.remainingDaily <= 0
      ? "Daily AI limit reached. Try again tomorrow."
      : "Monthly AI limit reached. Your AI quota has been used.",
  );
  const typed = error as Error & { status?: number; code?: string; quota?: AiQuota };
  typed.status = 429;
  typed.code = "AI_QUOTA_EXCEEDED";
  typed.quota = quota;
  return error;
}

export async function getAiQuota(userId?: string): Promise<AiQuota> {
  const sql = await getSql();
  const id = userId ?? "anonymous";
  const rows = await sql<{ daily_used: number; monthly_used: number }>`
    select
      coalesce(sum(case when usage_day = current_date then actions else 0 end), 0)::int as daily_used,
      coalesce(sum(case when usage_day >= date_trunc('month', current_date)::date then actions else 0 end), 0)::int as monthly_used
    from xpulse_ai_usage
    where user_id = ${id}
      and usage_day >= date_trunc('month', current_date)::date
  `;
  const row = rows[0] ?? { daily_used: 0, monthly_used: 0 };
  const dailyUsed = Number(row.daily_used) || 0;
  const monthlyUsed = Number(row.monthly_used) || 0;
  return {
    allowed: dailyUsed < AI_DAILY_ACTION_LIMIT && monthlyUsed < AI_MONTHLY_ACTION_LIMIT,
    dailyUsed,
    dailyLimit: AI_DAILY_ACTION_LIMIT,
    monthlyUsed,
    monthlyLimit: AI_MONTHLY_ACTION_LIMIT,
    remainingDaily: Math.max(0, AI_DAILY_ACTION_LIMIT - dailyUsed),
    remainingMonthly: Math.max(0, AI_MONTHLY_ACTION_LIMIT - monthlyUsed),
  };
}

export async function reserveAiAction(userId?: string): Promise<AiQuota> {
  const sql = await getSql();
  let id = userId;
  if (!id) {
    try { id = (await getSessionUser())?.id ?? "anonymous"; } catch { id = "anonymous"; }
  }
  const quota = await getAiQuota(id);
  if (!quota.allowed) throw quotaError(quota);
  await sql`
    insert into xpulse_ai_usage (user_id, usage_day, actions, updated_at)
    values (${id}, current_date, 1, now())
    on conflict (user_id, usage_day)
    do update set actions = xpulse_ai_usage.actions + 1, updated_at = now()
  `;
  return getAiQuota(id);
}

export async function getCurrentAiQuota(): Promise<AiQuota> {
  let userId: string | undefined;
  try { userId = (await getSessionUser())?.id ?? undefined; } catch { userId = undefined; }
  return getAiQuota(userId);
}
