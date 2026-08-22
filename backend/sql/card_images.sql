-- card_images — användartillagda bilder på ett kort i granskningsvyn.
--
-- Egen tabell, inte en kolumn på cards: flera bilder per kort stöds, och
-- ordningen mellan dem är data (position), inte en egenskap hos kortet.
--
-- Ingen datamigrering behövs — det finns inga befintliga bilder.
--
-- Kör i Supabase SQL editor. Bucketen 'card-images' måste skapas separat
-- (Storage → New bucket → card-images, Public = av).

create table if not exists card_images (
    id           uuid primary key default gen_random_uuid(),
    card_id      uuid not null references cards(id) on delete cascade,
    storage_path text not null,
    position     integer not null default 0,
    created_at   timestamptz not null default now()
);

-- Enda läsmönstret: "alla bilder för de här korten, i ordning".
-- GET /api/cards hämtar hela sessionens bilder med en enda IN-fråga.
create index if not exists card_images_card_id_position_idx
    on card_images (card_id, position);

-- Samma auktoriseringsmodell som cards/sessions/user_quotas: appen använder
-- Clerk, inte Supabase Auth, så det finns ingen auth.uid() att skriva policies
-- mot. All åtkomst går via backend med service role, som förbigår RLS.
-- RLS på utan policies = anon- och authenticated-nycklar ser ingenting alls.
-- Ta bort raden om övriga tabeller medvetet körs med RLS av.
alter table card_images enable row level security;
