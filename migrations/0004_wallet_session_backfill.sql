-- Wallet authentication integrity.
-- Repair legacy Solana sessions and enforce one account row per wallet.

with ranked as (
  select
    id,
    row_number() over (
      partition by "providerId", "accountId"
      order by "createdAt" asc, id asc
    ) as rn
  from account
)
delete from account a
using ranked r
where a.id = r.id
  and r.rn > 1;

create unique index if not exists "account_provider_account_idx"
  on account ("providerId", "accountId");

update session s
set "walletAddress" = a."accountId"
from account a
inner join xpulse_wallets w
  on w.user_id = a."userId"
 and w.address = a."accountId"
where s."userId" = a."userId"
  and a."providerId" = 'solana'
  and s."walletAddress" is null;
