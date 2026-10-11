-- preprocessed_source_material — källtexten omstrukturerad av
-- preprocess_source_material() i generator.py, innan den skickas vidare till
-- generate_cards_stream() och review_cards().
--
-- Egen kolumn, inte en overskrivning av source_material: source_material
-- förblir orörd (originalet användaren laddade upp), så att en eventuell
-- framtida visningsfunktion kan jämföra de två. Detta är framtidssäkring,
-- inte något som exponeras i UI idag.
--
-- Nullbar utan default. Om preprocessing-steget fallerar (exception, timeout,
-- tomt svar) returneras source_material oförändrat och sparas även här — då
-- blir de två kolumnerna identiska, vilket är en giltig och förväntad
-- datapunkt, inte ett fel att särskilja. I bildläge (ingen riktig källtext,
-- se ResolvedSource i main.py) körs preprocessing-steget inte alls, och
-- kolumnerna blir likaså identiska (båda får platshållartexten).
--
-- ⚠️ KÖRS I SUPABASE SQL EDITOR *INNAN* BACKEND DEPLOYAS.
--
-- Samma anledning som i vocab_example.sql: SQLAlchemy listar alla mappade
-- kolumner i sina SELECT:er, så i samma sekund som kolumnen finns på
-- SessionModel men inte i tabellen fallerar VARJE läsning av sessions med
-- UndefinedColumn — /api/generate, GET /api/sessions, GET
-- /api/sessions/{id}/source, för alla sessioner.
--
-- Ordningen är alltså: kör den här, verifiera, deploya sedan.

alter table sessions add column if not exists preprocessed_source_material text;

-- Inget index: kolumnen läses alltid tillsammans med sin session, aldrig som
-- sökvillkor.
