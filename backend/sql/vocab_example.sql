-- example — exempelmening på ett gloskort.
--
-- Egen kolumn på cards, inte återanvänd logg: logg betyder
-- CORRECTED/EXTERNAL-märkning i hela resten av kodbasen (se loggDisplay() i
-- frontend), och att lägga en exempelmening där skulle göra den betydelsen
-- osann för en av tre korttyper. Kolumnen är per kort och skalär — samma
-- form som text och extra — så den hör hemma på raden.
--
-- Nullbar och utan default: befintliga cloze- och qa-kort har ingen
-- exempelmening och ska inte få en tom sträng som ser ut som data.
-- Exporten läser den som `c.example or ''`.
--
-- Ingen datamigrering behövs — inga befintliga kort har exempelmeningar.
--
-- ⚠️ KÖRS I SUPABASE SQL EDITOR *INNAN* BACKEND DEPLOYAS.
--
-- Det här är inte en glos-specifik migrering i praktiken. SQLAlchemy listar
-- alla mappade kolumner i sina SELECT:er, så i samma sekund som example finns
-- på CardModel men inte i tabellen fallerar VARJE läsning av cards med
-- UndefinedColumn — GET /api/cards, /api/export och /api/explain, för alla
-- korttyper, inte bara glosor.
--
-- Ordningen är alltså: kör den här, verifiera, deploya sedan.

alter table cards add column if not exists example text;

-- Inget index: kolumnen läses alltid tillsammans med sitt kort, aldrig som
-- sökvillkor.
