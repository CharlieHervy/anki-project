import genanki
import random

def generate_model_id() -> int:
    """
    Stabilt modell-ID — ändra aldrig detta värde utan att återskapa
    alla befintliga kortlekar, annars uppstår duplicerade modeller i Anki.
    """
    return 1607392319


def create_anki_model() -> genanki.Model:
    """
    Skapar Anki-kortmallen med Dimindo-designsystemet.
    - Korttext: DM Serif Display
    - Extra-fält: DM Sans, separerat med --rule-linje
    - Cloze-svar (baksidan): --gold, fetstil
    - Logg-fältet: finns i fields-listan men renderas aldrig i kortmallen
    - Nattläge: inverterade men varumärkestrogna färger
    """

    css = """
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&display=swap');

/* ── CSS-variabler (ljusläge) ──────────────────────────────── */
:root {
  --ink:    #0d0d0d;
  --paper:  #f7f5f0;
  --cream:  #ede9e1;
  --rule:   #d8d3c8;
  --muted:  #8a8478;
  --gold:   #c9a84c;
}

/* ── Grundkort ─────────────────────────────────────────────── */
.card {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 1.05rem;
  line-height: 1.65;
  text-align: center;
  color: var(--ink);
  background-color: var(--paper);
  max-width: 640px;
  margin: 0 auto;
  padding: 40px 28px;
}

/* ── Cloze-lucka (framsidan) och cloze-svar (baksidan) ─────── */
.cloze {
  font-weight: bold;
  color: var(--gold);
}

/* ── Extra-fält ────────────────────────────────────────────── */
.extra-divider {
  width: 50%;
  margin: 22px auto 16px auto;
  border: none;
  border-top: 1px solid var(--rule);
}

.extra-text {
  font-family: 'DM Sans', sans-serif;
  font-weight: 300;
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.55;
}

/* ── Bild ──────────────────────────────────────────────────── */
.bild-container {
  margin-top: 20px;
}

.bild-container img {
  max-width: 100%;
  border-radius: 4px;
}

/* ── Nattläge ──────────────────────────────────────────────── */
.nightMode .card {
  --ink:   #e4e0d8;
  --paper: #1c1b18;
  --rule:  #3c3b38;
  --muted: #7a7870;
  color: var(--ink);
  background-color: var(--paper);
}

/* gold behålls oförändrad — fungerar på mörk bakgrund */
.nightMode .cloze {
  color: var(--gold);
}
"""

    qfmt = "{{cloze:Text}}"

    afmt = """{{cloze:Text}}

{{#Back Extra}}
<div class="extra-divider"></div>
<div class="extra-text">{{Back Extra}}</div>
{{/Back Extra}}

{{#Bild}}
<div class="bild-container">{{Bild}}</div>
{{/Bild}}"""

    return genanki.Model(
        generate_model_id(),
        'Cloze_Auto',
        fields=[
            {'name': 'Text'},
            {'name': 'Back Extra'},
            {'name': 'Logg'},   # Fältet finns för dataintegritet men renderas ej i mallen
            {'name': 'Bild'},
        ],
        templates=[
            {
                'name': 'Cloze_Auto',
                'qfmt': qfmt,
                'afmt': afmt,
            }
        ],
        css=css,
        model_type=genanki.Model.CLOZE
    )


def export_to_apkg(cards: list[dict], output_path: str) -> str:
    """
    Tar en lista av godkända kort och exporterar till .apkg-fil.
    Grupperar kort per kortlek (deck-fältet). Returnerar output_path.
    """
    model = create_anki_model()

    decks_dict: dict[str, genanki.Deck] = {}
    for card in cards:
        deck_name = card.get('deck', 'Huvudmeny')
        if deck_name not in decks_dict:
            deck_id = random.randrange(1 << 30, 1 << 31)
            decks_dict[deck_name] = genanki.Deck(deck_id, deck_name)

        note = genanki.Note(
            model=model,
            fields=[
                card.get('text', ''),
                card.get('extra', ''),
                card.get('logg', ''),   # Skickas till Logg-fältet men renderas ej
                card.get('bild', ''),
            ],
            tags=[card.get('tags', '')] if card.get('tags') else []
        )
        decks_dict[deck_name].add_note(note)

    package = genanki.Package(list(decks_dict.values()))
    package.write_to_file(output_path)

    return output_path