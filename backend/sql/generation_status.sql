-- status / error_message — gör genereringen oberoende av en enda öppen
-- anslutning (se kommentaren i main.py vid run_generation_pipeline()).
--
-- Bakgrunden: /api/generate körde tidigare hela pipelinen (preprocess →
-- generera → granska → spara) som EN lång SSE-ström. En stor generering kan
-- ta 10+ minuter, och en infrastrukturnivå-gräns på total anslutningstid
-- (inte vår egen idle-timeout) kan då döda anslutningen även om allt jobbar
-- som det ska — klienten ser "Something went wrong" trots att Claude redan
-- levererat och kostnaden redan är tagen.
--
-- Nu svarar /api/generate direkt med session_id, och pipelinen körs i en
-- bakgrundstråd som fortsätter oavsett vad som händer med klientens
-- anslutning. Frontend pollar GET /api/generate/{session_id}/status istället
-- för att läsa en strömmande anslutning.
--
-- status: 'processing' | 'reviewing' | 'done' | 'error'. NULL på sessioner
-- skapade innan detta fält fanns — inget pollar dem, så det är ofarligt.
--
-- ⚠️ KÖRS I SUPABASE SQL EDITOR *INNAN* BACKEND DEPLOYAS. Samma anledning som
-- i vocab_example.sql / preprocessed_source_material.sql: SQLAlchemy listar
-- alla mappade kolumner i sina SELECT:er, så i samma sekund som kolumnerna
-- finns på SessionModel men inte i tabellen fallerar VARJE läsning av
-- sessions med UndefinedColumn.

alter table sessions add column if not exists status text;
alter table sessions add column if not exists error_message text;

-- Inget index: pollingen läser alltid status för en specifik session via
-- primärnyckeln, aldrig som ett sökvillkor över flera sessioner.
