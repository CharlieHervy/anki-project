import genanki
import random
import tempfile
import os

def generate_model_id():
    """Genererar ett stabilt modell-ID baserat på kortmallens namn."""
    return 1607392319

def create_anki_model():
    """Skapar Anki-kortmallen (Cloze_Auto)."""
    return genanki.Model(
        generate_model_id(),
        'Cloze_Auto',
        fields=[
            {'name': 'Text'},
            {'name': 'Back Extra'},
            {'name': 'Logg'},
            {'name': 'Bild'},
        ],
        templates=[
            {
                'name': 'Cloze_Auto',
                'qfmt': '{{cloze:Text}}',
                'afmt': '''{{cloze:Text}}
<div class="extra-divider"></div>
<div class="extra-text">{{Back Extra}}</div>

{{#Logg}}
<div class="ghost-note">
  <span class="ghost-trigger">ⓘ Info</span>
  <div class="ghost-content">{{Logg}}</div>
</div>
{{/Logg}}

{{#Bild}}
<div style="margin-top: 20px;">
  {{Bild}}
</div>
{{/Bild}}''',
            }
        ],
        css='''.card {
  font-family: arial;
  font-size: 20px;
  line-height: 1.5;
  text-align: center;
  color: black;
  background-color: white;
}
.cloze {
  font-weight: bold;
  color: blue;
}
.nightMode .cloze {
  color: lightblue;
}
.extra-divider {
  width: 60%;
  margin: 20px auto 15px auto;
  border-top: 1px solid #cccccc;
}
.extra-text {
  font-size: 0.85em;
  color: #888888;
  line-height: 1.5;
}
.ghost-note {
  margin-top: 15px;
  margin-bottom: 15px;
  font-size: 0.8em;
  color: #888;
  text-align: center;
}
.ghost-content {
  display: none;
  background: #f9f9f9;
  border-radius: 5px;
  padding: 10px;
  margin-top: 5px;
}
.ghost-note:hover .ghost-content,
.ghost-note:active .ghost-content {
  display: block;
  color: #444;
}
.ghost-trigger {
  cursor: help;
  border-bottom: 1px dotted #888;
}
.nightMode .ghost-content {
  background: #2a2a2a;
  color: #ccc;
  border: 1px solid #444;
}''',
        model_type=genanki.Model.CLOZE
    )


def export_to_apkg(cards: list[dict], output_path: str) -> str:
    """
    Tar en lista av godkända kort och exporterar till .apkg-fil.
    Returnerar sökvägen till den skapade filen.
    """
    model = create_anki_model()

    # Gruppera kort per kortlek
    decks_dict = {}
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
                card.get('logg', ''),
                card.get('bild', ''),
            ],
            tags=[card.get('tags', '')] if card.get('tags') else []
        )
        decks_dict[deck_name].add_note(note)

    # Bygg paketet med alla kortlekar
    package = genanki.Package(list(decks_dict.values()))
    package.write_to_file(output_path)

    return output_path