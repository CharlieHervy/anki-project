import genanki
import random

CLOZE_MODEL_ID = 1607392319
BASIC_MODEL_ID = 1607392320
VOCAB_MODEL_ID = 1607392321


def create_cloze_model() -> genanki.Model:
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
  max-height: 400px;
  object-fit: contain;
  display: block;
  margin: 0 auto;
  border-radius: 4px;
}

/* Flera bilder på samma kort staplas — utan detta ligger de kant i kant. */
.bild-container img + img {
  margin-top: 10px;
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
        CLOZE_MODEL_ID,
        'Dimindo_Cloze',
        fields=[
            {'name': 'Text'},
            {'name': 'Back Extra'},
            {'name': 'Logg'},   # Finns för dataintegritet — renderas aldrig i mallen
            {'name': 'Bild'},
        ],
        templates=[
            {
                'name': 'Dimindo_Cloze',
                'qfmt': qfmt,
                'afmt': afmt,
            }
        ],
        css=css,
        model_type=genanki.Model.CLOZE
    )


def create_basic_model() -> genanki.Model:
    """
    Dimindo_Basic notetype for Q&A cards.
    Front = question (Text field), Back = answer (Extra field).
    Uses the same CSS as Dimindo_Cloze for visual consistency.
    Stable model ID — never change BASIC_MODEL_ID once cards are in the wild.
    """
    css = """
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&display=swap');

.card {
  background-color: #f7f5f0 !important;
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 16px;
  color: #0d0d0d;
  padding: 24px 16px;
  min-height: 100%;
  box-sizing: border-box;
}

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
/* Basic har inget eget Bild-fält (se export_to_apkg) — bildmarkupen läggs
   in i Back-fältet och bär den här klassen, så regeln matchar Cloze. */
.bild-container {
  margin-top: 16px;
}

.bild-container img {
  max-width: 100%;
  max-height: 400px;
  object-fit: contain;
  display: block;
  margin: 0 auto;
  border-radius: 4px;
}

/* Flera bilder på samma kort staplas — utan detta ligger de kant i kant. */
.bild-container img + img {
  margin-top: 10px;
}
"""

    qfmt = '<div class="dimindo-card">{{Front}}</div>'
    afmt = """<div class="dimindo-card">{{Front}}
{{#Back}}
<div class="extra-text">{{Back}}</div>
{{/Back}}
</div>"""

    return genanki.Model(
        BASIC_MODEL_ID,
        'Dimindo_Basic',
        fields=[
            {'name': 'Front'},
            {'name': 'Back'},
            {'name': 'Logg'},
        ],
        templates=[{
            'name': 'Dimindo_Basic',
            'qfmt': qfmt,
            'afmt': afmt,
        }],
        css=css,
        model_type=genanki.Model.FRONT_BACK
    )


def create_vocab_model() -> genanki.Model:
    """
    Dimindo_Vocab — glosor i Ankis "type in the answer"-format.

    Egen notetyp, inte en variant av Dimindo_Basic: fältuppsättningen skiljer
    (Image i stället för Logg) och mallen bygger på {{type:Back}}, som gör
    kortet till ett skrivkort i stället för ett klicka-för-att-visa-kort.

    INGET Logg-fält. Glosor granskas aldrig i efterhand mot källan, så det
    finns ingen CORRECTED/EXTERNAL-märkning att bära.

    Samma designtokens som Cloze/Basic (papper, vit kortbox, DM Serif Display),
    men centrerad layout — ett gloskort är ett kort ord, inte löptext.

    {{type:Back}} ligger på BÅDA sidorna, enligt Ankis standardmall: det är
    förekomsten på framsidan som renderar själva inmatningsfältet. Ligger den
    bara på baksidan får användaren inget att skriva i.

    Stabilt model_id — ändra aldrig VOCAB_MODEL_ID när kort väl är ute.
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

/* ── Kortbox — vit, kantad. Centrerad: ett gloskort är ett ord. ── */
.dimindo-card {
  background: #ffffff !important;
  border: 1px solid #d8d3c8;
  border-radius: 4px;
  padding: 20px 22px;
  max-width: 640px;
  margin: 0 auto;
  text-align: center;
  font-size: 1.05rem;
  line-height: 1.65;
  color: #0d0d0d;
}

/* ── Inmatningsfältet som {{type:Back}} renderar på framsidan ──
   Anki ger fältet id="typeans". Rätt/fel-markeringen på baksidan är
   Ankis egen rendering och styrs inte härifrån. */
#typeans {
  font-family: 'DM Sans', sans-serif;
  font-size: 0.95rem;
  padding: 6px 10px;
  margin-top: 14px;
  border: 1px solid #d8d3c8;
  border-radius: 3px;
  background: #ffffff;
  color: #0d0d0d;
  outline: none;
}
#typeans:focus { border-color: #b8a06a; }

/* ── Skiljelinjen mellan fråga och svar på baksidan ─────────── */
hr#answer {
  border: none;
  border-top: 1px solid #ede9e1;
  margin: 16px 0;
}

/* ── Exempelmening ──────────────────────────────────────────
   Samma roll som .extra-text i Cloze/Basic: stödtext på baksidan, avdelad
   med en hårfin linje i samma cream-ton som hr#answer. Kursivt eftersom
   meningen till största delen är målspråk — normal sättning för citerat
   främmande språk. Ingen citattecken: strängen slutar med den svenska
   översättningen inom parentes, och ett avslutande citattecken efter den
   parentesen skulle påstå att översättningen också är citerad. */
.example-sentence {
  font-family: 'DM Serif Display', Georgia, serif;
  font-style: italic;
  font-size: 0.95rem;
  line-height: 1.6;
  color: #0d0d0d;
  border-top: 1px solid #ede9e1;
  padding-top: 14px;
  margin-top: 16px;
}

/* ── Bild ───────────────────────────────────────────────────── */
.image-container {
  margin-top: 16px;
}

.image-container img {
  max-width: 100%;
  max-height: 400px;
  object-fit: contain;
  display: block;
  margin: 0 auto;
  border-radius: 4px;
}

/* Flera bilder på samma kort staplas — utan detta ligger de kant i kant. */
.image-container img + img {
  margin-top: 10px;
}
"""

    # Framsidan rör aldrig Example: meningen innehåller svaret, och att visa
    # den innan man svarat vore att lämna ut facit.
    qfmt = '<div class="dimindo-card">{{Front}}<br>{{type:Back}}</div>'

    afmt = """<div class="dimindo-card">{{Front}}
<hr id=answer>
{{type:Back}}
{{#Example}}
<div class="example-sentence">{{Example}}</div>
{{/Example}}
{{#Image}}
<div class="image-container">{{Image}}</div>
{{/Image}}
</div>"""

    return genanki.Model(
        VOCAB_MODEL_ID,
        'Dimindo_Vocab',
        fields=[
            {'name': 'Front'},
            {'name': 'Back'},
            {'name': 'Image'},
            # Example ligger sist: fältordningen är en del av notetypens schema,
            # och ett nytt fält på slutet är den enda tilläggsformen som inte
            # flyttar befintliga fält. Ofarligt just nu — notetypen har aldrig
            # importerats någonstans — men vanan är värd att hålla.
            {'name': 'Example'},
        ],
        templates=[{
            'name': 'Dimindo_Vocab',
            'qfmt': qfmt,
            'afmt': afmt,
        }],
        css=css,
        model_type=genanki.Model.FRONT_BACK
    )


def export_to_apkg(
    cards: list[dict],
    output_path: str,
    media_files: list[str] | None = None,
) -> str:
    """
    Tar en lista av godkända kort och exporterar till .apkg-fil.
    Grupperar kort per kortlek (deck-fältet). Returnerar output_path.

    card_type väljer notetyp: 'vocab' → Dimindo_Vocab, 'qa' → Dimindo_Basic,
    allt annat → Dimindo_Cloze. Valet sker per kort, så ett paket med blandade
    typer är giltigt — men en session innehåller i praktiken bara en typ,
    eftersom varje genereringsväg har sin egen endpoint och skriver sin egen.

    media_files är absoluta sökvägar till bildfiler på disk. genanki läser dem
    vid write_to_file och lagrar dem i paketet under enbart sitt basename
    (Package.write_to_file: os.path.basename), så namnen MÅSTE vara unika över
    hela paketet — annars skriver ett korts bild över ett annats vid import.
    Anroparen ansvarar för namngivningen; se /api/export i main.py.
    """
    cloze_model = create_cloze_model()
    basic_model = create_basic_model()
    vocab_model = create_vocab_model()

    decks_dict: dict[str, genanki.Deck] = {}
    for card in cards:
        deck_name = card.get('deck', 'Huvudmeny')
        if deck_name not in decks_dict:
            deck_id = random.randrange(1 << 30, 1 << 31)
            decks_dict[deck_name] = genanki.Deck(deck_id, deck_name)

        if card.get('card_type') == 'vocab':
            # Dimindo_Vocab har ett eget Image-fält, till skillnad från
            # Dimindo_Basic: notetypen är ny, så det finns ingen befintlig
            # installation vars schema en fältutökning skulle krocka med.
            # Bildmarkupen kan därför ligga i sitt eget fält i stället för
            # att bakas in i svaret — och måste göra det: Back matchas
            # tecken för tecken mot det användaren skrivit.
            note = genanki.Note(
                model=vocab_model,
                fields=[
                    card.get('text', ''),
                    card.get('extra', ''),
                    card.get('bild', ''),
                    card.get('example', ''),
                ],
                tags=[card.get('tags', '')] if card.get('tags') else []
            )
        elif card.get('card_type') == 'qa':
            # Dimindo_Basic har medvetet INGET Bild-fält. Att lägga till ett
            # fält ändrar notetypens schema, och Anki matchar notetyper på
            # model_id vid import: en användare som redan har Dimindo_Basic i
            # sin samling skulle få korten importerade under en andra,
            # suffixad notetyp i stället för sin befintliga. Bildmarkupen
            # läggs därför i Back-fältet, inuti samma .bild-container som
            # Cloze använder — samma rendering, noll schemaändring.
            back = card.get('extra', '')
            bild = card.get('bild', '')
            if bild:
                back = f'{back}<div class="bild-container">{bild}</div>'
            note = genanki.Note(
                model=basic_model,
                fields=[
                    card.get('text', ''),
                    back,
                    card.get('logg', ''),
                ],
                tags=[card.get('tags', '')] if card.get('tags') else []
            )
        else:
            note = genanki.Note(
                model=cloze_model,
                fields=[
                    card.get('text', ''),
                    card.get('extra', ''),
                    card.get('logg', ''),
                    card.get('bild', ''),
                ],
                tags=[card.get('tags', '')] if card.get('tags') else []
            )
        decks_dict[deck_name].add_note(note)

    package = genanki.Package(list(decks_dict.values()), media_files=media_files or [])
    package.write_to_file(output_path)

    return output_path