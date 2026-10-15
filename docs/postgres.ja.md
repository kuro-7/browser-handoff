# Postgres（Supabase）で `HandoffStore` を作る

`HandoffStore`（`src/server/store.ts`）を Postgres に置くときの表と、PostgREST（Supabase の REST）で書いた例。
キットの時刻はミリ秒の数値、表は `timestamptz` なので、出し入れで変える。

## 表

```sql
create table handoff_tickets (
  ticket_hash text primary key,               -- 引換券の SHA-256（base64url）。券そのものは置かない
  subject_id  text not null,
  purpose     text not null check (purpose in ('escape', 'home-screen')),
  issued_at   timestamptz not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  payload     text check (payload is null or octet_length(payload) <= 2048)
);

-- revokeBySubject で、主体・用途ごとの未使用の券を探す。
create index handoff_tickets_live on handoff_tickets (subject_id, purpose, issued_at desc) where used_at is null;

-- 期限切れから日が経ったものは消してよい（home-screen は 30 日）。
-- delete from handoff_tickets where expires_at < now() - interval '7 days';

-- サーバーの鍵（service role）からだけ触る。Supabase は public の表を anon・authenticated にも見せるので外す。
alter table handoff_tickets enable row level security;
revoke all privileges on table handoff_tickets from anon, authenticated;
grant select, insert, update on table handoff_tickets to service_role; -- 古い券を消す delete を回すなら delete も足す
```

`revokeBySubject`（新しい順に N 枚残して、残りを期限切れにする）は、REST だと「読む→書く」の2回になり原子的でない。関数にして1回で済ませる。

```sql
create function handoff_revoke_by_subject(p_subject_id text, p_purpose text, p_keep_latest int, p_now timestamptz)
returns void language sql as $$
  update handoff_tickets set expires_at = p_now
  where ticket_hash in (
    select ticket_hash from handoff_tickets
    where subject_id = p_subject_id and purpose = p_purpose and used_at is null and expires_at > p_now
    order by issued_at desc
    offset p_keep_latest
  );
$$;

-- Supabase は public の関数を誰でも PostgREST から呼べるようにするので、サーバーの鍵だけにする。
revoke execute on function handoff_revoke_by_subject(text, text, int, timestamptz) from public, anon, authenticated;
grant execute on function handoff_revoke_by_subject(text, text, int, timestamptz) to service_role;
```

## PostgREST での実装の例

`consume` は、`used_at is null` と `expires_at > now` を条件にした PATCH にする。条件に合う行だけが更新されて返るので、同じ券で2回呼ぶと2回目は空になる（原子的）。

```ts
import type { HandoffStore, TicketRecord } from 'browser-handoff/server';

interface Row {
  ticket_hash: string;
  subject_id: string;
  purpose: TicketRecord['purpose'];
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  payload: string | null;
}

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (t: string) => Date.parse(t);

const toRow = (r: TicketRecord): Row => ({
  ticket_hash: r.ticketHash,
  subject_id: r.subjectId,
  purpose: r.purpose,
  issued_at: iso(r.issuedAt),
  expires_at: iso(r.expiresAt),
  used_at: r.usedAt === null ? null : iso(r.usedAt),
  payload: r.payload,
});

const fromRow = (r: Row): TicketRecord => ({
  ticketHash: r.ticket_hash,
  subjectId: r.subject_id,
  purpose: r.purpose,
  issuedAt: ms(r.issued_at),
  expiresAt: ms(r.expires_at),
  usedAt: r.used_at === null ? null : ms(r.used_at),
  payload: r.payload,
});

export function postgrestStore(baseUrl: string, serviceKey: string): HandoffStore {
  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
  };
  const call = async (path: string, init: RequestInit): Promise<Row[]> => {
    const res = await fetch(`${baseUrl}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
    if (!res.ok) throw new Error(`handoff store: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as Row[]) : [];
  };
  const eq = (v: string) => `eq.${encodeURIComponent(v)}`;

  return {
    async put(record) {
      await call('handoff_tickets', { method: 'POST', body: JSON.stringify(toRow(record)) });
    },
    async get(ticketHash) {
      const rows = await call(`handoff_tickets?ticket_hash=${eq(ticketHash)}&limit=1`, { method: 'GET' });
      return rows[0] ? fromRow(rows[0]) : null;
    },
    async consume(ticketHash, now) {
      const rows = await call(
        `handoff_tickets?ticket_hash=${eq(ticketHash)}&used_at=is.null&expires_at=gt.${encodeURIComponent(iso(now))}`,
        { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ used_at: iso(now) }) },
      );
      return rows[0] ? fromRow(rows[0]) : null;
    },
    async revokeBySubject(subjectId, purpose, keepLatest, now) {
      await call('rpc/handoff_revoke_by_subject', {
        method: 'POST',
        body: JSON.stringify({ p_subject_id: subjectId, p_purpose: purpose, p_keep_latest: keepLatest, p_now: iso(now) }),
      });
    },
  };
}
```

GeoCutter のようにすでに REST の手元の道具（`SupabaseRestClient` など）があれば、`call` をそれに置き換えればよい。
