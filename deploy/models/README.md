# AI-Core-Modelle unter eigenem Namen

Die Nutzer sehen nur **AI Core Lite / Core / Ultra**, nie den Namen des Basismodells. Dafür gibt es zwei Schichten:

1. **Ollama:** `create-models.sh` legt jedes Modell unter eigenem Namen an (`aicore-lite`, `aicore-core`, `aicore-ultra`), mit festen Einstellungen und der AI-Core-Persönlichkeit.
2. **Server:** `MODEL_CATALOG` in der `.env` ordnet jedem Modell Anzeigename und Stufe (kostenlos oder Pro) zu. Der Browser bekommt nur neutrale Kennungen (`core/ai-core-lite`); den echten Namen kennt nur der Server.

| Name | Gruppe | Stufe | Basis | Arbeitsspeicher (ungefähr) |
|---|---|---|---|---|
| AI Core Lite | Kostenlos | gratis | Qwen 3.5 2B | 4 GB |
| AI Core Flink | Allrounder | Pro | Qwen 3.5 4B | 6 GB |
| AI Core Allrounder | Allrounder | Pro | Qwen 3.5 9B | 12 GB |
| AI Core Allrounder Plus | Allrounder | Pro | Gemma 4 12B | 16 GB |
| AI Core Allrounder Max | Allrounder | Pro | Qwen 3.8 27B | 24 GB |
| AI Core Turbo | Allrounder | Pro | Gemma 4 26B (Mixture-of-Experts, schnell) | 24 GB |
| AI Core Denker | Denken | Pro | DeepSeek-R1 8B | 8 GB |
| AI Core Denker Plus | Denken | Pro | DeepSeek-R1 14B | 16 GB |
| AI Core Denker Max | Denken | Pro | DeepSeek-R1 32B | 32 GB |
| AI Core Analyst | Denken | Pro | gpt-oss 20B | 20 GB |
| AI Core Mathe | Denken | Pro | Phi-4 14B | 16 GB |
| AI Core Coder Klein | Programmieren | Pro | Qwen2.5-Coder 7B | 8 GB |
| AI Core Coder | Programmieren | Pro | Qwen3-Coder 30B (Mixture-of-Experts) | 24 GB |
| AI Core Coder Plus | Programmieren | Pro | Devstral Small 2 | 20 GB |
| AI Core Vision Klein | Bilder | Pro | Qwen3-VL 2B | 4 GB |
| AI Core Vision | Bilder | Pro | Qwen3-VL 8B | 10 GB |

**Wichtig:** Die neueren Familien (Qwen 3.5 und 3.8, Gemma 4, gpt-oss, Qwen3-Coder, Qwen3-VL) laufen nur mit einer **aktuellen Ollama-Version**. Erst Ollama aktualisieren (`curl -fsSL https://ollama.com/install.sh | sh`), dann `ollama --version` prüfen. Die Namen und Größen stammen aus Übersichtsartikeln vom November 2026; ich konnte sie nicht direkt auf ollama.com nachsehen. Meldet das Skript „Modell nicht gefunden“, passt du den Basisnamen in `models.list` an.

**Auf einem Rechner ohne Grafikkarte** sind die kleinen Modelle (Lite, Flink, Vision Klein) und die Mixture-of-Experts-Modelle (Turbo, Coder) am sinnvollsten, weil sie pro Wort nur wenige Parameter lesen. Die dichten großen Modelle (Denker Max, Allrounder Max) sind dort sehr langsam.

**Denkmodus:** Lite, Flink und Allrounder (Qwen 3.5) sind so eingestellt, dass sie nicht erst lange nachdenken (`schnell` im Katalog). Alle anderen denken, wo das Modell es kann; das Nachdenken erscheint im Chat als einklappbarer Denkblock.

**Nutzer sehen nur Modelle, die du wirklich installiert hast.** Du musst nicht alle laden: Fang mit zwei oder drei an, die auf den Tiny passen (zum Beispiel Lite, Allrounder, Denker). Jedes Modell, das du später per Skript nachlegst, erscheint automatisch in der Liste (Server neu starten oder die Seite neu laden).

```bash
./create-models.sh list           # alle Modelle mit Speicherbedarf
./create-models.sh aicore-coder   # ein Modell anlegen
./create-models.sh all            # alle (lädt sehr viele GB)
```

Als Besitzer kannst du Modelle auch in der Oberfläche laden und löschen (Einstellungen → Modelle verwalten). Das ist kostenlos und nur für dich sichtbar.

**Stärkste Stufe über die Cloud:** Trägst du `CLOUD_API_KEY` ein, kannst du im Katalog ein Cloud-Modell als Pro-Stufe führen, zum Beispiel
`cloud/deepseek-flash|AI Core Ultra|pro|am gründlichsten`. Das ist der Weg zu deutlich besseren Antworten, als ein Tiny je liefern kann.

## Lizenzen (wichtig, wenn du Modelle unter eigenem Namen anbietest)

- Laut dem Übersichtsartikel vom November 2026 stehen unter **Apache 2.0**: Qwen 3.5, Qwen 3.8, Gemma 4 (früher eigene Gemma-Bedingungen!), gpt-oss, Qwen3-Coder, Devstral Small 2 und Qwen3-VL; unter **MIT**: DeepSeek-R1. Qwen2.5-Coder 7B und Phi-4 sind nach meinem Kenntnisstand Apache 2.0 bzw. MIT. Apache 2.0 und MIT erlauben Umbenennen und Verkaufen, verlangen aber, dass Lizenztext und Urheberhinweis erhalten bleiben (zum Beispiel in deinen AGB oder einer Lizenzseite).
- **Das stammt nicht aus den Lizenztexten selbst.** Prüfe jede Lizenz auf der Modellseite, bevor du Pro verkaufst (`ollama show --license NAME` zeigt sie).
- **Nicht** unter fremdem Namen anbieten: **Llama** (verlangt „Built with Llama“ im Namen) und ältere **Gemma**-Versionen mit eigenen Nutzungsbedingungen.

## Was „abstimmen“ hier bedeutet

Feintuning großer Modelle braucht Grafikkarten und Trainingsdaten; auf dem Tiny ist das nicht möglich. Die Modelle werden über Persönlichkeit, Antwortstil und feste Einstellungen angepasst. Das macht Antworten einheitlich und sauber, hebt aber die Grundfähigkeit des Modells nicht auf das Niveau großer Spitzenmodelle. Mehr Qualität bekommst du durch größere Modelle (Cloud-Stufe).
