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
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

.card {
  background-color: #2a2f36 !important;
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 16px;
  color: #16181b;
  padding: 24px 16px;
  min-height: 100%;
  box-sizing: border-box;
  text-rendering: optimizeLegibility;
}

.dimindo-card {
  background: #ffffff !important;
  border: 1px solid #3a414b;
  border-radius: 6px;
  padding: 28px 30px;
  max-width: 680px;
  margin: 0 auto;
  text-align: left;
  font-size: 1.125rem;     /* 18 px */
  line-height: 1.6;
  color: #16181b;
}

.cloze {
  background: #dde6f0 !important;
  color: #0b0f14 !important;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.extra-text {
  font-family: inherit;
  font-weight: 400;
  font-size: 0.9em;        /* ≈ 16 px */
  color: #454d5a;
  line-height: 1.55;
  border-top: 1px solid #e3e6ea;
  padding-top: 12px;
  margin-top: 14px;
}

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
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

.card {
  background-color: #2a2f36 !important;
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 16px;
  color: #16181b;
  padding: 24px 16px;
  min-height: 100%;
  box-sizing: border-box;
  text-rendering: optimizeLegibility;
}

.dimindo-card {
  background: #ffffff !important;
  border: 1px solid #3a414b;
  border-radius: 6px;
  padding: 28px 30px;
  max-width: 680px;
  margin: 0 auto;
  text-align: left;
  font-size: 1.125rem;     /* 18 px */
  line-height: 1.6;
  color: #16181b;
}

.cloze {
  background: #dde6f0 !important;
  color: #0b0f14 !important;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.extra-text {
  font-family: inherit;
  font-weight: 400;
  font-size: 0.9em;        /* ≈ 16 px */
  color: #454d5a;
  line-height: 1.55;
  border-top: 1px solid #e3e6ea;
  padding-top: 12px;
  margin-top: 14px;
}

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
@import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap');

.card {
  background-color: #2a2f36 !important;
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 16px;
  color: #16181b;
  padding: 24px 16px;
  min-height: 100%;
  box-sizing: border-box;
  text-rendering: optimizeLegibility;
}

.dimindo-card {
  background: #ffffff !important;
  border: 1px solid #3a414b;
  border-radius: 6px;
  padding: 28px 30px;
  max-width: 680px;
  margin: 0 auto;
  text-align: center;
  font-size: 1.25rem;      /* 20 px */
  line-height: 1.5;
  color: #16181b;
}

#typeans {
  font-family: inherit;
  font-size: 1.1rem;
  padding: 10px 14px;
  margin-top: 18px;
  border: 1px solid #c3c9d1;
  border-radius: 4px;
  background: #ffffff;
  color: #16181b;
  outline: none;
}
#typeans:focus {
  border-color: #5b7fa8;
  box-shadow: 0 0 0 3px rgba(91, 127, 168, 0.25);
}

hr#answer {
  border: none;
  border-top: 1px solid #e3e6ea;
  margin: 20px 0;
}

.example-sentence {
  font-family: inherit;
  font-style: italic;
  font-size: 0.85em;       /* ≈ 17 px */
  line-height: 1.55;
  color: #2b3038;
  border-top: 1px solid #e3e6ea;
  padding-top: 16px;
  margin-top: 20px;
}

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