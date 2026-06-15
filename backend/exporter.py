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

    Utseende matchar exakt granskningsvy i page.tsx:
    - Sidbakgrund: #f7f5f0 (paper), tvingat med !important
    - Kortbox: vit, border 1px solid #d8d3c8, border-radius 4px
    - Cloze-svar: cream-highlight (#ede9e1), inte guld
    - Extra: border-top #ede9e1, font DM Sans, color #8a8478
    - Logg: renderas aldrig
    - Nattläge: ignoreras, ljust läge tvingas med !important
    """

    css = """
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&display=swap');

/* ── Sidbakgrund — pappersfärg ─────────────────────────────── */
.card {
  background-color: #f7f5f0 !important;
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 16px;
  color: #0d0d0d;
  padding: 24px 16px;
  min-height: 100%;
  box-sizing: border-box;
}

/* ── Kortbox — vit, kantad, lätt skugga ────────────────────── */
.dimindo-card {
  background: #ffffff !important;
  border: 1px solid #d8d3c8;
  border-radius: 4px;
  padding: 20px 22px;
  max-width: 640px;
  margin: 0 auto;
  text-align: left;
  font-size: 0.9rem;
  line-height: 1.65;
  color: #0d0d0d;
}

/* ── Cloze: cream-highlight (identiskt med granskningsvyn) ─── */
/* Gäller både [...]‐luckan på framsidan och svaret på baksidan */
.cloze {
  background: #ede9e1 !important;
  color: #0d0d0d !important;
  padding: 1px 4px;
  border-radius: 2px;
  font-weight: 500;
}

/* ── Extra-fält ─────────────────────────────────────────────── */
.extra-text {
  font-family: 'DM Sans', sans-serif;
  font-weight: 300;
  font-size: 0.82rem;
  color: #8a8478;
  line-height: 1.55;
  border-top: 1px solid #ede9e1;
  padding-top: 8px;
  margin-top: 8px;
}

/* ── Bild ───────────────────────────────────────────────────── */
.bild-container {
  margin-top: 16px;
}

.bild-container img {
  max-width: 100%;
  border-radius: 4px;
}
"""

    # Framsidan: kortboxen wrappas i .dimindo-card
    qfmt = '<div class="dimindo-card">{{cloze:Text}}</div>'

    # Baksidan: svar + extra (Logg renderas ej)
    afmt = """<div class="dimindo-card">{{cloze:Text}}

{{#Back Extra}}
<div class="extra-text">{{Back Extra}}</div>
{{/Back Extra}}

{{#Bild}}
<div class="bild-container">{{Bild}}</div>
{{/Bild}}
</div>"""

    return genanki.Model(
        generate_model_id(),
        'Cloze_Auto',
        fields=[
            {'name': 'Text'},
            {'name': 'Back Extra'},
            {'name': 'Logg'},   # Finns för dataintegritet — renderas aldrig i mallen
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